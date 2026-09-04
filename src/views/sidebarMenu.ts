import * as vscode from 'vscode';

class SidebarMenuItem extends vscode.TreeItem {
    children?: SidebarMenuItem[];

    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        options?: { commandId?: string; tooltip?: string; iconId?: string; children?: SidebarMenuItem[] }
    ) {
        super(label, collapsibleState);
        if (options?.tooltip) {
            this.tooltip = options.tooltip;
        }
        if (options?.commandId) {
            this.command = {
                command: options.commandId,
                title: label
            };
        }
        if (options?.iconId) {
            this.iconPath = new vscode.ThemeIcon(options.iconId);
        }
        if (options?.children) {
            this.children = options.children;
        }
    }
}

function createItem(label: string, commandId: string, tooltip: string, iconId: string): SidebarMenuItem {
    return new SidebarMenuItem(label, vscode.TreeItemCollapsibleState.None, { commandId, tooltip, iconId });
}

function createSection(label: string, iconId: string, children: SidebarMenuItem[]): SidebarMenuItem {
    return new SidebarMenuItem(label, vscode.TreeItemCollapsibleState.Expanded, { iconId, children });
}

class SidebarMenuProvider implements vscode.TreeDataProvider<SidebarMenuItem> {
    private readonly sections: SidebarMenuItem[] = [
        createSection('Compilação', 'run-all', [
            createItem('Compilar Arquivo Atual', 'abl-linter.compileRemote', 'Compilar o arquivo ativo no editor', 'run-above'),
            createItem('Selecionar Arquivos e Compilar', 'abl-linter.selectFilesAndCompile', 'Selecionar arquivos para enviar para compilação remota', 'files'),
        ]),
        createSection('Servidores', 'server-environment', [
            createItem('Gerenciar Servidores', 'abl-linter.manageServers', 'Abrir menu completo de gerenciamento', 'server-environment'),
            createItem('Adicionar Servidor', 'abl-linter.addServer', 'Adicionar novo servidor de destino', 'add'),
            createItem('Excluir Servidor', 'abl-linter.removeServer', 'Excluir servidor de destino', 'trash'),
        ]),
        createSection('Configuração', 'settings-gear', [
            createItem('Ajustar Configurações', 'abl-linter.openSettings', 'Abrir configurações da extensão', 'settings-gear'),
            createItem('Selecionar Repositório', 'abl-linter.selectRepository', 'Alterar repositório de compilação', 'repo'),
        ]),
        createSection('Facilitadores', 'lightbulb', [
            createItem('Analisar Log', 'abl-linter.analyzeLog', 'Análise estática de logs Progress: erros, performance, conexões e arquivos', 'graph'),
            
        ]),
    ];

    readonly onDidChangeTreeData?: vscode.Event<SidebarMenuItem | undefined | null | void>;

    getTreeItem(element: SidebarMenuItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SidebarMenuItem): Thenable<SidebarMenuItem[]> {
        if (!element) {
            return Promise.resolve(this.sections);
        }
        return Promise.resolve(element.children || []);
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

export function registerFacilitatorCommands(context: vscode.ExtensionContext) {
    // Selecionar Repositório de Compilação
    context.subscriptions.push(
        vscode.commands.registerCommand('abl-linter.selectRepository', async () => {
            const repos = ['CRM', 'EAI1.00', 'EMS2.08', 'EMS5.08', 'FND1.02', 'GP3.50', 'HCM2.11A', 'HUB'];
            const config = vscode.workspace.getConfiguration('abl-linter');
            const current = config.get<string>('compilationRepository', 'EMS2.08');
            const selected = await vscode.window.showQuickPick(repos, {
                placeHolder: `Repositório atual: ${current}`,
                title: 'Selecionar Repositório de Compilação'
            });
            if (selected) {
                await config.update('compilationRepository', selected, vscode.ConfigurationTarget.Global);
                await config.update('enableCompilationRepository', true, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`Repositório alterado para: ${selected}`);
            }
        })
    );
}
