import * as vscode from 'vscode';
import { LintRule, stripComments } from './index';

/**
 * Regra: Falta da Diretiva de Erro Moderno.
 * Conforme o ABL Reference v13.0, arquivos `.p`/`.cls` devem definir 
 * 'BLOCK-LEVEL ON ERROR UNDO, THROW' ou 'ROUTINE-LEVEL ON ERROR UNDO, THROW'
 * no início do arquivo para que falhas e exceptions não causem loops ou sejam
 * caladas pelo 'UNDO, RETRY' default do ABL clássico.
 */
export class MissingErrorDirectiveRule implements LintRule {
    name = 'missing-error-directive';
    description = 'Garanti que o arquivo tenha BLOCK-LEVEL ou ROUTINE-LEVEL ON ERROR UNDO, THROW';

    check(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        
        // Apenas avalia arquivos procedures e classes, ignorando includes se possível
        // Mas como não temos o URI facilmente aqui, vamos checar globalmente
        const uri = document.uri.toString();
        if (uri.endsWith('.i')) {
            return diagnostics; // Includes muitas vezes não devem redefinir isso
        }
        
        const fullText = document.getText();
        const strippedText = stripComments(fullText);

        // Regex para as diretivas
        const hasDirective = /\b(BLOCK-LEVEL|ROUTINE-LEVEL)\s+ON\s+ERROR\s+UNDO\s*,\s*THROW\b/i.test(strippedText);

        if (!hasDirective) {
            // Emite aviso na primeira linha do arquivo
            let firstLineLength = 0;
            if (document.lineCount > 0) {
                firstLineLength = document.lineAt(0).text.length;
            }

            const range = new vscode.Range(0, 0, 0, firstLineLength);

            diagnostics.push(new vscode.Diagnostic(
                range,
                `Arquivo não possui a diretiva BLOCK-LEVEL (ou ROUTINE-LEVEL) ON ERROR UNDO, THROW. O padrão legado do ABL não eleva exceptions adequadamente.`,
                vscode.DiagnosticSeverity.Warning
            ));
        }

        return diagnostics;
    }
}
