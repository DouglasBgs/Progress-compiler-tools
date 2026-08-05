import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface AblParameter {
    direction: 'INPUT' | 'OUTPUT' | 'INPUT-OUTPUT' | 'RETURN';
    name: string;
    dataType: string;
    isTable: boolean;
    isDataset: boolean;
    extent?: string;
}

/** Parâmetro no momento da chamada: `RUN proc(OUTPUT TABLE tt-x, INPUT pc)`. */
export interface CallArg {
    direction: string;  // INPUT | OUTPUT | INPUT-OUTPUT | (vazio = posicional)
    modifier: string;   // TABLE | DATASET | BUFFER-COPY | (vazio)
    name: string;       // nome da variável ou temp-table
}

/**
 * Divide uma string de args respeitando profundidade de parênteses.
 * Ex: "OUTPUT TABLE tt-a, INPUT pcCod" → ["OUTPUT TABLE tt-a", "INPUT pcCod"]
 */
function splitCallArgs(raw: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of raw) {
        if (ch === '(') { depth++; cur += ch; }
        else if (ch === ')') { depth--; cur += ch; }
        else if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; }
        else { cur += ch; }
    }
    if (cur.trim()) { parts.push(cur.trim()); }
    return parts;
}

/**
 * Faz o parse dos argumentos inline de uma chamada RUN:
 *   (OUTPUT TABLE tt-danfe, INPUT pcCod, INPUT-OUTPUT piTotal)
 */
function parseCallArgs(argsStr: string): CallArg[] {
    const args: CallArg[] = [];
    for (const raw of splitCallArgs(argsStr)) {
        const upper = raw.toUpperCase();
        // Direção
        const dirMatch = /^(INPUT-OUTPUT|INPUT|OUTPUT)\b/i.exec(raw);
        const direction = dirMatch ? dirMatch[1].toUpperCase() : '';
        const rest = dirMatch ? raw.slice(dirMatch[0].length).trim() : raw.trim();

        // Modificador (TABLE FOR, DATASET FOR, BUFFER-COPY OF, TABLE, DATASET)
        const modMatch = /^(TABLE\s+FOR|DATASET\s+FOR|BUFFER-COPY\s+OF|TABLE|DATASET)\b/i.exec(rest);
        const modifier = modMatch ? modMatch[1].replace(/\s+/g, ' ').toUpperCase() : '';
        const namePart = modMatch ? rest.slice(modMatch[0].length).trim() : rest;

        // Nome da variável (primeira palavra, remove pontuação final)
        const nameMatch = /^([\w-]+)/.exec(namePart);
        const name = nameMatch ? nameMatch[1] : namePart;

        if (name) {
            args.push({ direction, modifier, name });
        }
    }
    return args;
}

export interface AblProcedureInfo {
    name: string;
    parameters: AblParameter[];
    /** URI do arquivo onde a procedure foi encontrada */
    uri: vscode.Uri;
    /** Linha 0-based da declaração */
    line: number;
    /** true = interna (mesma URI que o documento atual) */
    isInternal: boolean;
}

// ---------------------------------------------------------------------------
// Helpers de parsing
// ---------------------------------------------------------------------------

/**
 * Remove comentários de bloco e de linha do texto ABL,
 * substituindo-os por espaços (preserva posições de linha/coluna).
 */
function stripComments(text: string): string {
    const result = text.split('');
    let i = 0;

    while (i < result.length) {
        const ch = result[i];
        const nx = i + 1 < result.length ? result[i + 1] : '';

        if (ch === '/' && nx === '*') {
            result[i] = result[i + 1] = ' ';
            i += 2;
            while (i < result.length) {
                if (result[i] === '*' && i + 1 < result.length && result[i + 1] === '/') {
                    result[i] = result[i + 1] = ' ';
                    i += 2;
                    break;
                }
                if (result[i] !== '\n') { result[i] = ' '; }
                i++;
            }
        } else if (ch === '/' && nx === '/') {
            while (i < result.length && result[i] !== '\n') {
                result[i] = ' ';
                i++;
            }
        } else if (ch === '"' || ch === "'") {
            const q = ch;
            result[i] = ' ';
            i++;
            while (i < result.length) {
                if (result[i] === q) {
                    result[i] = ' ';
                    if (i + 1 < result.length && result[i + 1] === q) {
                        result[i + 1] = ' ';
                        i += 2;
                    } else {
                        i++;
                        break;
                    }
                } else {
                    if (result[i] !== '\n') { result[i] = ' '; }
                    i++;
                }
            }
        } else {
            i++;
        }
    }

    return result.join('');
}

/**
 * Extrai os parâmetros de uma procedure a partir do texto do arquivo.
 * Analisa as linhas entre `PROCEDURE name:` e o próximo `END PROCEDURE.`
 */
function extractParameters(text: string, procName: string): AblParameter[] {
    const stripped = stripComments(text);
    const lines = stripped.split('\n');
    const params: AblParameter[] = [];

    // Localiza o início da procedure
    const procStartRegex = new RegExp(`\\bPROCEDURE\\s+${escapeRegExp(procName)}\\s*:`, 'i');
    let inProc = false;
    let depth = 0;

    for (const line of lines) {
        const upper = line.toUpperCase().trim();

        if (!inProc) {
            if (procStartRegex.test(line)) {
                inProc = true;
                depth = 1;
            }
            continue;
        }

        // Rastreia profundidade de blocos para saber quando a procedure termina
        if (/\b(DO|FOR|REPEAT|CASE)\b.*:\s*$/.test(line) || /\b(CATCH|FINALLY)\b.*:\s*$/.test(line)) {
            depth++;
        }
        if (/\bEND\b\s*(?:PROCEDURE|FUNCTION|METHOD|CLASS|CASE|CATCH|FINALLY)?\s*\./.test(upper)) {
            depth--;
            if (depth <= 0) {
                break;
            }
        }

        // DEFINE [INPUT|OUTPUT|INPUT-OUTPUT|RETURN] PARAMETER name AS type
        const paramMatch = /\bDEFINE\s+(INPUT-OUTPUT|INPUT|OUTPUT|RETURN)\s+PARAMETER\s+([\w-]+)\s+(?:AS\s+([\w-]+(?:\s+\w+)*))?(.*)/i.exec(line);
        if (paramMatch) {
            const direction = paramMatch[1].toUpperCase() as AblParameter['direction'];
            const name = paramMatch[2];
            const rawType = (paramMatch[3] ?? '').trim().toUpperCase();
            const rest = (paramMatch[4] ?? '').toUpperCase();

            const isTable = /\bTABLE\b/.test(rawType) || /\bTABLE\b/.test(rest);
            const isDataset = /\bDATASET\b/.test(rawType) || /\bDATASET\b/.test(rest);
            const extentMatch = /\bEXTENT\s+(\d+)/.exec(rest);

            let dataType = rawType || 'UNKNOWN';
            if (isTable) { dataType = 'TABLE'; }
            if (isDataset) { dataType = 'DATASET'; }

            params.push({
                direction,
                name,
                dataType,
                isTable,
                isDataset,
                extent: extentMatch ? extentMatch[1] : undefined,
            });
        }

        // DEFINE [INPUT|OUTPUT|INPUT-OUTPUT] PARAMETER TABLE FOR name
        const tableParamMatch = /\bDEFINE\s+(INPUT-OUTPUT|INPUT|OUTPUT)\s+PARAMETER\s+TABLE\s+FOR\s+([\w-]+)/i.exec(line);
        if (tableParamMatch && !paramMatch) {
            params.push({
                direction: tableParamMatch[1].toUpperCase() as AblParameter['direction'],
                name: tableParamMatch[2],
                dataType: 'TABLE',
                isTable: true,
                isDataset: false,
            });
        }

        // DEFINE [INPUT|OUTPUT|INPUT-OUTPUT] PARAMETER DATASET FOR name
        const dsParamMatch = /\bDEFINE\s+(INPUT-OUTPUT|INPUT|OUTPUT)\s+PARAMETER\s+DATASET\s+FOR\s+([\w-]+)/i.exec(line);
        if (dsParamMatch && !paramMatch && !tableParamMatch) {
            params.push({
                direction: dsParamMatch[1].toUpperCase() as AblParameter['direction'],
                name: dsParamMatch[2],
                dataType: 'DATASET',
                isTable: false,
                isDataset: true,
            });
        }
    }

    return params;
}

/** Escapa caracteres especiais de RegExp em uma string literal. */
function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Encontra a linha 0-based onde `PROCEDURE name:` ou `FUNCTION name RETURNS`
 * está declarada no texto.
 */
function findProcedureLine(text: string, procName: string): number {
    const stripped = stripComments(text);
    const lines = stripped.split('\n');
    const escapedName = escapeRegExp(procName);
    const re = new RegExp(
        `\\b(?:PROCEDURE\\s+${escapedName}\\s*:|FUNCTION\\s+${escapedName}\\s+RETURNS\\b)`,
        'i'
    );
    for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
            return i;
        }
    }
    return 0;
}

// ---------------------------------------------------------------------------
// Helpers de resolução de includes para busca de procedures
// ---------------------------------------------------------------------------

/** Regex que extrai os caminhos de includes ABL ({arquivo.i}) de um texto. */
const INCLUDE_IN_TEXT = /\{([\w./\\-]+\.i\d*)\s*(?:[^}]*)?\}/gi;

/**
 * Retorna os URIs de todos os includes referenciados em `text`,
 * resolvendo-os a partir de `baseDir`.
 * Profundidade máxima controlada por `maxDepth` para evitar loops.
 */
async function collectIncludeUris(
    text: string,
    baseDir: string,
    visited: Set<string>,
    maxDepth: number
): Promise<vscode.Uri[]> {
    if (maxDepth <= 0) { return []; }

    const uris: vscode.Uri[] = [];
    const pattern = new RegExp(INCLUDE_IN_TEXT.source, 'gi');
    let m: RegExpExecArray | null;

    while ((m = pattern.exec(text)) !== null) {
        const includePath = m[1].replace(/\\/g, '/');
        const basename = path.basename(includePath);

        let resolvedUri: vscode.Uri | undefined;

        // 1. Relativo ao diretório base
        const relPath = path.join(baseDir, includePath);
        if (fs.existsSync(relPath)) {
            resolvedUri = vscode.Uri.file(relPath);
        }

        // 2. Raiz dos workspace folders
        if (!resolvedUri) {
            for (const folder of vscode.workspace.workspaceFolders ?? []) {
                const wsPath = path.join(folder.uri.fsPath, includePath);
                if (fs.existsSync(wsPath)) {
                    resolvedUri = vscode.Uri.file(wsPath);
                    break;
                }
            }
        }

        // 3. Busca recursiva no workspace pelo nome do arquivo
        if (!resolvedUri) {
            const found = await vscode.workspace.findFiles(
                `**/${basename}`,
                '{**/node_modules/**,**/.git/**}',
                3
            );
            if (found.length > 0) {
                resolvedUri = found[0];
            }
        }

        if (!resolvedUri) { continue; }

        const key = resolvedUri.fsPath;
        if (visited.has(key)) { continue; }
        visited.add(key);
        uris.push(resolvedUri);

        // Lê o include e coleta sub-includes recursivamente
        try {
            const subText = fs.readFileSync(key, 'utf8');
            const subDir = path.dirname(key);
            const subUris = await collectIncludeUris(subText, subDir, visited, maxDepth - 1);
            uris.push(...subUris);
        } catch {
            // ignora erros de leitura
        }
    }

    return uris;
}

// ---------------------------------------------------------------------------
// Tenta encontrar a procedure em um texto/URI específico
// ---------------------------------------------------------------------------

function tryFindInText(
    text: string,
    uri: vscode.Uri,
    procName: string,
    isInternal: boolean
): AblProcedureInfo | undefined {
    const stripped = stripComments(text);

    // Aceita tanto PROCEDURE name: quanto FUNCTION name RETURNS
    const escapedName = escapeRegExp(procName);
    const reProcedure = new RegExp(`\\bPROCEDURE\\s+${escapedName}\\s*:`, 'i');
    const reFunction  = new RegExp(`\\bFUNCTION\\s+${escapedName}\\s+RETURNS\\b`, 'i');

    const isProc = reProcedure.test(stripped);
    const isFunc = !isProc && reFunction.test(stripped);

    if (!isProc && !isFunc) { return undefined; }

    return {
        name: procName,
        parameters: extractParameters(text, procName),
        uri,
        line: findProcedureLine(text, procName),
        isInternal,
    };
}

// ---------------------------------------------------------------------------
// Resolução da procedure — fonte → includes → arquivo externo
// ---------------------------------------------------------------------------

/**
 * Procura `procName` na seguinte ordem:
 *   1. No próprio arquivo aberto
 *   2. Em todos os includes ({*.i}) referenciados no arquivo (recursivo, depth 3)
 *   3. Como arquivo externo (RUN path/proc.p) no diretório atual, workspace e busca
 */
async function resolveProcedure(
    document: vscode.TextDocument,
    procName: string
): Promise<AblProcedureInfo | undefined> {
    const currentDir = path.dirname(document.uri.fsPath);
    const selfText = document.getText();

    // -----------------------------------------------------------------------
    // 1. Procedure no próprio arquivo
    // -----------------------------------------------------------------------
    const selfResult = tryFindInText(selfText, document.uri, procName, true);
    if (selfResult) { return selfResult; }

    // -----------------------------------------------------------------------
    // 2. Busca nos includes referenciados no arquivo (e nos deles, até depth 3)
    // -----------------------------------------------------------------------
    const visited = new Set<string>([document.uri.fsPath]);
    const includeUris = await collectIncludeUris(selfText, currentDir, visited, 3);

    for (const incUri of includeUris) {
        try {
            const incText = fs.readFileSync(incUri.fsPath, 'utf8');
            const result = tryFindInText(incText, incUri, procName, false);
            if (result) { return result; }
        } catch {
            // ignora arquivo ilegível
        }
    }

    // -----------------------------------------------------------------------
    // 3. Procedure como arquivo externo
    //    Ex: RUN path/to/proc.p  ou  RUN myproc  (sem extensão)
    // -----------------------------------------------------------------------
    const hasExt = /\.(p|w|cls)$/i.test(procName);
    const externalCandidates = hasExt
        ? [procName]
        : [`${procName}.p`, `${procName}.w`];

    for (const candidate of externalCandidates) {
        const normalized = candidate.replace(/\\/g, '/');
        const basename = path.basename(normalized);
        const simpleName = path.basename(procName, path.extname(procName));

        // 3a. Relativo ao diretório do arquivo atual
        const relPath = path.join(currentDir, normalized);
        if (fs.existsSync(relPath)) {
            const fileText = fs.readFileSync(relPath, 'utf8');
            return {
                name: procName,
                parameters: extractParameters(fileText, simpleName),
                uri: vscode.Uri.file(relPath),
                line: findProcedureLine(fileText, simpleName),
                isInternal: false,
            };
        }

        // 3b. Relativo à raiz dos workspace folders
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            const wsPath = path.join(folder.uri.fsPath, normalized);
            if (fs.existsSync(wsPath)) {
                const fileText = fs.readFileSync(wsPath, 'utf8');
                return {
                    name: procName,
                    parameters: extractParameters(fileText, simpleName),
                    uri: vscode.Uri.file(wsPath),
                    line: findProcedureLine(fileText, simpleName),
                    isInternal: false,
                };
            }
        }

        // 3c. Busca recursiva no workspace pelo nome do arquivo
        const found = await vscode.workspace.findFiles(
            `**/${basename}`,
            '{**/node_modules/**,**/.git/**}',
            3
        );
        if (found.length > 0) {
            const fileUri = found[0];
            const fileDoc = await vscode.workspace.openTextDocument(fileUri);
            const fileText = fileDoc.getText();
            return {
                name: procName,
                parameters: extractParameters(fileText, simpleName),
                uri: fileUri,
                line: findProcedureLine(fileText, simpleName),
                isInternal: false,
            };
        }
    }

    return undefined;
}

// ---------------------------------------------------------------------------
// Detecta se o cursor está sobre o nome de uma procedure/função
// ---------------------------------------------------------------------------

/**
 * Verifica se o cursor está sobre o nome de uma procedure/função em:
 *   - `RUN procName`
 *   - `RUN procName (...)` / `RUN procName IN handle`
 *
 * Regras de captura do nome:
 *   - Letras, dígitos, hífen, underscore, / e \ (separadores de caminho)
 *   - Ponto SOMENTE seguido de extensão válida (p, w, cls) — nunca o ponto final do statement
 *   - `VALUE(...)` é ignorado (chamada dinâmica)
 */
function findProcedureAtPosition(
    lineText: string,
    col: number
): { procName: string; inlineArgs: CallArg[] | null; start: number; end: number } | null {
    const runPattern = /\bRUN\s+(?!VALUE\s*\()(([\w/\\-]+)(\.(?:p|w|cls))?)/gi;
    let match: RegExpExecArray | null;

    while ((match = runPattern.exec(lineText)) !== null) {
        const fullName = match[1];
        const nameStart = match.index + match[0].length - fullName.length;
        const nameEnd   = nameStart + fullName.length;

        if (col >= nameStart && col <= nameEnd) {
            const cleanName = fullName.replace(/\.$/, '');

            // Captura args inline: RUN proc(OUTPUT TABLE tt-x, INPUT pcY)
            let inlineArgs: CallArg[] | null = null;
            const afterName = lineText.slice(nameEnd);
            const parenMatch = /^\s*\(([^)]*)\)/.exec(afterName);
            if (parenMatch) {
                inlineArgs = parseCallArgs(parenMatch[1]);
            }

            return {
                procName: cleanName,
                inlineArgs,
                start: nameStart,
                end: nameStart + cleanName.length,
            };
        }
    }

    return null;
}

// ---------------------------------------------------------------------------
// Formata parâmetros para exibição em Markdown
// ---------------------------------------------------------------------------

function formatParameters(params: AblParameter[]): string {
    if (params.length === 0) {
        return '_Sem parâmetros_';
    }

    const dirIcon: Record<string, string> = {
        'INPUT':       '→',
        'OUTPUT':      '←',
        'INPUT-OUTPUT': '↔',
        'RETURN':      '⮐',
    };

    const rows = params.map((p) => {
        const icon = dirIcon[p.direction] ?? '';
        const type = p.isTable
            ? `TABLE FOR \`${p.name}\``
            : p.isDataset
            ? `DATASET FOR \`${p.name}\``
            : `\`${p.dataType}\`${p.extent ? ` EXTENT ${p.extent}` : ''}`;
        return `| ${icon} \`${p.direction}\` | \`${p.name}\` | ${type} |`;
    });

    return [
        '| Dir | Nome | Tipo |',
        '|-----|------|------|',
        ...rows,
    ].join('\n');
}

function formatCallArgs(args: CallArg[]): string {
    if (args.length === 0) { return '_Sem parâmetros_'; }

    const dirIcon: Record<string, string> = {
        'INPUT':        '→',
        'OUTPUT':       '←',
        'INPUT-OUTPUT': '↔',
        '':             '◦',
    };

    const rows = args.map((a) => {
        const icon = dirIcon[a.direction] ?? '◦';
        const dirLabel = a.direction || '_posicional_';
        const typeLabel = a.modifier ? `${a.modifier} \`${a.name}\`` : `\`${a.name}\``;
        return `| ${icon} \`${dirLabel}\` | ${typeLabel} |`;
    });

    return [
        '| Dir | Argumento |',
        '|-----|-----------|',
        ...rows,
    ].join('\n');
}

// ---------------------------------------------------------------------------
// DefinitionProvider — F12 / Ctrl+Click → navega para a procedure
// ---------------------------------------------------------------------------

export class AblProcedureDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): Promise<vscode.Definition | undefined> {
        const lineText = document.lineAt(position.line).text;
        const hit = findProcedureAtPosition(lineText, position.character);
        if (!hit) {
            return undefined;
        }

        const info = await resolveProcedure(document, hit.procName);
        if (!info) {
            return undefined;
        }

        return new vscode.Location(info.uri, new vscode.Position(info.line, 0));
    }
}

// ---------------------------------------------------------------------------
// HoverProvider — mostra assinatura e parâmetros ao passar o mouse
// ---------------------------------------------------------------------------

export class AblProcedureHoverProvider implements vscode.HoverProvider {
    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        const lineText = document.lineAt(position.line).text;
        const hit = findProcedureAtPosition(lineText, position.character);
        if (!hit) {
            return undefined;
        }

        const info = await resolveProcedure(document, hit.procName);

        const md = new vscode.MarkdownString('', true);
        md.isTrusted = true;
        md.supportHtml = false;

        if (!info) {
            // Não encontrou a definição, mas pode ter args inline
            md.appendMarkdown(`**PROCEDURE** \`${hit.procName}\`\n\n`);
            if (hit.inlineArgs && hit.inlineArgs.length > 0) {
                md.appendMarkdown('**Parâmetros na chamada:**\n\n');
                md.appendMarkdown(formatCallArgs(hit.inlineArgs));
            } else {
                md.appendMarkdown('\u26a0\ufe0f Procedure não encontrada no workspace.');
            }
        } else {
            const origin = info.isInternal
                ? `_interna — linha ${info.line + 1}_`
                : `_${vscode.workspace.asRelativePath(info.uri)}_`;

            md.appendCodeblock(`PROCEDURE ${info.name}.`, 'abl');
            md.appendMarkdown(`\n${origin}\n\n`);

            // Parâmetros da definição (DEFINE PARAMETER)
            if (info.parameters.length > 0) {
                md.appendMarkdown('**Definição dos parâmetros:**\n\n');
                md.appendMarkdown(formatParameters(info.parameters));
                md.appendMarkdown('\n\n');
            }

            // Se houver args inline na chamada, exibe também
            if (hit.inlineArgs && hit.inlineArgs.length > 0) {
                md.appendMarkdown('**Parâmetros na chamada:**\n\n');
                md.appendMarkdown(formatCallArgs(hit.inlineArgs));
                md.appendMarkdown('\n\n');
            }

            if (info.parameters.length === 0 && (!hit.inlineArgs || hit.inlineArgs.length === 0)) {
                md.appendMarkdown('_Sem parâmetros_\n\n');
            }

            // Botão para navegar (ir para a procedure)
            const encodedArg = encodeURIComponent(
                JSON.stringify({ uri: info.uri.toString(), line: info.line })
            );
            md.appendMarkdown(
                `[$(go-to-file) Ir para procedure](command:abl-linter.openProcedure?${encodedArg} "Navegar para a definição da procedure")`
            );
        }

        const range = new vscode.Range(position.line, hit.start, position.line, hit.end);
        return new vscode.Hover(md, range);
    }
}

// ---------------------------------------------------------------------------
// Registrador principal
// ---------------------------------------------------------------------------

export function registerAblProcedureProviders(context: vscode.ExtensionContext): void {
    const selector: vscode.DocumentSelector = [
        { language: 'abl' },
        { pattern: '**/*.{p,w,cls,i}' },
    ];

    // Comando: navegar para a procedure (abre o arquivo e posiciona na linha)
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'abl-linter.openProcedure',
            async (args: { uri: string; line: number }) => {
                if (!args?.uri) {
                    return;
                }
                const uri = vscode.Uri.parse(args.uri);
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc, {
                    viewColumn: vscode.ViewColumn.Active,
                    preview: false,
                    selection: new vscode.Range(args.line ?? 0, 0, args.line ?? 0, 0),
                });
            }
        )
    );

    // DefinitionProvider (F12 / Ctrl+Click sobre RUN procName)
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            selector,
            new AblProcedureDefinitionProvider()
        )
    );

    // HoverProvider (parâmetros ao passar o mouse sobre RUN procName)
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            selector,
            new AblProcedureHoverProvider()
        )
    );
}
