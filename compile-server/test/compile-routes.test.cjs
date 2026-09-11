const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');
const flush = () => new Promise(resolve => setImmediate(resolve));

async function serverFixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compile-routes-'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.mkdirSync(path.join(dir, 'patches', '12.1.2024.1', 'Progress'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'server.config.json'), JSON.stringify({ defaultRepository: 'EMS2.08',
        workerPool: { enabled: true, port: 9095, workersPerDb: 1 },
        databases: { Progress: { pf: 'C:/db/{repository}/connect.pf', ini: 'C:/repo/{repository}/progress.ini' } },
        patchConfig: { baseDir: path.join(dir, 'patches'), baseShortcut: path.join(dir, 'shortcuts') }
    }));
    const routes = new Map(), scheduled = [], requests = [];
    let sockets;
    const app = { use() {}, post(route, handler) { routes.set('POST ' + route, handler); },
        get(route, handler) { routes.set('GET ' + route, handler); } };
    const express = () => app; express.static = () => () => {};
    class ControlledManager {
        async initialize() {}
        async shutdown() {}
        dispatchJob(jobId, dbType, baseTempPath, reportPath, sources, settings, onStart) {
            return new Promise((resolve, reject) => requests.push({ jobId, dbType, baseTempPath, reportPath, sources,
                settings, start: onStart, resolve, reject }));
        }
        getStatus() { return {}; }
        recycleAll() {}
    }
    const noOp = () => {};
    const dependencies = {
        dotenv: { config: noOp }, express, cors: () => noOp, 'body-parser': { json: () => noOp },
        uuid: { v4: randomUUID }, http: { createServer: () => ({ listen: (_, cb) => cb(), close: cb => cb() }) },
        ws: { WebSocketServer: class extends EventEmitter { constructor() { super(); sockets = this; } }, WebSocket: { OPEN: 1 } },
        './logger': { logger: { info: noOp, warn: noOp, error: noOp, debug: noOp, timed: noOp } },
        './db/data-source': { AppDataSource: { initialize: async () => {} } },
        './db/jobMetric.repository': { createJobMetric: noOp, updateJobMetric: noOp },
        './dashboard/dashboard.routes': { registerDashboardRoutes: noOp },
        './worker/worker-manager': { WorkerManager: ControlledManager },
        './worker/repository-context': require('../src/worker/repository-context')
    };
    const source = fs.readFileSync(path.join(__dirname, '../src/server.ts'), 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    vm.runInNewContext(js, { require(name) {
        if (name === 'child_process') throw new Error('A rota não pode abrir compiladores avulsos');
        return dependencies[name] || require(name);
    }, exports: {}, __dirname: path.join(dir, 'src'), Buffer, URL, console,
        setTimeout(fn) { scheduled.push(fn); },
        process: { env: {}, platform: 'win32', version: process.version, pid: 1, on: noOp,
            exit(code) { throw new Error('Server startup failed: ' + code); } }
    });
    await flush();
    async function drain() { while (scheduled.length) scheduled.shift()(); await flush(); }
    async function invoke(method, route, req = {}) {
        const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; } };
        await routes.get(method + ' ' + route)({ body: {}, ip: '127.0.0.1', ...req }, res);
        return res;
    }
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return { dir, requests, drain, invoke, connect(jobId) {
        const ws = new EventEmitter(); ws.readyState = 1; ws.messages = []; ws.send = text => ws.messages.push(JSON.parse(text));
        sockets.emit('connection', ws, { url: '/?jobId=' + jobId, headers: { host: 'localhost' } }); return ws;
    } };
}

test('POST /compile, queued/processing notifications and GET /result preserve contracts through worker', async t => {
    const { invoke, drain, requests, connect } = await serverFixture(t);
    const accepted = await invoke('POST', '/compile', { body: { dbType: 'Progress', repository: 'EMS5',
        files: [{ relativePath: 'pasta/ação.p', contentBase64: Buffer.from('MESSAGE "ok".').toString('base64') }] } });
    assert.equal(accepted.code, 202); assert.equal(accepted.body.status, 'queued');
    const id = accepted.body.jobId, ws = connect(id); await drain();
    assert.equal(requests.length, 1); assert.equal(requests[0].settings.pf, 'C:/db/EMS5/connect.pf');
    assert.equal(requests[0].settings.repository, 'EMS5');
    const queued = await invoke('GET', '/result/:jobId', { params: { jobId: id } });
    assert.equal(queued.code, 400); assert.match(queued.body.message, /queued/);
    const job = requests[0]; job.start(); assert.equal(ws.messages[0].status, 'processing');
    fs.writeFileSync(path.join(job.baseTempPath, 'resultado/pasta/ação.r'), 'rcode');
    fs.writeFileSync(job.reportPath, '\uFEFF' + JSON.stringify([{ file: 'pasta/ação.p', success: true, messages: [] }]));
    job.resolve({ success: true }); await drain();
    assert.equal(ws.messages[1].status, 'completed');
    const result = await invoke('GET', '/result/:jobId', { params: { jobId: id } });
    assert.equal(result.code, 200);
    assert.deepEqual(result.body, { status: 'completed', compiledFiles: [{ relativePath: 'pasta/ação.r', contentBase64: Buffer.from('rcode').toString('base64') }], errors: [] });
    assert.equal(fs.existsSync(job.baseTempPath), false);
    assert.equal((await invoke('GET', '/result/:jobId', { params: { jobId: id } })).code, 404);
});

test('Patch goes through worker with resolved context and missing report is job error', async t => {
    const { invoke, drain, requests } = await serverFixture(t);
    const accepted = await invoke('POST', '/compile', { body: { dbType: 'Patch', repository: 'EMS2.08',
        patchInfo: { patchVersion: '12.1.2024.1', subType: 'Progress' },
        files: [{ relativePath: 'a.p', contentBase64: '' }] } });
    assert.equal(accepted.code, 202); await drain(); assert.equal(requests.length, 1);
    const job = requests[0]; assert.equal(job.dbType, 'Patch'); assert.equal(job.settings.repository, 'EMS2.08'); assert.match(job.settings.pf, /connect-ems2\.pf$/);
    job.start(); job.resolve({ success: true }); await drain();
    const result = await invoke('GET', '/result/:jobId', { params: { jobId: accepted.body.jobId } });
    assert.equal(result.body.status, 'error'); assert.deepEqual(result.body.compiledFiles, []);
    assert.equal(requests.length, 1);
});

test('worker failure keeps result error contract without disposable fallback', async t => {
    const { invoke, drain, requests } = await serverFixture(t);
    const accepted = await invoke('POST', '/compile', { body: { dbType: 'Progress', files: [] } });
    await drain(); requests[0].start(); requests[0].reject(new Error('Progress desconectou')); await drain();
    const result = await invoke('GET', '/result/:jobId', { params: { jobId: accepted.body.jobId } });
    assert.equal(result.body.status, 'error'); assert.equal(result.body.message, 'Progress desconectou');
    assert.equal(requests.length, 1); assert.equal(fs.existsSync(requests[0].baseTempPath), false);
});
