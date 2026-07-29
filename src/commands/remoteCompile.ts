import * as vscode from 'vscode';
import axios from 'axios';
import WebSocket from 'ws';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { getOrPromptCompilerUrl } from '../extension';
import {
    TargetServer,
    readServers,
    saveServers,
    getServersForCurrentPlatform,
    pickFolderDialog,
    ensureTrustedUncHost
} from './manageServers';

/**
 * Interface payload de arquivo
 */
interface FilePayload {
    relativePath: string;
    contentBase64: string;
}

// Canal de output para exibir erros da compilação remota
const outputChannel = vscode.window.createOutputChannel('ABL Compiler');

/**
 * Aceita qualquer arquivo com extensão para envio ao servidor (a filtragem de compilação ocorre no servidor)
 */
export const ABL_COMPILE_REGEX = /\.[a-zA-Z0-9_\-]+$/i;

/**
 * Extrai caminhos de includes ABL do conteúdo de um arquivo.
 * Padrão: {caminho/arquivo.i} ou {arquivo.m1} ou {arquivo.m} ou {arquivo &ARG=valor}
 * Aceita qualquer extensão, não apenas .i
 */
function extractIncludePaths(content: string): string[] {
    // Captura apenas o primeiro token dentro das chaves, ignorando parâmetros após o nome do include.
    const includeRegex = /\{\s*([^{}\s&]+?\.[a-zA-Z0-9]+)(?:\s+[^{}]*)?\}/gi;
    const includes: string[] = [];
    const seenIncludes = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = includeRegex.exec(content)) !== null) {
        const raw = match[1].trim();
        if (raw) {
            const normalized = raw.replace(/\\/g, '/');
            if (!seenIncludes.has(normalized)) {
                seenIncludes.add(normalized);
                includes.push(normalized);
            }
        }
    }
    return includes;
}

/**
 * Retorna conjunto de caminhos relativos de arquivos modificados no git (staged + unstaged).
 */
function getGitModifiedFiles(workspaceRoot: string): Set<string> {
    try {
        const output = execSync('git status --porcelain', {
            cwd: workspaceRoot,
            encoding: 'utf8',
            timeout: 5000
        });
        const modified = new Set<string>();
        for (const line of output.split('\n')) {
            if (line.length < 4) { continue; }
            // Formato: XY ARQUIVO  ou  XY "ARQUIVO" (com espaços)
            const filePath = line.substring(3).trim().replace(/^"(.*)"$/, '$1');
            if (filePath) {
                modified.add(filePath.replace(/\\/g, '/'));
            }
        }
        return modified;
    } catch {
        return new Set<string>();
    }
}

/**
 * Identifica apenas as includes diretas dos arquivos pai (sources principais).
 * NÃO processa includes de outras sources, apenas do arquivo principal.
 * Processa até 10 includes por arquivo pai, retornando os que estão modificados no git.
 */
async function collectModifiedIncludes(
    urisToCompile: vscode.Uri[],
    workspaceRoot: string,
    gitModified: Set<string>,
    alreadyAdded: Set<string>
): Promise<vscode.Uri[]> {
    const result: vscode.Uri[] = [];
    const resolvedIncludeCache = new Map<string, vscode.Uri | undefined>();

    // Processa apenas os arquivos pai (sources principais)
    for (const fileUri of urisToCompile) {
        let content: string;
        try {
            const raw = await vscode.workspace.fs.readFile(fileUri);
            content = Buffer.from(raw).toString('utf8');
        } catch {
            continue;
        }

        // Extrai as includes diretas do arquivo pai
        const includePaths = extractIncludePaths(content);
    

        for (let i = 0; i < includePaths.length; i++) {
            const includePath = includePaths[i];
            const normalizedInclude = includePath.replace(/\\/g, '/').replace(/^\/+/, '');

            let includeUri = resolvedIncludeCache.get(normalizedInclude);
            if (includeUri === undefined) {
                const matches = await vscode.workspace.findFiles(
                    `**/${normalizedInclude}`,
                    '**/{node_modules,.git}/**',
                    1
                );
                includeUri = matches[0];
                resolvedIncludeCache.set(normalizedInclude, includeUri);
            }

            if (!includeUri) {
                continue;
            }

            const fullPath = includeUri.fsPath;
            const gitRelative = path.relative(workspaceRoot, fullPath).replace(/\\/g, '/');

            // Se modificado no git e ainda não adicionado ao payload
            if (gitModified.has(gitRelative) && !alreadyAdded.has(fullPath)) {
                alreadyAdded.add(fullPath);
                result.push(includeUri);
            }
        }
    }

    return result;
}

/**
 * Extrai a URI de um argumento (Explorer Uri ou SCM SourceControlResourceState)
 */
function extractUri(arg: any): vscode.Uri | undefined {
    if (arg instanceof vscode.Uri) {
        return arg;
    }
    // SCM SourceControlResourceState possui .resourceUri
    if (arg && arg.resourceUri) {
        if (arg.resourceUri instanceof vscode.Uri) {
            return arg.resourceUri;
        }
        if (typeof arg.resourceUri.fsPath === 'string') {
            return vscode.Uri.file(arg.resourceUri.fsPath);
        }
    }
    return undefined;
}

// Trava para evitar múltiplas compilações simultâneas
let isCompiling = false;

/**
 * Registra o comando de compilação remota do Explorer
 */
export function registerRemoteCompileCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand(
        'abl-linter.compileRemote',
        async (...args: any[]) => {

            if (isCompiling) {
                vscode.window.showInformationMessage('Já existe uma compilação remota em execução. Por favor, aguarde até que ela termine.');
                return;
            }

            isCompiling = true;

            try {

        // ── Resolver URIs independente da origem (Explorer, SCM, F5) ──
        let urisToCompile: vscode.Uri[] = [];
        const addedPaths = new Set<string>();

        const flatten = (arr: any[]): any[] => {
            return arr.reduce((acc, val) => Array.isArray(val) ? acc.concat(flatten(val)) : acc.concat(val), []);
        };

        // Extrai de todos os argumentos (incluindo arrays que o VS Code envia para multi-seleção)
        const allItems = flatten(args);

        for (const item of allItems) {
            // Se for um grupo de SCM (ex: "Changes", "Staged Changes") 
            if (item && Array.isArray(item.resourceStates)) {
                for (const state of item.resourceStates) {
                    const u = extractUri(state);
                    if (u && !addedPaths.has(u.fsPath)) {
                        addedPaths.add(u.fsPath);
                        urisToCompile.push(u);
                    }
                }
            } else {
                const u = extractUri(item);
                if (u && !addedPaths.has(u.fsPath)) {
                    addedPaths.add(u.fsPath);
                    urisToCompile.push(u);
                }
            }
        }

        // Se chamado via F5 (sem argumentos / array vazio), tenta o arquivo ativo
        if (urisToCompile.length === 0) {
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor && activeEditor.document) {
                urisToCompile = [activeEditor.document.uri];
            }
        }

        // Filtra apenas arquivos com alguma extensão (incluindo qualquer include ou suporte)
        urisToCompile = urisToCompile.filter(u => ABL_COMPILE_REGEX.test(u.fsPath));

        if (urisToCompile.length === 0) {
            vscode.window.showWarningMessage('Nenhum arquivo selecionado ou aberto no editor.');
            return;
        }

        // URL do servidor de compilação
        const compilerUrl = await getOrPromptCompilerUrl();
        if (!compilerUrl) { return; }

        // Raiz do workspace
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Você deve estar em um Workspace para usar a compilação remota.');
            return;
        }

        // ── 1. Escolher local para salvar ─────────────────────────────
        const allServers       = await readServers();
        const availableServers = getServersForCurrentPlatform(allServers);

        const platformIcon = (p: string) =>
            p === 'linux' ? '🐧' : p === 'windows' ? '💻' : '🌐';

        type PickItemTyped = vscode.QuickPickItem & { _type: string; serverObj?: TargetServer };

        const destItems: PickItemTyped[] = [
            {
                label: '$(home) Workspace Local',
                description: 'Salvar na estrutura de pastas do projeto',
                detail: workspaceFolder.uri.fsPath,
                _type: 'local'
            },
            ...availableServers.map(s => ({
                label: `$(server) ${platformIcon(s.platform)} ${s.name}`,
                description: s.path,
                detail: s.dbType
                    ? `Banco: ${s.dbType} | Plataforma: ${s.platform}`
                    : `Plataforma: ${s.platform}`,
                _type: 'server',
                serverObj: s
            })),
            {
                label: '$(folder-opened) Selecionar Pasta...',
                description: 'Escolher uma pasta no computador (uso único, não salva)',
                detail: '',
                _type: 'browse'
            },
            {
                label: '$(add) + Configurar Novo Servidor...',
                description: 'Adicionar permanentemente à lista de servidores',
                detail: '',
                _type: 'add'
            }
        ];

        const destSelection = await vscode.window.showQuickPick(destItems, {
            placeHolder: '📦 Onde deseja salvar os arquivos compilados (.r)?',
            ignoreFocusOut: true
        });

        if (!destSelection) {
            vscode.window.showWarningMessage('Salvamento cancelado. Os arquivos .r não foram persistidos.');
            return;
        }

        let targetBasePath = '';
        let isLocal        = false;
        let preSelectedDb: string | undefined;

        if (destSelection._type === 'local') {
            targetBasePath = workspaceFolder.uri.fsPath;
            isLocal        = true;

        } else if (destSelection._type === 'server') {
            targetBasePath = destSelection.description!;
            preSelectedDb  = destSelection.serverObj?.dbType;

        } else if (destSelection._type === 'browse') {
            const picked = await pickFolderDialog(
                'Selecionar pasta de destino para os arquivos .r',
                vscode.Uri.file(os.homedir())
            );
            if (!picked) {
                vscode.window.showWarningMessage('Nenhuma pasta selecionada. Salvamento cancelado.');
                return;
            }
            targetBasePath = picked;

        } else if (destSelection._type === 'add') {
            const isWin   = process.platform === 'win32';
            const example = isWin
                ? '\\\\servidor\\share\\bin  ou  C:\\temp\\bin'
                : '/mnt/servidor/bin  ou  /home/user/bin';

            const newName = await vscode.window.showInputBox({
                prompt: 'Nome do Servidor (Ex: Produção, Homologação)',
                placeHolder: 'Ex: Servidor de Aplicação',
                ignoreFocusOut: true,
                validateInput: (v) => (!v || v.trim() === '') ? 'Nome é obrigatório.' : null
            });
            if (!newName) {
                vscode.window.showWarningMessage('Configuração incompleta. Salvamento cancelado.');
                return;
            }

            const platformItem = await vscode.window.showQuickPick([
                { label: '🐧 Linux',   description: 'Apenas para usuários Linux',         value: 'linux'   },
                { label: '💻 Windows', description: 'Apenas para usuários Windows',        value: 'windows' },
                { label: '🌐 Ambas',   description: 'Funciona para Linux e Windows (any)', value: 'any'     },
            ], { placeHolder: 'Para qual plataforma é este servidor?', ignoreFocusOut: true });
            if (!platformItem) {
                vscode.window.showWarningMessage('Configuração incompleta. Salvamento cancelado.');
                return;
            }
            const platform = (platformItem as any).value as 'linux' | 'windows' | 'any';

            const inputMethod = await vscode.window.showQuickPick([
                { label: '$(folder-opened) Selecionar Pasta...', description: 'Abrir diálogo de seleção de pasta' },
                { label: '$(keyboard) Digitar Caminho',          description: `Útil para caminhos de rede: ${example}` },
            ], { placeHolder: 'Como deseja informar o caminho?', ignoreFocusOut: true });
            if (!inputMethod) {
                vscode.window.showWarningMessage('Configuração incompleta. Salvamento cancelado.');
                return;
            }

            let newPath: string | undefined;
            if (inputMethod.label.includes('Selecionar Pasta')) {
                newPath = await pickFolderDialog(
                    `Pasta do servidor "${newName}"`,
                    vscode.Uri.file(os.homedir())
                );
            } else {
                newPath = await vscode.window.showInputBox({
                    prompt: `Caminho Completo (${isWin ? 'Windows' : 'Linux'})`,
                    placeHolder: `Ex: ${example}`,
                    ignoreFocusOut: true,
                    validateInput: (v) => (!v || v.trim() === '') ? 'Caminho é obrigatório.' : null
                });
            }

            if (!newPath) {
                vscode.window.showWarningMessage('Nenhum caminho informado. Salvamento cancelado.');
                return;
            }

            const uncValidation = await ensureTrustedUncHost(newPath.trim());
            if (!uncValidation.trusted) {
                vscode.window.showWarningMessage('Configuração cancelada: host UNC não confiável.');
                return;
            }

            // Banco padrão para o novo servidor (opcional)
            const newDbItem = await vscode.window.showQuickPick([
                { label: '$(dash) Não definir (perguntar na compilação)', value: undefined },
                { label: 'Progress',   value: 'Progress'   as const },
                { label: 'SQL Server', value: 'SQL Server' as const },
                { label: 'Oracle',     value: 'Oracle'     as const },
            ], { placeHolder: 'Banco de Compilação padrão para este servidor? (Opcional)', ignoreFocusOut: true });
            if (newDbItem === undefined) {
                vscode.window.showWarningMessage('Configuração incompleta. Salvamento cancelado.');
                return;
            }
            const newDbType = newDbItem.value;

            targetBasePath = newPath;
            preSelectedDb  = newDbType;

            const newServer: TargetServer = { name: newName.trim(), path: newPath.trim(), platform, dbType: newDbType };
            const fresh = await readServers();
            await saveServers([...fresh, newServer]);
            vscode.window.showInformationMessage(`✅ Servidor "${newName}" adicionado à lista de servidores!`);

            if (uncValidation.restartRequired && uncValidation.host) {
                const restartAction = await vscode.window.showWarningMessage(
                    `Host UNC "${uncValidation.host}" adicionado em security.allowedUNCHosts. É necessário reiniciar o VS Code para aplicar totalmente essa configuração.`,
                    'Reiniciar Agora',
                    'Depois'
                );

                if (restartAction === 'Reiniciar Agora') {
                    await vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            }
        }

        if (!targetBasePath) {
            vscode.window.showWarningMessage('Salvamento cancelado.');
            return;
        }

        // ── 2. Banco de Dados (usa o do servidor se definido, senão pergunta) ─
        let selectedDb: string;
        if (preSelectedDb) {
            selectedDb = preSelectedDb;
        } else {
            // Patch disponível apenas quando não há banco pré-configurado (local, browse ou servidor sem default)
            const picked = await vscode.window.showQuickPick(
                ['Progress', 'SQL Server', 'Oracle', 'Patch'],
                { placeHolder: 'Selecione em qual Banco de Dados deverá ser feita a compilação', ignoreFocusOut: true }
            );
            if (!picked) {
                vscode.window.showWarningMessage('Compilação cancelada: Nenhum banco de dados foi selecionado.');
                return;
            }
            selectedDb = picked;
        }

        let patchInfo: any = null;
        if (selectedDb === 'Patch') {
            const lastPatch = context.globalState.get<string>('lastPatchVersion') || '';
            const patchVersion = await vscode.window.showInputBox({
                prompt: 'Informe a versão do patch (Ex: 12.1.2024.1)',
                placeHolder: 'XX.X.XXXX.X',
                value: lastPatch,
                ignoreFocusOut: true,
                validateInput: (v) => (!v || v.trim() === '') ? 'Versão do patch é obrigatória.' : null
            });
            if (!patchVersion) { return; }

            context.globalState.update('lastPatchVersion', patchVersion);

            const subType = await vscode.window.showQuickPick(
                ['Progress', 'SQL Server', 'Oracle'],
                { placeHolder: 'Selecione a versão de banco para este patch', ignoreFocusOut: true }
            );
            if (!subType) { return; }

            patchInfo = { patchVersion, subType };
        }

        // Salva buffers pendentes
        await vscode.workspace.saveAll(false);

        // ── Includes modificados no Git ───────────────────────────────────────
        const cfg = vscode.workspace.getConfiguration('abl-linter');
        if (cfg.get<boolean>('includeGitChangedIncludes', false)) {
            const gitModified = getGitModifiedFiles(workspaceFolder.uri.fsPath);
            if (gitModified.size > 0) {
                const modifiedIncludes = await collectModifiedIncludes(
                    urisToCompile,
                    workspaceFolder.uri.fsPath,
                    gitModified,
                    addedPaths
                );
                if (modifiedIncludes.length > 0) {
                    urisToCompile.push(...modifiedIncludes);
                    vscode.window.showInformationMessage(
                        `🔗 ${modifiedIncludes.length} include(s) modificado(s) no Git incluído(s) na compilação.`
                    );
                }
            }
        }
        // ─────────────────────────────────────────────────────────────────────

        const filesPayload: FilePayload[] = [];
        const pathMapping = new Map<string, string>();
        
            await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Compilação Remota ABL',
                }, async (progress) => {

                    // ── 1. Montar payload ──────────────────────────────────────
                    progress.report({ message: `Lendo ${urisToCompile.length} arquivo(s)...` });

                for (const fileUri of urisToCompile) {
                    const relativePath = path.relative(workspaceFolder.uri.fsPath, fileUri.fsPath);
                    const normalized   = relativePath.replace(/\\/g, '/');

                    // Remove prefixo 'src/' do caminho relativo
                    let targetRelative = normalized;
                    const srcIndex = normalized.indexOf('/src/');
                    if (srcIndex !== -1) {
                        targetRelative = normalized.substring(srcIndex + 5);
                    } else if (normalized.startsWith('src/')) {
                        targetRelative = normalized.substring(4);
                    }

                    const fileData      = await vscode.workspace.fs.readFile(fileUri);
                    const contentBase64 = Buffer.from(fileData).toString('base64');
                    filesPayload.push({ relativePath: targetRelative, contentBase64 });

                    const parsedTarget   = path.parse(targetRelative);
                    const rTarget        = path.posix.join(parsedTarget.dir, parsedTarget.name + '.r');
                    const parsedOriginal = path.parse(normalized);
                    const rOriginal      = path.posix.join(parsedOriginal.dir, parsedOriginal.name + '.r');
                    pathMapping.set(rTarget, rOriginal);
                }

                // ── 2. Enviar ao servidor de compilação ────────────────────
                progress.report({ message: `Enviando ${filesPayload.length} arquivo(s) para compilar no ${selectedDb}...` });

                // Verifica se a seleção de repositório está habilitada
                const config = vscode.workspace.getConfiguration('abl-linter');
                const enableRepo = config.get<boolean>('enableCompilationRepository', false);
                const repository = enableRepo
                    ? config.get<string>('compilationRepository', 'EMS2.08')
                    : undefined;

                const response = await axios.post(compilerUrl, {
                    dbType: selectedDb,
                    patchInfo: patchInfo,
                    ...(repository ? { repository } : {}),
                    files: filesPayload
                }, {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 60000
                });

                if (response.status !== 202 || !response.data.jobId) {
                    vscode.window.showErrorMessage('Servidor não suporta filas ou retornou payload inválido.');
                    return;
                }

                const jobId = response.data.jobId;

                // ── 2.5. Exibir resumo dos arquivos enviados ────────────────────
                outputChannel.clear();
                outputChannel.appendLine('=== RESUMO DE ARQUIVOS ENVIADOS ===');
                outputChannel.appendLine(`JobId: ${jobId}`);
                outputChannel.appendLine(`Banco: ${selectedDb}${patchInfo ? ` | Patch: ${patchInfo.patchVersion}` : ''}`);
                outputChannel.appendLine(`Total: ${filesPayload.length} arquivo(s)\n`);
                for (const file of filesPayload) {
                    outputChannel.appendLine(`  • ${file.relativePath}`);
                }
                outputChannel.appendLine('');
                outputChannel.show(false);
                
                // ── 3. Lidar com Fila e Status via WebSocket ────────────────────
                // Troca protocolo http/https por ws/wss
                const wsUrl = compilerUrl.replace(/^http/, 'ws') + '?jobId=' + jobId;
                
                progress.report({ message: `Aguardando a Fila de Compilação...` });
                
                // Assincronamente espera o processamento completar
                const wsResult = await new Promise<any>((resolve, reject) => {
                    const ws = new WebSocket(wsUrl);
                    
                    ws.on('message', (data: any) => {
                        try {
                            const payload = JSON.parse(data.toString());
                            if (payload.status === 'processing') {
                                progress.report({ message: `Processando os arquivos no OpenEdge... (Clique X para cancelar)` });
                            } else if (payload.status === 'completed') {
                                ws.close();
                                resolve(payload);
                            } else if (payload.status === 'error') {
                                ws.close();
                                reject(new Error(payload.errorMsg || 'Erro no processo do servidor.'));
                            }
                        } catch (e) {
                            console.error('Falha ao parsear WS:', e);
                        }
                    });

                    ws.on('error', (err) => {
                        reject(err);
                    });
                });

                // ── 4. Buscar o Payload Gigante Final (GET /result/:id) ─────────
                progress.report({ message: `Baixando resultado (.r) do Servidor...` });
                
                const baseURL = compilerUrl.endsWith('/compile') ? compilerUrl.replace('/compile', '') : compilerUrl;
                const resultResponse = await axios.get(`${baseURL}/result/${jobId}`);
                
                const compiledFiles: FilePayload[] = resultResponse.data.compiledFiles || [];
                const errors: any[]                = resultResponse.data.errors || [];
                outputChannel.clear();

                // ── 5a. Erros de compilação e Avisos ────────────────────────────────
                if (errors.length > 0) {
                    outputChannel.appendLine('=== STATUS: ALERTAS / ERROS ===');
                    outputChannel.appendLine(`Detectado(s) incidente(s) em ${errors.length} arquivo(s):`);
                    outputChannel.appendLine('-----------------------------------\n');

                    let hardErrorsCount = 0;

                    for (const err of errors) {
                        const originalRelativeFile = pathMapping.get(err.file) || err.file;
                        
                        // Se não for warning (não gerou .r no server), apagamos o arquivo local .r caso exista por sujeira
                        if (!err.isWarning) {
                            hardErrorsCount++;
                            try {
                                const parsed      = path.parse(originalRelativeFile);
                                const rTargetPath = path.join(workspaceFolder.uri.fsPath, parsed.dir, parsed.name + '.r');
                                await vscode.workspace.fs.delete(vscode.Uri.file(rTargetPath), { useTrash: false });
                            } catch (_) {}
                        }

                        const statusAviso = err.isWarning ? "⚠️ AVISO:" : "❌ ERRO:";
                        outputChannel.appendLine(`[Arquivo]: ${err.file}`);
                        
                        if (err.messages && err.messages.length > 0) {
                            for (const msg of err.messages) {
                                outputChannel.appendLine(`   ${statusAviso} ${msg}`);
                            }
                        } else {
                            outputChannel.appendLine(`   ${statusAviso} Falha na compilação. Código de erro genérico.`);
                        }
                        outputChannel.appendLine('');
                    }

                    outputChannel.show(true);

                    if (compiledFiles.length === 0) {
                        vscode.window.showErrorMessage(
                            `Compilação abortada! Nenhum '.r' foi gerado com sucesso. Verifique o output.`
                        );
                        return;
                    } else if (hardErrorsCount > 0) {
                        vscode.window.showWarningMessage(
                            `Compilação falhou em alguns arquivos, mas ${compiledFiles.length} arquivo(s) foram compilados com sucesso. Verifique o Output!`
                        );
                    } else {
                        vscode.window.showInformationMessage(
                            `A compilação teve alguns avisos, mas gerou ${compiledFiles.length} arquivo(s) .r com sucesso. Verifique o Output.`
                        );
                    }
                }

                // ── 6. Gravar os arquivos .r no destino ────────────────────
                progress.report({ message: `Gravando ${compiledFiles.length} arquivo(s) .r em: ${path.basename(targetBasePath)}...` });

                for (const comp of compiledFiles) {
                    const finalRelative = isLocal
                        ? (pathMapping.get(comp.relativePath) || comp.relativePath)
                        : comp.relativePath;

                    const targetPath = path.join(targetBasePath, finalRelative);
                    const targetDir  = path.dirname(targetPath);

                    await vscode.workspace.fs.createDirectory(vscode.Uri.file(targetDir));
                    await vscode.workspace.fs.writeFile(
                        vscode.Uri.file(targetPath),
                        Buffer.from(comp.contentBase64, 'base64')
                    );
                }

                vscode.window.showInformationMessage(
                    `✅ ${compiledFiles.length} arquivo(s) .r salvos em: ${targetBasePath}`
                );
            });

        } catch (error: any) {           
            console.error('Erro na compilação remota', error);
            const msg = error.response?.data?.message || error.message || 'Erro desconhecido';
            vscode.window.showErrorMessage(`Falha na Compilação Remota: ${msg}`);
        } finally {
            isCompiling = false;
        }
    });

    context.subscriptions.push(disposable);
}
