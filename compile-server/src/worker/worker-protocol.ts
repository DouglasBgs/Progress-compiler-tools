export interface WorkerDbSettings { repository?: string; pf?: string; ini?: string; }

export interface WorkerPoolConfig {
    enabled: boolean;
    port: number;
    prewarmDatabases: string[];
    prewarmRepositories?: string[];
    /** Quantidade fixa por combinação de banco/PF/INI. */
    workersPerDb: number;
    jobTimeoutMs: number;
    startupTimeoutMs?: number;
    heartbeatIntervalMs?: number;
    heartbeatTimeoutMs?: number;
}

export interface WorkerOptions {
    port: number;
    jobTimeoutMs: number;
    startupTimeoutMs: number;
    heartbeatIntervalMs: number;
    heartbeatTimeoutMs: number;
}

export interface CompileManifest {
    jobId: string;
    baseTempPath: string;
    reportPath: string;
    sources: string[];
}

// O socket transporta apenas comandos curtos; listas de fontes ficam no manifest UTF-8.
export type NodeToWorkerCommand =
    | { action: 'COMPILE'; jobId: string; requestPath: string }
    | { action: 'PING' }
    | { action: 'QUIT' };

export type WorkerToNodeMessage =
    | { action: 'REGISTER'; workerId: string }
    | { action: 'DONE'; jobId: string; success: boolean; error?: string }
    | { action: 'PONG' };
