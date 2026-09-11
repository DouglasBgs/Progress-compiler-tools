const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WorkerManager, nextDailyRestart } = require('../src/worker/worker-manager');
const flush = () => new Promise(resolve => setImmediate(resolve));

function pool(t, count = 2, readyImmediately = true) {
    const created = [];
    const factory = (id, dbType, settings, options, callbacks) => {
        const worker = {
            id, dbType, dbSettings: settings, state: 'starting', jobCount: 0, lastUsedAt: Date.now(),
            startedAt: Date.now(), pendingRestart: false, jobs: [],
            isReady() { return this.state === 'idle' && !this.pendingRestart; },
            start() { if (readyImmediately) this.ready(); },
            ready() { this.state = 'idle'; callbacks.onStateChange(this); },
            executeJob(jobId) {
                assert.equal(this.isReady(), true, 'busy workers must never receive another job');
                this.state = 'busy'; this.jobs.push(jobId);
                return new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
            },
            finish() {
                this.jobCount++; this.resolve({ success: true });
                if (this.pendingRestart) callbacks.onRecycleRequest(this, 'daily_restart');
                else { this.state = 'idle'; callbacks.onStateChange(this); }
            },
            requestDailyRestart() {
                if (this.pendingRestart) return;
                this.pendingRestart = true;
                if (this.state !== 'busy') callbacks.onRecycleRequest(this, 'daily_restart');
            },
            fail() { this.reject?.(new Error('process exited')); callbacks.onRecycleRequest(this, 'process_exit'); },
            async kill() { this.state = 'stopped'; this.reject?.(new Error('shutdown')); }
        };
        created.push(worker); return worker;
    };
    const manager = new WorkerManager({ enabled: true, port: 9095, workersPerDb: count, prewarmDatabases: [], jobTimeoutMs: 30000 }, {}, factory);
    manager.isRunning = true;
    t.after(() => manager.shutdown());
    const submit = (id, settings = { pf: 'C:/db/main.pf', ini: 'C:/repo/main.ini' }, db = 'Progress') =>
        manager.dispatchJob(id, db, '/tmp/' + id, '/tmp/' + id + '/report.json', ['a.p'], settings);
    return { manager, created, submit };
}

test('parallel requests reserve distinct workers, overflow waits FIFO and sessions are reused', async t => {
    const { created, submit } = pool(t);
    const jobs = ['a', 'b', 'c', 'd'].map(id => submit(id));
    await flush();
    assert.equal(created.length, 2);
    assert.deepEqual(created.map(w => w.jobs), [['a'], ['b']]);
    created[0].finish(); await flush();
    assert.deepEqual(created[0].jobs, ['a', 'c']);
    created[1].finish(); await flush();
    assert.deepEqual(created[1].jobs, ['b', 'd']);
    created.forEach(w => w.finish()); await Promise.all(jobs);
    assert.equal(created.length, 2);
});

test('same db with different PF/INI and Patch use separate persistent contexts', async t => {
    const { created, submit } = pool(t, 1);
    const jobs = [submit('a'), submit('b', { pf: 'C:/db/main.pf', ini: 'C:/repo/other.ini' }),
        submit('c', { pf: 'C:/patch/1.pf' }, 'Patch'), submit('d', { pf: 'C:/patch/2.pf' }, 'Patch')];
    await flush(); assert.equal(created.length, 4);
    assert.deepEqual(created.map(w => w.jobs), [['a'], ['b'], ['c'], ['d']]);
    created.forEach(w => w.finish()); await Promise.all(jobs);
});

test('02h restart drains active work and queued jobs wait for replacement', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date(2026, 8, 10, 1, 59).getTime() });
    const { manager, created, submit } = pool(t, 1);
    const a = submit('a'), b = submit('b'); await flush();
    manager.scheduleDailyRestart(); t.mock.timers.tick(60000);
    assert.equal(created.length, 1); assert.deepEqual(created[0].jobs, ['a']);
    created[0].finish(); await a; await flush();
    t.mock.timers.tick(1000); await flush();
    assert.equal(created.length, 2); assert.deepEqual(created[1].jobs, ['b']);
    created[1].finish(); await b;
    t.mock.timers.tick(60000); await flush(); assert.equal(created.length, 2);
    manager.shutdown(); t.mock.timers.reset();
});

test('process failure rejects its job, recovers worker and preserves queued job', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
    const { created, submit, manager } = pool(t, 1);
    const a = submit('a'); const rejected = assert.rejects(a, /process exited/);
    const b = submit('b'); await flush(); created[0].fail();
    await rejected; await flush(); t.mock.timers.tick(1000); await flush();
    assert.equal(created.length, 2); assert.deepEqual(created[1].jobs, ['b']);
    created[1].finish(); await b; manager.shutdown(); t.mock.timers.reset();
});

test('shutdown rejects running and queued requests', async t => {
    const { submit, manager } = pool(t, 1);
    const a = assert.rejects(submit('a'), /shutdown|encerrad/i);
    const b = assert.rejects(submit('b'), /shutdown|encerrad/i);
    await flush(); await manager.shutdown(); await Promise.all([a,b]);
});

test('next restart is server-local 02h including month rollover', () => {
    for (const [now, expected] of [[new Date(2026,8,10,1,59), new Date(2026,8,10,2)],
        [new Date(2026,8,10,2), new Date(2026,8,11,2)], [new Date(2026,8,30,23), new Date(2026,9,1,2)]]) {
        assert.equal(nextDailyRestart(now).getTime(), expected.getTime());
    }
});
test('repository queues stay isolated even when sharing the same PF and INI', async t => {
 const { created, submit } = pool(t, 1);
 const settings = repository => ({ repository, pf: 'shared.pf', ini: 'shared.ini' });
 const jobs = [submit('ems-a', settings('EMS2.08')), submit('ems-b', settings('EMS2.08')),
  submit('fnd', settings('FND1.02')), submit('crm', settings('CRM'))];
 await flush(); assert.equal(created.length, 3);
 assert.deepEqual(created.map(w => w.jobs), [['ems-a'], ['fnd'], ['crm']]);
 created.forEach(w => w.finish()); await flush();
 assert.deepEqual(created[0].jobs, ['ems-a', 'ems-b']);
 created[0].finish(); await Promise.all(jobs);
});
test('new repositories create instances while existing idle and busy workers remain online', async t => {
    const { manager, created, submit } = pool(t, 1);
    const settings = repository => ({ repository, pf: 'shared.pf', ini: 'shared.ini' });
    const emsJob = submit('ems-first', settings('EMS2.08'));
    await flush();
    const emsWorker = created[0];
    emsWorker.finish(); await emsJob; await flush();
    assert.equal(emsWorker.state, 'idle');

    const fndJob = submit('fnd-first', settings('FND1.02'));
    await flush();
    const fndWorker = created[1];
    assert.equal(emsWorker.state, 'idle');
    assert.equal(fndWorker.state, 'busy');

    // HUB não está em nenhuma lista de prewarm: deve abrir sob demanda.
    const hubJob = submit('hub-first', settings('HUB'));
    await flush();
    assert.equal(created.length, 3);
    assert.equal(emsWorker.state, 'idle');
    assert.equal(fndWorker.state, 'busy');
    assert.deepEqual(created[2].jobs, ['hub-first']);
    assert.equal(manager.getStatus().totalWorkers, 3);

    const emsNext = submit('ems-next', settings('EMS2.08'));
    await flush();
    assert.equal(created.length, 3);
    assert.deepEqual(emsWorker.jobs, ['ems-first', 'ems-next']);
    created.forEach(worker => worker.finish());
    await Promise.all([fndJob, hubJob, emsNext]);
    assert.ok(created.every(worker => worker.isReady()));
});
test('cold context dispatches queued job when registration arrives later', async t => {
 const { submit, created } = pool(t, 1, false);
 const job = submit('cold'); await flush();
 assert.deepEqual(created[0].jobs, []);
 created[0].ready(); await flush();
 assert.deepEqual(created[0].jobs, ['cold']); created[0].finish(); await job;
});
test('context that never registers returns error instead of waiting forever', async t => {
 t.mock.timers.enable({ apis: ['setTimeout'] });
 const { submit, manager } = pool(t, 1, false);
 let error;
 const job = submit('cold').catch(e => { error = e; });
 await flush(); t.mock.timers.tick(60000); await flush();
 assert.match(error?.message || '', /indisponível.*60000/);
 await job; assert.equal(manager.getStatus().contexts[0].queued, 0);
});
test('busy healthy worker does not impose startup timeout on normal queue', async t => {
 t.mock.timers.enable({ apis: ['setTimeout'] });
 const { submit, created } = pool(t, 1);
 const first = submit('first'); const second = submit('second');
 await flush(); t.mock.timers.tick(120000); await flush();
 assert.deepEqual(created[0].jobs, ['first']);
 created[0].finish(); await first; await flush();
 assert.deepEqual(created[0].jobs, ['first', 'second']); created[0].finish(); await second;
});
