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

// Keep the same filters for the summary and the recent jobs list.
function filteredJobs(req: Request, res: Response) {
    const values: Record<string, string> = {};
    for (const key of ['startDate', 'endDate', 'machineName', 'dbType', 'status']) {
        const value = req.query[key];
        if (value !== undefined && typeof value !== 'string') {
            res.status(400).json({ status: 'error', message: 'Filtro inválido.' });
            return null;
        }
        values[key] = (value as string | undefined)?.trim() || '';
    }
    for (const key of ['startDate', 'endDate']) {
        const value = values[key];
        if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
            !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) {
            res.status(400).json({ status: 'error', message: 'Informe uma data válida.' });
            return null;
        }
    }
    if (values.startDate && values.endDate && values.startDate > values.endDate) {
        res.status(400).json({ status: 'error', message: 'A data inicial deve ser anterior ou igual à data final.' });
        return null;
    }
    const query = AppDataSource.getRepository(JobMetric).createQueryBuilder('m');
    // Resolve local midnight through the IANA zone, including historical DST.
    function midnight(value: string, nextDay = false): Date {
        const day = new Date(value + 'T00:00:00Z');
        if (nextDay) day.setUTCDate(day.getUTCDate() + 1);
        const local = day.getTime();
        let utc = local;
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Sao_Paulo', timeZoneName: 'longOffset',
        });
        for (let i = 0; i < 3; i++) {
            const zone = formatter.formatToParts(new Date(utc)).find(p => p.type === 'timeZoneName')!.value;
            const match = /GMT([+-])(\d{2}):(\d{2})/.exec(zone);
            const offset = match ? (match[1] === '-' ? -1 : 1) * (+match[2] * 60 + +match[3]) : 0;
            utc = local - offset * 60000;
        }
        return new Date(utc);
    }
    if (values.startDate) query.andWhere('m.createdAt >= :start', { start: midnight(values.startDate) });
    if (values.endDate) query.andWhere('m.createdAt < :end', { end: midnight(values.endDate, true) });
    if (values.machineName) {
        query.andWhere('INSTR(LOWER(m.machineName), LOWER(:machineName)) > 0', { machineName: values.machineName });
    }
    if (values.dbType) query.andWhere('LOWER(m.dbType) = LOWER(:dbType)', { dbType: values.dbType });
    if (values.status) query.andWhere('m.status = :status', { status: values.status });
    return query;
}

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

    app.get('/api/dashboard/metrics', requireAuth, async (req: Request, res: Response) => {
        const query = filteredJobs(req, res);
        if (!query) return;

        const totalJobs = await query.clone().getCount();

        const byStatus = await query.clone()
            .select('m.status', 'status')
            .addSelect('COUNT(*)', 'count')
            .groupBy('m.status')
            .getRawMany();

        const byMachine = await query.clone()
            .select('m.machineName', 'machineName')
            .addSelect('COUNT(*)', 'count')
            .groupBy('m.machineName')
            .orderBy('count', 'DESC')
            .limit(10)
            .getRawMany();

        const byDatabase = await query.clone()
            .select('m.dbType', 'dbType')
            .addSelect('COUNT(*)', 'count')
            .groupBy('m.dbType')
            .orderBy('count', 'DESC')
            .getRawMany();

        const byRepository = await query.clone()
            .select("COALESCE(NULLIF(TRIM(m.repository), ''), 'Não informado')", 'repository')
            .addSelect('COUNT(*)', 'count')
            .groupBy("COALESCE(NULLIF(TRIM(m.repository), ''), 'Não informado')")
            .orderBy('count', 'DESC')
            .addOrderBy('repository', 'ASC')
            .getRawMany();

        const totals = await query.clone()
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
            byRepository,
            totalFiles: Number(totals?.totalFiles) || 0,
            avgDurationMs: Number(totals?.avgDurationMs) || 0,
            distinctMachines: Number(totals?.distinctMachines) || 0,
            avgFilesPerJob: Number(totals?.avgFilesPerJob) || 0,
        });
    });

    app.get('/api/dashboard/jobs', requireAuth, async (req: Request, res: Response) => {
        const query = filteredJobs(req, res);
        if (!query) return;
        const sortColumns: Record<string, string> = {
            jobId: 'm.jobId', status: 'm.status', machineName: 'm.machineName',
            ip: 'm.ip', filesCount: 'm.filesCount', dbType: 'm.dbType',
            repository: 'm.repository', durationMs: 'm.durationMs', createdAt: 'm.createdAt',
        };
        const sortBy = req.query.sortBy ?? 'createdAt';
        const sortOrder = req.query.sortOrder ?? 'DESC';
        const rawLimit = req.query.limit ?? '25';
        const rawPage = req.query.page ?? '1';
        if (typeof sortBy !== 'string' || !Object.prototype.hasOwnProperty.call(sortColumns, sortBy) ||
            (sortOrder !== 'ASC' && sortOrder !== 'DESC') ||
            typeof rawLimit !== 'string' || !/^\d+$/.test(rawLimit) ||
            typeof rawPage !== 'string' || !/^\d+$/.test(rawPage) ||
            !Number.isSafeInteger(Number(rawLimit)) || Number(rawLimit) < 1 ||
            !Number.isSafeInteger(Number(rawPage)) || Number(rawPage) < 1) {
            return res.status(400).json({ status: 'error', message: 'Paginação ou ordenação inválida.' });
        }
        const limit = Math.min(Number(rawLimit), 200);
        const total = await query.clone().getCount();
        const totalPages = Math.ceil(total / limit);
        const page = Math.min(Number(rawPage), Math.max(1, totalPages));
        const jobs = await query
            .orderBy(sortColumns[sortBy], sortOrder)
            .addOrderBy('m.id', sortOrder)
            .skip((page - 1) * limit)
            .take(limit)
            .getMany();

        res.json({ status: 'ok', jobs, total, page, limit, totalPages, sortBy, sortOrder });
    });
}
