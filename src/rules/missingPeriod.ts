import * as vscode from 'vscode';
import { LintRule, stripComments, isPreprocessorLine } from './index';

/**
 * Regra: Falta de ponto final.
 * Detecta linhas de código ABL que não terminam com ponto (.)
 * Exclui: linhas vazias, comentários, preprocessor, labels, DO/END/THEN/ELSE/OTHERWISE
 */
export class MissingPeriodRule implements LintRule {
    name = 'missing-period';
    description = 'Detecta linhas que não terminam com ponto final (.)';

    check(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const fullText = document.getText();
        const strippedText = stripComments(fullText);
        const lines = strippedText.split('\n');

        // Palavras-chave que iniciam blocos (não precisam de ponto)
        const blockOpeners = /^\s*(DO|REPEAT|FOR\s+EACH|FOR\s+FIRST|FOR\s+LAST|THEN|ELSE|OTHERWISE|CATCH|FINALLY|ENUM|INTERFACE|CLASS|METHOD|CONSTRUCTOR|DESTRUCTOR)\s*:?\s*$/i;
        // Palavras-chave que são continuações de linhas anteriores
        const continuationKeywords = /^\s*(AND|OR|NOT|THEN|ELSE|OTHERWISE|WHERE|BY|BREAK|NO-LOCK|EXCLUSIVE-LOCK|SHARE-LOCK|NO-WAIT|NO-ERROR|FIELDS|EXCEPT|COLLATE|STOP-AFTER|TABLE-SCAN|NO-PREFETCH|DESCENDING|TRANSACTION|PRESELECT|TENANT-WHERE|QUERY-TUNING|USE-INDEX|ON\s+ERROR|ON\s+ENDKEY|ON\s+QUIT|ON\s+STOP)\b/i;
        // Labels
        const labelPattern = /^\s*[\w-]+\s*:\s*$/;
        // Linhas de definição que continuam
        const defContinuation = /,\s*$/;

        // Buffer para detectar statements multi-linha
        let statementBuffer = '';
        let statementStartLine = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Pular linhas vazias
            if (trimmed === '') {
                // Se temos um buffer pendente sem ponto, reportar
                if (statementBuffer.trim() !== '') {
                    const bufTrimmed = statementBuffer.trim();
                    if (!bufTrimmed.endsWith('.') && !bufTrimmed.endsWith(':') &&
                        !blockOpeners.test(bufTrimmed) && !labelPattern.test(bufTrimmed)) {
                        const prevLine = i - 1;
                        if (prevLine >= 0) {
                            const originalLine = document.lineAt(prevLine);
                            const range = new vscode.Range(
                                prevLine, 0,
                                prevLine, originalLine.text.length
                            );
                            diagnostics.push(new vscode.Diagnostic(
                                range,
                                `Falta ponto final (.) no final do statement.`,
                                vscode.DiagnosticSeverity.Error
                            ));
                        }
                    }
                }
                statementBuffer = '';
                continue;
            }

            // Pular preprocessor
            if (isPreprocessorLine(trimmed)) {
                continue;
            }

            // Acumular o buffer
            if (statementBuffer === '') {
                statementStartLine = i;
            }
            statementBuffer += ' ' + trimmed;

            // Verificar se a linha termina com ponto (fim do statement)
            if (trimmed.endsWith('.')) {
                statementBuffer = '';
                continue;
            }

            // Verificar se termina com dois-pontos (abertura de bloco)
            if (trimmed.endsWith(':')) {
                statementBuffer = '';
                continue;
            }

            // Verificar se é label
            if (labelPattern.test(trimmed)) {
                statementBuffer = '';
                continue;
            }

            // Verificar se é uma continuação explícita (vírgula)
            if (defContinuation.test(trimmed)) {
                continue;
            }

            // Verificar se a próxima linha é uma continuação
            if (i + 1 < lines.length) {
                const nextTrimmed = lines[i + 1].trim();
                if (continuationKeywords.test(nextTrimmed) || nextTrimmed === '' || 
                    isPreprocessorLine(nextTrimmed)) {
                    continue;
                }
            }

            // Verificar se a linha atual é um bloco opener ou palavra-chave standalone
            if (blockOpeners.test(trimmed) || continuationKeywords.test(trimmed)) {
                continue;
            }

            // Se a próxima linha não-vazia começa com ponto, é OK
            let nextNonEmpty = i + 1;
            while (nextNonEmpty < lines.length && lines[nextNonEmpty].trim() === '') {
                nextNonEmpty++;
            }
            if (nextNonEmpty < lines.length) {
                const nextLine = lines[nextNonEmpty].trim();
                if (nextLine.startsWith('.')) {
                    continue;
                }
                // A próxima linha pode ser continuação do mesmo statement
                if (/^\s*([\w-]+=|[\w-]+\s+(=|EQ|NE|GT|LT|GE|LE|>|<|>=|<=|<>))/i.test(nextLine)) {
                    continue;
                }
            }
        }

        return diagnostics;
    }
}
