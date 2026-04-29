import * as vscode from 'vscode';
import { LintRule, stripComments } from './index';

/**
 * Regra: DEFINE VARIABLE sem NO-UNDO.
 * Conforme o ABL Reference v13.0 (DEFINE VARIABLE statement, p.525 / VAR statement, p.1232):
 * O VAR statement é NO-UNDO por padrão, mas o DEFINE VARIABLE não.
 * Sem NO-UNDO, a variável participa de transações e pode ser restaurada em UNDO,
 * o que geralmente não é o comportamento desejado e prejudica a performance.
 */
export class DefineWithoutNoUndoRule implements LintRule {
    name = 'define-without-no-undo';
    description = 'Detecta DEFINE VARIABLE sem NO-UNDO';

    check(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const fullText = document.getText();
        const strippedText = stripComments(fullText);

        // Procurar DEFINE VARIABLE statements completos (até o ponto)
        const definePattern = /\bDEFINE\s+(?:NEW\s+)?(?:SHARED\s+)?VARIABLE\b[^.]*\./gi;

        let match;
        while ((match = definePattern.exec(strippedText)) !== null) {
            const statement = match[0];

            // Verificar se contém NO-UNDO
            if (!/\bNO-UNDO\b/i.test(statement)) {
                // Calcular a linha
                const beforeMatch = strippedText.substring(0, match.index);
                const lineNumber = (beforeMatch.match(/\n/g) || []).length;

                if (lineNumber < document.lineCount) {
                    const originalLine = document.lineAt(lineNumber);
                    const defPos = originalLine.text.toUpperCase().indexOf('DEFINE');
                    const range = new vscode.Range(
                        lineNumber, defPos >= 0 ? defPos : 0,
                        lineNumber, originalLine.text.length
                    );
                    diagnostics.push(new vscode.Diagnostic(
                        range,
                        `DEFINE VARIABLE sem NO-UNDO. Adicione NO-UNDO para melhor performance e evitar restauração indesejada em transações. Considere usar VAR (que é NO-UNDO por padrão).`,
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
            }
        }

        return diagnostics;
    }
}
