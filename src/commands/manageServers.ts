import * as vscode from 'vscode';
import * as os from 'os';
import {
    TargetServer,
    readServers,
    saveServers,
    getServersForCurrentPlatform,
    getServersFilePath
} from '../config/serversConfig';

// Re-exporta os tipos e helpers necessários pelo remoteCompile
export { TargetServer, readServers, saveServers, getServersForCurrentPlatform };

/**
 * Abre o diálogo de seleção de pasta (cross-platform)
 */
export async function pickFolderDialog(title: string, defaultUri?: vscode.Uri): Promise<string | undefined> {
    const result = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Selecionar Pasta',
        title: title,
        defaultUri: defaultUri
    });
    return result?.[0]?.fsPath;
}

/**
 * Registra o comando de gerenciamento de servidores de destino
 */
export function registerManageServersCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('abl-linter.manageServers', async () => {
        await showServerManager();
    });
    context.subscriptions.push(disposable);
}

/**
 * Registra o comando direto para adicionar servidor.
 */
export function registerAddServerCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('abl-linter.addServer', async () => {
        await addServer();
    });
    context.subscriptions.push(disposable);
}

/**
 * Registra o comando direto para remover servidor.
 */
export function registerRemoveServerCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('abl-linter.removeServer', async () => {
        await removeServer();
    });
    context.subscriptions.push(disposable);
}

function extractUncHost(serverPath: string): string | undefined {
    const normalized = serverPath.trim();
    const match = normalized.match(/^[\\/]{2}([^\\/]+)[\\/]/);
    return match?.[1];
}

/**
 * Valida se o host UNC está em security.allowedUNCHosts e oferece inclusão automática.
 */
export interface UncTrustValidationResult {
    trusted: boolean;
    restartRequired: boolean;
    host?: string;
}

async function promptRestartForUncChanges(host: string): Promise<void> {
    const restartAction = await vscode.window.showWarningMessage(
        `Host UNC "${host}" adicionado em security.allowedUNCHosts. É necessário reiniciar o VS Code para aplicar totalmente essa configuração.`,
        'Reiniciar Agora',
        'Depois'
    );

    if (restartAction === 'Reiniciar Agora') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
}

export async function ensureTrustedUncHost(serverPath: string): Promise<UncTrustValidationResult> {
    const host = extractUncHost(serverPath);

    // Só valida caminhos UNC.
    if (!host) {
        return { trusted: true, restartRequired: false };
    }

    const securityConfig = vscode.workspace.getConfiguration('security');
    const allowedHosts = securityConfig.get<string[]>('allowedUNCHosts', []);
    const hostLower = host.toLowerCase();
    const isAllowed = allowedHosts.some(h => h === '*' || h.toLowerCase() === hostLower);

    if (isAllowed) {
        return { trusted: true, restartRequired: false, host };
    }

    const action = await vscode.window.showWarningMessage(
        `O host UNC "${host}" não está em security.allowedUNCHosts. Isso pode bloquear gravações em pastas remotas.`,
        'Confiar neste host',
        'Cancelar'
    );

    if (action !== 'Confiar neste host') {
        vscode.window.showWarningMessage('Servidor não adicionado: host UNC não confiável.');
        return { trusted: false, restartRequired: false, host };
    }

    await securityConfig.update(
        'allowedUNCHosts',
        [...allowedHosts, host],
        vscode.ConfigurationTarget.Global
    );

    return { trusted: true, restartRequired: true, host };
}

async function showServerManager() {
    const servers = await readServers();

    const ACTION_ADD    = '$(add) Adicionar Novo Servidor';
    const ACTION_EDIT   = '$(edit) Editar Servidor';
    const ACTION_REMOVE = '$(trash) Remover Servidor';
    const ACTION_FILE   = '$(file-code) Abrir Arquivo de Configuração';
    const ACTION_CLOSE  = '$(close) Fechar';

    const action = await vscode.window.showQuickPick([
        { label: ACTION_ADD,    description: 'Adicionar um novo caminho de destino' },
        { label: ACTION_EDIT,   description: `${servers.length} servidor(es) configurado(s)` },
        { label: ACTION_REMOVE, description: 'Remover um servidor da lista' },
        { label: ACTION_FILE,   description: getServersFilePath() },
        { label: ACTION_CLOSE,  description: '' },
    ], {
        placeHolder: '⚙️ Gerenciar Servidores de Destino (.r)',
        ignoreFocusOut: true,
    });

    if (!action || action.label === ACTION_CLOSE) { return; }

    if (action.label === ACTION_ADD) {
        await addServer();
    } else if (action.label === ACTION_EDIT) {
        await editServer();
    } else if (action.label === ACTION_REMOVE) {
        await removeServer();
    } else if (action.label === ACTION_FILE) {
        // Abre o arquivo JSON no editor para edição manual
        const uri = vscode.Uri.file(getServersFilePath());
        await vscode.window.showTextDocument(uri);
    }
}

async function addServer() {
    const servers = await readServers();

    // 1. Nome
    const name = await vscode.window.showInputBox({
        prompt: 'Nome do Servidor',
        placeHolder: 'Ex: Produção, Homologação, Dev...',
        ignoreFocusOut: true,
        validateInput: (v) => (!v || v.trim() === '') ? 'Nome é obrigatório.' : null
    });
    if (!name) { return; }

    // 2. Plataforma
    const platformItem = await vscode.window.showQuickPick([
        { label: '🐧 Linux',   description: 'Apenas para usuários Linux',           value: 'linux'   as const },
        { label: '💻 Windows', description: 'Apenas para usuários Windows',          value: 'windows' as const },
        { label: '🌐 Ambas',   description: 'Funciona para Linux e Windows (any)',   value: 'any'     as const },
    ], { placeHolder: 'Para qual plataforma é este servidor?', ignoreFocusOut: true });
    if (!platformItem) { return; }
    const platform = (platformItem as any).value as 'linux' | 'windows' | 'any';

    // 3. Caminho
    const inputMethod = await vscode.window.showQuickPick([
        { label: '$(folder-opened) Selecionar Pasta...', description: 'Abrir diálogo de seleção de pasta' },
        { label: '$(keyboard) Digitar Caminho',          description: 'Útil para caminhos de rede \\\\servidor\\share' },
    ], { placeHolder: 'Como deseja informar o caminho do servidor?', ignoreFocusOut: true });
    if (!inputMethod) { return; }

    let serverPath: string | undefined;

    if (inputMethod.label.includes('Selecionar Pasta')) {
        serverPath = await pickFolderDialog(`Selecionar pasta para "${name}"`, vscode.Uri.file(os.homedir()));
    } else {
        const isWin = process.platform === 'win32';
        const example = platform === 'windows'
            ? '\\\\servidor\\share\\bin  ou  C:\\temp\\bin'
            : platform === 'linux'
            ? '/mnt/servidor/bin  ou  /home/user/bin'
            : isWin ? '\\\\servidor\\share\\bin' : '/mnt/servidor/bin';

        serverPath = await vscode.window.showInputBox({
            prompt: 'Caminho Completo do Diretório de Destino',
            placeHolder: `Ex: ${example}`,
            ignoreFocusOut: true,
            validateInput: (v) => (!v || v.trim() === '') ? 'Caminho é obrigatório.' : null
        });
    }

    if (!serverPath) {
        vscode.window.showWarningMessage('Adição cancelada: nenhum caminho foi informado.');
        return;
    }

    const uncValidation = await ensureTrustedUncHost(serverPath.trim());
    if (!uncValidation.trusted) {
        return;
    }

    // 4. Banco de Compilação Padrão (Opcional)
    const dbItem = await vscode.window.showQuickPick([
        { label: '$(dash) Não definir (perguntar na compilação)', value: undefined },
        { label: 'Progress',   value: 'Progress'   as const },
        { label: 'SQL Server', value: 'SQL Server' as const },
        { label: 'Oracle',     value: 'Oracle'     as const },
    ], { placeHolder: 'Banco de Compilação padrão para este servidor? (Opcional — pode ser ignorado)', ignoreFocusOut: true });
    if (dbItem === undefined) { return; }
    const dbType = dbItem.value;

    const newServer: TargetServer = { name: name.trim(), path: serverPath.trim(), platform, dbType };
    const fresh = await readServers(); // relê antes de gravar
    await saveServers([...fresh, newServer]);
    vscode.window.showInformationMessage(`✅ Servidor "${name}" (${platform}) adicionado com sucesso!`);

    if (uncValidation.restartRequired && uncValidation.host) {
        await promptRestartForUncChanges(uncValidation.host);
    }
}

async function editServer() {
    const servers = await readServers();

    if (servers.length === 0) {
        vscode.window.showWarningMessage('Nenhum servidor configurado para editar.');
        return;
    }

    const pick = await vscode.window.showQuickPick(
        servers.map((s, i) => ({
            label: `$(server) ${s.name}`,
            description: s.path,
            detail: s.dbType ? `Banco: ${s.dbType} | Plataforma: ${s.platform}` : `Plataforma: ${s.platform}`,
            index: i
        })),
        { placeHolder: 'Selecione o servidor para editar', ignoreFocusOut: true }
    );
    if (!pick) { return; }

    const idx = (pick as any).index as number;
    const old = servers[idx];

    // Nome
    const name = await vscode.window.showInputBox({
        prompt: 'Nome do Servidor',
        value: old.name,
        ignoreFocusOut: true,
        validateInput: (v) => (!v || v.trim() === '') ? 'Nome é obrigatório.' : null
    });
    if (!name) { return; }

    // Plataforma
    const platformItem = await vscode.window.showQuickPick([
        { label: '🐧 Linux',   description: 'Apenas para usuários Linux',         value: 'linux'   as const },
        { label: '💻 Windows', description: 'Apenas para usuários Windows',        value: 'windows' as const },
        { label: '🌐 Ambas',   description: 'Funciona para Linux e Windows (any)', value: 'any'     as const },
    ].map(item => ({ ...item, picked: item.value === old.platform })),
    { placeHolder: 'Para qual plataforma é este servidor?', ignoreFocusOut: true });
    if (!platformItem) { return; }
    const platform = (platformItem as any).value as 'linux' | 'windows' | 'any';

    // Caminho
    const inputMethod = await vscode.window.showQuickPick([
        { label: '$(folder-opened) Selecionar Pasta...', description: 'Abrir diálogo de seleção de pasta' },
        { label: '$(keyboard) Digitar Caminho',          description: `Atual: ${old.path}` },
    ], { placeHolder: 'Como deseja atualizar o caminho?', ignoreFocusOut: true });
    if (!inputMethod) { return; }

    let serverPath: string | undefined;

    if (inputMethod.label.includes('Selecionar Pasta')) {
        let defaultUri: vscode.Uri;
        try { defaultUri = vscode.Uri.file(old.path); }
        catch { defaultUri = vscode.Uri.file(os.homedir()); }
        serverPath = await pickFolderDialog(`Selecionar nova pasta para "${name}"`, defaultUri);
    } else {
        serverPath = await vscode.window.showInputBox({
            prompt: 'Caminho Completo do Diretório de Destino',
            value: old.path,
            ignoreFocusOut: true,
            validateInput: (v) => (!v || v.trim() === '') ? 'Caminho é obrigatório.' : null
        });
    }

    if (!serverPath) { return; }

    const uncValidation = await ensureTrustedUncHost(serverPath.trim());
    if (!uncValidation.trusted) {
        return;
    }

    // Banco de Compilação Padrão (Opcional)
    const dbItem = await vscode.window.showQuickPick([
        { label: '$(dash) Não definir (perguntar na compilação)', value: undefined, picked: old.dbType === undefined },
        { label: 'Progress',   value: 'Progress'   as const, picked: old.dbType === 'Progress'   },
        { label: 'SQL Server', value: 'SQL Server' as const, picked: old.dbType === 'SQL Server' },
        { label: 'Oracle',     value: 'Oracle'     as const, picked: old.dbType === 'Oracle'     },
    ], { placeHolder: 'Banco de Compilação padrão para este servidor? (Opcional)', ignoreFocusOut: true });
    if (dbItem === undefined) { return; }
    const dbType = dbItem.value;

    const fresh = await readServers(); // relê antes de gravar
    const updated = [...fresh];
    updated[idx] = { name: name.trim(), path: serverPath.trim(), platform, dbType };
    await saveServers(updated);
    vscode.window.showInformationMessage(`✅ Servidor "${name}" atualizado com sucesso!`);

    if (uncValidation.restartRequired && uncValidation.host) {
        await promptRestartForUncChanges(uncValidation.host);
    }
}

async function removeServer() {
    const servers = await readServers();

    if (servers.length === 0) {
        vscode.window.showWarningMessage('Nenhum servidor configurado para remover.');
        return;
    }

    const picks = await vscode.window.showQuickPick(
        servers.map((s, i) => ({
            label: `$(server) ${s.name}`,
            description: s.path,
            detail: s.dbType ? `Banco: ${s.dbType} | Plataforma: ${s.platform}` : `Plataforma: ${s.platform}`,
            index: i,
            picked: false
        })),
        {
            placeHolder: 'Selecione os servidores para remover (Multi-seleção)',
            ignoreFocusOut: true,
            canPickMany: true
        }
    );
    if (!picks || picks.length === 0) { return; }

    const toRemove = new Set(picks.map((p: any) => p.index as number));
    const fresh = await readServers(); // relê antes de gravar
    const updated = fresh.filter((_, i) => !toRemove.has(i));
    await saveServers(updated);
    vscode.window.showInformationMessage(`🗑️ ${picks.length} servidor(es) removido(s) com sucesso!`);
}
