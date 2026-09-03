export interface ImportedJobMetric {
    jobId: string;
    status: 'queued' | 'completed' | 'error';
    machineName: string | null;
    ip: string | null;
    filesCount: number;
    ablSourcesCount: number;
    dbType: string;
    repository: string | null;
    compiledCount: number | null;
    errorsCount: number | null;
    errorMsg: string | null;
    durationMs: number | null;
    createdAt: Date;
    finishedAt: Date | null;
}

interface CompileRequest {
    machineName: string | null;
    ip: string | null;
    filesCount: number;
    dbType: string;
    repository: string | null;
    createdAt: Date;
}

function getValue(line: string, name: string): string | null {
    const match = line.match(new RegExp(`(?:^|\\s)${name}=("(?:\\\\.|[^"])*"|[^\\s|]+)`));
    if (!match) {
        return null;
    }

    try {
        return match[1].startsWith('"') ? JSON.parse(match[1]) : match[1];
    } catch {
        return match[1].replace(/^"|"$/g, '');
    }
}

function getLogTimestamp(line: string): Date | null {
    const match = line.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}):/);
    if (!match) {
        return null;
    }

    const [, year, month, day, hour, minute, second] = match;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
}

function getInteger(line: string, name: string, fallback = 0): number {
    const value = getValue(line, name);
    const parsed = value === null ? NaN : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getAblSourcesCount(line: string, fallback: number): number {
    const filesMatch = line.match(/\sfiles=(\[[\s\S]*?\])\sdbType=/);
    if (!filesMatch) {
        return fallback;
    }

    try {
        const files = JSON.parse(filesMatch[1]);
        return Array.isArray(files)
            ? files.filter((file) => /\.(p|py|w|cls)$/i.test(String(file))).length
            : fallback;
    } catch {
        return fallback;
    }
}

export function parseCompileLog(content: string): ImportedJobMetric[] {
    const jobs = new Map<string, ImportedJobMetric>();
    let lastRequest: CompileRequest | null = null;

    for (const line of content.split(/\r?\n/)) {
        const timestamp = getLogTimestamp(line);

        if (line.includes('POST /compile recebido')) {
            lastRequest = {
                machineName: getValue(line, 'machineName'),
                ip: getValue(line, 'ip'),
                filesCount: getInteger(line, 'filesCount'),
                dbType: getValue(line, 'dbType') ?? 'unknown',
                repository: getValue(line, 'repository'),
                createdAt: timestamp ?? new Date(),
            };
            continue;
        }

        if (line.includes('Job criado e enfileirado')) {
            const jobId = getValue(line, 'jobId');
            if (!jobId) {
                continue;
            }

            const filesCount = getInteger(line, 'filesCount', lastRequest?.filesCount ?? 0);
            jobs.set(jobId, {
                jobId,
                status: 'queued',
                machineName: getValue(line, 'machineName') ?? lastRequest?.machineName ?? null,
                ip: lastRequest?.ip ?? null,
                filesCount,
                ablSourcesCount: getAblSourcesCount(line, filesCount),
                dbType: getValue(line, 'dbType') ?? lastRequest?.dbType ?? 'unknown',
                repository: lastRequest?.repository ?? null,
                compiledCount: null,
                errorsCount: null,
                errorMsg: null,
                durationMs: null,
                createdAt: timestamp ?? lastRequest?.createdAt ?? new Date(),
                finishedAt: null,
            });
            lastRequest = null;
            continue;
        }

        const jobId = getValue(line, 'jobId');
        const job = jobId ? jobs.get(jobId) : undefined;
        if (!job) {
            continue;
        }

        if (line.includes('Job finalizado com sucesso')) {
            job.status = 'completed';
            job.compiledCount = getInteger(line, 'compiledFiles');
            job.errorsCount = getInteger(line, 'errors');
            job.durationMs = getInteger(line, 'durationMs');
            job.finishedAt = timestamp;
        } else if (line.includes('Job falhou')) {
            job.status = 'error';
            job.errorMsg = getValue(line, 'error');
            job.durationMs = getInteger(line, 'durationMs');
            job.finishedAt = timestamp;
        }
    }

    return [...jobs.values()];
}
