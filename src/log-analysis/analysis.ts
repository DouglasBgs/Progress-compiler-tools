import { ParsedLogLine } from './avmLogParser';

export interface LogIssue {
    line: number;
    timestamp: Date;
    processId: string;
    threadId: string;
    type: string;
    procedure: string | null;
    message: string;
    context: string[];
}

export interface ProcedureTiming {
    name: string;
    calls: number;
    totalTime: number;
    avgTime: number;
    maxTime: number;
    percentage: number;
}

export interface DatabaseUsage {
    name: string;
    users: string[];
    connections: number;
}

export interface FileUsage {
    path: string;
    opens: number;
}

export interface UnclosedFile {
    path: string;
    fileId: string;
    processId: string;
    threadId: string;
    line: number;
}

export interface ProcessThreadStats {
    processId: string;
    threadId: string;
    events: number;
    traces: number;
    errors: number;
    startedAt: Date;
    endedAt: Date;
}

export interface StaticLogAnalysis {
    errors: LogIssue[];
    warnings: LogIssue[];
    procedureTimings: ProcedureTiming[];
    databases: DatabaseUsage[];
    files: FileUsage[];
    unclosedFiles: UnclosedFile[];
    processThreads: ProcessThreadStats[];
    timeRange: { start: Date | null; end: Date | null };
}

interface ProcedureCall {
    name: string;
    startTime: Date;
}

function stackKey(line: ParsedLogLine): string {
    return `${line.processId}:${line.threadId}`;
}

function extractProcedureName(message: string, expression: RegExp): string | null {
    const match = message.match(expression);
    return match ? match[1] : null;
}

function sanitizeMessage(message: string): string {
    return message.replace(/"(?:\\.|[^"\\])*"/g, '"<redacted>"');
}

function buildContext(lines: ParsedLogLine[], index: number): string[] {
    const start = Math.max(0, index - 3);
    const end = Math.min(lines.length, index + 4);
    return lines.slice(start, end).map((line) => {
        const marker = line.line === lines[index].line ? '>>> ' : '    ';
        return `${String(line.line).padStart(6, ' ')} ${marker}[${line.processId} ${line.threadId}] ${line.category} ${sanitizeMessage(line.message)}`;
    });
}

function collectIssues(lines: ParsedLogLine[]): { errors: LogIssue[]; warnings: LogIssue[] } {
    const errors: LogIssue[] = [];
    const warnings: LogIssue[] = [];
    const warningTypes = ['RowErrors', 'RowErrorsAux', 'tt_log_erros', 'ttErrosConexao'];

    lines.forEach((line, index) => {
        const procedure = extractProcedureName(line.message, /^Return from\s+(\S+)/);
        const context = buildContext(lines, index);

        if (/^Return from\s+\S+.*\bERROR\s*$/.test(line.message)) {
            errors.push({ line: line.line, timestamp: line.timestamp, processId: line.processId, threadId: line.threadId, type: 'Return ERROR', procedure, message: sanitizeMessage(line.message), context });
        } else if (/loadProc\(\) failed|STOP condition|abnormally/i.test(line.message)) {
            errors.push({ line: line.line, timestamp: line.timestamp, processId: line.processId, threadId: line.threadId, type: 'Runtime', procedure, message: sanitizeMessage(line.message), context });
        }

        const warningType = warningTypes.find((type) => line.message.includes(type));
        if (warningType) {
            warnings.push({ line: line.line, timestamp: line.timestamp, processId: line.processId, threadId: line.threadId, type: warningType, procedure, message: sanitizeMessage(line.message), context });
        }
    });

    return { errors, warnings };
}

function collectProcedureTimings(lines: ParsedLogLine[]): ProcedureTiming[] {
    const stacks = new Map<string, ProcedureCall[]>();
    const timings = new Map<string, { calls: number; totalTime: number; maxTime: number }>();

    for (const line of lines) {
        if (line.category !== '4GLTRACE') {
            continue;
        }

        const started = extractProcedureName(line.message, /^(?:Run|Func|Invoke|New)\s+(\S+)/);
        if (started) {
            const key = stackKey(line);
            const stack = stacks.get(key) ?? [];
            stack.push({ name: started, startTime: line.timestamp });
            stacks.set(key, stack);
            continue;
        }

        const returned = extractProcedureName(line.message, /^Return from\s+(\S+)/);
        if (!returned) {
            continue;
        }

        const stack = stacks.get(stackKey(line));
        if (!stack?.length) {
            continue;
        }

        const callIndex = returned === 'Main'
            ? stack.length - 1
            : stack.map((call) => call.name).lastIndexOf(returned);
        if (callIndex < 0) {
            continue;
        }

        const [call] = stack.splice(callIndex, 1);
        const elapsed = (line.timestamp.getTime() - call.startTime.getTime()) / 1_000;
        if (elapsed < 0 || elapsed > 3_600) {
            continue;
        }

        const current = timings.get(call.name) ?? { calls: 0, totalTime: 0, maxTime: 0 };
        current.calls++;
        current.totalTime += elapsed;
        current.maxTime = Math.max(current.maxTime, elapsed);
        timings.set(call.name, current);
    }

    const totalTime = [...timings.values()].reduce((sum, timing) => sum + timing.totalTime, 0);
    return [...timings.entries()]
        .map(([name, timing]) => ({
            name,
            calls: timing.calls,
            totalTime: timing.totalTime,
            avgTime: timing.totalTime / timing.calls,
            maxTime: timing.maxTime,
            percentage: totalTime > 0 ? timing.totalTime * 100 / totalTime : 0,
        }))
        .sort((first, second) => second.totalTime - first.totalTime);
}

function collectDatabases(lines: ParsedLogLine[]): DatabaseUsage[] {
    const databases = new Map<string, DatabaseUsage>();
    const pendingDatabase = new Map<string, string>();
    const pendingUser = new Map<string, string>();

    for (const line of lines) {
        if (line.category !== 'CONN') {
            continue;
        }

        const key = stackKey(line);
        const database = extractProcedureName(line.message, /^Database\s+(\S+)/);
        const user = extractProcedureName(line.message, /^User\s+(\S+)/);
        const connected = extractProcedureName(line.message, /^Connected to database\s+(\S+?)[,.]/);

        if (database) {
            pendingDatabase.set(key, database);
        }
        if (user) {
            pendingUser.set(key, user);
        }
        if (!connected) {
            continue;
        }

        const usage = databases.get(connected) ?? { name: connected, users: [], connections: 0 };
        const knownUser = pendingUser.get(key);
        if (knownUser && !usage.users.includes(knownUser)) {
            usage.users.push(knownUser);
        }
        usage.connections++;
        databases.set(connected, usage);
        pendingDatabase.delete(key);
        pendingUser.delete(key);
    }

    return [...databases.values()].sort((first, second) => second.connections - first.connections);
}

function collectFiles(lines: ParsedLogLine[]): { files: FileUsage[]; unclosedFiles: UnclosedFile[] } {
    const files = new Map<string, number>();
    const openFiles = new Map<string, UnclosedFile>();

    for (const line of lines) {
        if (line.category !== 'FILEID') {
            continue;
        }

        const match = line.message.match(/^(Open|Close)\s+(.+?)\s+ID=(\d+)$/);
        if (!match) {
            continue;
        }

        const [, action, filePath, fileId] = match;
        const key = `${stackKey(line)}:${fileId}`;
        if (action === 'Open') {
            files.set(filePath, (files.get(filePath) ?? 0) + 1);
            openFiles.set(key, { path: filePath, fileId, processId: line.processId, threadId: line.threadId, line: line.line });
        } else {
            openFiles.delete(key);
        }
    }

    return {
        files: [...files.entries()]
            .map(([filePath, opens]) => ({ path: filePath, opens }))
            .sort((first, second) => second.opens - first.opens),
        unclosedFiles: [...openFiles.values()],
    };
}

function collectProcessThreads(lines: ParsedLogLine[], errors: LogIssue[]): ProcessThreadStats[] {
    const errorKeys = new Set(errors.map((error) => `${error.processId}:${error.threadId}:${error.line}`));
    const stats = new Map<string, ProcessThreadStats>();

    for (const line of lines) {
        const key = stackKey(line);
        const current = stats.get(key) ?? {
            processId: line.processId,
            threadId: line.threadId,
            events: 0,
            traces: 0,
            errors: 0,
            startedAt: line.timestamp,
            endedAt: line.timestamp,
        };
        current.events++;
        current.traces += line.category === '4GLTRACE' ? 1 : 0;
        current.errors += errorKeys.has(`${key}:${line.line}`) ? 1 : 0;
        current.startedAt = current.startedAt < line.timestamp ? current.startedAt : line.timestamp;
        current.endedAt = current.endedAt > line.timestamp ? current.endedAt : line.timestamp;
        stats.set(key, current);
    }

    return [...stats.values()].sort((first, second) => second.events - first.events);
}

export function analyzeLog(lines: ParsedLogLine[]): StaticLogAnalysis {
    const { errors, warnings } = collectIssues(lines);
    const fileResult = collectFiles(lines);

    return {
        errors,
        warnings,
        procedureTimings: collectProcedureTimings(lines),
        databases: collectDatabases(lines),
        files: fileResult.files,
        unclosedFiles: fileResult.unclosedFiles,
        processThreads: collectProcessThreads(lines, errors),
        timeRange: {
            start: lines.length > 0 ? lines[0].timestamp : null,
            end: lines.length > 0 ? lines[lines.length - 1].timestamp : null,
        },
    };
}
