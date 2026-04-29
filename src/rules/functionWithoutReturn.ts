import * as vscode from 'vscode';
import { LintRule, stripComments } from './index';

/**
 * Regra: FUNCTION sem RETURN.
 * Conforme o ABL Reference v13.0 (FUNCTION statement, p.711):
 * Toda FUNCTION deve retornar um valor usando RETURN.
 * Se o caminho de execução não atingir um RETURN, o resultado é indeterminado.
 */
export class FunctionWithoutReturnRule implements LintRule {
    name = 'function-without-return';
    description = 'Detecta FUNCTION sem statement RETURN';

    check(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const fullText = document.getText();
        const strippedText = stripComments(fullText);
        const lines = strippedText.split('\n');

        let inFunction = false;
        let functionLineNumber = -1;
        let functionName = '';
        let hasReturn = false;
        let blockDepth = 0;
        let isForwardDeclaration = false;

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            const upper = trimmed.toUpperCase();

            if (trimmed === '') {
                continue;
            }

            // Detectar início de FUNCTION
            const funcMatch = /\bFUNCTION\s+([\w-]+)\s+RETURNS\b/i.exec(trimmed);
            if (funcMatch && !inFunction) {
                // Verificar se é FORWARD declaration (sem corpo)
                if (/\bFORWARD\b/i.test(trimmed)) {
                    isForwardDeclaration = true;
                    continue;
                }

                // Verificar se termina com ":" (tem corpo)
                const restOfLine = trimmed;
                if (/:\s*$/.test(restOfLine) || 
                    (i + 1 < lines.length && lines[i + 1].trim() === ':')) {
                    inFunction = true;
                    functionLineNumber = i;
                    functionName = funcMatch[1];
                    hasReturn = false;
                    blockDepth = 1;
                    isForwardDeclaration = false;
                }
                continue;
            }

            if (inFunction) {
                // Contar profundidade de blocos
                if (/\b(DO|FOR|REPEAT|CASE)\b.*:/i.test(upper) || 
                    /\bCATCH\b.*:/i.test(upper) ||
                    /\bFINALLY\s*:/i.test(upper)) {
                    blockDepth++;
                }

                if (/\bEND\b\s*(\bFUNCTION\b)?\s*\./i.test(upper)) {
                    blockDepth--;
                    if (blockDepth <= 0) {
                        if (!hasReturn) {
                            const originalLine = document.lineAt(functionLineNumber);
                            const funcPos = originalLine.text.toUpperCase().indexOf('FUNCTION');
                            const range = new vscode.Range(
                                functionLineNumber, funcPos >= 0 ? funcPos : 0,
                                functionLineNumber, originalLine.text.length
                            );
                            diagnostics.push(new vscode.Diagnostic(
                                range,
                                `FUNCTION "${functionName}" não possui statement RETURN. Toda função deve retornar um valor.`,
                                vscode.DiagnosticSeverity.Warning
                            ));
                        }
                        inFunction = false;
                        continue;
                    }
                } else if (/\bEND\b/i.test(upper) && /\.\s*$/.test(trimmed)) {
                    blockDepth--;
                    if (blockDepth <= 0) {
                        if (!hasReturn) {
                            const originalLine = document.lineAt(functionLineNumber);
                            const funcPos = originalLine.text.toUpperCase().indexOf('FUNCTION');
                            const range = new vscode.Range(
                                functionLineNumber, funcPos >= 0 ? funcPos : 0,
                                functionLineNumber, originalLine.text.length
                            );
                            diagnostics.push(new vscode.Diagnostic(
                                range,
                                `FUNCTION "${functionName}" não possui statement RETURN. Toda função deve retornar um valor.`,
                                vscode.DiagnosticSeverity.Warning
                            ));
                        }
                        inFunction = false;
                        continue;
                    }
                }

                // Procurar RETURN (que não seja RETURN ERROR dentro de outro bloco)
                if (/\bRETURN\b/i.test(upper) && !/\bRETURN\s+ERROR\b/i.test(upper)) {
                    hasReturn = true;
                }
                // RETURN com valor também conta
                if (/\bRETURN\s+\S/i.test(upper)) {
                    hasReturn = true;
                }
            }
        }

        return diagnostics;
    }
}
