import * as dotenv from 'dotenv';
dotenv.config();
import express, { Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { logger } from './logger';
import { AppDataSource } from './db/data-source';
import { createJobMetric, updateJobMetric } from './db/jobMetric.repository';
import { registerDashboardRoutes } from './dashboard/dashboard.routes';
import { WorkerManager } from './worker/worker-manager';
import { resolveRepositorySettings, resolvePrewarmContexts } from './worker/repository-context';
import { WorkerDbSettings } from './worker/worker-protocol';

let workerManager: WorkerManager | null = null;

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
registerDashboardRoutes(app);
app.use('/dashboard', express.static(path.join(__dirname, 'dashboard', 'public')));

// Configuração do Servidor HTTP + WebSocket
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

interface FilePayload {
    relativePath: string;
    contentBase64: string;
}

interface CompileJob {
    jobId: string;
    files: FilePayload[];
    dbType: string;
    machineName?: string;
    dbSettings: any;
    status: 'queued' | 'processing' | 'completed' | 'error';
    result?: any;
    errorMsg?: string;
    createdAt: number;
}

// Queue system for scalability
// A concorrência é controlada pelos slots persistentes de cada contexto.
let shuttingDown = false;
let activeJobs = 0;
const jobQueue: CompileJob[] = [];
const jobResults = new Map<string, CompileJob>();

// WebSocket clients tracking
const clients = new Map<string, WebSocket>();

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    // Expect client to pass jobId in url, e.g. ws://localhost:8080/?jobId=123
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const jobId = url.searchParams.get('jobId');

    if (jobId) {
        clients.set(jobId, ws);
        ws.on('close', () => {
            clients.delete(jobId);
            logger.debug('WebSocket', `Conexão fechada para job ${jobId}`);
        });
        logger.info('WebSocket', `Cliente conectado`, { jobId });
        // Se o job já terminou antes do websocket conectar
        const job = jobResults.get(jobId);
        if (job && (job.status === 'completed' || job.status === 'error')) {
            logger.info('WebSocket', `Job já finalizado, notificando cliente imediatamente`, { jobId, status: job.status });
            notifyClient(jobId, { status: job.status, jobId, errorMsg: job.errorMsg });
        }
    } else {
        logger.warn('WebSocket', `Conexão recebida sem jobId na URL`, { url: req.url });
    }
});

function notifyClient(jobId: string, payload: any) {
    const ws = clients.get(jobId);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
        logger.debug('WebSocket', `Notificação enviada`, { jobId, status: payload.status });
    } else {
        logger.debug('WebSocket', `Cliente não disponível para notificação`, { jobId });
    }
}

// Worker loop
async function processQueue() {
    if (shuttingDown || jobQueue.length === 0) {
        return;
    }
    activeJobs++;
    const job = jobQueue.shift()!;
    jobResults.set(job.jobId, job);

    const waitTimeMs = Date.now() - job.createdAt;
    
    logger.info('Queue', `Iniciando processamento do job`, { jobId: job.jobId, machineName: job.machineName, activeJobs, pendingJobs: jobQueue.length, waitTimeMs, filesCount: job.files.length, dbType: job.dbType });

    let startTime = Date.now();
    // Encaminha os próximos pedidos; cada pool mantém sua própria fila FIFO.
    setTimeout(processQueue, 0);
    try {
        await executeCompileJob(job, () => {
            startTime = Date.now();
            job.status = 'processing';
            notifyClient(job.jobId, { status: 'processing', jobId: job.jobId });
        });
        job.status = 'completed';
        notifyClient(job.jobId, { status: 'completed', jobId: job.jobId });

        const compiledCount = job.result?.compiledFiles?.length ?? 0;
        const errorCount = job.result?.errors?.length ?? 0;
        updateJobMetric(job.jobId, {
            status: 'completed',
            compiledCount,
            errorsCount: errorCount,
            durationMs: Date.now() - startTime,
            finishedAt: new Date(),
        });
        logger.timed('Queue', `Job finalizado com sucesso`, startTime, { jobId: job.jobId, compiledFiles: compiledCount, errors: errorCount });
    } catch (err: any) {
        job.status = 'error';
        job.errorMsg = err.message || 'Erro desconhecido';
        notifyClient(job.jobId, { status: 'error', jobId: job.jobId, errorMsg: job.errorMsg });
        updateJobMetric(job.jobId, {
            status: 'error',
            errorMsg: job.errorMsg,
            durationMs: Date.now() - startTime,
            finishedAt: new Date(),
        });
        logger.error('Queue', `Job falhou`, { jobId: job.jobId, error: job.errorMsg, durationMs: Date.now() - startTime });
    } finally {
        activeJobs--;
        logger.debug('Queue', `Slot liberado`, { activeJobs, pendingJobs: jobQueue.length });
        // Processa o próximo da fila iterativamente
        setTimeout(processQueue, 0);
    }
}

/** Toda compilação utiliza uma sessão persistente, inclusive Patch. */
async function executeCompileJob(job: CompileJob, onStart: () => void): Promise<void> {
    const ctx = `Compile:${job.jobId.substring(0, 8)}`;
    const jobStart = Date.now();

    const baseTempPath = path.join(__dirname, '..', 'temp', job.jobId);
    const resultadoPath = path.join(baseTempPath, 'resultado');
    const reportPath = path.join(baseTempPath, 'compile_report.json');

    // Prepara os arquivos isolados do job antes de enfileirar no pool.
    logger.info(ctx, `Preparando diretórios temporários`, { baseTempPath });
    if (!fs.existsSync(baseTempPath)) fs.mkdirSync(baseTempPath, { recursive: true });
    if (!fs.existsSync(resultadoPath)) fs.mkdirSync(resultadoPath, { recursive: true });

    const ablSources: string[] = [];
    const extractStart = Date.now();
    for (const file of job.files) {
        const fullPath = path.join(baseTempPath, file.relativePath);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const dirResultado = path.join(resultadoPath, path.dirname(file.relativePath));
        if (!fs.existsSync(dirResultado)) fs.mkdirSync(dirResultado, { recursive: true });
        fs.writeFileSync(fullPath, Buffer.from(file.contentBase64, 'base64'));
        if (/\.(p|py|w|cls)$/i.test(fullPath)) {
            ablSources.push(file.relativePath);
        }
    }
    logger.timed(ctx, `Arquivos extraídos para disco`, extractStart, { totalFiles: job.files.length, ablSources: ablSources.length });

    try {
        if (!workerManager) throw new Error('Worker Pool indisponível.');
        await workerManager.dispatchJob(job.jobId, job.dbType, baseTempPath, reportPath,
            ablSources, job.dbSettings, onStart);
        await collectCompileResult(job, ctx, jobStart, baseTempPath, resultadoPath, reportPath);
    } finally {
        // O resultado já foi coletado ou o job falhou; cada diretório pertence a um único job.
        try { fs.rmSync(baseTempPath, { recursive: true, force: true }); }
        catch (error: any) { logger.warn(ctx, 'Falha ao limpar temporários', { error: error.message }); }
    }
}

/**
 * Coleta os arquivos .r e erros do relatório JSON gerado pelo worker,
 * preenchendo job.result no formato esperado pela extensão.
 */
async function collectCompileResult(
    job: CompileJob,
    ctx: string,
    jobStart: number,
    baseTempPath: string,
    resultadoPath: string,
    reportPath: string
): Promise<void> {
    // Relatório ausente/inválido é falha do job, nunca sucesso vazio.
    const reportData = JSON.parse(fs.readFileSync(reportPath, 'utf8').replace(/^\uFEFF/, ''));
    if (!Array.isArray(reportData)) throw new Error('Relatório de compilação inválido.');
    const expectedSources = job.files.filter(file => /\.(p|py|w|cls)$/i.test(file.relativePath))
        .map(file => file.relativePath.replace(/\\/g, '/'));
    if (reportData.length !== expectedSources.length || reportData.some((item: any, index: number) =>
        !item || item.file !== expectedSources[index] || typeof item.success !== 'boolean' ||
        !Array.isArray(item.messages) || item.messages.some((message: any) => typeof message !== 'string'))) {
        throw new Error('Relatório de compilação incompleto ou inválido.');
    }

    const compiledFiles: FilePayload[] = [];
    const compilationErrors: any[] = [];

    for (const item of reportData) {
        const parsed = path.parse(item.file);
        const rRelativePath = path.posix.join(parsed.dir, parsed.name + '.r');
        const rFullPath = path.join(resultadoPath, rRelativePath);
        const hasRFile = fs.existsSync(rFullPath);

        if (hasRFile) {
            compiledFiles.push({
                relativePath: rRelativePath,
                contentBase64: fs.readFileSync(rFullPath).toString('base64')
            });
        }
        if (item.messages && item.messages.length > 0) {
            compilationErrors.push({ file: item.file, messages: item.messages, isWarning: hasRFile });
        } else if (!hasRFile) {
            compilationErrors.push({ file: item.file, messages: ['Falha na geração do compilado (.r) ou erro de sintaxe estrutural.'], isWarning: false });
        }
    }

    job.result = { compiledFiles, errors: compilationErrors };
    logger.info(ctx, `Resultado da compilação processado`, { compiledOk: compiledFiles.length, errors: compilationErrors.length });

    logger.timed(ctx, `Job de compilação concluído (total)`, jobStart, { compiledOk: compiledFiles.length, errors: compilationErrors.length });
}

// =========================================================================
// Endpoints administrativos do Worker Pool
// =========================================================================

/** Força a reciclagem de todos os workers (útil após deploy de banco/schema) */
app.post('/api/workers/recycle', (req: Request, res: Response) => {
    if (!workerManager) {
        return res.status(503).json({ status: 'disabled', message: 'Worker Pool não está ativo.' });
    }
    const reason = (req.body?.reason as string) || 'manual_api';
    workerManager.recycleAll(reason);
    logger.info('API', `Reciclagem de workers solicitada via API`, { reason, ip: req.ip });
    return res.json({ status: 'ok', message: 'Reciclagem de todos os workers iniciada.' });
});

/** Retorna o status atual de todos os workers do pool */
app.get('/api/workers/status', (_req: Request, res: Response) => {
    if (!workerManager) {
        return res.json({ enabled: false, message: 'Worker Pool não está ativo.' });
    }
    return res.json(workerManager.getStatus());
});

// Queue API
app.post('/compile', async (req: Request, res: Response) => {
    const requestStart = Date.now();
    try {
        const files: FilePayload[] = req.body.files;
        const dbType: string = req.body.dbType;
        const machineNameRaw = req.body.machineName ?? undefined;
        const machineName: string = typeof machineNameRaw === 'string' && machineNameRaw.trim() !== ''
            ? machineNameRaw.trim()
            : 'unknown';
        const patchInfo = req.body.patchInfo; // { patchVersion: string, subType: string }

        if (!files || !Array.isArray(files)) {
            logger.warn('API', `Payload inválido recebido`, { body: typeof req.body });
            return res.status(400).json({ status: 'error', message: 'Payload inválido.' });
        }
        
        const configPath = path.join(__dirname, '..', 'server.config.json');
        let serverConfig: any = {};
        if (fs.existsSync(configPath)) {
            serverConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } else {
            logger.warn('Config', `Arquivo server.config.json não encontrado`, { configPath });
        }

        // Resolve o repositório: prioriza o valor enviado pelo cliente, depois o padrão do config, e por último EMS2.08
        const repositoryValue = req.body.repository || serverConfig.defaultRepository || 'EMS2.08';
        if (typeof repositoryValue !== 'string' || !repositoryValue.trim()) {
            return res.status(400).json({ status: 'error', message: 'Repositório inválido.' });
        }
        const repository = repositoryValue.trim();

        logger.info('API', `POST /compile recebido`, { filesCount: files?.length, dbType, repository, hasPatchInfo: !!patchInfo, machineName, ip: req.ip });

        let dbSettings: any = null;

        if (dbType === 'Patch' && patchInfo) {
            const pConfig = serverConfig.patchConfig;
            if (!pConfig) {
                logger.error('API', `Configuração patchConfig não encontrada no server.config.json`);
                return res.status(400).json({ status: 'error', message: `A configuração "patchConfig" não foi encontrada no server.config.json.`});
            }
            
            // Lógica baseada no .bat: Resolve caminhos de rede/locais
            const patchBaseDir = path.join(pConfig.baseDir, patchInfo.patchVersion, patchInfo.subType);
            
            if (!fs.existsSync(patchBaseDir)) {
                logger.error('API', `Diretório do patch não encontrado`, { patchBaseDir, patchVersion: patchInfo.patchVersion, subType: patchInfo.subType });
                return res.status(404).json({ 
                    status: 'error', 
                    message: `A versão do patch "${patchInfo.patchVersion}" (${patchInfo.subType}) não está disponível ou o diretório não foi encontrado.` 
                });
            }

            const shortcutPath = path.join(pConfig.baseShortcut, patchInfo.patchVersion.substring(0, 9) , patchInfo.subType, repository);
            const pfPath = path.join(patchBaseDir, 'connect-ems2.pf');
            const iniPath = path.join(shortcutPath, 'progress-12.ini');

            dbSettings = {
                repository,
                pf: pfPath,
                ini: iniPath
            };

            logger.info('API', `Configuração de Patch resolvida`, { patchVersion: patchInfo.patchVersion, subType: patchInfo.subType, repository, pfPath, iniPath });
        } else {
            dbSettings = resolveRepositorySettings(serverConfig, dbType, repository);
            if (dbSettings) logger.info('API', 'Contexto de repositório resolvido', { dbType, ...dbSettings });
        }

        if (!dbSettings) {
            logger.error('API', `Banco de dados ou patch não mapeado`, { dbType });
             return res.status(400).json({ status: 'error', message: `O banco de dados ou patch "${dbType}" não está mapeado no server.config.json.`});
        }

        const jobId = uuidv4();
        jobQueue.push({
            jobId,
            files,
            dbType,
            machineName,
            dbSettings,
            status: 'queued',
            createdAt: Date.now()
        });

        const ablSourcesCount = files.filter(f => /\.(p|py|w|cls)$/i.test(f.relativePath)).length;
        createJobMetric({
            jobId,
            status: 'queued',
            machineName,
            ip: req.ip ?? null,
            filesCount: files.length,
            ablSourcesCount,
            dbType,
            repository,
        });

        const fileNames = files.map(f => f.relativePath);
        logger.info('API', `Job criado e enfileirado`, { jobId, machineName, filesCount: files.length, files: fileNames, dbType, queueSize: jobQueue.length, activeJobs });
        logger.timed('API', `Resposta 202 enviada ao cliente`, requestStart, { jobId });
        
        // Retorna status 202 (Accepted) para o cliente fechar a requisição rápida e abrir o websocket
        res.status(202).json({ status: 'queued', jobId });

        // Trigger Queue
        setTimeout(processQueue, 0);
    } catch (e: any) {
        logger.error('API', `Erro inesperado no POST /compile`, { error: e.message, stack: e.stack });
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// Endpoint para download do resultado e limpeza da memória
app.get('/result/:jobId', (req: Request, res: Response) => {
    const jobId = req.params.jobId as string;
    const job = jobResults.get(jobId);

    logger.info('API', `GET /result/${jobId}`, { found: !!job, status: job?.status, ip: req.ip });

    if (!job) {
        logger.warn('API', `Job não encontrado ou expirado`, { jobId });
        return res.status(404).json({ status: 'error', message: 'Job não encontrado ou expirado.' });
    }

    if (job.status !== 'completed' && job.status !== 'error') {
        logger.warn('API', `Tentativa de download de job não finalizado`, { jobId, status: job.status });
        return res.status(400).json({ status: 'error', message: `Job está com status: ${job.status}` });
    }

    const compiledCount = job.result?.compiledFiles?.length ?? 0;
    const errorCount = job.result?.errors?.length ?? 0;

    res.json({
        status: job.status,
        compiledFiles: job.result?.compiledFiles || [],
        errors: job.result?.errors || [],
        message: job.errorMsg
    });

    // Clean up memory
    jobResults.delete(jobId);
    logger.info('API', `Resultado entregue e removido da memória`, { jobId, compiledFiles: compiledCount, errors: errorCount });
});

AppDataSource.initialize()
    .then(async () => {
        logger.info('Database', 'Conexão com SQLite estabelecida (TypeORM)');

        // Inicializa o Worker Pool de sessões OpenEdge persistentes
        const configPath = path.join(__dirname, '..', 'server.config.json');
        if (fs.existsSync(configPath)) {
            try {
                const serverConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                const poolConfig = serverConfig.workerPool;

                if (poolConfig && poolConfig.enabled) {
                    const defaultRepo = serverConfig.defaultRepository || 'EMS2.08';
                    const resolvedDatabases: Record<string, WorkerDbSettings> = {};
                    for (const dbType of poolConfig.prewarmDatabases || []) {
                        const settings = resolveRepositorySettings(serverConfig, dbType, defaultRepo);
                        if (settings) resolvedDatabases[dbType] = settings;
                    }
                    const contexts = resolvePrewarmContexts(serverConfig);
                    workerManager = new WorkerManager(poolConfig, resolvedDatabases);
                    await workerManager.initialize(contexts);
                    logger.info('Server', `Worker Pool TCP iniciado`, {
                        prewarmDatabases: poolConfig.prewarmDatabases,
                        workersPerDb: poolConfig.workersPerDb,
                        port: poolConfig.port
                    });
                } else {
                    throw new Error('Configure workerPool.enabled=true; compilações exigem workers persistentes.');
                }
            } catch (configErr: any) {
                if (workerManager) await workerManager.shutdown();
                throw configErr;
            }
        }

        if (!workerManager) throw new Error('server.config.json deve configurar o Worker Pool.');
        server.listen(PORT, () => {
            logger.info('Server', `═══════════════════════════════════════════════════`);
            logger.info('Server', `ABL Compile Server iniciado com sucesso`);
            logger.info('Server', `Porta: ${PORT} | WorkerPool: ${workerManager ? 'ATIVO' : 'DESABILITADO'}`);
            logger.info('Server', `PID: ${process.pid} | Node: ${process.version} | Plataforma: ${process.platform}`);
            logger.info('Server', `DLC: ${process.env.DLC || '(não definido)'}`);
            logger.info('Server', `LOG_LEVEL: ${process.env.LOG_LEVEL || 'info (padrão)'}`);
            logger.info('Server', `═══════════════════════════════════════════════════`);
            logger.info('Server', 'Rotas habilitadas:', {
                routes: [
                    'POST   /compile',
                    'GET    /result/:jobId',
                    'POST   /api/workers/recycle',
                    'GET    /api/workers/status',
                    'POST   /api/auth/login',
                    'GET    /api/dashboard/metrics',
                    'GET    /api/dashboard/jobs',
                    'GET    /dashboard/* (estático)',
                ],
            });
        });
    })
    .catch((err) => {
        logger.error('Server', 'Falha ao inicializar servidor de compilação', { error: err.message });
        process.exit(1);
    });

// Graceful shutdown
async function gracefulShutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Server', `Sinal ${signal} recebido, encerrando...`, { activeJobs, pendingJobs: jobQueue.length });

    // Encerra workers antes de fechar o servidor HTTP
    if (workerManager) {
        logger.info('Server', `Encerrando Worker Pool...`);
        await workerManager.shutdown();
    }

    server.close(() => {
        logger.info('Server', `Servidor encerrado com sucesso`);
        process.exit(0);
    });
}

process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });

process.on('uncaughtException', (err) => {
    logger.error('Server', `EXCEÇÃO NÃO CAPTURADA`, { error: err.message, stack: err.stack });
    process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
    logger.error('Server', `PROMISE REJECTION NÃO TRATADA`, { reason: reason?.message || String(reason), stack: reason?.stack });
});
