const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const context = vm.createContext({ sessionStorage: { getItem: () => 'token' }, document: { getElementById: () => ({ addEventListener() {} }) } });
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/dashboard/public/dashboard.js'), 'utf8');
vm.runInContext(source.replace(/loadDashboard\(\);\s*$/, ''), context);
test('IP masking handles IPv4, mapped IPv4 and IPv6 without exposing host addresses', () => {
  assert.equal(typeof context.maskIp, 'function');
  for (const [input, expected] of [['192.168.1.25', '192.168.*.*'], ['::ffff:192.168.1.25', '192.168.*.*'], ['2001:db8::1234', '2001:db8:*:*:*:*:*:*'], ['::1', '*:*:*:*:*:*:*:*'], [null, '—'], ['invalid', '***']]) assert.equal(context.maskIp(input), expected);
});
test('duration preserves zero and distinguishes missing timings', () => {
  assert.equal(typeof context.formatDuration, 'function');
  for (const [input, expected] of [[null, '—'], [undefined, '—'], [0, '0 ms'], [250, '250 ms'], [1500, '1,5 s'], [61000, '1 min 1 s'], [3600000, '1 h 0 min 0 s']]) assert.equal(context.formatDuration(input), expected);
});
