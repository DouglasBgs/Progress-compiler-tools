import * as dotenv from 'dotenv';
dotenv.config();
import express, { Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

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
    dbSettings: any;
    status: 'queued' | 'processing' | 'completed' | 'error';
    result?: any;
    errorMsg?: string;
}

// Queue system for scalability
const MAX_CONCURRENT_JOBS = 3;
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
        ws.on('close', () => clients.delete(jobId));
        console.log(`[WS] Client connected for job: ${jobId}`);
        // Se o job já terminou antes do websocket conectar
        const job = jobResults.get(jobId);
        if (job && (job.status === 'completed' || job.status === 'error')) {
            notifyClient(jobId, { status: job.status, jobId, errorMsg: job.errorMsg });
        }
    }
});

function notifyClient(jobId: string, payload: any) {
    const ws = clients.get(jobId);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    }
}

// Worker loop
async function processQueue() {
    if (activeJobs >= MAX_CONCURRENT_JOBS || jobQueue.length === 0) {
        return;
    }

    activeJobs++;
    const job = jobQueue.shift()!;
    job.status = 'processing';
    jobResults.set(job.jobId, job);
    
    notifyClient(job.jobId, { status: 'processing', jobId: job.jobId });
    console.log(`[Job ${job.jobId}][Queue] - Iniciando processamento. (Ativos: ${activeJobs})`);

    try {
        await executeCompileJob(job);
        job.status = 'completed';
        notifyClient(job.jobId, { status: 'completed', jobId: job.jobId });
        console.log(`[Job ${job.jobId}][Queue] - Finalizado com sucesso.`);
    } catch (err: any) {
        job.status = 'error';
        job.errorMsg = err.message || 'Erro desconhecido';
        notifyClient(job.jobId, { status: 'error', jobId: job.jobId, errorMsg: job.errorMsg });
        console.error(`[Job ${job.jobId}][Queue] - Falhou:`, err);
    } finally {
        activeJobs--;
        // Processa o próximo da fila iterativamente
        setTimeout(processQueue, 0);
    }
}

async function executeCompileJob(job: CompileJob): Promise<void> {
    return new Promise((resolve, reject) => {
        const baseTempPath = path.join(__dirname, '..', 'temp', job.jobId);
        const resultadoPath = path.join(baseTempPath, 'resultado');

        if (!fs.existsSync(baseTempPath)) fs.mkdirSync(baseTempPath, { recursive: true });
        if (!fs.existsSync(resultadoPath)) fs.mkdirSync(resultadoPath, { recursive: true });

        const ablSources: string[] = [];

        // Extraimos arquivos do job para o disco
        for (const file of job.files) {
            const fullPath = path.join(baseTempPath, file.relativePath);
            const dir = path.dirname(fullPath);

            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            
            const dirResultado = path.join(resultadoPath, path.dirname(file.relativePath));
            if (!fs.existsSync(dirResultado)) fs.mkdirSync(dirResultado, { recursive: true });

            fs.writeFileSync(fullPath, Buffer.from(file.contentBase64, 'base64'));
            
            if (/\.(p|w|cls)$/i.test(fullPath)) {
                ablSources.push(file.relativePath);
            }
        }

        const compileScriptPath = path.join(baseTempPath, '_mass_compile.p');
        const reportPath = path.join(baseTempPath, 'compile_report.json');
        
        let compileScriptContent = `
DEFINE VARIABLE i AS INTEGER NO-UNDO.
DEFINE VARIABLE cErros AS CHARACTER NO-UNDO.
DEFINE VARIABLE cMsg AS CHARACTER NO-UNDO.
DEFINE VARIABLE cLine AS CHARACTER NO-UNDO.
 
PROPATH = "${baseTempPath.replace(/\\/g, '/')} " + "," + PROPATH.

OUTPUT TO "${reportPath.replace(/\\/g, '/')}" CONVERT TARGET "UTF-8".
PUT UNFORMATTED "[" SKIP.
`;

        for (let idx = 0; idx < ablSources.length; idx++) {
            const src = ablSources[idx];
            const unixPath = src.replace(/\\/g, '/');
            const pathNoFile = path.dirname(unixPath);
            const fullLocalPath = path.join(baseTempPath, src).replace(/\\/g, '/');
            const isLast = (idx === ablSources.length - 1);
            
            compileScriptContent += `
COMPILE "${fullLocalPath}" SAVE INTO "resultado/${pathNoFile}" NO-ERROR.
cLine = "~{" + '"file": "${unixPath}", "success": ' + (IF COMPILER:ERROR THEN "false" ELSE "true") + ', "messages": ['.
PUT UNFORMATTED cLine.

cErros = "".
IF ERROR-STATUS:NUM-MESSAGES > 0 OR COMPILER:ERROR THEN DO:
    IF COMPILER:ERROR THEN DO:
        cMsg = "[Linha " + STRING(COMPILER:ERROR-ROW) + " / Col " + STRING(COMPILER:ERROR-COL) + "] Falha na compilacao listada abaixo.".
        cMsg = REPLACE(cMsg, "${baseTempPath}\\", "").
        cMsg = REPLACE(cMsg, "${baseTempPath}/", "").
        cMsg = REPLACE(cMsg, "${baseTempPath}", "").
        cMsg = REPLACE(cMsg, CHR(92), CHR(92) + CHR(92)). 
        cMsg = REPLACE(cMsg, CHR(34), CHR(92) + CHR(34)). 
        cMsg = REPLACE(cMsg, CHR(10), CHR(92) + "n").     
        cMsg = REPLACE(cMsg, CHR(13), CHR(92) + "r").     
        cErros = cErros + (IF cErros <> "" THEN "," ELSE "") + CHR(34) + cMsg + CHR(34).
    END.

    DO i = 1 TO ERROR-STATUS:NUM-MESSAGES:
        cMsg = "[Mensagem] " + ERROR-STATUS:GET-MESSAGE(i).
        IF cMsg <> ? THEN DO:
            cMsg = REPLACE(cMsg, "${baseTempPath}\\", "").
            cMsg = REPLACE(cMsg, "${baseTempPath}/", "").
            cMsg = REPLACE(cMsg, "${baseTempPath}", "").
            cMsg = REPLACE(cMsg, CHR(92), CHR(92) + CHR(92)). 
            cMsg = REPLACE(cMsg, CHR(34), CHR(92) + CHR(34)). 
            cMsg = REPLACE(cMsg, CHR(10), CHR(92) + "n").     
            cMsg = REPLACE(cMsg, CHR(13), CHR(92) + "r").     
            cErros = cErros + (IF cErros <> "" THEN "," ELSE "") + CHR(34) + cMsg + CHR(34).
        END.
    END.
END.

PUT UNFORMATTED cErros + "]}".
PUT UNFORMATTED "${isLast ? '' : ','}" SKIP.
`;
        }
        
        compileScriptContent += `
PUT UNFORMATTED "]" SKIP.
OUTPUT CLOSE.
QUIT.
`;

        fs.writeFileSync(compileScriptPath, compileScriptContent);

        let finalPfPath = '';
        let finalIniPath = '';

        if (job.dbSettings.pf && fs.existsSync(job.dbSettings.pf)) {
            finalPfPath = path.join(baseTempPath, 'compile.pf');
            let pfContent = fs.readFileSync(job.dbSettings.pf, 'utf8');
            const unixBaseTempPath = baseTempPath.replace(/\\/g, '/');
            if (/-PROPATH\s+/i.test(pfContent)) {
                pfContent = pfContent.replace(/(-PROPATH\s+)([^\r\n]+)/i, `$1${unixBaseTempPath},$2`);
            } else if (!job.dbSettings.ini) {
                pfContent += `\n-PROPATH ${unixBaseTempPath}\n`;
            }
            fs.writeFileSync(finalPfPath, pfContent);
        }

        if (job.dbSettings.ini && fs.existsSync(job.dbSettings.ini)) {
            finalIniPath = path.join(baseTempPath, 'compile.ini');
            let iniContent = fs.readFileSync(job.dbSettings.ini, 'utf8');
            const unixBaseTempPath = baseTempPath.replace(/\\/g, '/');
            if (/^PROPATH=/im.test(iniContent)) {
                iniContent = iniContent.replace(/^PROPATH=(.*)$/im, `PROPATH=${unixBaseTempPath},$1`);
            } else if (/^\[Startup\]/im.test(iniContent)) {
                iniContent = iniContent.replace(/^\[Startup\]/im, `[Startup]\nPROPATH=${unixBaseTempPath}`);
            } else {
                iniContent = `[Startup]\nPROPATH=${unixBaseTempPath}\n\n` + iniContent;
            }
            fs.writeFileSync(finalIniPath, iniContent);
        }

        const strPf = finalPfPath ? `-pf "${finalPfPath}"` : '';
        const strIni = finalIniPath ? `-ininame "${finalIniPath}"` : '';

        const dlcPath = process.env.DLC || 'C:\\Progress\\OpenEdge';
        const isWindows = process.platform === 'win32';
        const exeName = isWindows ? 'prowin.exe' : 'prowin';
        
        const compilerCmd = fs.existsSync(path.join(dlcPath, 'bin', exeName)) 
            ? `"${path.join(dlcPath, 'bin', exeName)}"` 
            : exeName;

        const command = `${compilerCmd} -b ${strPf} ${strIni} -p "${compileScriptPath}"`;

        exec(command, { cwd: baseTempPath }, (error) => {
            if (error) console.error(`[Job ${job.jobId}] Erro ao compilar:`, error);

            let reportData: any[] = [];
            if (fs.existsSync(reportPath)) {
                try {
                    reportData = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
                } catch (err) { }
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

            // O Node.js não apaga a pasta base agora. A limpeza ocorre após o download do /result ou via trigger periódica
            fs.rmSync(baseTempPath, { recursive: true, force: true });
            resolve();
        });
    });
}

// Queue API
app.post('/compile', async (req: Request, res: Response) => {
    try {
        const files: FilePayload[] = req.body.files;
        const dbType: string = req.body.dbType;
        const patchInfo = req.body.patchInfo; // { patchVersion: string, subType: string }

        if (!files || !Array.isArray(files)) {
            return res.status(400).json({ status: 'error', message: 'Payload inválido.' });
        }
        
        const configPath = path.join(__dirname, '..', 'server.config.json');
        let serverConfig: any = {};
        if (fs.existsSync(configPath)) {
            serverConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }

        let dbSettings: any = null;

        if (dbType === 'Patch' && patchInfo) {
            const pConfig = serverConfig.patchConfig;
            if (!pConfig) {
                return res.status(400).json({ status: 'error', message: `A configuração "patchConfig" não foi encontrada no server.config.json.`});
            }
            
            // Lógica baseada no .bat: Resolve caminhos de rede/locais
            const patchBaseDir = path.join(pConfig.baseDir, patchInfo.patchVersion, patchInfo.subType);
            
            if (!fs.existsSync(patchBaseDir)) {
                return res.status(404).json({ 
                    status: 'error', 
                    message: `A versão do patch "${patchInfo.patchVersion}" (${patchInfo.subType}) não está disponível ou o diretório não foi encontrado.` 
                });
            }

            const shortcutPath = path.join(pConfig.baseShortcut, patchInfo.patchVersion.substring(0, 9) , patchInfo.subType, 'EMS2.08');
            const pfPath = path.join(patchBaseDir, 'connect-ems2.pf');
            const iniPath = path.join(shortcutPath, 'progress-12.ini');

            dbSettings = {
                pf: pfPath,
                ini: iniPath
            };

            console.log(`[Job][Patch] Resolvendo para Patch: ${patchInfo.patchVersion} (${patchInfo.subType})`);
        } else {
            dbSettings = serverConfig.databases?.[dbType];
        }

        if (!dbSettings) {
             return res.status(400).json({ status: 'error', message: `O banco de dados ou patch "${dbType}" não está mapeado no server.config.json.`});
        }

        const jobId = uuidv4();
        jobQueue.push({
            jobId,
            files,
            dbType,
            dbSettings,
            status: 'queued'
        });

        console.log(`[Job ${jobId}][Queue] - Job Recebido e Enfileirado (${files.length} arquivos)`);
        
        // Retorna status 202 (Accepted) para o cliente fechar a requisição rápida e abrir o websocket
        res.status(202).json({ status: 'queued', jobId });

        // Trigger Queue
        setTimeout(processQueue, 0);
    } catch (e: any) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// Endpoint para download do resultado e limpeza da memória
app.get('/result/:jobId', (req: Request, res: Response) => {
    const jobId = req.params.jobId as string;
    const job = jobResults.get(jobId);

    if (!job) {
        return res.status(404).json({ status: 'error', message: 'Job não encontrado ou expirado.' });
    }

    if (job.status !== 'completed' && job.status !== 'error') {
        return res.status(400).json({ status: 'error', message: `Job está com status: ${job.status}` });
    }

    res.json({
        status: job.status,
        compiledFiles: job.result?.compiledFiles || [],
        errors: job.result?.errors || [],
        message: job.errorMsg
    });

    // Clean up memory
    jobResults.delete(jobId);
    console.log(`[Job ${jobId}][Queue] - Payload de resultado baixado pelo cliente e deletado em memoria.`);
});

server.listen(PORT, () => {
    console.log(`ABL Compiler Server rodando na porta ${PORT} com Queue & WebSockets`);
});
