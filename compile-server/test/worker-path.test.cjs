const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ts = require('typescript');

for (const mode of ['dist', 'src']) {
    test(`worker locates daemon in ${mode === 'dist' ? 'dist/scripts' : 'scripts'} when running from ${mode}/worker`, async t => {
        const sourcePath = path.resolve(__dirname, '../src/worker/worker-instance.ts');
        const js = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
        }).outputText;
        const root = path.resolve('/tmp', 'deployment-with-spaces', 'compile server');
        const exports = {};
        const cp = require('node:child_process');
        const child = new EventEmitter();
        child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
        child.kill = () => { child.emit('close', 0); return true; };
        let spawnArgs;
        t.mock.method(cp, 'spawn', (_, args) => { spawnArgs = args; return child; });
        vm.runInNewContext(js, { exports, require: createRequire(sourcePath),
            __dirname: path.join(root, mode, 'worker'), process, setTimeout, clearTimeout, setInterval, clearInterval });
        const worker = new exports.WorkerInstance('path-test', 'Progress', {}, {
            port: 9095, startupTimeoutMs: 60000, jobTimeoutMs: 30000,
            heartbeatIntervalMs: 30000, heartbeatTimeoutMs: 10000
        });
        t.after(() => worker.kill());
        worker.start();
        const expected = mode === 'dist' ? path.join(root, 'dist/scripts/_worker_daemon.p')
            : path.join(root, 'scripts/_worker_daemon.p');
        assert.equal(spawnArgs[spawnArgs.indexOf('-p') + 1], expected);
    });
}
