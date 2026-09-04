import * as vscode from 'vscode';
import { registerRemoteCompileCommand } from './commands/remoteCompile';
import {
    registerAddServerCommand,
    registerManageServersCommand,
    registerRemoveServerCommand
} from './commands/manageServers';
import { initServersConfig } from './config/serversConfig';
import {
    registerOpenSettingsCommand,
    registerSelectFilesAndCompileCommand,
    registerSelectFoldersAndCompileCommand,
    registerSidebarMenu,
    registerFacilitatorCommands
} from './views/sidebarMenu';
import { registerLogAnalyzerCommand } from './commands/logAnalyzer';
import { registerAblIncludeProviders } from './providers/ablIncludeProvider';
import { registerAblProcedureProviders } from './providers/ablProcedureProvider';
import { registerStatusBar } from './views/statusBar';

export function activate(context: vscode.ExtensionContext) {
    console.log('OpenEdge ABL Progress Compiler Tools is now active!');

    // Inicializa o gerenciador de servidores (servers.json no globalStorage da extensão)
    initServersConfig(context);

    // Verifica se o URL do servidor de compilação está configurado (Assistente Inicial)
    getOrPromptCompilerUrl();

    // Registra a barra de status com indicação do repositório/pasta ativa
    registerStatusBar(context);

    // Registra o comando de compilação remota do VSCode Explorer context menu
    registerRemoteCompileCommand(context);

    // Registra o comando de gerenciamento de servidores de destino
    registerManageServersCommand(context);
    registerAddServerCommand(context);
    registerRemoveServerCommand(context);

    // Registra menu lateral da extensão
    registerOpenSettingsCommand(context);
    registerSelectFilesAndCompileCommand(context);
    registerSelectFoldersAndCompileCommand(context);
    registerFacilitatorCommands(context);
    registerLogAnalyzerCommand(context);
    registerSidebarMenu(context);

    // Registra providers de includes ABL (navegação, hover, links)
    registerAblIncludeProviders(context);

    // Registra providers de procedures ABL (definição, hover com parâmetros)
    registerAblProcedureProviders(context);
}

export async function getOrPromptCompilerUrl(): Promise<string> {
    const config = vscode.workspace.getConfiguration('abl-linter');
    let compilerUrl = config.get<string>('compilerUrl', '');

    if (!compilerUrl || compilerUrl.trim() === '') {
        const result = await vscode.window.showInputBox({
            prompt: 'Configuração Necessária: Informe o URL do Servidor de Compilação ABL',
            placeHolder: 'Ex: http://seu-servidor:8080/compile',
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value || !value.startsWith('http')) {
                    return 'O URL deve ser válido e começar com http:// ou https://';
                }
                return null;
            }
        });

        if (result) {
            await config.update('compilerUrl', result, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('URL do Servidor configurado com sucesso!');
            return result;
        } else {
            vscode.window.showWarningMessage('A compilação remota não funcionará sem um servidor configurado.');
            return '';
        }
    }
    return compilerUrl;
}

export function deactivate() {
    // noop
}

