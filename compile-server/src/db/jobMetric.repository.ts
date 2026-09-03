import { AppDataSource } from './data-source';
import { JobMetric } from './entities/JobMetric';
import { logger } from '../logger';

export async function createJobMetric(input: {
    jobId: string;
    status: string;
    machineName: string | null;
    ip: string | null;
    filesCount: number;
    ablSourcesCount: number;
    dbType: string;
    repository: string | null;
}): Promise<void> {
    try {
        const repo = AppDataSource.getRepository(JobMetric);
        const metric = repo.create({ ...input, finishedAt: null, compiledCount: null, errorsCount: null, errorMsg: null, durationMs: null });
        await repo.save(metric);
    } catch (err: any) {
        logger.error('Metrics', `Falha ao salvar métrica de job`, { jobId: input.jobId, error: err.message });
    }
}

export async function updateJobMetric(jobId: string, patch: {
    status: string;
    compiledCount?: number;
    errorsCount?: number;
    errorMsg?: string;
    durationMs?: number;
    finishedAt: Date;
}): Promise<void> {
    try {
        const repo = AppDataSource.getRepository(JobMetric);
        await repo.update({ jobId }, patch);
    } catch (err: any) {
        logger.error('Metrics', `Falha ao atualizar métrica de job`, { jobId, error: err.message });
    }
}
