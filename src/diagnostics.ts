import * as vscode from 'vscode';
import { allRules } from './rules';

/**
 * Analisa um documento ABL e retorna todos os diagnósticos encontrados.
 * Itera sobre todas as regras de lint registradas e coleta os resultados.
 */
export function analyzeDocument(document: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];

    for (const rule of allRules) {
        try {
            const ruleDiagnostics = rule.check(document);
            diagnostics.push(...ruleDiagnostics);
        } catch (error) {
            console.error(`Erro ao executar regra "${rule.name}":`, error);
        }
    }

    return diagnostics;
}
