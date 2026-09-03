const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCompileLog } = require('../src/db/job-log.parser');

test('consolida um job concluido a partir dos eventos do log', () => {
    const log = [
        '2026-09-03 11:44:48: [9/3/2026, 11:44:48 AM] [INFO] [API]  POST /compile recebido | filesCount=1 dbType="Progress" repository="EMS2.08" hasPatchInfo=false machineName="JVN060106755" ip="::ffff:10.173.80.66"',
        '2026-09-03 11:44:48: [9/3/2026, 11:44:48 AM] [INFO] [API]  Job criado e enfileirado | jobId="24e6bdb5-28a3-48d3-ba20-2bb3baff69d1" machineName="JVN060106755" filesCount=1 files=["ftp/api/v1/svDanfeCom.p"] dbType="Progress" queueSize=1 activeJobs=0',
        '2026-09-03 11:44:59: [9/3/2026, 11:44:59 AM] [INFO] [Queue]  Job finalizado com sucesso | jobId="24e6bdb5-28a3-48d3-ba20-2bb3baff69d1" compiledFiles=1 errors=0 durationMs=11166',
    ].join('\n');

    assert.deepEqual(parseCompileLog(log), [{
        jobId: '24e6bdb5-28a3-48d3-ba20-2bb3baff69d1',
        status: 'completed',
        machineName: 'JVN060106755',
        ip: '::ffff:10.173.80.66',
        filesCount: 1,
        ablSourcesCount: 1,
        dbType: 'Progress',
        repository: 'EMS2.08',
        compiledCount: 1,
        errorsCount: 0,
        errorMsg: null,
        durationMs: 11166,
        createdAt: new Date('2026-09-03T11:44:48'),
        finishedAt: new Date('2026-09-03T11:44:59'),
    }]);
});

test('preserva job pendente quando o log nÆo possui evento de t‚rmino', () => {
    const log = [
        '2026-09-03 11:48:11: [9/3/2026, 11:48:11 AM] [INFO] [API]  POST /compile recebido | filesCount=3 dbType="SQL Server" repository="EMS2.08" hasPatchInfo=false machineName="JVN060105685" ip="::ffff:10.80.72.132"',
        '2026-09-03 11:48:11: [9/3/2026, 11:48:11 AM] [INFO] [API]  Job criado e enfileirado | jobId="2c2cabb1-f8e4-4df7-86a6-e96223fa2bea" machineName="JVN060105685" filesCount=3 files=["cep/ce0423.w","cep/ce0423rp.p","cep/ce0423a.p"] dbType="SQL Server" queueSize=1 activeJobs=0',
    ].join('\n');

    const [job] = parseCompileLog(log);
    assert.equal(job.status, 'queued');
    assert.equal(job.compiledCount, null);
    assert.equal(job.finishedAt, null);
    assert.equal(job.ablSourcesCount, 3);
});
