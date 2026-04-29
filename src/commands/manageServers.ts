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
        { label: '🪟 Windows', description: 'Apenas para usuários Windows',          value: 'windows' as const },
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

    const newServer: TargetServer = { name: name.trim(), path: serverPath.trim(), platform };
    const fresh = await readServers(); // relê antes de gravar
    await saveServers([...fresh, newServer]);
    vscode.window.showInformationMessage(`✅ Servidor "${name}" (${platform}) adicionado com sucesso!`);
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
            detail: `Plataforma: ${s.platform}`,
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
        { label: '🪟 Windows', description: 'Apenas para usuários Windows',        value: 'windows' as const },
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

    const fresh = await readServers(); // relê antes de gravar
    const updated = [...fresh];
    updated[idx] = { name: name.trim(), path: serverPath.trim(), platform };
    await saveServers(updated);
    vscode.window.showInformationMessage(`✅ Servidor "${name}" atualizado com sucesso!`);
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
            detail: `Plataforma: ${s.platform}`,
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
