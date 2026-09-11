const { test } = require('node:test');
const assert = require('node:assert/strict');
const { workerContextKey } = require('../src/worker/worker-manager');
test('repositories never share sessions even with identical PF/INI', () => {
 const keys = ['EMS2.08', 'FND1.02', 'CRM'].map(repository => workerContextKey('Progress', {
  repository, pf: 'C:/shared/connect.pf', ini: 'C:/shared/progress.ini'
 }));
 assert.equal(new Set(keys).size, 3);
});
const { resolveRepositorySettings, resolvePrewarmContexts } = require('../src/worker/repository-context');
test('prewarm and on-demand resolve identical settings for EMS2 FND and CRM', () => {
 const config = {
  workerPool: { prewarmDatabases: ['Progress'], prewarmRepositories: ['EMS2.08','FND1.02','CRM'] },
  databases: { Progress: { pf: 'C:/{repository}/connect.pf', ini: 'C:/{repository}/progress.ini' } }
 };
 const contexts = resolvePrewarmContexts(config);
 assert.equal(contexts.length, 3);
 for (const context of contexts) {
  assert.deepEqual(context.settings, resolveRepositorySettings(config, 'Progress', context.settings.repository));
  assert.equal(context.settings.pf, `C:/${context.settings.repository}/connect.pf`);
 }
 assert.equal(config.databases.Progress.pf, 'C:/{repository}/connect.pf');
});
test('repository override uses own INI and inherits common PF without mutating other repositories', () => {
 const config = { databases: { Progress: { pf: 'shared.pf', ini: '{repository}.ini' } },
  repositories: { CRM: { databases: { Progress: { ini: 'crm-special.ini' } } } } };
 assert.deepEqual(resolveRepositorySettings(config, 'Progress', 'CRM'), { repository: 'CRM', pf: 'shared.pf', ini: 'crm-special.ini' });
 assert.equal(resolveRepositorySettings(config, 'Progress', 'FND1.02').ini, 'FND1.02.ini');
 assert.equal(resolveRepositorySettings(config, 'missing', 'CRM'), undefined);
});
test('repositories outside prewarm remain supported on demand', () => {
 const config = { databases: { Oracle: { pf: '{repository}.pf' } } };
 assert.equal(resolveRepositorySettings(config, 'Oracle', 'HCM2.11A').pf, 'HCM2.11A.pf');
});
