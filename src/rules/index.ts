import * as vscode from 'vscode';
import { MissingPeriodRule } from './missingPeriod';
import { UnmatchedEndRule } from './unmatchedEnd';
import { IfWithoutThenRule } from './ifWithoutThen';
import { UndefinedVariableRule } from './undefinedVariable';
import { UnclosedStringRule } from './unclosedString';
import { AssignInConditionRule } from './assignInCondition';
import { FindWithoutNoErrorRule } from './findWithoutNoError';
import { EmptyDoBlockRule } from './emptyDoBlock';
// Novas regras baseadas no ABL Reference v13.0
import { ForEachWithoutLockRule } from './forEachWithoutLock';
import { CaseWithoutWhenRule } from './caseWithoutWhen';
import { DefineWithoutNoUndoRule } from './defineWithoutNoUndo';
import { DeleteObjectWithoutNoErrorRule } from './deleteObjectWithoutNoError';
import { CaseWithoutOtherwiseRule } from './caseWithoutOtherwise';
import { FunctionWithoutReturnRule } from './functionWithoutReturn';
import { RunWithoutNoErrorRule } from './runWithoutNoError';

// Novas regras (Fase 3 - ABL Reference)
import { CanFindExclusiveLockRule } from './canFindExclusiveLock';
import { MessageWithoutViewAsRule } from './messageWithoutViewAs';
import { MissingErrorDirectiveRule } from './missingErrorDirective';

/**
 * Interface que define uma regra de lint para ABL.
 * Cada regra analisa o documento e retorna diagnósticos.
 */
export interface LintRule {
    /** Nome identificador da regra */
    name: string;
    /** Descrição legível da regra */
    description: string;
    /** Executa a verificação e retorna diagnósticos */
    check(document: vscode.TextDocument): vscode.Diagnostic[];
}

/**
 * Remove comentários de bloco e de linha do texto ABL.
 * Retorna o texto com comentários substituídos por espaços
 * (para manter as posições de linha/coluna corretas).
 */
export function stripComments(text: string): string {
    let result = '';
    let i = 0;
    let inBlockComment = false;
    let inString = false;
    let stringChar = '';

    while (i < text.length) {
        if (inBlockComment) {
            if (text[i] === '*' && text[i + 1] === '/') {
                result += '  ';
                i += 2;
                inBlockComment = false;
            } else {
                result += text[i] === '\n' ? '\n' : ' ';
                i++;
            }
        } else if (inString) {
            result += text[i];
            if (text[i] === stringChar && text[i + 1] !== stringChar) {
                inString = false;
            } else if (text[i] === stringChar && text[i + 1] === stringChar) {
                result += text[i + 1];
                i++;
            }
            i++;
        } else {
            if (text[i] === '/' && text[i + 1] === '*') {
                result += '  ';
                i += 2;
                inBlockComment = true;
            } else if (text[i] === '/' && text[i + 1] === '/') {
                // Linha de comentário — preenche até o fim da linha
                while (i < text.length && text[i] !== '\n') {
                    result += ' ';
                    i++;
                }
            } else if (text[i] === '"' || text[i] === "'") {
                inString = true;
                stringChar = text[i];
                result += text[i];
                i++;
            } else {
                result += text[i];
                i++;
            }
        }
    }

    return result;
}

/**
 * Verifica se uma linha está dentro de um preprocessor ou é diretiva.
 */
export function isPreprocessorLine(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.startsWith('&') || trimmed.startsWith('{');
}

/**
 * Lista de todas as regras de lint registradas.
 * 
 * Regras 1-8: Originais
 * Regras 9-15: Baseadas no ABL Reference v13.0
 */
export const allRules: LintRule[] = [
    // --- Regras originais ---
    new MissingPeriodRule(),         // 1. Falta de ponto final
    new UnmatchedEndRule(),          // 2. END desbalanceado
    new IfWithoutThenRule(),         // 3. IF sem THEN
    new UndefinedVariableRule(),     // 4. Variável não definida
    new UnclosedStringRule(),        // 5. String não fechada
    new AssignInConditionRule(),     // 6. Atribuição em condição
    new FindWithoutNoErrorRule(),    // 7. FIND sem NO-ERROR
    new EmptyDoBlockRule(),          // 8. DO vazio

    // --- Novas regras (ABL Reference v13.0) ---
    new ForEachWithoutLockRule(),        // 9. FOR EACH sem lock explícito
    new CaseWithoutWhenRule(),           // 10. CASE sem WHEN
    new DefineWithoutNoUndoRule(),       // 11. DEFINE VARIABLE sem NO-UNDO
    new DeleteObjectWithoutNoErrorRule(),// 12. DELETE OBJECT sem NO-ERROR
    new CaseWithoutOtherwiseRule(),      // 13. CASE sem OTHERWISE
    new FunctionWithoutReturnRule(),     // 14. FUNCTION sem RETURN
    new RunWithoutNoErrorRule(),         // 15. RUN sem NO-ERROR

    // --- Novas Regras (Fase 3) ---
    new CanFindExclusiveLockRule(),      // 16. CAN-FIND com EXCLUSIVE-LOCK
    new MessageWithoutViewAsRule(),      // 17. MESSAGE sem VIEW-AS ALERT-BOX
    new MissingErrorDirectiveRule(),     // 18. Falta de diretiva de erro (ON ERROR UNDO, THROW)
];
