import * as vscode from 'vscode';
import { LintRule, stripComments } from './index';

/**
 * Regra: RUN sem NO-ERROR.
 * Conforme o ABL Reference v13.0 (RUN statement, p.1075):
 * O RUN pode falhar se a procedure não existir, não for encontrada no PROPATH,
 * ou se houver erro de parâmetros. Sem NO-ERROR, o erro interrompe a execução.
 * Esta regra detecta RUN de procedures dinâmicas (VALUE) e procedures externas.
 */
export class RunWithoutNoErrorRule implements LintRule {
    name = 'run-without-no-error';
    description = 'Detecta RUN de procedures externas/dinâmicas sem NO-ERROR';

    check(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const fullText = document.getText();
        const strippedText = stripComments(fullText);
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
                const upper = currentStatement.toUpperCase().trim();

                // Verificar se é um RUN statement
                if (/^\s*RUN\s+/i.test(upper)) {
                    // Verificar se é dinâmico (VALUE) ou externo (com extensão .p/.w/.r)
                    const isDynamic = /\bVALUE\s*\(/i.test(upper);
                    const isExternal = /\bRUN\s+[\w\/-]+\.(p|w|r)\b/i.test(upper);
                    const isPersistent = /\bPERSISTENT\b/i.test(upper);
                    const isOnServer = /\bON\s+(SERVER|SESSION)\b/i.test(upper);

                    // Apenas verifica para RUN dinâmico, externo, persistente ou remoto
                    if (isDynamic || isExternal || isPersistent || isOnServer) {
                        // Verificar se tem NO-ERROR
                        if (!/\bNO-ERROR\b/i.test(upper)) {
                            const originalLine = document.lineAt(statementStartLine);
                            const runPos = originalLine.text.toUpperCase().indexOf('RUN');
                            const range = new vscode.Range(
                                statementStartLine, runPos >= 0 ? runPos : 0,
                                statementStartLine, originalLine.text.length
                            );

                            let tipo = 'externo';
                            if (isDynamic) { tipo = 'dinâmico (VALUE)'; }
                            else if (isPersistent) { tipo = 'persistente'; }
                            else if (isOnServer) { tipo = 'remoto'; }

                            diagnostics.push(new vscode.Diagnostic(
                                range,
                                `RUN ${tipo} sem NO-ERROR. Adicione NO-ERROR para tratar falhas na execução da procedure.`,
                                vscode.DiagnosticSeverity.Warning
                            ));
                        }
                    }
                }

                currentStatement = '';
            }
        }

        return diagnostics;
    }
}
