import { Express, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { login } from '../auth/auth.service';
import { requireAuth } from '../auth/auth.middleware';
import { AppDataSource } from '../db/data-source';
import { JobMetric } from '../db/entities/JobMetric';
import { logger } from '../logger';

const loginRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', message: 'Muitas tentativas de login. Tente novamente mais tarde.' },
});

export function registerDashboardRoutes(app: Express): void {
    app.post('/api/auth/login', loginRateLimiter, async (req: Request, res: Response) => {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ status: 'error', message: 'Usuário e senha são obrigatórios.' });
        }

        try {
            const token = await login(username, password);
            if (!token) {
                logger.warn('Auth', 'Tentativa de login falhou', { username, ip: req.ip });
                return res.status(401).json({ status: 'error', message: 'Usuário ou senha inválidos.' });
            }
            logger.info('Auth', 'Login bem-sucedido', { username });
            res.json({ status: 'ok', token });
        } catch (err: any) {
            logger.error('Auth', 'Erro ao processar login', { error: err.message });
            res.status(500).json({ status: 'error', message: 'Erro interno ao processar login.' });
        }
    });

    app.get('/api/dashboard/metrics', requireAuth, async (_req: Request, res: Response) => {
        const repo = AppDataSource.getRepository(JobMetric);

        const totalJobs = await repo.count();

        const byStatus = await repo
            .createQueryBuilder('m')
            .select('m.status', 'status')
            .addSelect('COUNT(*)', 'count')
            .groupBy('m.status')
            .getRawMany();

        const byMachine = await repo
            .createQueryBuilder('m')
            .select('m.machineName', 'machineName')
            .addSelect('COUNT(*)', 'count')
            .groupBy('m.machineName')
            .orderBy('count', 'DESC')
            .limit(10)
            .getRawMany();

        const byDatabase = await repo
            .createQueryBuilder('m')
            .select('m.dbType', 'dbType')
            .addSelect('COUNT(*)', 'count')
            .groupBy('m.dbType')
            .orderBy('count', 'DESC')
            .getRawMany();

        const totals = await repo
            .createQueryBuilder('m')
            .select('SUM(m.filesCount)', 'totalFiles')
            .addSelect('AVG(m.durationMs)', 'avgDurationMs')
            .addSelect("COUNT(DISTINCT NULLIF(m.machineName, ''))", 'distinctMachines')
            .addSelect('AVG(m.filesCount)', 'avgFilesPerJob')
            .getRawOne();

        res.json({
            status: 'ok',
            totalJobs,
            byStatus,
            byMachine,
            byDatabase,
            totalFiles: Number(totals?.totalFiles) || 0,
            avgDurationMs: Number(totals?.avgDurationMs) || 0,
            distinctMachines: Number(totals?.distinctMachines) || 0,
            avgFilesPerJob: Number(totals?.avgFilesPerJob) || 0,
        });
    });

    app.get('/api/dashboard/jobs', requireAuth, async (req: Request, res: Response) => {
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const status = req.query.status as string | undefined;

        const repo = AppDataSource.getRepository(JobMetric);
        const where = status ? { status } : {};

        const jobs = await repo.find({
            where,
            order: { createdAt: 'DESC' },
            take: limit,
        });

        res.json({ status: 'ok', jobs });
    });
}
