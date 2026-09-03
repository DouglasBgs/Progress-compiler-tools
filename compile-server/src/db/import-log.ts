import * as fs from 'fs';
import * as path from 'path';
import { AppDataSource } from './data-source';
import { JobMetric } from './entities/JobMetric';
import { parseCompileLog } from './job-log.parser';

const logPath = process.argv[2];

if (!logPath) {
    console.error('Uso: npm run logs:import -- <caminho-do-output.log>');
    process.exit(1);
}

const resolvedLogPath = path.resolve(logPath);

if (!fs.existsSync(resolvedLogPath)) {
    console.error(`Arquivo de log não encontrado: ${resolvedLogPath}`);
    process.exit(1);
}

async function importLog(): Promise<void> {
    const jobs = parseCompileLog(fs.readFileSync(resolvedLogPath, 'utf8'));
    const repository = AppDataSource.getRepository(JobMetric);
    let inserted = 0;
    let updated = 0;

    for (const job of jobs) {
        const existing = await repository.findOneBy({ jobId: job.jobId });
        await repository.save(existing ? { ...existing, ...job } : repository.create(job));
        if (existing) {
            updated++;
        } else {
            inserted++;
        }
    }

    console.log(`Importação concluída: ${inserted} inserido(s), ${updated} atualizado(s), ${jobs.length} job(s) lido(s).`);
}

AppDataSource.initialize()
    .then(importLog)
    .then(() => AppDataSource.destroy())
    .catch(async (err) => {
        console.error('Falha ao importar o histórico de compilação:', err);
        if (AppDataSource.isInitialized) {
            await AppDataSource.destroy();
        }
        process.exit(1);
    });
