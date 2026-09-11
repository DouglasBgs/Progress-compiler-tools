import * as net from 'net';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../logger';
import { WorkerInstance, WorkerJobResult, WorkerCallbacks } from './worker-instance';
import { WorkerPoolConfig, WorkerDbSettings, WorkerOptions } from './worker-protocol';

export function nextDailyRestart(now: Date = new Date()): Date {
    const next = new Date(now);
    next.setHours(2, 0, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next;
}

export function workerContextKey(dbType: string, settings: WorkerDbSettings): string {
    const normalize = (value?: string) => {
        if (!value) return '';
        return process.platform === 'win32'
            ? path.win32.normalize(value).toLowerCase()
            : path.normalize(value);
    };
    return JSON.stringify([settings.repository || '', dbType, normalize(settings.pf), normalize(settings.ini)]);
}

type WorkerFactory = (id: string, db: string, settings: WorkerDbSettings,
    options: WorkerOptions, callbacks: WorkerCallbacks) => WorkerInstance;
interface PendingJob {
    jobId: string;
    baseTempPath: string;
    reportPath: string;
    sources: string[];
    onStart?: () => void;
    resolve: (result: WorkerJobResult) => void;
    reject: (error: Error) => void;
}
interface Slot {
    worker?: WorkerInstance;
    recovering: boolean;
    failures: number;
    retryTimer?: NodeJS.Timeout;
}
interface Pool {
    key: string;
    dbType: string;
    settings: WorkerDbSettings;
    slots: Slot[];
    queue: PendingJob[];
    unavailableTimer?: NodeJS.Timeout;
    lastFailure?: string;
}

export class WorkerManager {
    private tcpServer: net.Server | null = null;
    private pools = new Map<string, Pool>();
    private allWorkersById = new Map<string, WorkerInstance>();
    private sockets = new Set<net.Socket>();
    private isRunning = false;
    private dailyRestartTimer: NodeJS.Timeout | null = null;
    private nextRestartAt: Date | null = null;
    private shutdownPromise?: Promise<void>;

    constructor(
        private config: WorkerPoolConfig,
        private databasesConfig: Record<string, WorkerDbSettings>,
        private createWorker: WorkerFactory = (id, db, settings, options, callbacks) =>
            new WorkerInstance(id, db, settings, options, callbacks)
    ) {
        if (!Number.isInteger(config.workersPerDb) || config.workersPerDb < 1) {
            throw new Error('workerPool.workersPerDb deve ser um inteiro maior que zero.');
        }
        for (const [name, value] of Object.entries({ jobTimeoutMs: config.jobTimeoutMs,
            startupTimeoutMs: config.startupTimeoutMs, heartbeatIntervalMs: config.heartbeatIntervalMs,
            heartbeatTimeoutMs: config.heartbeatTimeoutMs })) {
            if (value !== undefined && (!Number.isFinite(value) || value <= 0 || value > 2147483647)) {
                throw new Error(`workerPool.${name} deve ser um tempo positivo em milissegundos.`);
            }
        }
    }

    public async initialize(contexts?: Array<{ dbType: string; settings: WorkerDbSettings }>): Promise<void> {
        if (!this.config.enabled) throw new Error('O pool de workers deve estar habilitado para compilar.');
        if (this.tcpServer) throw new Error('WorkerManager já inicializado.');
        await new Promise<void>((resolve, reject) => {
            this.tcpServer = net.createServer(socket => this.handleIncomingSocket(socket));
            this.tcpServer.once('error', reject);
            this.tcpServer.listen(this.config.port, '127.0.0.1', () => {
                this.tcpServer!.removeListener('error', reject);
                this.tcpServer!.on('error', err => logger.error('WorkerManager', 'Erro TCP', { error: err.message }));
                this.isRunning = true;
                resolve();
            });
        });
        const initialContexts = contexts ?? (this.config.prewarmDatabases || []).map(dbType => ({
            dbType, settings: this.databasesConfig[dbType]
        }));
        for (const { dbType, settings } of initialContexts) {
            if (settings?.pf?.trim()) this.ensurePool(dbType, settings);
        }
        this.scheduleDailyRestart();
    }

    private handleIncomingSocket(socket: net.Socket): void {
        this.sockets.add(socket);
        socket.on('close', () => this.sockets.delete(socket));
        socket.on('error', err => logger.warn('WorkerManager', 'Erro de conexão TCP', { error: err.message }));
        socket.setTimeout(10000, () => socket.destroy());
        let buffer = '';
        const onData = (chunk: Buffer) => {
            buffer += chunk.toString('utf8');
            if (buffer.length > 16384) { socket.destroy(); return; }
            const end = buffer.indexOf('\n');
            if (end < 0) return;
            try {
                const msg = JSON.parse(buffer.slice(0, end));
                const worker = this.allWorkersById.get(msg.workerId);
                if (msg.action !== 'REGISTER' || !worker || worker.state !== 'starting') {
                    socket.destroy(); return;
                }
                socket.removeListener('data', onData);
                socket.setTimeout(0);
                worker.attachSocket(socket);
                const remaining = buffer.slice(end + 1);
                if (remaining) socket.emit('data', Buffer.from(remaining, 'utf8'));
            } catch (error) {
                socket.destroy();
            }
        };
        socket.on('data', onData);
    }

    private ensurePool(dbType: string, settings: WorkerDbSettings): Pool {
        const key = workerContextKey(dbType, settings);
        const existing = this.pools.get(key);
        if (existing) return existing;
        const pool: Pool = { key, dbType, settings: { ...settings }, slots: [], queue: [] };
        this.pools.set(key, pool);
        for (let index = 0; index < this.config.workersPerDb; index++) {
            const slot: Slot = { recovering: false, failures: 0 };
            pool.slots.push(slot);
            this.spawnWorker(pool, slot);
        }
        return pool;
    }

    private spawnWorker(pool: Pool, slot: Slot): void {
        if (!this.isRunning) return;
        const id = `w-${randomUUID()}`;
        const worker = this.createWorker(id, pool.dbType, pool.settings, {
            port: this.config.port,
            jobTimeoutMs: this.config.jobTimeoutMs ?? 30000,
            startupTimeoutMs: this.config.startupTimeoutMs ?? 60000,
            heartbeatIntervalMs: this.config.heartbeatIntervalMs ?? 30000,
            heartbeatTimeoutMs: this.config.heartbeatTimeoutMs ?? 10000
        }, {
            onStateChange: () => queueMicrotask(() => this.pump(pool)),
            onRecycleRequest: (w, reason) => { void this.recover(pool, slot, w, reason); }
        });
        slot.worker = worker;
        slot.recovering = false;
        this.allWorkersById.set(id, worker);
        worker.start();
    }

    private async recover(pool: Pool, slot: Slot, worker: WorkerInstance, reason: string): Promise<void> {
        if (slot.worker !== worker || slot.recovering || !this.isRunning) return;
        slot.recovering = true;
        pool.lastFailure = worker.lastError || reason;
        this.checkAvailability(pool);
        this.allWorkersById.delete(worker.id);
        if (reason === 'daily_restart' || Date.now() - worker.startedAt > 60000) slot.failures = 0;
        const delay = reason === 'daily_restart' ? 0 : Math.min(60000, 1000 * 2 ** Math.min(slot.failures++, 6));
        logger.warn('WorkerManager', 'Reiniciando worker', { workerId: worker.id, reason, retryDelayMs: delay });
        // Nunca inicia outro processo no slot antes da saída confirmada do anterior.
        await worker.kill();
        if (!this.isRunning) return;
        slot.retryTimer = setTimeout(() => {
            slot.retryTimer = undefined;
            this.spawnWorker(pool, slot);
        }, delay);
    }

    public async dispatchJob(jobId: string, dbType: string, baseTempPath: string, reportPath: string,
        sources: string[], settings: WorkerDbSettings = this.databasesConfig[dbType], onStart?: () => void
    ): Promise<WorkerJobResult> {
        if (!this.isRunning) throw new Error('Worker Pool encerrado ou indisponível.');
        if (!settings) throw new Error(`Contexto de compilação não configurado: ${dbType}`);
        const pool = this.ensurePool(dbType, settings);
        return new Promise((resolve, reject) => {
            pool.queue.push({ jobId, baseTempPath, reportPath, sources, onStart, resolve, reject });
            this.pump(pool);
        });
    }

    private pump(pool: Pool): void {
        if (!this.isRunning) return;
        this.checkAvailability(pool);
        for (const slot of pool.slots) {
            const worker = slot.worker;
            if (!pool.queue.length) break;
            if (slot.recovering || !worker?.isReady()) continue;
            const job = pool.queue.shift()!;
            try {
                // executeJob reserva o worker sincronamente, antes de retornar a Promise.
                const execution = worker.executeJob(job.jobId, job.baseTempPath, job.reportPath, job.sources);
                execution.then(job.resolve, job.reject).finally(() => this.pump(pool));
                job.onStart?.();
                logger.info('WorkerManager', 'Compilação atribuída ao worker', {
                    jobId: job.jobId, workerId: worker.id, dbType: pool.dbType, repository: pool.settings.repository, queued: pool.queue.length
                });
            } catch (error: any) { job.reject(error); }
        }
    }

    /** Limita apenas a indisponibilidade do contexto, não a fila de workers ocupados. */
    private checkAvailability(pool: Pool): void {
        const healthy = pool.slots.some(slot => !slot.recovering && slot.worker &&
            (slot.worker.isReady() || slot.worker.state === 'busy'));
        if (!this.isRunning || !pool.queue.length || healthy) {
            if (pool.unavailableTimer) clearTimeout(pool.unavailableTimer);
            pool.unavailableTimer = undefined;
            return;
        }
        if (pool.unavailableTimer) return;
        const timeout = this.config.startupTimeoutMs ?? 60000;
        pool.unavailableTimer = setTimeout(() => {
            pool.unavailableTimer = undefined;
            const message = `Contexto ${pool.settings.repository || '(padrão)'}/${pool.dbType} indisponível após ${timeout}ms. ` +
                `PF: ${pool.settings.pf || '(não configurado)'}. INI: ${pool.settings.ini || '(não configurado)'}. ` +
                `Última falha: ${pool.lastFailure || 'worker não concluiu o registro TCP'}. Consulte os logs [Progress].`;
            logger.error('WorkerManager', 'Contexto não ficou disponível; retornando erro aos jobs pendentes', {
                repository: pool.settings.repository, dbType: pool.dbType, queued: pool.queue.length, error: message
            });
            for (const job of pool.queue.splice(0)) job.reject(new Error(message));
        }, timeout);
    }

    public recycleAll(reason = 'manual'): void {
        logger.info('WorkerManager', 'Reinício solicitado; aguardando jobs ativos', { reason });
        for (const worker of this.allWorkersById.values()) worker.requestDailyRestart();
    }

    private scheduleDailyRestart(): void {
        this.nextRestartAt = nextDailyRestart();
        logger.info('WorkerManager', 'Próximo reinício às 02h locais do servidor', { scheduledAt: this.nextRestartAt.toISOString() });
        this.dailyRestartTimer = setTimeout(() => {
            if (!this.isRunning) return;
            this.recycleAll('daily_restart');
            this.scheduleDailyRestart();
        }, this.nextRestartAt.getTime() - Date.now());
    }

    public getStatus(): any {
        const workers: Record<string, any[]> = {};
        const contexts = [];
        for (const pool of this.pools.values()) {
            const list = pool.slots.filter(s => s.worker).map(s => ({
                id: s.worker!.id, repository: pool.settings.repository, state: s.worker!.state, isReady: !s.recovering && s.worker!.isReady(),
                jobCount: s.worker!.jobCount, lastUsedAt: new Date(s.worker!.lastUsedAt).toISOString()
            }));
            (workers[pool.dbType] ||= []).push(...list);
            contexts.push({ dbType: pool.dbType, repository: pool.settings.repository, pf: pool.settings.pf, ini: pool.settings.ini,
                lastFailure: pool.lastFailure, queued: pool.queue.length, capacity: pool.slots.length, workers: list });
        }
        return { enabled: this.isRunning, port: this.config.port, totalWorkers: this.allWorkersById.size,
            nextRestartAt: this.nextRestartAt?.toISOString(), workers, contexts };
    }

    public shutdown(): Promise<void> {
        if (this.shutdownPromise) return this.shutdownPromise;
        this.isRunning = false;
        if (this.dailyRestartTimer) clearTimeout(this.dailyRestartTimer);
        this.dailyRestartTimer = null;
        const stops: Promise<void>[] = [];
        for (const pool of this.pools.values()) {
            if (pool.unavailableTimer) clearTimeout(pool.unavailableTimer);
            for (const job of pool.queue.splice(0)) job.reject(new Error('Worker Pool encerrado.'));
            for (const slot of pool.slots) {
                if (slot.retryTimer) clearTimeout(slot.retryTimer);
                if (slot.worker) stops.push(slot.worker.kill());
            }
        }
        this.allWorkersById.clear();
        for (const socket of this.sockets) socket.destroy();
        if (this.tcpServer) {
            const server = this.tcpServer;
            stops.push(new Promise(resolve => server.close(() => resolve())));
            this.tcpServer = null;
        }
        this.shutdownPromise = Promise.all(stops).then(() => { this.pools.clear(); });
        return this.shutdownPromise;
    }
}
