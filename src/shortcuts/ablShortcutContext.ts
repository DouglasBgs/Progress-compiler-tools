export interface ShortcutContext {
    prefix: string;
    /** Character offset within the current line, excluding indentation. */
    start: number;
}

/** Lightweight lexical check; deliberately offers statement templates only at line start. */
export function getShortcutContext(textBeforeCursor: string): ShortcutContext | undefined {
    const line = textBeforeCursor.slice(textBeforeCursor.lastIndexOf('\n') + 1);
    const match = /^([\t ]*)(&?[a-z][a-z0-9-]*(?:[\t ]+[a-z][a-z0-9-]*)*)$/i.exec(line);
    if (!match) return undefined;

    let commentDepth = 0;
    let quote = '';
    let lineComment = false;
    for (let i = 0; i < textBeforeCursor.length; i++) {
        const ch = textBeforeCursor[i];
        const next = textBeforeCursor[i + 1];
        if (lineComment) {
            if (ch === '\n') lineComment = false;
        } else if (commentDepth > 0) {
            if (ch === '/' && next === '*') { commentDepth++; i++; }
            else if (ch === '*' && next === '/') { commentDepth--; i++; }
        } else if (quote) {
            if (ch === '~') i++; // ABL escapes quotes and continued newlines with tilde.
            else if (ch === quote) {
                if (next === quote) i++;
                else quote = '';
            }
        } else if (ch === '/' && next === '*') { commentDepth++; i++; }
        else if (ch === '/' && next === '/') { lineComment = true; i++; }
        else if (ch === '"' || ch === "'") quote = ch;
    }
    if (commentDepth || quote || lineComment) return undefined;
    return { prefix: match[2].toLowerCase().replace(/[\t ]+/g, ' '), start: match[1].length };
}
