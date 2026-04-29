import * as vscode from 'vscode';
import { LintRule, stripComments } from './index';

/**
 * Regra: FOR EACH sem lock explícito.
 * Conforme o ABL Reference v13.0 (FOR statement, p.659):
 * "By default, the AVM puts a SHARE-LOCK on a record when it is read."
 * Omitir o lock pode causar problemas de concorrência.
 * Recomenda-se sempre especificar NO-LOCK, SHARE-LOCK ou EXCLUSIVE-LOCK.
 */
export class ForEachWithoutLockRule implements LintRule {
    name = 'for-each-without-lock';
    description = 'Detecta FOR EACH/FIRST/LAST sem lock explícito (NO-LOCK, SHARE-LOCK ou EXCLUSIVE-LOCK)';

    check(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const fullText = document.getText();
        const strippedText = stripComments(fullText);

        // Padrão para encontrar FOR EACH/FIRST/LAST statements completos
        // Coleta o statement inteiro até ":" (abertura de bloco)
        const forPattern = /\bFOR\s+(EACH|FIRST|LAST)\b/gi;

        let match;
        while ((match = forPattern.exec(strippedText)) !== null) {
            const startPos = match.index;

            // Encontrar o fim do header do FOR (que termina com ":")
            let endPos = startPos;
            let depth = 0;
            while (endPos < strippedText.length) {
                const char = strippedText[endPos];
                if (char === '(') { depth++; }
                if (char === ')') { depth--; }
                if (char === ':' && depth === 0) {
                    break;
                }
                if (char === '.' && depth === 0) {
                    // Pode ser um FOR statement inline
                    break;
                }
                endPos++;
            }

            const forHeader = strippedText.substring(startPos, endPos + 1);

            // Verificar se contém algum lock
            if (!/\b(NO-LOCK|SHARE-LOCK|EXCLUSIVE-LOCK)\b/i.test(forHeader)) {
                // Encontrar a linha no documento original
                const beforeMatch = strippedText.substring(0, startPos);
                const lineNumber = (beforeMatch.match(/\n/g) || []).length;

                if (lineNumber < document.lineCount) {
                    const originalLine = document.lineAt(lineNumber);
                    const forPos = originalLine.text.toUpperCase().indexOf('FOR');
                    const range = new vscode.Range(
                        lineNumber, forPos >= 0 ? forPos : 0,
                        lineNumber, originalLine.text.length
                    );
                    diagnostics.push(new vscode.Diagnostic(
                        range,
                        `FOR ${match[1].toUpperCase()} sem lock explícito. Adicione NO-LOCK, SHARE-LOCK ou EXCLUSIVE-LOCK para evitar problemas de concorrência.`,
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
            }
        }

        return diagnostics;
    }
}
