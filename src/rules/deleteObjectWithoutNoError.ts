import * as vscode from 'vscode';
import { LintRule, stripComments } from './index';

/**
 * Regra: DELETE OBJECT sem NO-ERROR.
 * Conforme o ABL Reference v13.0 (DELETE OBJECT statement, p.549):
 * DELETE OBJECT pode lançar ERROR se o handle for inválido, se o socket
 * estiver conectado, se houver async requests pendentes, etc.
 * É boa prática sempre usar NO-ERROR ou VALID-HANDLE/VALID-OBJECT antes.
 */
export class DeleteObjectWithoutNoErrorRule implements LintRule {
    name = 'delete-object-without-no-error';
    description = 'Detecta DELETE OBJECT sem NO-ERROR';

    check(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const fullText = document.getText();
        const strippedText = stripComments(fullText);

        // Coletar statements completos
        const lines = strippedText.split('\n');
        let currentStatement = '';
        let statementStartLine = 0;

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();

            if (trimmed === '') {
                continue;
            }

            if (currentStatement === '') {
                statementStartLine = i;
            }

            currentStatement += ' ' + trimmed;

            if (trimmed.endsWith('.')) {
                const upper = currentStatement.toUpperCase();

                // Verificar se é DELETE OBJECT
                if (/\bDELETE\s+OBJECT\b/i.test(upper)) {
                    // Verificar se tem NO-ERROR
                    if (!/\bNO-ERROR\b/i.test(upper)) {
                        const originalLine = document.lineAt(statementStartLine);
                        const delPos = originalLine.text.toUpperCase().indexOf('DELETE');
                        const range = new vscode.Range(
                            statementStartLine, delPos >= 0 ? delPos : 0,
                            statementStartLine, originalLine.text.length
                        );
                        diagnostics.push(new vscode.Diagnostic(
                            range,
                            `DELETE OBJECT sem NO-ERROR. Adicione NO-ERROR para evitar erros caso o handle/objeto seja inválido.`,
                            vscode.DiagnosticSeverity.Warning
                        ));
                    }
                }

                currentStatement = '';
            }
        }

        return diagnostics;
    }
}
