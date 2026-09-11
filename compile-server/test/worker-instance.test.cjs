const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WorkerInstance } = require('../src/worker/worker-instance');
function fixture(t) {
    const reasons = [], sent = [];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-test-'));
    const socket = new EventEmitter();
    Object.assign(socket, { destroyed: false, setNoDelay() {}, write(data, encoding, callback) {
        sent.push(JSON.parse(data)); if (callback) callback(); return true;
    }, destroy() { this.destroyed = true; this.emit('close'); } });
    const worker = new WorkerInstance('w-test', 'Progress', {}, { port: 9095, jobTimeoutMs: 1000,
        startupTimeoutMs: 1000, heartbeatIntervalMs: 5000, heartbeatTimeoutMs: 1000 },
        { onRecycleRequest: (_, r) => reasons.push(r) });
    worker.attachSocket(socket);
    t.after(async () => { await worker.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
    const run = id => worker.executeJob(id, dir, path.join(dir,'report.json'), ['pasta/ação.p']);
    const done = (id, extra = {}) => socket.emit('data', Buffer.from(JSON.stringify({ action: 'DONE', jobId: id, success: true, ...extra }) + '\n'));
    return { worker, socket, dir, reasons, sent, run, done };
}
test('registered socket accepts work and manifest keeps unicode paths and source list', async t => {
    const { worker, sent, run, done } = fixture(t);
    assert.equal(worker.isReady(), true);
    const job = run('a');
    assert.equal(sent[0].action, 'COMPILE');
    assert.deepEqual(JSON.parse(fs.readFileSync(sent[0].requestPath, 'utf8')).sources, ['pasta/ação.p']);
    done('a'); await job; assert.equal(worker.isReady(), true);
});
test('wrong job id and fragmented messages cannot release an active worker', async t => {
    const { worker, run, done, socket } = fixture(t);
    const job = run('a'); done('old'); assert.equal(worker.state, 'busy');
    socket.emit('data', Buffer.from('{"action":"DONE","jobId":"a",'));
    assert.equal(worker.state, 'busy');
    socket.emit('data', Buffer.from('"success":true}\n')); await job;
    assert.equal(worker.jobCount, 1);
    done('a'); assert.equal(worker.jobCount, 1);
});
test('compiler error returns failure without recycling and next job can run', async t => {
    const { worker, run, done, reasons } = fixture(t);
    const job = run('a'); const failure = assert.rejects(job, /erro de teste/);
    done('a', { success: false, error: 'erro de teste' }); await failure;
    assert.deepEqual(reasons, []); assert.equal(worker.isReady(), true);
    const next = run('b'); done('b'); await next;
});
test('daily restart finishes active job exactly once before requesting replacement', async t => {
    const { worker, run, done, reasons } = fixture(t);
    const job = run('a'); worker.requestDailyRestart(); worker.requestDailyRestart();
    assert.deepEqual(reasons, []); done('a'); await job;
    assert.deepEqual(reasons, ['daily_restart']); assert.equal(worker.isReady(), false);
});
test('job timeout requests recovery only once despite socket closing', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const { worker, run, socket, reasons } = fixture(t);
    const rejected = assert.rejects(run('a'), /Timeout/);
    t.mock.timers.tick(1000); await rejected; socket.emit('close');
    assert.equal(reasons.length, 1); assert.equal(worker.isReady(), false);
});
test('heartbeat detects an idle worker that stops responding', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const { worker, socket, sent, reasons } = fixture(t);
    t.mock.timers.tick(5000); assert.equal(sent[0].action, 'PING');
    socket.emit('data', Buffer.from('{"action":"PONG"}\n'));
    t.mock.timers.tick(1000); assert.deepEqual(reasons, []);
    t.mock.timers.tick(4000); t.mock.timers.tick(1000);
    assert.deepEqual(reasons, ['heartbeat_timeout']); assert.equal(worker.isReady(), false);
});
test('registration accepts fragmented first frame', async t => {
    const { WorkerManager } = require('../src/worker/worker-manager');
    const { worker, socket } = fixture(t);
    await worker.kill(); // usa um worker novo ainda em starting
    const fresh = new WorkerInstance('w-new', 'Progress', {}, { port: 9095, jobTimeoutMs: 1000,
        startupTimeoutMs: 1000, heartbeatIntervalMs: 5000, heartbeatTimeoutMs: 1000 });
    const manager = new WorkerManager({ enabled: true, workersPerDb: 1 }, {});
    manager.allWorkersById.set('w-new', fresh);
    const incoming = new EventEmitter();
    Object.assign(incoming, { destroyed: false, setTimeout() {}, setNoDelay() {},
        destroy() { this.destroyed = true; this.emit('close'); }, write() {} });
    manager.handleIncomingSocket(incoming);
    incoming.emit('data', Buffer.from('{"action":"REGISTER",'));
    assert.equal(fresh.isReady(), false);
    incoming.emit('data', Buffer.from('"workerId":"w-new"}\n'));
    assert.equal(fresh.isReady(), true);
    await manager.shutdown();
});
test('spawn preserves UNC settings and replacement waits for process close', async t => {
    const cp = require('node:child_process');
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    let killed = 0, args;
    child.kill = () => { killed++; return true; };
    t.mock.method(cp, 'spawn', (_, received) => { args = received; return child; });
    const worker = new WorkerInstance('w-spawn', 'Progress', { pf: '//share/db.pf', ini: '//share/repo.ini' },
        { port: 9095, startupTimeoutMs: 60000, jobTimeoutMs: 1000, heartbeatIntervalMs: 5000, heartbeatTimeoutMs: 1000 });
    worker.start(); assert.ok(args.includes('//share/db.pf')); assert.ok(args.includes('//share/repo.ini'));
    let stopped = false; const stop = worker.kill().then(() => { stopped = true; });
    await Promise.resolve(); assert.equal(stopped, false); assert.equal(killed, 1);
    child.emit('close', 0, null); await stop; assert.equal(stopped, true);
});
test('startup without registration requests recovery', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const cp = require('node:child_process');
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.kill = () => { child.emit('close', 0); return true; };
    t.mock.method(cp, 'spawn', () => child);
    const reasons = [];
    const worker = new WorkerInstance('w-start', 'Progress', {}, { port: 9095, startupTimeoutMs: 1000,
        jobTimeoutMs: 1000, heartbeatIntervalMs: 5000, heartbeatTimeoutMs: 1000 },
        { onRecycleRequest: (_, reason) => reasons.push(reason) });
    worker.start(); t.mock.timers.tick(1000);
    assert.deepEqual(reasons, ['startup_timeout']); await worker.kill();
});
test('failed job settles only after Progress exits so temporary files can be removed safely', async t => {
    const cp = require('node:child_process');
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.kill = () => true;
    t.mock.method(cp, 'spawn', () => child);
    const { worker, socket, run } = fixture(t);
    // O fixture conecta direto; aqui também associamos um processo simulado real ao ciclo de vida.
    worker.start();
    let settled = false;
    const result = run('a').catch(error => { settled = true; return error; });
    socket.emit('close');
    const stopped = worker.kill();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    child.emit('close', 1); await stopped;
    assert.match((await result).message, /encerrada/);
});
test('EMS5 cold start registers through manager then compiles first queued request', async t => {
    const { WorkerManager } = require('../src/worker/worker-manager');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ems5-cold-'));
    let instance;
    t.mock.method(WorkerInstance.prototype, 'start', () => {});
    const manager = new WorkerManager({ enabled: true, port: 9095, workersPerDb: 1, prewarmDatabases: [], jobTimeoutMs: 30000 }, {},
        (...args) => { instance = new WorkerInstance(...args); return instance; });
    manager.isRunning = true;
    t.after(async () => { await manager.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
    const job = manager.dispatchJob('ems5-job', 'Progress', dir, path.join(dir, 'report.json'), ['a.p'], { repository: 'EMS5.08', pf: 'ems5.pf' });
    assert.equal(instance.state, 'starting');
    const sent = [], socket = new EventEmitter();
    Object.assign(socket, { destroyed: false, setTimeout() {}, setNoDelay() {},
        write(text, encoding, cb) { sent.push(JSON.parse(text)); cb?.(); },
        destroy() { this.destroyed = true; this.emit('close'); } });
    manager.handleIncomingSocket(socket);
    socket.emit('data', Buffer.from(JSON.stringify({ action: 'REGISTER', workerId: instance.id }) + '\n'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sent[0].action, 'COMPILE'); assert.equal(sent[0].jobId, 'ems5-job');
    socket.emit('data', Buffer.from('{"action":"DONE","jobId":"ems5-job","success":true}\n'));
    assert.equal((await job).success, true);
});
