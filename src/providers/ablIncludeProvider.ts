import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Expressão regular para detectar includes ABL.
 * Grupo 1 = caminho do include (.i, .i1, .i2 ...)
 * Grupo 2 = tudo após o caminho até o fechamento } (args posicionais e/ou nomeados)
 */
const INCLUDE_REGEX = /\{([\w./\\-]+\.i\d*)((?:\s[^}]*)?)\/?(\})/gi;
// Versão simples para document-link (sem captura de args)
const INCLUDE_REGEX_SIMPLE = /\{([\w./\\-]+\.i\d*)\s*(?:[^}]*)?\}/gi;

/** Parâmetros passados a um include ABL. */
interface IncludeArgs {
    /** Argumentos posicionais: {1}=args[0], {2}=args[1] … */
    positional: string[];
    /** Argumentos nomeados: &PARAM=valor */
    named: Record<string, string>;
}

/** Separa args posicionais e nomeados do texto após o nome do include. */
function parseIncludeArgs(argsStr: string): IncludeArgs {
    const positional: string[] = [];
    const named: Record<string, string> = {};

    if (!argsStr.trim()) { return { positional, named }; }

    // Tokeniza respeitando strings entre aspas
    const tokenRe = /&([\w-]+)=(?:"([^"]*)"|'([^']*)'|(\S+))|(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(argsStr)) !== null) {
        if (m[1]) {
            // named: &PARAM=value
            named[m[1].toUpperCase()] = m[2] ?? m[3] ?? m[4] ?? '';
        } else if (m[5]) {
            // positional
            positional.push(m[5]);
        }
    }
    return { positional, named };
}

/**
 * Retorna o include encontrado na posição do cursor, ou null.
 */
function findIncludeAtPosition(
    line: string,
    col: number
): { includePath: string; argsStr: string; args: IncludeArgs; start: number; end: number } | null {
    // Regex que captura: {path/file.i args…}
    const pattern = /\{([\w./\\-]+\.i\d*)((?:\s[^}]*)?)\/?(\})/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
        if (col >= match.index && col <= match.index + match[0].length) {
            const argsStr = (match[2] ?? '').trimStart();
            return {
                includePath: match[1],
                argsStr,
                args: parseIncludeArgs(argsStr),
                start: match.index,
                end: match.index + match[0].length,
            };
        }
    }
    return null;
}

/**
 * Resolve o caminho de um include ABL.
 * Ordem de busca:
 *   1. Relativo ao diretório do arquivo atual
 *   2. Raiz dos workspace folders
 *   3. Busca recursiva no workspace pelo nome do arquivo
 */
async function resolveIncludePath(
    document: vscode.TextDocument,
    includePath: string
): Promise<vscode.Uri | undefined> {
    const normalized = includePath.replace(/\\/g, '/');
    const basename = path.basename(normalized);

    // 1. Relativo ao diretório do arquivo atual
    const currentDir = path.dirname(document.uri.fsPath);
    const relative = path.join(currentDir, normalized);
    if (fs.existsSync(relative)) {
        return vscode.Uri.file(relative);
    }

    // 2. Relativo à raiz dos workspace folders
    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
        const direct = path.join(folder.uri.fsPath, normalized);
        if (fs.existsSync(direct)) {
            return vscode.Uri.file(direct);
        }
    }

    // 3. Busca recursiva pelo nome do arquivo no workspace
    const found = await vscode.workspace.findFiles(
        `**/${basename}`,
        '{**/node_modules/**,**/.git/**}',
        5
    );
    if (found.length > 0) {
        // Se houver mais de um resultado, prefere o mais próximo ao arquivo atual
        if (found.length === 1) {
            return found[0];
        }
        // Ordena por distância do diretório atual
        const sorted = found.sort((a, b) => {
            const distA = relativeDist(currentDir, a.fsPath);
            const distB = relativeDist(currentDir, b.fsPath);
            return distA - distB;
        });
        return sorted[0];
    }

    return undefined;
}

/** Retorna uma heurística de "distância" entre dois caminhos (número de diretórios diferentes). */
function relativeDist(from: string, to: string): number {
    const rel = path.relative(from, to);
    return (rel.match(/\.\./g) ?? []).length;
}

// ---------------------------------------------------------------------------
// DefinitionProvider — F12 / Ctrl+Click → Ir para definição
// ---------------------------------------------------------------------------
export class AblIncludeDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): Promise<vscode.Definition | undefined> {
        const lineText = document.lineAt(position.line).text;
        const hit = findIncludeAtPosition(lineText, position.character);
        if (!hit) {
            return undefined;
        }

        const uri = await resolveIncludePath(document, hit.includePath);
        if (!uri) {
            return undefined;
        }

        return new vscode.Location(uri, new vscode.Position(0, 0));
    }
}

// ---------------------------------------------------------------------------
// HoverProvider — Hover sobre include → mostra caminho + botão "Abrir ao lado"
// ---------------------------------------------------------------------------
export class AblIncludeHoverProvider implements vscode.HoverProvider {
    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        const lineText = document.lineAt(position.line).text;
        const hit = findIncludeAtPosition(lineText, position.character);
        if (!hit) {
            return undefined;
        }

        const uri = await resolveIncludePath(document, hit.includePath);

        const md = new vscode.MarkdownString('', true);
        md.isTrusted = true;
        md.supportHtml = false;

        // --- Cabeçalho ---
        md.appendMarkdown(`**Include ABL:** \`${hit.includePath}\`\n\n`);

        // --- Parâmetros passados (se existirem) ---
        const { positional, named } = hit.args;
        const hasArgs = positional.length > 0 || Object.keys(named).length > 0;
        if (hasArgs) {
            md.appendMarkdown('**Parâmetros passados:**\n\n');
            if (positional.length > 0) {
                const rows = positional.map((v, i) =>
                    `| \`{${i + 1}}\` | \`${v}\` |`
                );
                md.appendMarkdown('| Posição | Valor |\n|---------|-------|\n');
                md.appendMarkdown(rows.join('\n'));
                md.appendMarkdown('\n\n');
            }
            if (Object.keys(named).length > 0) {
                const rows = Object.entries(named).map(
                    ([k, v]) => `| \`&${k}\` | \`${v}\` |`
                );
                md.appendMarkdown('| Parâmetro | Valor |\n|-----------|-------|\n');
                md.appendMarkdown(rows.join('\n'));
                md.appendMarkdown('\n\n');
            }
        }

        if (uri) {
            const shortPath = vscode.workspace.asRelativePath(uri);
            const encodedArg = encodeURIComponent(JSON.stringify({ uri: uri.toString() }));
            md.appendMarkdown(`📄 \`${shortPath}\`\n\n`);
            md.appendMarkdown(
                `[$(split-horizontal) Abrir ao lado](command:abl-linter.openIncludeAside?${encodedArg} "Abrir include em coluna ao lado")`
            );
        } else {
            md.appendMarkdown(`⚠️ Arquivo não encontrado no workspace.`);
        }

        const range = new vscode.Range(
            position.line, hit.start,
            position.line, hit.end
        );
        return new vscode.Hover(md, range);
    }
}

// ---------------------------------------------------------------------------
// DocumentLinkProvider — Sublinha includes como links clicáveis
// ---------------------------------------------------------------------------
export class AblIncludeDocumentLinkProvider implements vscode.DocumentLinkProvider {
    provideDocumentLinks(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.DocumentLink[] {
        const links: vscode.DocumentLink[] = [];
        const pattern = new RegExp(INCLUDE_REGEX_SIMPLE.source, 'gi');

        for (let i = 0; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;
            let match: RegExpExecArray | null;
            pattern.lastIndex = 0;

            while ((match = pattern.exec(lineText)) !== null) {
                const range = new vscode.Range(i, match.index, i, match.index + match[0].length);
                // Cria o link sem target — o target é resolvido de forma assíncrona
                const link = new vscode.DocumentLink(range);
                // Guarda o include path como tooltip para identificação posterior
                (link as any).__includePath = match[1];
                (link as any).__documentUri = document.uri.toString();
                links.push(link);
            }
        }

        return links;
    }

    async resolveDocumentLink(
        link: vscode.DocumentLink,
        _token: vscode.CancellationToken
    ): Promise<vscode.DocumentLink> {
        const includePath: string = (link as any).__includePath;
        const docUriStr: string = (link as any).__documentUri;

        if (!includePath || !docUriStr) {
            return link;
        }

        const document = vscode.workspace.textDocuments.find(
            (d) => d.uri.toString() === docUriStr
        );
        if (!document) {
            return link;
        }

        const resolved = await resolveIncludePath(document, includePath);
        if (resolved) {
            // Aponta diretamente para o arquivo — abre em guia normal, sem duplicação
            link.target = resolved;
        }

        return link;
    }
}

// ---------------------------------------------------------------------------
// Registrador principal — chame esta função em extension.ts
// ---------------------------------------------------------------------------
export function registerAblIncludeProviders(context: vscode.ExtensionContext): void {
    const selector: vscode.DocumentSelector = [
        { language: 'abl' },
        { pattern: '**/*.{p,w,cls,i}' },
    ];

    // Comando: abrir include em coluna ao lado
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'abl-linter.openIncludeAside',
            async (args: { uri: string }) => {
                if (!args?.uri) {
                    vscode.window.showWarningMessage('Include não encontrado no workspace.');
                    return;
                }
                const uri = vscode.Uri.parse(args.uri);
                await vscode.window.showTextDocument(uri, {
                    viewColumn: vscode.ViewColumn.Beside,
                    preview: false,
                    preserveFocus: false,
                });
            }
        )
    );

    // DefinitionProvider (F12 / Ctrl+Click)
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            selector,
            new AblIncludeDefinitionProvider()
        )
    );

    // HoverProvider (tooltip com botão "Abrir ao lado")
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            selector,
            new AblIncludeHoverProvider()
        )
    );

    // DocumentLinkProvider (sublinha como link clicável)
    context.subscriptions.push(
        vscode.languages.registerDocumentLinkProvider(
            selector,
            new AblIncludeDocumentLinkProvider()
        )
    );
}
