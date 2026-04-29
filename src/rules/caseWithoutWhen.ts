import * as vscode from 'vscode';
import { LintRule, stripComments } from './index';

/**
 * Regra: CASE sem WHEN.
 * Conforme o ABL Reference v13.0 (CASE statement, p.188):
 * O CASE precisa de pelo menos um WHEN clause para ter utilidade.
 * Um CASE sem nenhum WHEN é código morto.
 */
export class CaseWithoutWhenRule implements LintRule {
    name = 'case-without-when';
    description = 'Detecta statement CASE sem nenhum WHEN';

    check(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const fullText = document.getText();
        const strippedText = stripComments(fullText);
        const lines = strippedText.split('\n');

        let inCase = false;
        let caseLineNumber = -1;
        let hasWhen = false;
        let caseDepth = 0;

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            const upper = trimmed.toUpperCase();

            if (trimmed === '') {
                continue;
            }

            // Detectar início de CASE
            if (/\bCASE\b.*:/i.test(upper) && !inCase) {
                inCase = true;
                caseLineNumber = i;
                hasWhen = false;
                caseDepth = 1;
                continue;
            }

            if (inCase) {
                // Contar profundidade de blocos internos
                if (/\b(DO|FOR|REPEAT|CASE)\b.*:/i.test(upper)) {
                    caseDepth++;
                }

                if (/\bEND\b/i.test(upper)) {
                    caseDepth--;
                    if (caseDepth <= 0) {
                        // Fim do CASE
                        if (!hasWhen) {
                            const originalLine = document.lineAt(caseLineNumber);
                            const casePos = originalLine.text.toUpperCase().indexOf('CASE');
                            const range = new vscode.Range(
                                caseLineNumber, casePos >= 0 ? casePos : 0,
                                caseLineNumber, originalLine.text.length
                            );
                            diagnostics.push(new vscode.Diagnostic(
                                range,
                                `CASE sem nenhum WHEN. O statement CASE requer pelo menos uma cláusula WHEN.`,
                                vscode.DiagnosticSeverity.Error
                            ));
                        }
                        inCase = false;
                        continue;
                    }
                }

                // Procurar WHEN apenas no nível correto
                if (caseDepth === 1 && /\bWHEN\b/i.test(upper)) {
                    hasWhen = true;
                }
            }
        }

        return diagnostics;
    }
}
