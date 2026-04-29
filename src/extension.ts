import * as vscode from 'vscode';
import { analyzeDocument } from './diagnostics';
import { registerRemoteCompileCommand } from './commands/remoteCompile';
import { registerManageServersCommand } from './commands/manageServers';
import { initServersConfig } from './config/serversConfig';

let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
    console.log('OpenEdge ABL Linter is now active!');

    // Inicializa o gerenciador de servidores (servers.json no globalStorage da extensão)
    initServersConfig(context);

    // Verifica se o URL do servidor de compilação está configurado (Assistente Incial)
    getOrPromptCompilerUrl();

    // Cria a coleção de diagnósticos
    diagnosticCollection = vscode.languages.createDiagnosticCollection('abl-linter');
    context.subscriptions.push(diagnosticCollection);

    // Extensões ABL suportadas
    const ablExtensions = ['.p', '.w', '.cls', '.i'];

    // Função auxiliar para verificar se o documento é ABL
    function isAblDocument(document: vscode.TextDocument): boolean {
        if (document.languageId === 'abl') {
            return true;
        }
        const fileName = document.fileName.toLowerCase();
        return ablExtensions.some(ext => fileName.endsWith(ext));
    }

    // Executa análise ao salvar o arquivo
    const onSaveDisposable = vscode.workspace.onDidSaveTextDocument((document) => {
        if (isAblDocument(document)) {
            const diagnostics = analyzeDocument(document);
            diagnosticCollection.set(document.uri, diagnostics);
        }
    });
    context.subscriptions.push(onSaveDisposable);

    // Limpa diagnósticos ao fechar o arquivo
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => {
        diagnosticCollection.delete(doc.uri);
    }));

    // Registra o comando de compilação remota do VSCode Explorer context menu
    registerRemoteCompileCommand(context);

    // Registra o comando de gerenciamento de servidores de destino
    registerManageServersCommand(context);

    // Analisa documentos ABL já abertos (ao ativar a extensão)
    vscode.workspace.textDocuments.forEach((document) => {
        if (isAblDocument(document)) {
            const diagnostics = analyzeDocument(document);
            diagnosticCollection.set(document.uri, diagnostics);
        }
    });
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
    if (diagnosticCollection) {
        diagnosticCollection.dispose();
    }
}
