import * as vscode from 'vscode';

class SidebarMenuItem extends vscode.TreeItem {
    constructor(label: string, commandId: string, tooltip: string, iconId: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.tooltip = tooltip;
        this.command = {
            command: commandId,
            title: label
        };
        this.iconPath = new vscode.ThemeIcon(iconId);
    }
}

class SidebarMenuProvider implements vscode.TreeDataProvider<SidebarMenuItem> {
    private readonly items: SidebarMenuItem[] = [
        new SidebarMenuItem(
            'Selecionar Arquivos e Compilar',
            'abl-linter.selectFilesAndCompile',
            'Selecionar arquivos para enviar para compilacao remota',
            'files'
        ),
        new SidebarMenuItem(
            'Ajustar Configuracoes',
            'abl-linter.openSettings',
            'Abrir configuracoes da extensao',
            'settings-gear'
        ),
        new SidebarMenuItem(
            'Adicionar Servidor',
            'abl-linter.addServer',
            'Adicionar novo servidor de destino',
            'add'
        ),
        new SidebarMenuItem(
            'Excluir Servidor',
            'abl-linter.removeServer',
            'Excluir servidor de destino',
            'trash'
        ),
        new SidebarMenuItem(
            'Gerenciar Servidores',
            'abl-linter.manageServers',
            'Abrir menu completo de gerenciamento',
            'server-environment'
        )
    ];

    readonly onDidChangeTreeData?: vscode.Event<SidebarMenuItem | undefined | null | void>;

    getTreeItem(element: SidebarMenuItem): vscode.TreeItem {
        return element;
    }

    getChildren(): Thenable<SidebarMenuItem[]> {
        return Promise.resolve(this.items);
    }
}

export function registerSidebarMenu(context: vscode.ExtensionContext) {
    const provider = new SidebarMenuProvider();

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('ablLinterMenu', provider)
    );
}

export function registerOpenSettingsCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('abl-linter.openSettings', async () => {
        await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:douglasbarbosa.progress-compiler-tools abl-linter'
        );
    });

    context.subscriptions.push(disposable);
}

export function registerSelectFilesAndCompileCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('abl-linter.selectFilesAndCompile', async () => {
        const selectedFiles = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            openLabel: 'Enviar para Compilacao',
            title: 'Selecionar arquivos para compilacao remota',
            filters: {
                'Arquivos OpenEdge ABL': ['p', 'w', 'cls', 'i', 'py'],
                'Todos os Arquivos': ['*']
            }
        });

        if (!selectedFiles || selectedFiles.length === 0) {
            vscode.window.showWarningMessage('Nenhum arquivo foi selecionado para compilacao.');
            return;
        }

        await vscode.commands.executeCommand('abl-linter.compileRemote', selectedFiles);
    });

    context.subscriptions.push(disposable);
}
