import { ChildProcess, spawn } from 'child_process';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import { StringDecoder } from 'string_decoder';
import { logger } from '../logger';
import { CompileManifest, NodeToWorkerCommand, WorkerDbSettings, WorkerOptions, WorkerToNodeMessage } from './worker-protocol';

export type WorkerState = 'starting' | 'idle' | 'busy' | 'restarting' | 'stopped';
export interface WorkerJobResult { success: boolean; }
export interface WorkerCallbacks {
    onStateChange?: (worker: WorkerInstance) => void;
    onRecycleRequest?: (worker: WorkerInstance, reason: string) => void;
}
interface ActiveJob {
    id: string;
    resolve: (result: WorkerJobResult) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

export class WorkerInstance {
    public state: WorkerState = 'starting';
    public jobCount = 0;
    public lastUsedAt = Date.now();
    public startedAt = Date.now();
    public lastError?: string;
    private restartPending = false;
    private childProcess: ChildProcess | null = null;
    private processClosed: Promise<void> = Promise.resolve();
    private stopPromise?: Promise<void>;
    private socket: net.Socket | null = null;
    private decoder = new StringDecoder('utf8');
    private socketBuffer = '';
    private activeJob?: ActiveJob;
    private startupTimer?: NodeJS.Timeout;
    private heartbeatTimer?: NodeJS.Timeout;
    private pongTimer?: NodeJS.Timeout;

    constructor(public readonly id: string, public readonly dbType: string,
        public readonly dbSettings: WorkerDbSettings, private options: WorkerOptions,
        private callbacks: WorkerCallbacks = {}) {}

    public isReady(): boolean {
        return this.state === 'idle' && !this.restartPending && !!this.socket && !this.socket.destroyed;
    }

    public start(): void {
        this.startedAt = Date.now();
        const dlc = process.env.DLC || 'C:\\Progress\\OpenEdge';
        const executable = process.platform === 'win32' ? 'prowin.exe' : '_progres';
        const installed = path.join(dlc, 'bin', executable);
        const command = fs.existsSync(installed) ? installed : executable;
        const runtimeRoot = path.resolve(__dirname, '..');
        const scriptsRoot = path.basename(runtimeRoot) === 'src' ? path.dirname(runtimeRoot) : runtimeRoot;
        const daemon = path.join(scriptsRoot, 'scripts', '_worker_daemon.p');
        const args: string[] = ['-b'];
        // Não omitir silenciosamente configurações UNC inacessíveis: o AVM deve reportar o erro.
        if (this.dbSettings.pf) args.push('-pf', this.dbSettings.pf);
        if (this.dbSettings.ini) args.push('-ininame', this.dbSettings.ini);
        args.push('-p', daemon, '-param', `PORT=${this.options.port},WORKER_ID=${this.id}`, '-q');
        logger.info('WorkerInstance', 'Iniciando sessão persistente', { workerId: this.id, dbType: this.dbType, repository: this.dbSettings.repository, pf: this.dbSettings.pf, ini: this.dbSettings.ini, command, daemon });
        this.startupTimer = setTimeout(() => this.fail('startup_timeout', new Error('Timeout no registro do worker.')),
            this.options.startupTimeoutMs);
        try {
            const child = spawn(command, args, { windowsHide: true, detached: false, stdio: ['ignore', 'pipe', 'pipe'] });
            this.childProcess = child;
            this.processClosed = new Promise(resolve => {
                child.once('close', (code, signal) => {
                    this.childProcess = null;
                    resolve();
                    this.fail('process_exit', new Error(`Progress encerrou (código ${code}, sinal ${signal}).`));
                });
            });
            child.on('error', error => this.fail('process_error', error));
            // Drena as duas saídas para evitar bloqueio do processo e registrar erros de startup ABL/PF.
            child.stdout?.on('data', data => logger.info('Progress', String(data).trim().slice(0, 8192), { workerId: this.id }));
            child.stderr?.on('data', data => logger.error('Progress', String(data).trim().slice(0, 8192), { workerId: this.id }));
        } catch (error: any) { this.fail('spawn_error', error); }
    }

    /** O manager já validou o REGISTER antes de associar o socket. */
    public attachSocket(socket: net.Socket): void {
        if (this.state !== 'starting' || this.socket) { socket.destroy(); return; }
        clearTimeout(this.startupTimer);
        this.socket = socket;
        socket.setNoDelay(true);
        socket.on('data', (data: Buffer) => this.receive(data));
        socket.on('close', () => this.fail('socket_closed', new Error('Conexão com o worker encerrada.')));
        socket.on('error', error => this.fail('socket_error', error));
        this.heartbeatTimer = setInterval(() => {
            if (!this.isReady() || this.pongTimer) return;
            this.pongTimer = setTimeout(() => this.fail('heartbeat_timeout', new Error('Worker não respondeu ao heartbeat.')),
                this.options.heartbeatTimeoutMs);
            this.send({ action: 'PING' });
        }, this.options.heartbeatIntervalMs);
        this.setState('idle');
    }

    private receive(data: Buffer): void {
        this.socketBuffer += this.decoder.write(data);
        if (this.socketBuffer.length > 65536) { this.fail('protocol_error', new Error('Resposta do worker excedeu o limite.')); return; }
        let end: number;
        while ((end = this.socketBuffer.indexOf('\n')) >= 0) {
            const line = this.socketBuffer.slice(0, end).trim();
            this.socketBuffer = this.socketBuffer.slice(end + 1);
            if (!line) continue;
            try {
                const msg: WorkerToNodeMessage = JSON.parse(line);
                if (msg.action === 'PONG') {
                    clearTimeout(this.pongTimer); this.pongTimer = undefined;
                } else if (msg.action === 'DONE' && this.activeJob?.id === msg.jobId) {
                    if (typeof msg.success !== 'boolean') throw new Error('DONE sem success booleano.');
                    const job = this.activeJob;
                    this.activeJob = undefined;
                    clearTimeout(job.timer);
                    this.jobCount++;
                    this.lastUsedAt = Date.now();
                    if (msg.success) job.resolve({ success: true });
                    else job.reject(new Error(msg.error || 'Falha interna no worker Progress.'));
                    if (this.restartPending) this.restart();
                    else this.setState('idle');
                } else {
                    logger.warn('WorkerInstance', 'Mensagem fora do job ativo ignorada', { workerId: this.id, action: msg.action });
                }
            } catch (error: any) { this.fail('protocol_error', error); return; }
        }
    }

    public async executeJob(jobId: string, baseTempPath: string, reportPath: string, sources: string[]): Promise<WorkerJobResult> {
        if (!this.isReady()) throw new Error(`Worker ${this.id} não está disponível (${this.state}).`);
        const requestPath = path.join(baseTempPath, '_worker_request.json');
        const manifest: CompileManifest = { jobId, baseTempPath: baseTempPath.replace(/\\/g, '/'),
            reportPath: reportPath.replace(/\\/g, '/'), sources: sources.map(s => s.replace(/\\/g, '/')) };
        fs.writeFileSync(requestPath, JSON.stringify(manifest), 'utf8');
        this.setState('busy');
        this.lastUsedAt = Date.now();
        // Uma compilação pode bloquear o loop ABL; seu próprio timeout substitui o heartbeat.
        clearTimeout(this.pongTimer); this.pongTimer = undefined;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => this.fail('job_timeout', new Error(`Timeout de compilação (${this.options.jobTimeoutMs}ms).`)),
                this.options.jobTimeoutMs);
            this.activeJob = { id: jobId, resolve, reject, timer };
            this.send({ action: 'COMPILE', jobId, requestPath: requestPath.replace(/\\/g, '/') });
        });
    }

    private send(command: NodeToWorkerCommand): void {
        try {
            // ASCII no socket: evita cortar caracteres UTF-8 entre leituras ABL.
            const payload = JSON.stringify(command).replace(/[\u007f-\uffff]/g,
                char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')) + '\n';
            if (payload.length > 16384) throw new Error('Comando excedeu o limite de 16 KB.');
            if (!this.socket || this.socket.destroyed) throw new Error('Socket indisponível.');
            this.socket.write(payload, 'utf8', error => { if (error) this.fail('write_error', error); });
        } catch (error: any) { this.fail('write_error', error); }
    }

    public requestDailyRestart(): void {
        if (this.restartPending || this.state === 'stopped' || this.state === 'restarting') return;
        this.restartPending = true;
        if (this.state !== 'busy') this.restart();
    }

    private restart(): void {
        this.clearTimers();
        this.setState('restarting');
        this.callbacks.onRecycleRequest?.(this, 'daily_restart');
    }

    private fail(reason: string, error: Error): void {
        if (this.state === 'stopped' || this.state === 'restarting') return;
        this.lastError = error.message;
        this.clearTimers();
        this.setState('restarting');
        if (this.activeJob) {
            const job = this.activeJob;
            this.activeJob = undefined;
            void this.processClosed.then(() => job.reject(error));
        }
        logger.error('WorkerInstance', 'Falha da sessão persistente', { workerId: this.id, reason, error: error.message });
        this.callbacks.onRecycleRequest?.(this, reason);
    }

    private clearTimers(): void {
        clearTimeout(this.startupTimer);
        clearInterval(this.heartbeatTimer);
        clearTimeout(this.pongTimer);
        if (this.activeJob) clearTimeout(this.activeJob.timer);
    }

    public kill(): Promise<void> {
        if (this.stopPromise) return this.stopPromise;
        this.setState('stopped');
        this.clearTimers();
        if (this.activeJob) {
            const job = this.activeJob;
            this.activeJob = undefined;
            void this.processClosed.then(() => job.reject(new Error('Worker encerrado.')));
        }
        this.socket?.destroy();
        this.socket = null;
        if (this.childProcess) {
            try { this.childProcess.kill(); }
            catch (error: any) { logger.error('WorkerInstance', 'Falha ao encerrar processo', { workerId: this.id, error: error.message }); }
        }
        this.stopPromise = this.processClosed;
        return this.stopPromise;
    }

    private setState(state: WorkerState): void {
        this.state = state;
        this.callbacks.onStateChange?.(this);
    }
}
