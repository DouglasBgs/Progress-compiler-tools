export interface ParsedLogLine {
    line: number;
    timestamp: Date;
    processId: string;
    threadId: string;
    level: number;
    category: string;
    message: string;
    format: 'avm-client' | 'appserver-agent';
}

export interface ParsedLog {
    lines: ParsedLogLine[];
    totalLines: number;
    ignoredLines: number;
    formats: Array<ParsedLogLine['format']>;
}

const AVM_LOG_LINE = /^\[(\d{2})\/(\d{2})\/(\d{2})@(\d{2}):(\d{2}):(\d{2})\.(\d{3})([-+]\d{4})\]\s+(P-\d+)\s+(T-\d+)\s+(\d+)\s+4GL\s+(\S+)\s*(.*)$/;
const AGENT_LOG_LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[-+]\d{4})\s+(\d+)\s+(\d+)\s+(\d+)\s+(AS-\d+)\s+\S+\s+(\S+)\s*(.*)$/;

function parseTimestamp(
    year: string,
    month: string,
    day: string,
    hour: string,
    minute: string,
    second: string,
    millisecond: string,
    offset: string
): Date {
    const offsetSign = offset.startsWith('-') ? -1 : 1;
    const offsetHours = Number(offset.substring(1, 3));
    const offsetMinutes = Number(offset.substring(3, 5));
    const offsetInMinutes = offsetSign * (offsetHours * 60 + offsetMinutes);
    const utcTime = Date.UTC(
        2000 + Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        Number(millisecond)
    );

    return new Date(utcTime - offsetInMinutes * 60_000);
}

export function parseAvmLogLine(line: string, lineNumber: number): ParsedLogLine | null {
    const match = line.match(AVM_LOG_LINE);
    if (match) {
        const [, year, month, day, hour, minute, second, millisecond, offset, processId, threadId, level, category, message] = match;

        return {
            line: lineNumber,
            timestamp: parseTimestamp(year, month, day, hour, minute, second, millisecond, offset),
            processId,
            threadId,
            level: Number(level),
            category,
            message,
            format: 'avm-client',
        };
    }

    const agentMatch = line.match(AGENT_LOG_LINE);
    if (!agentMatch) {
        return null;
    }

    const [, timestamp, processId, threadId, level, , category, message] = agentMatch;

    return {
        line: lineNumber,
        timestamp: new Date(timestamp),
        processId,
        threadId,
        level: Number(level),
        category,
        message,
        format: 'appserver-agent',
    };
}

export function parseAvmLog(content: string): ParsedLog {
    const rawLines = content.replace(/\0/g, '').split(/\r?\n/);
    const lines: ParsedLogLine[] = [];
    const formats = new Set<ParsedLogLine['format']>();
    let ignoredLines = 0;

    rawLines.forEach((line, index) => {
        if (line.trim() === '') {
            return;
        }

        const parsed = parseAvmLogLine(line, index + 1);
        if (parsed) {
            lines.push(parsed);
            formats.add(parsed.format);
        } else {
            ignoredLines++;
        }
    });

    return { lines, totalLines: rawLines.length, ignoredLines, formats: [...formats] };
}
