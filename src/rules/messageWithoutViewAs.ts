import * as vscode from 'vscode';
import { LintRule, stripComments } from './index';

/**
 * Regra: MESSAGE sem VIEW-AS ALERT-BOX.
 * Em interfaces modernas/Windows, o statement MESSAGE sem VIEW-AS ALERT-BOX
 * pisca a mensagem rapidamente na barra de status inferior, o que geralmente
 * não é o que o desenvolvedor deseja.
 */
export class MessageWithoutViewAsRule implements LintRule {
    name = 'message-without-view-as';
    description = 'Detecta MESSAGE sem VIEW-AS ALERT-BOX';

    check(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const fullText = document.getText();
        const strippedText = stripComments(fullText);
        const lines = strippedText.split('\n');

        let currentStatement = '';
        let statementStartLine = 0;

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();

            if (trimmed === '') { continue; }

            if (currentStatement === '') {
                statementStartLine = i;
            }

            currentStatement += ' ' + trimmed;

            if (trimmed.endsWith('.')) {
                const upper = currentStatement.toUpperCase().trim();

                // Identifica o statement MESSAGE
                if (/^\s*MESSAGE\b/i.test(upper)) {
                    // Verifica se há VIEW-AS ALERT-BOX
                    if (!/\bVIEW-AS\s+ALERT-BOX\b/i.test(upper)) {
                        const originalLine = document.lineAt(statementStartLine);
                        const msgPos = originalLine.text.toUpperCase().indexOf('MESSAGE');
                        
                        const range = new vscode.Range(
                            statementStartLine, msgPos >= 0 ? msgPos : 0,
                            statementStartLine, originalLine.text.length
                        );

                        diagnostics.push(new vscode.Diagnostic(
                            range,
                            `MESSAGE sem VIEW-AS ALERT-BOX. A mensagem será exibida apenas na barra de rodapé (status bar).`,
                            vscode.DiagnosticSeverity.Information
                        ));
                    }
                }

                currentStatement = '';
            }
        }

        return diagnostics;
    }
}
