const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AppDataSource } = require('../src/db/data-source');
const { JobMetric } = require('../src/db/entities/JobMetric');
const { registerDashboardRoutes } = require('../src/dashboard/dashboard.routes');
test('filters jobs and aggregates with inclusive São Paulo dates', async t => {
  AppDataSource.setOptions({ database: ':memory:' });
  await AppDataSource.initialize();
  t.after(() => AppDataSource.destroy());
  await AppDataSource.getRepository(JobMetric).save([
    ['before', '2026-09-17T02:59:59Z', 'PC-1', 'Progress'],
    ['start', '2026-09-17T03:00:00Z', 'PC-1', 'Progress'],
    ['end', '2026-09-18T02:59:59Z', 'PC-1', 'Progress'],
    ['after', '2026-09-18T03:00:00Z', 'PC-1', 'Progress'],
    ['machine', '2026-09-17T12:00:00Z', 'PC-2', 'Progress'],
    ['database', '2026-09-17T12:00:00Z', 'PC-1', 'Oracle'],
  ].map(([jobId, date, machineName, dbType]) => ({ jobId, createdAt: new Date(date), machineName, dbType, status: 'done', filesCount: 2, durationMs: 1500 })));
  const routes = new Map();
  registerDashboardRoutes({ post() {}, get(path, ...handlers) { routes.set(path, handlers.at(-1)); } });
  async function get(path, query) {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await routes.get('/api/dashboard/' + path)({ query }, res);
    return res;
  }
  const query = { startDate: '2026-09-17', endDate: '2026-09-17', machineName: 'pc-1', dbType: 'Progress' };
  assert.deepEqual((await get('jobs', query)).body.jobs.map(j => j.jobId), ['end', 'start']);
  const metrics = (await get('metrics', query)).body;
  assert.equal(metrics.totalJobs, 2);
  assert.equal(metrics.totalFiles, 4);
  assert.equal(metrics.avgDurationMs, 1500);
  assert.equal(metrics.distinctMachines, 1);
  for (const key of ['byStatus', 'byMachine', 'byDatabase']) assert.equal(Number(metrics[key][0].count), 2);
  assert.equal((await get('jobs', {})).body.jobs.length, 6);
  assert.equal((await get('jobs', { machineName: '%' })).body.jobs.length, 0);
  for (const path of ['jobs', 'metrics']) {
    for (const invalid of [{ startDate: '2026-02-30' }, { startDate: ['2026-09-17'] }, { startDate: '2026-09-18', endDate: '2026-09-17' }]) assert.equal((await get(path, invalid)).code, 400);
    const empty = (await get(path, { machineName: 'missing' })).body;
    assert.equal(path === 'jobs' ? empty.jobs.length : empty.totalJobs, 0);
  }
});
