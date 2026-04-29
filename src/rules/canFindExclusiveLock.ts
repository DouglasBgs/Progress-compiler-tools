import * as vscode from 'vscode';
import { LintRule, stripComments } from './index';

/**
 * Regra: CAN-FIND com EXCLUSIVE-LOCK.
 * Conforme o ABL Reference v13.0 (CAN-FIND function, p. 1048):
 * "EXCLUSIVE-LOCK is not allowed in a CAN-FIND because CAN-FIND does not return a record."
 * O uso de EXCLUSIVE-LOCK no CAN-FIND resulta em erro de compilação/sintaxe.
 */
export class CanFindExclusiveLockRule implements LintRule {
    name = 'can-find-exclusive-lock';
    description = 'Detecta uso inválido de EXCLUSIVE-LOCK na função CAN-FIND';

    check(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const fullText = document.getText();
        const strippedText = stripComments(fullText);

        // Expressão regular para achar CAN-FIND ( ... EXCLUSIVE-LOCK ... )
        // Usamos uma regex mais abrangente para pegar o parêntese
        const canFindPattern = /\bCAN-FIND\s*\(([^)]+)\)/gi;

        let match;
        while ((match = canFindPattern.exec(strippedText)) !== null) {
            const innerContent = match[1];

            if (/\bEXCLUSIVE-LOCK\b/i.test(innerContent)) {
                // Descobrir a linha
                const beforeMatch = strippedText.substring(0, match.index);
                const lineNumber = (beforeMatch.match(/\n/g) || []).length;

                if (lineNumber < document.lineCount) {
                    const originalLine = document.lineAt(lineNumber);
                    const canFindPos = originalLine.text.toUpperCase().indexOf('CAN-FIND');
                    const range = new vscode.Range(
                        lineNumber, canFindPos >= 0 ? canFindPos : 0,
                        lineNumber, originalLine.text.length
                    );

                    diagnostics.push(new vscode.Diagnostic(
                        range,
                        `A função CAN-FIND não permite EXCLUSIVE-LOCK, pois não retorna um registro. Use NO-LOCK ou SHARE-LOCK (default).`,
                        vscode.DiagnosticSeverity.Error
                    ));
                }
            }
        }

        return diagnostics;
    }
}
