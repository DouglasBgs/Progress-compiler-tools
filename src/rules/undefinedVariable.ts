import * as vscode from 'vscode';
import { LintRule, stripComments, isPreprocessorLine } from './index';

/**
 * Regra: Variável não definida.
 * Detecta uso de variáveis que não foram declaradas com DEFINE VARIABLE.
 * Essa análise é limitada a variáveis locais — não verifica temp-tables, buffers, etc.
 */
export class UndefinedVariableRule implements LintRule {
    name = 'undefined-variable';
    description = 'Detecta uso de variáveis não declaradas com DEFINE VARIABLE';

    check(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const fullText = document.getText();
        const strippedText = stripComments(fullText);
        const lines = strippedText.split('\n');

        // Coletar todas as variáveis definidas
        const definedVariables = new Set<string>();
        // Coletar parâmetros
        const definedParams = new Set<string>();
        // Coletar temp-tables e buffers
        const definedTables = new Set<string>();

        // Padrões para definição de variáveis
        const defineVarPattern = /\bDEFINE\s+(?:NEW\s+)?(?:SHARED\s+)?VARIABLE\s+([\w-]+)/gi;
        const defineParamPattern = /\bDEFINE\s+(?:INPUT|OUTPUT|INPUT-OUTPUT|RETURN)\s+PARAMETER\s+([\w-]+)/gi;
        const defineTTPattern = /\bDEFINE\s+(?:NEW\s+)?(?:SHARED\s+)?TEMP-TABLE\s+([\w-]+)/gi;
        const defineBufferPattern = /\bDEFINE\s+(?:NEW\s+)?(?:SHARED\s+)?BUFFER\s+([\w-]+)/gi;
        const definePropertyPattern = /\bDEFINE\s+(?:PUBLIC|PRIVATE|PROTECTED)?\s*(?:STATIC\s+)?(?:OVERRIDE\s+)?PROPERTY\s+([\w-]+)/gi;
        // VAR statement (ABL v13.0 shorthand — NO-UNDO by default)
        const varPattern = /\bVAR\s+(?:(?:PRIVATE|PACKAGE-PRIVATE|PROTECTED|PACKAGE-PROTECTED|PUBLIC)\s+)?(?:STATIC\s+)?(?:SERIALIZABLE\s+|NON-SERIALIZABLE\s+)?(?:[\w.-]+(?:\s*\[[^\]]*\])?\s+)([\w-]+(?:\s*,\s*[\w-]+)*)/gi;

        // Extrair definições
        let match;
        while ((match = defineVarPattern.exec(strippedText)) !== null) {
            definedVariables.add(match[1].toLowerCase());
        }
        while ((match = defineParamPattern.exec(strippedText)) !== null) {
            definedParams.add(match[1].toLowerCase());
        }
        while ((match = defineTTPattern.exec(strippedText)) !== null) {
            definedTables.add(match[1].toLowerCase());
        }
        while ((match = defineBufferPattern.exec(strippedText)) !== null) {
            definedTables.add(match[1].toLowerCase());
        }
        while ((match = definePropertyPattern.exec(strippedText)) !== null) {
            definedVariables.add(match[1].toLowerCase());
        }
        while ((match = varPattern.exec(strippedText)) !== null) {
            // VAR pode definir múltiplas variáveis: VAR INT x, y, z.
            const varNames = match[1].split(',');
            for (const v of varNames) {
                const name = v.trim().split(/\s*=/)[0].trim();
                if (name) {
                    definedVariables.add(name.toLowerCase());
                }
            }
        }

        // Palavras-chave reservadas do ABL (não são variáveis)
        const reservedWords = new Set([
            'true', 'false', 'yes', 'no', '?',
            'self', 'this-object', 'this-procedure', 'target-procedure',
            'super', 'session', 'error-status', 'compiler',
            'integer', 'character', 'decimal', 'logical', 'date', 'datetime',
            'datetime-tz', 'int64', 'handle', 'longchar', 'memptr', 'raw',
            'recid', 'rowid', 'widget-handle', 'com-handle', 'blob', 'clob',
            // Controle de fluxo
            'if', 'then', 'else', 'do', 'end', 'for', 'each', 'first', 'last',
            'repeat', 'while', 'case', 'when', 'otherwise', 'return', 'leave',
            'next', 'undo', 'retry', 'catch', 'finally', 'throw',
            // Database
            'find', 'where', 'and', 'or', 'not', 'by', 'create', 'delete',
            'update', 'display', 'assign', 'release', 'validate',
            'no-lock', 'exclusive-lock', 'share-lock', 'no-wait', 'no-error',
            'available', 'ambiguous', 'locked', 'can-find',
            // Define
            'define', 'variable', 'temp-table', 'buffer', 'like', 'as',
            'no-undo', 'initial', 'format', 'label', 'column-label',
            'extent', 'serialize-name', 'field', 'index',
            // Outros
            'procedure', 'function', 'returns', 'forward', 'class', 'method',
            'constructor', 'destructor', 'implements', 'inherits', 'override',
            'abstract', 'final', 'static', 'public', 'private', 'protected',
            'message', 'view-as', 'alert-box', 'information', 'warning',
            'error', 'question', 'buttons', 'ok', 'ok-cancel', 'yes-no',
            'yes-no-cancel', 'input', 'output', 'input-output', 'put',
            'get', 'set', 'run', 'publish', 'subscribe', 'unsubscribe',
            'new', 'shared', 'global', 'using', 'propath', 'this',
            'skip', 'space', 'trim', 'substring', 'replace', 'entry',
            'num-entries', 'lookup', 'length', 'index', 'r-index',
            'string', 'caps', 'lc', 'fill', 'chr', 'asc',
            'today', 'now', 'time', 'etime', 'day', 'month', 'year',
            'absolute', 'round', 'truncate', 'minimum', 'maximum',
            'modulo', 'sqrt', 'exp', 'log', 'random',
            'valid-handle', 'valid-object', 'type-of',
            'table', 'dataset', 'data-source', 'query', 'browse',
            'frame', 'window', 'menu', 'sub-menu', 'menu-item',
            'trigger', 'on', 'anywhere', 'persistent', 'transaction',
            'parameter', 'with', 'down', 'no-box', 'stream-io',
            'overlay', 'to', 'title', 'centered', 'row', 'column',
            'help', 'choose', 'apply', 'wait-for', 'process', 'pause',
            'stream', 'close', 'page', 'export',
            'import', 'in', 'of', 'from', 'through', 'thru',
        ]);

        // Combinar todas as definições conhecidas
        const allDefined = new Set([...definedVariables, ...definedParams, ...definedTables]);

        // Procurar atribuições de variáveis não definidas
        const assignPattern = /\b([\w][\w-]*)\s*=\s*/g;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (trimmed === '' || isPreprocessorLine(trimmed)) {
                continue;
            }

            // Pular linhas de definição (DEFINE e VAR)
            if (/^\s*(DEFINE|VAR)\b/i.test(trimmed)) {
                continue;
            }

            // Procurar atribuições (variavel = valor)
            let assignMatch;
            assignPattern.lastIndex = 0;
            while ((assignMatch = assignPattern.exec(trimmed)) !== null) {
                const varName = assignMatch[1].toLowerCase();

                // Pular se é palavra reservada
                if (reservedWords.has(varName)) {
                    continue;
                }

                // Pular se contém qualificador de tabela (tabela.campo)
                const beforeMatch = trimmed.substring(0, assignMatch.index);
                if (beforeMatch.endsWith('.')) {
                    continue;
                }

                // Verificar se há "." depois do nome (acesso a campo)
                const afterMatch = trimmed.substring(assignMatch.index + assignMatch[0].length);
                if (varName.includes('.')) {
                    continue;
                }

                // Pular se está definida
                if (allDefined.has(varName)) {
                    continue;
                }

                // Pular nomes muito curtos que podem ser campos de tabela
                if (varName.length <= 1) {
                    continue;
                }

                // Verificar se é um campo de tabela qualificado (ex: tabela.campo)
                const fullAssignPattern = new RegExp(`\\b[\\w-]+\\.${varName.replace(/-/g, '\\-')}\\s*=`, 'i');
                if (fullAssignPattern.test(trimmed)) {
                    continue;
                }

                const originalLine = document.lineAt(i);
                const varPos = originalLine.text.toLowerCase().indexOf(varName);
                if (varPos >= 0) {
                    const range = new vscode.Range(
                        i, varPos,
                        i, varPos + varName.length
                    );
                    diagnostics.push(new vscode.Diagnostic(
                        range,
                        `Variável "${assignMatch[1]}" possivelmente não definida. Use DEFINE VARIABLE para declarar.`,
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
            }
        }

        return diagnostics;
    }
}
