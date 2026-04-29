import * as vscode from 'vscode';
import { LintRule, stripComments } from './index';

/**
 * Regra: DO vazio.
 * Detecta blocos DO: seguidos imediatamente de END. sem conteúdo significativo.
 */
export class EmptyDoBlockRule implements LintRule {
    name = 'empty-do-block';
    description = 'Detecta blocos DO vazios (DO: seguido de END. sem conteúdo)';

    check(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const fullText = document.getText();
        const strippedText = stripComments(fullText);
        const lines = strippedText.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            const upper = trimmed.toUpperCase();

            // Verificar se a linha abre um bloco DO
            if (/\bDO\s*:/i.test(upper) || 
                /\bDO\s+WHILE\b.*:/i.test(upper) ||
                /\bDO\s+TRANSACTION\s*:/i.test(upper)) {

                // Procurar a próxima linha não-vazia
                let nextNonEmpty = i + 1;
                while (nextNonEmpty < lines.length && lines[nextNonEmpty].trim() === '') {
                    nextNonEmpty++;
                }

                // Verificar se a próxima linha não-vazia é END.
                if (nextNonEmpty < lines.length) {
                    const nextTrimmed = lines[nextNonEmpty].trim().toUpperCase();
                    if (/^\s*END\s*\.\s*$/i.test(nextTrimmed)) {
                        const originalLine = document.lineAt(i);
                        const range = new vscode.Range(
                            i, 0,
                            nextNonEmpty, document.lineAt(nextNonEmpty).text.length
                        );
                        diagnostics.push(new vscode.Diagnostic(
                            range,
                            `Bloco DO vazio. O bloco não contém nenhum statement entre DO: e END.`,
                            vscode.DiagnosticSeverity.Error
                        ));
                    }
                }
            }
        }

        return diagnostics;
    }
}
