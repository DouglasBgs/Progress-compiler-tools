/**
 * Logger utilitário para o Compile Server.
 * Produz logs estruturados com timestamp ISO-8601 e nível,
 * facilitando a leitura via `pm2 logs`.
 */

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

function formatTimestamp(): string {
    const date = new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
    return date;
}

function formatMessage(level: LogLevel, context: string, message: string, meta?: Record<string, any>): string {
    const ts = formatTimestamp();
    const metaStr = meta ? ' | ' + Object.entries(meta).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : '';
    return `[${ts}] [${level}] [${context}]  ${message}${metaStr}`;
}

export const logger = {
    info(context: string, message: string, meta?: Record<string, any>) {
        console.log(formatMessage('INFO', context, message, meta));
    },

    warn(context: string, message: string, meta?: Record<string, any>) {
        console.warn(formatMessage('WARN', context, message, meta));
    },

    error(context: string, message: string, meta?: Record<string, any>) {
        console.error(formatMessage('ERROR', context, message, meta));
    },

    debug(context: string, message: string, meta?: Record<string, any>) {
        if (process.env.LOG_LEVEL === 'debug') {
            console.log(formatMessage('DEBUG', context, message, meta));
        }
    },

    /** Log de duração de uma operação */
    timed(context: string, message: string, startTime: number, meta?: Record<string, any>) {
        const duration = Date.now() - startTime;
        const allMeta = { ...meta, durationMs: duration };
        console.log(formatMessage('INFO', context, message, allMeta));
    }
};
