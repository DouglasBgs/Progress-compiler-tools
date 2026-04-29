import * as vscode from 'vscode';
import * as path from 'path';

export interface TargetServer {
    name: string;
    path: string;
    platform: 'linux' | 'windows' | 'any';
}

const SERVERS_FILE = 'servers.json';

let _storageUri: vscode.Uri | undefined;

/**
 * Inicializa o gerenciador de configuração com o contexto da extensão.
 * Deve ser chamado no activate() antes de qualquer uso.
 */
export function initServersConfig(context: vscode.ExtensionContext): void {
    _storageUri = context.globalStorageUri;
}

/**
 * Retorna o URI do arquivo servers.json
 */
function getServersFileUri(): vscode.Uri {
    if (!_storageUri) {
        throw new Error('[ABL Linter] ServersConfig não foi inicializado. Chame initServersConfig() no activate().');
    }
    return vscode.Uri.file(path.join(_storageUri.fsPath, SERVERS_FILE));
}

/**
 * Lê a lista de servidores do arquivo servers.json.
 * Retorna array vazio se o arquivo ainda não existir.
 */
export async function readServers(): Promise<TargetServer[]> {
    try {
        const fileUri = getServersFileUri();
        const raw = await vscode.workspace.fs.readFile(fileUri);
        const json = Buffer.from(raw).toString('utf-8');
        const parsed = JSON.parse(json);
        if (Array.isArray(parsed)) {
            return parsed as TargetServer[];
        }
        return [];
    } catch (err: any) {
        // Arquivo ainda não existe (primeira execução) — retorna vazio
        if (err?.code === 'FileNotFound' || err?.code === 'ENOENT' || err?.name === 'EntryNotFound (FileSystemError)') {
            return [];
        }
        // Erro de parse do JSON — retorna vazio e avisa
        console.warn('[ABL Linter] Erro ao ler servers.json:', err);
        return [];
    }
}

/**
 * Grava a lista de servidores no arquivo servers.json.
 * Cria o diretório de storage se necessário.
 */
export async function saveServers(servers: TargetServer[]): Promise<void> {
    const fileUri = getServersFileUri();

    // Garante que o diretório de storage existe
    await vscode.workspace.fs.createDirectory(_storageUri!);

    const json = JSON.stringify(servers, null, 2);
    const bytes = Buffer.from(json, 'utf-8');
    await vscode.workspace.fs.writeFile(fileUri, bytes);
}

/**
 * Retorna o caminho físico do arquivo de configuração, para exibição ao usuário.
 */
export function getServersFilePath(): string {
    return getServersFileUri().fsPath;
}

/**
 * Filtra servidores pela plataforma atual do sistema operacional.
 */
export function getServersForCurrentPlatform(servers: TargetServer[]): TargetServer[] {
    const currentPlatform = process.platform === 'win32' ? 'windows' : 'linux';
    return servers.filter(s => s.platform === 'any' || s.platform === currentPlatform);
}
