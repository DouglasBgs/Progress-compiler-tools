import * as vscode from 'vscode';
import { detectRepositoryForUri, getRepositoryDisplayName } from '../config/repositoryDetector';

let statusBarItem: vscode.StatusBarItem;

export function registerStatusBar(context: vscode.ExtensionContext) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'abl-linter.selectRepository';
    context.subscriptions.push(statusBarItem);

    // Atualiza ao trocar de arquivo ativo
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            updateStatusBar(editor);
        })
    );

    // Atualiza se as configurações forem alteradas
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('abl-linter')) {
                updateStatusBar(vscode.window.activeTextEditor);
            }
        })
    );

    // Atualiza inicialmente
    updateStatusBar(vscode.window.activeTextEditor);
}

export function updateStatusBar(editor?: vscode.TextEditor) {
    if (!statusBarItem) { return; }

    const config = vscode.workspace.getConfiguration('abl-linter');
    const autoDetect = config.get<boolean>('autoDetectRepository', true);
    const configuredRepo = config.get<string>('compilationRepository', 'EMS2.08');

    if (editor && editor.document) {
        const detected = detectRepositoryForUri(editor.document.uri);
        if (autoDetect && detected) {
            statusBarItem.text = `$(repo) ABL: ${detected.code}`;
            statusBarItem.tooltip = `Repositório Detectado: ${detected.displayName}\nOrigem: Pasta raiz que precede progress/src/\nClique para alterar ou selecionar repositório`;
            statusBarItem.show();
            return;
        }
    }

    // Se não houver arquivo ativo ou se auto-detect não identificou
    const friendlyName = getRepositoryDisplayName(configuredRepo);
    statusBarItem.text = `$(repo) ABL: ${configuredRepo.replace(/\.\d+$/, '')}`;
    statusBarItem.tooltip = `Repositório de Compilação: ${friendlyName}\nClique para alterar repositório`;
    statusBarItem.show();
}
