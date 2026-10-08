import * as vscode from 'vscode';
import catalog from '../shortcuts/catalog.json';
import { getShortcutContext } from '../shortcuts/ablShortcutContext';

function getMatches(document: vscode.TextDocument, position: vscode.Position) {
    if (document.languageId !== 'abl') return undefined;
    const config = vscode.workspace.getConfiguration('abl-linter', document);
    if (!config.get<boolean>('shortcuts.enabled', true)) return undefined;
    const context = getShortcutContext(document.getText(new vscode.Range(new vscode.Position(0, 0), position)));
    if (!context) return undefined;
    const matches = catalog.flatMap(snippet => snippet.prefixes
        .filter(prefix => prefix.startsWith(context.prefix))
        .map(prefix => ({ snippet, prefix })));
    return matches.length ? { context, matches } : undefined;
}

export function registerAblShortcutProvider(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider({ language: 'abl' }, {
            provideCompletionItems(document, position, token) {
                if (token.isCancellationRequested) return [];
                const result = getMatches(document, position);
                if (!result) return [];
                // Replace the suffix too when completing in the middle of a word.
                const suffix = /^[a-z0-9-]*/i.exec(document.lineAt(position.line).text.slice(position.character))![0];
                const range = new vscode.Range(
                    new vscode.Position(position.line, result.context.start),
                    new vscode.Position(position.line, position.character + suffix.length)
                );
                const items = result.matches.map(({ snippet, prefix }) => {
                    const item = new vscode.CompletionItem({ label: prefix, description: `ABL · ${snippet.category}` }, vscode.CompletionItemKind.Snippet);
                    item.insertText = new vscode.SnippetString(snippet.body.join('\n'));
                    item.range = range;
                    item.filterText = prefix;
                    item.sortText = `${prefix === result.context.prefix ? '0' : '1'}_${prefix}`;
                    item.detail = snippet.description;
                    item.documentation = new vscode.MarkdownString(snippet.description + '\n\nTab percorre os campos editáveis.\n\n')
                        .appendCodeblock(snippet.body.join('\n'), 'abl');
                    return item;
                });
                // Recompute as the prefix changes, including multi-word keywords.
                return new vscode.CompletionList(items, true);
            }
        })
    );
}
