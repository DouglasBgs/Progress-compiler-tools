import * as vscode from 'vscode';
import { LintRule, stripComments } from './index';

/**
 * Regra: Uso de = em vez de EQ em comparações.
 * Detecta possível confusão entre atribuição (=) e comparação (EQ/=)
 * dentro de condições IF e WHERE.
 */
export class AssignInConditionRule implements LintRule {
    name = 'assign-in-condition';
    description = 'Alerta sobre possível confusão entre atribuição e comparação em IF/WHERE';

    check(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const fullText = document.getText();
        const strippedText = stripComments(fullText);
        const lines = strippedText.split('\n');

        let inIfCondition = false;
        let inWhereClause = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            const upper = trimmed.toUpperCase();

            if (trimmed === '') {
                continue;
            }

            // Verificar se entramos em contexto IF
            if (/\bIF\b/i.test(upper)) {
                inIfCondition = true;
            }

            // Verificar se entramos em contexto WHERE
            if (/\bWHERE\b/i.test(upper)) {
                inWhereClause = true;
            }

            // Verificar THEN — fim da condição IF
            if (/\bTHEN\b/i.test(upper)) {
                inIfCondition = false;
            }

            // Verificar fim do statement
            if (trimmed.endsWith('.') || trimmed.endsWith(':')) {
                if (!inIfCondition) {
                    inWhereClause = false;
                }
            }

            // Se estamos em condição, procurar "="
            if (inIfCondition || inWhereClause) {
                // Procurar padrão: variavel = valor (que poderia ser EQ)
                const assignInCondition = /\b([\w][\w-]*)\s*=\s*(?![\s]*$)/g;
                let condMatch;

                while ((condMatch = assignInCondition.exec(trimmed)) !== null) {
                    // Ignorar se é parte de >= ou <= ou <> ou <>= etc
                    const charBefore = condMatch.index > 0 ? trimmed[condMatch.index - 1] : '';
                    const eqPos = condMatch.index + condMatch[1].length;
                    const charAfterEq = eqPos + 1 < trimmed.length ? trimmed[eqPos + 1] : '';

                    if (charBefore === '<' || charBefore === '>' || charBefore === '!') {
                        continue;
                    }
                    if (charAfterEq === '>' || charAfterEq === '<') {
                        continue;
                    }

                    const originalLine = document.lineAt(i);
                    const eqPosInOriginal = originalLine.text.indexOf('=', condMatch.index);
                    if (eqPosInOriginal >= 0) {
                        // Verificar se não é >= ou <=
                        if (eqPosInOriginal > 0) {
                            const prevChar = originalLine.text[eqPosInOriginal - 1];
                            if (prevChar === '<' || prevChar === '>' || prevChar === '!') {
                                continue;
                            }
                        }

                        const range = new vscode.Range(
                            i, eqPosInOriginal,
                            i, eqPosInOriginal + 1
                        );
                        diagnostics.push(new vscode.Diagnostic(
                            range,
                            `Uso de "=" dentro de condição IF/WHERE. Considere usar "EQ" para comparação, para maior clareza.`,
                            vscode.DiagnosticSeverity.Warning
                        ));
                    }
                }
            }

            // Reset ao fim do bloco THEN
            if (/\bTHEN\b/i.test(upper)) {
                inIfCondition = false;
            }
        }

        return diagnostics;
    }
}
