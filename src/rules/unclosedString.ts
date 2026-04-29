import * as vscode from 'vscode';
import { LintRule } from './index';

/**
 * Regra: String não fechada.
 * Detecta strings com aspas simples ou duplas abertas sem fechamento na mesma linha.
 */
export class UnclosedStringRule implements LintRule {
    name = 'unclosed-string';
    description = 'Detecta strings com aspas abertas sem fechamento';

    check(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i).text;
            const trimmed = line.trim();

            // Pular linhas vazias e comentários de linha
            if (trimmed === '' || trimmed.startsWith('//')) {
                continue;
            }

            // Pular se a linha está dentro de um comentário de bloco
            // (verificação simplificada — olha apenas a linha)

            // Verificar strings não fechadas
            const unclosed = this.findUnclosedString(line, i);
            if (unclosed) {
                diagnostics.push(unclosed);
            }
        }

        return diagnostics;
    }

    private findUnclosedString(line: string, lineNumber: number): vscode.Diagnostic | null {
        let inString = false;
        let stringChar = '';
        let stringStart = 0;
        let inBlockComment = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = i + 1 < line.length ? line[i + 1] : '';

            // Se estamos em comentário de bloco
            if (inBlockComment) {
                if (char === '*' && nextChar === '/') {
                    inBlockComment = false;
                    i++; // pular o /
                }
                continue;
            }

            // Verificar início de comentário de bloco
            if (!inString && char === '/' && nextChar === '*') {
                inBlockComment = true;
                i++;
                continue;
            }

            // Verificar comentário de linha
            if (!inString && char === '/' && nextChar === '/') {
                break; // Resto da linha é comentário
            }

            if (inString) {
                // Verificar escape (aspas duplicadas em ABL)
                if (char === stringChar) {
                    if (nextChar === stringChar) {
                        // Aspas escapadas (duplicadas)
                        i++; // pular a segunda aspa
                        continue;
                    }
                    // Fim da string
                    inString = false;
                    continue;
                }
            } else {
                if (char === '"' || char === "'") {
                    inString = true;
                    stringChar = char;
                    stringStart = i;
                }
            }
        }

        // Se ainda estamos dentro de uma string ao final da linha
        if (inString && !inBlockComment) {
            const range = new vscode.Range(
                lineNumber, stringStart,
                lineNumber, line.length
            );
            return new vscode.Diagnostic(
                range,
                `String não fechada. Falta a aspa ${stringChar === '"' ? 'dupla (")' : "simples (')"} de fechamento.`,
                vscode.DiagnosticSeverity.Error
            );
        }

        return null;
    }
}
