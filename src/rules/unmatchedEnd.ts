import * as vscode from 'vscode';
import { LintRule, stripComments } from './index';

/**
 * Regra: Blocos END desbalanceados.
 * Verifica se todos os blocos abertos (DO, FOR, REPEAT, CASE, PROCEDURE,
 * FUNCTION, CLASS, METHOD, CONSTRUCTOR, DESTRUCTOR, TRIGGER) possuem
 * um END correspondente.
 */
export class UnmatchedEndRule implements LintRule {
    name = 'unmatched-end';
    description = 'Detecta blocos DO/FOR/REPEAT sem END correspondente';

    check(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const fullText = document.getText();
        const strippedText = stripComments(fullText);
        const lines = strippedText.split('\n');

        // Pilha de blocos abertos — cada item contém a linha e o tipo do bloco
        const blockStack: { line: number; type: string; keyword: string }[] = [];

        // Padrões de abertura de bloco (que terminam com ":" ou são PROCEDURE/FUNCTION/etc)
        const blockOpenPatterns = [
            { regex: /\bDO\s*:/i, type: 'DO' },
            { regex: /\bDO\s+WHILE\b/i, type: 'DO WHILE' },
            { regex: /\bDO\s+TRANSACTION\b/i, type: 'DO TRANSACTION' },
            { regex: /\bDO\s+ON\b/i, type: 'DO ON' },
            { regex: /\bREPEAT\b/i, type: 'REPEAT' },
            { regex: /\bFOR\s+(EACH|FIRST|LAST)\b/i, type: 'FOR' },
            { regex: /\bCASE\b/i, type: 'CASE' },
            { regex: /\bPROCEDURE\s+\S+/i, type: 'PROCEDURE' },
            { regex: /\bFUNCTION\s+\S+/i, type: 'FUNCTION' },
            { regex: /\bCLASS\s+\S+/i, type: 'CLASS' },
            { regex: /\bMETHOD\s+/i, type: 'METHOD' },
            { regex: /\bCONSTRUCTOR\s+/i, type: 'CONSTRUCTOR' },
            { regex: /\bDESTRUCTOR\s+/i, type: 'DESTRUCTOR' },
            { regex: /\bTRIGGER\s+/i, type: 'TRIGGER' },
            { regex: /\bCATCH\s+/i, type: 'CATCH' },
            { regex: /\bFINALLY\s*:/i, type: 'FINALLY' },
        ];

        // Padrão de END — inclui END CASE, END FUNCTION, END PROCEDURE, END METHOD etc.
        // Conforme ABL Reference v13.0: "END [CASE].", "END [FUNCTION].", etc.
        const endPattern = /\bEND\s*(?:CASE|FUNCTION|PROCEDURE|METHOD|CLASS|CONSTRUCTOR|DESTRUCTOR|CATCH|FINALLY)?\s*\./i;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (trimmed === '') {
                continue;
            }

            // Verificar se a linha contém END
            if (endPattern.test(trimmed)) {
                if (blockStack.length > 0) {
                    blockStack.pop();
                } else {
                    // END sem bloco aberto correspondente
                    const originalLine = document.lineAt(i);
                    const endMatch = originalLine.text.match(/\bEND\b/i);
                    const startCol = endMatch ? originalLine.text.indexOf(endMatch[0]) : 0;
                    const range = new vscode.Range(
                        i, startCol,
                        i, startCol + 3
                    );
                    diagnostics.push(new vscode.Diagnostic(
                        range,
                        `END sem bloco correspondente. Há mais END do que blocos abertos.`,
                        vscode.DiagnosticSeverity.Error
                    ));
                }
                continue;
            }

            // Verificar abertura de bloco
            // Um bloco é aberto quando a linha termina com ":"
            if (trimmed.endsWith(':')) {
                for (const pattern of blockOpenPatterns) {
                    if (pattern.regex.test(trimmed)) {
                        blockStack.push({
                            line: i,
                            type: pattern.type,
                            keyword: pattern.type
                        });
                        break;
                    }
                }
            }

            // PROCEDURE e FUNCTION podem não terminar com ":"
            // mas geralmente o fazem em ABL 4GL
            if (/^\s*PROCEDURE\s+\S+\s*:/i.test(trimmed) ||
                /^\s*FUNCTION\s+\S+\s+RETURNS\s+/i.test(trimmed)) {
                // Já tratado acima
            }
        }

        // Reportar blocos não fechados
        for (const block of blockStack) {
            const originalLine = document.lineAt(block.line);
            const range = new vscode.Range(
                block.line, 0,
                block.line, originalLine.text.length
            );
            diagnostics.push(new vscode.Diagnostic(
                range,
                `Bloco ${block.type} aberto na linha ${block.line + 1} não possui END correspondente.`,
                vscode.DiagnosticSeverity.Error
            ));
        }

        return diagnostics;
    }
}
