import { WorkerDbSettings, WorkerPoolConfig } from './worker-protocol';

export interface RepositoryServerConfig {
    defaultRepository?: string;
    databases?: Record<string, WorkerDbSettings>;
    repositories?: Record<string, { databases?: Record<string, WorkerDbSettings> }>;
    workerPool?: WorkerPoolConfig;
}

export function resolveRepositorySettings(config: RepositoryServerConfig, dbType: string,
    repository: string): WorkerDbSettings | undefined {
    const base = config.databases?.[dbType];
    const override = config.repositories?.[repository]?.databases?.[dbType];
    if (!base && !override) return undefined;
    const settings = { ...base, ...override };
    return {
        repository,
        pf: settings.pf?.replace(/\{repository\}/g, repository),
        ini: settings.ini?.replace(/\{repository\}/g, repository)
    };
}

export function resolvePrewarmContexts(config: RepositoryServerConfig): Array<{ dbType: string; settings: WorkerDbSettings }> {
    const repositories = config.workerPool?.prewarmRepositories ??
        [config.defaultRepository || 'EMS2.08', ...Object.keys(config.repositories || {})];
    const contexts: Array<{ dbType: string; settings: WorkerDbSettings }> = [];
    for (const repository of new Set(repositories)) {
        if (typeof repository !== 'string' || !repository.trim()) {
            throw new Error('workerPool.prewarmRepositories deve conter nomes de repositórios não vazios.');
        }
        for (const dbType of config.workerPool?.prewarmDatabases || []) {
            const settings = resolveRepositorySettings(config, dbType, repository);
            if (settings?.pf?.trim()) contexts.push({ dbType, settings });
        }
    }
    return contexts;
}
