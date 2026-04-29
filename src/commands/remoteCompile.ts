import * as vscode from 'vscode';
import axios from 'axios';
import WebSocket from 'ws';
import * as path from 'path';
import * as os from 'os';
import { getOrPromptCompilerUrl } from '../extension';
import {
    TargetServer,
    readServers,
    saveServers,
    getServersForCurrentPlatform,
    pickFolderDialog
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
 * Extensões ABL compiláveis (inclui .i, .i1, .i2, .i3, ...)
 */
export const ABL_COMPILE_REGEX = /\.(p|w|cls|i\d*)$/i;

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

        // Filtra apenas extensões ABL compiláveis (.p, .w, .cls, .i, .i1, .i2, ...)
        urisToCompile = urisToCompile.filter(u => ABL_COMPILE_REGEX.test(u.fsPath));

        if (urisToCompile.length === 0) {
            vscode.window.showWarningMessage('Nenhum arquivo ABL selecionado ou aberto no editor (extensões válidas: .p, .w, .cls, .i, etc).');
            return;
        }

        // URL do servidor de compilação
        const compilerUrl = await getOrPromptCompilerUrl();
        if (!compilerUrl) { return; }

        // Tipo do Banco de Dados
        const dbOptions = ['Progress', 'SQL Server', 'Oracle', 'Patch'];
        const selectedDb = await vscode.window.showQuickPick(
            dbOptions,
            { placeHolder: 'Selecione em qual Banco de Dados deverá ser feita a compilação', ignoreFocusOut: true }
        );
        if (!selectedDb) {
            vscode.window.showWarningMessage('Compilação cancelada: Nenhum banco de dados foi selecionado.');
            return;
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
            if (!patchVersion) return;
            
            context.globalState.update('lastPatchVersion', patchVersion);

            const subType = await vscode.window.showQuickPick(
                ['Progress', 'SQL Server', 'Oracle'],
                { placeHolder: 'Selecione a versão de banco para este patch', ignoreFocusOut: true }
            );
            if (!subType) return;

            patchInfo = { patchVersion, subType };
        }

        // Raiz do workspace
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Você deve estar em um Workspace para usar a compilação remota.');
            return;
        }

        // Salva buffers pendentes
        await vscode.workspace.saveAll(false);


        const filesPayload: FilePayload[] = [];
        const pathMapping = new Map<string, string>();

        await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Compilação Remota ABL',
                cancellable: false
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

                const response = await axios.post(compilerUrl, {
                    dbType: selectedDb,
                    patchInfo: patchInfo,
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
                                progress.report({ message: `Processando os arquivos no OpenEdge...` });
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

                // ── 5b. Sucesso — escolher destino dos .r ──────────────────
                // Lê servidores do arquivo servers.json (assíncrono)
                const allServers       = await readServers();
                const availableServers = getServersForCurrentPlatform(allServers);

                const platformIcon = (p: string) =>
                    p === 'linux' ? '🐧' : p === 'windows' ? '🪟' : '🌐';

                type PickItemTyped = vscode.QuickPickItem & { _type: string };

                const items: PickItemTyped[] = [
                    {
                        label: '$(home) Workspace Local',
                        description: 'Salvar na estrutura de pastas do projeto',
                        detail: workspaceFolder.uri.fsPath,
                        _type: 'local'
                    },
                    ...availableServers.map(s => ({
                        label: `$(server) ${platformIcon(s.platform)} ${s.name}`,
                        description: s.path,
                        detail: `Plataforma: ${s.platform}`,
                        _type: 'server'
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

                const selection = await vscode.window.showQuickPick(items, {
                    placeHolder: '📦 Onde deseja salvar os arquivos compilados (.r)?',
                    ignoreFocusOut: true
                });

                if (!selection) {
                    vscode.window.showWarningMessage('Salvamento cancelado. Os arquivos .r não foram persistidos.');
                    return;
                }

                let targetBasePath = '';
                let isLocal        = false;

                // ── Workspace local ──
                if ((selection as any)._type === 'local') {
                    targetBasePath = workspaceFolder.uri.fsPath;
                    isLocal        = true;

                // ── Servidor já configurado ──
                } else if ((selection as any)._type === 'server') {
                    targetBasePath = selection.description!;

                // ── Seletor de pasta (uso único) ──
                } else if ((selection as any)._type === 'browse') {
                    const picked = await pickFolderDialog(
                        'Selecionar pasta de destino para os arquivos .r',
                        vscode.Uri.file(os.homedir())
                    );
                    if (!picked) {
                        vscode.window.showWarningMessage('Nenhuma pasta selecionada. Salvamento cancelado.');
                        return;
                    }
                    targetBasePath = picked;

                // ── Adicionar novo servidor permanentemente ──
                } else if ((selection as any)._type === 'add') {
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
                        { label: '🪟 Windows', description: 'Apenas para usuários Windows',        value: 'windows' },
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

                    targetBasePath = newPath;
                    const newServer: TargetServer = { name: newName.trim(), path: newPath.trim(), platform };
                    // Relê antes de gravar para não sobrescrever alterações concorrentes
                    const fresh = await readServers();
                    await saveServers([...fresh, newServer]);
                    vscode.window.showInformationMessage(
                        `✅ Servidor "${newName}" adicionado à lista de servidores!`
                    );
                }

                if (!targetBasePath) {
                    vscode.window.showWarningMessage('Salvamento cancelado.');
                    return;
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
