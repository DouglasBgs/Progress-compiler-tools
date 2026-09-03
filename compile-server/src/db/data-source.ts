import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as path from 'path';
import { JobMetric } from './entities/JobMetric';

export const AppDataSource = new DataSource({
    type: 'better-sqlite3',
    database: path.join(__dirname, '..', '..', 'data', 'dashboard.sqlite'),
    entities: [JobMetric],
    synchronize: true,
    logging: false,
});
