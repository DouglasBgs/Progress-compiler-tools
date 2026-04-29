import * as vscode from 'vscode';
import { LintRule, stripComments } from './index';

/**
 * Regra: IF sem THEN.
 * Detecta statements IF que não possuem a palavra-chave THEN correspondente.
 */
export class IfWithoutThenRule implements LintRule {
    name = 'if-without-then';
    description = 'Detecta IF sem a palavra-chave THEN correspondente';

    check(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const fullText = document.getText();
        const strippedText = stripComments(fullText);
        const lines = strippedText.split('\n');

        // Procurar IFs e verificar se possuem THEN
        let inIfStatement = false;
        let ifLineNumber = -1;
        let hasThen = false;
        let parenDepth = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim().toUpperCase();

            if (trimmed === '') {
                continue;
            }

            // Verificar se a linha inicia um IF statement
            const ifMatch = /\bIF\b/i.exec(trimmed);
            if (ifMatch && !inIfStatement) {
                // Verificar se o THEN está na mesma linha
                if (/\bTHEN\b/i.test(trimmed)) {
                    continue;
                }

                inIfStatement = true;
                ifLineNumber = i;
                hasThen = false;
                parenDepth = 0;

                // Contar parênteses na linha atual
                for (const char of line) {
                    if (char === '(') { parenDepth++; }
                    if (char === ')') { parenDepth--; }
                }
                continue;
            }

            // Se estamos dentro de um IF, procurar THEN
            if (inIfStatement) {
                // Contar parênteses
                for (const char of line) {
                    if (char === '(') { parenDepth++; }
                    if (char === ')') { parenDepth--; }
                }

                if (/\bTHEN\b/i.test(trimmed)) {
                    hasThen = true;
                    inIfStatement = false;
                    continue;
                }

                // Se encontramos um ponto (fim do statement) sem THEN, é erro
                if (trimmed.endsWith('.') && parenDepth <= 0) {
                    if (!hasThen) {
                        const originalLine = document.lineAt(ifLineNumber);
                        const ifPos = originalLine.text.toUpperCase().indexOf('IF');
                        const range = new vscode.Range(
                            ifLineNumber, ifPos >= 0 ? ifPos : 0,
                            ifLineNumber, (ifPos >= 0 ? ifPos : 0) + 2
                        );
                        diagnostics.push(new vscode.Diagnostic(
                            range,
                            `IF sem THEN correspondente. Todo IF deve ter um THEN.`,
                            vscode.DiagnosticSeverity.Error
                        ));
                    }
                    inIfStatement = false;
                    continue;
                }

                // Se encontramos outro bloco aberto sem THEN, é erro
                if (/\b(DO|FOR|REPEAT|PROCEDURE|FUNCTION)\b/i.test(trimmed) && 
                    !(/\bTHEN\b/i.test(trimmed))) {
                    if (!hasThen) {
                        const originalLine = document.lineAt(ifLineNumber);
                        const ifPos = originalLine.text.toUpperCase().indexOf('IF');
                        const range = new vscode.Range(
                            ifLineNumber, ifPos >= 0 ? ifPos : 0,
                            ifLineNumber, (ifPos >= 0 ? ifPos : 0) + 2
                        );
                        diagnostics.push(new vscode.Diagnostic(
                            range,
                            `IF sem THEN correspondente. Todo IF deve ter um THEN.`,
                            vscode.DiagnosticSeverity.Error
                        ));
                    }
                    inIfStatement = false;
                    continue;
                }
            }
        }

        // Se chegamos ao fim do arquivo com IF pendente
        if (inIfStatement && !hasThen && ifLineNumber >= 0) {
            const originalLine = document.lineAt(ifLineNumber);
            const ifPos = originalLine.text.toUpperCase().indexOf('IF');
            const range = new vscode.Range(
                ifLineNumber, ifPos >= 0 ? ifPos : 0,
                ifLineNumber, (ifPos >= 0 ? ifPos : 0) + 2
            );
            diagnostics.push(new vscode.Diagnostic(
                range,
                `IF sem THEN correspondente. Todo IF deve ter um THEN.`,
                vscode.DiagnosticSeverity.Error
            ));
        }

        return diagnostics;
    }
}
