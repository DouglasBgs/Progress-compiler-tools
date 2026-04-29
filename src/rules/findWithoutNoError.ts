import * as vscode from 'vscode';
import { LintRule, stripComments } from './index';

/**
 * Regra: FIND sem NO-ERROR.
 * Detecta statements FIND que não possuem o modificador NO-ERROR,
 * o que pode causar erros em tempo de execução caso o registro não seja encontrado.
 */
export class FindWithoutNoErrorRule implements LintRule {
    name = 'find-without-no-error';
    description = 'Detecta FIND sem NO-ERROR';

    check(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const fullText = document.getText();
        const strippedText = stripComments(fullText);

        // Quebrar em statements (separados por ".")
        // Precisamos rastrear as linhas para cada statement
        const lines = strippedText.split('\n');

        // Coletar statements multi-linha
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

            // Se o statement termina com ponto
            if (trimmed.endsWith('.')) {
                this.checkStatement(
                    currentStatement.trim(),
                    statementStartLine,
                    document,
                    diagnostics
                );
                currentStatement = '';
            }
        }

        return diagnostics;
    }

    private checkStatement(
        statement: string,
        startLine: number,
        document: vscode.TextDocument,
        diagnostics: vscode.Diagnostic[]
    ): void {
        const upper = statement.toUpperCase();

        // Verificar se é um FIND statement
        const findMatch = /\bFIND\s+(FIRST|LAST|NEXT|PREV|CURRENT)?\s*/i.exec(upper);
        if (!findMatch) {
            return;
        }

        // Ignorar CAN-FIND (que não precisa de NO-ERROR)
        if (/\bCAN-FIND\b/i.test(upper)) {
            return;
        }

        // Verificar se tem NO-ERROR
        if (/\bNO-ERROR\b/i.test(upper)) {
            return;
        }

        // Reportar o erro na linha onde o FIND começa
        const originalLine = document.lineAt(startLine);
        const findPos = originalLine.text.toUpperCase().indexOf('FIND');

        if (findPos >= 0) {
            const range = new vscode.Range(
                startLine, findPos,
                startLine, findPos + 4
            );
            diagnostics.push(new vscode.Diagnostic(
                range,
                `FIND sem NO-ERROR. Adicione NO-ERROR para evitar erros em tempo de execução caso o registro não seja encontrado.`,
                vscode.DiagnosticSeverity.Warning
            ));
        }
    }
}
