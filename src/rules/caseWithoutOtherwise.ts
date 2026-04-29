import * as vscode from 'vscode';
import { LintRule, stripComments } from './index';

/**
 * Regra: CASE sem OTHERWISE.
 * Conforme o ABL Reference v13.0 (CASE statement, p.188):
 * "If the OTHERWISE branch is not given and no matching value is found,
 * then no branch of the CASE statement is executed."
 * É boa prática ter OTHERWISE para lidar com valores inesperados.
 */
export class CaseWithoutOtherwiseRule implements LintRule {
    name = 'case-without-otherwise';
    description = 'Detecta CASE sem cláusula OTHERWISE';

    check(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const fullText = document.getText();
        const strippedText = stripComments(fullText);
        const lines = strippedText.split('\n');

        let inCase = false;
        let caseLineNumber = -1;
        let hasOtherwise = false;
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
                hasOtherwise = false;
                caseDepth = 1;
                continue;
            }

            if (inCase) {
                // Blocos internos
                if (/\b(DO|FOR|REPEAT|CASE)\b.*:/i.test(upper)) {
                    caseDepth++;
                }

                if (/\bEND\b/i.test(upper)) {
                    caseDepth--;
                    if (caseDepth <= 0) {
                        if (!hasOtherwise) {
                            const originalLine = document.lineAt(caseLineNumber);
                            const casePos = originalLine.text.toUpperCase().indexOf('CASE');
                            const range = new vscode.Range(
                                caseLineNumber, casePos >= 0 ? casePos : 0,
                                caseLineNumber, originalLine.text.length
                            );
                            diagnostics.push(new vscode.Diagnostic(
                                range,
                                `CASE sem OTHERWISE. Considere adicionar OTHERWISE para tratar valores não previstos.`,
                                vscode.DiagnosticSeverity.Information
                            ));
                        }
                        inCase = false;
                        continue;
                    }
                }

                // Procurar OTHERWISE apenas no nível correto
                if (caseDepth === 1 && /\bOTHERWISE\b/i.test(upper)) {
                    hasOtherwise = true;
                }
            }
        }

        return diagnostics;
    }
}
