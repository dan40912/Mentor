import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { parseTestCommand } from '../src/test-command.js';
import { testCommandSensor, TEST_OUTPUT_BYTES } from '../src/sensors.js';
import { parseExecution } from '../src/coach.js';
import { requestApp, fakeAgent } from './fixtures/request.js';

function fakeExec({ chunks = [], exitCode = 0, error, signal, killed = false } = {}, calls = []) {
  return (file, args, options) => {
    calls.push({ file, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.killed = killed;
    queueMicrotask(() => {
      for (const [stream, text] of chunks) child[stream].emit('data', Buffer.from(text));
      if (error) child.emit('error', error);
      child.emit('close', exitCode, signal);
    });
    return child;
  };
}

test('command grammar preserves quoted/escaped arguments and rejects shell operators', () => {
  assert.deepEqual(parseTestCommand('node "a b.js" \'台灣 PM\' "" escaped\\ space'), ['node', 'a b.js', '台灣 PM', '', 'escaped space']);
  assert.deepEqual(parseTestCommand('node test.js \'a|b;$HOME\' "a>b"'), ['node', 'test.js', 'a|b;$HOME', 'a>b']);
  for (const command of ['npm test && echo ok', 'npm test | cat', 'npm test > out', 'npm test; pwd', 'node $(pwd)', 'node `pwd`', 'node "$HOME"', 'npm test\npwd', 'node "open', 'node trailing\\', 'X=1 node test.js', '"" test', 'node \0']) {
    assert.throws(() => parseTestCommand(command), { code: 'TEST_COMMAND_INVALID' }, command);
  }
});

test('executor passes argv, output directory, timeout and shell false; success is PASS', async () => {
  const calls = [];
  const result = await testCommandSensor('node "test file.js" --name "台灣 PM"', '/task/output', { executeFile: fakeExec({ chunks: [['stdout', 'all passed\n']] }, calls) });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { file: 'node', args: ['test file.js', '--name', '台灣 PM'], options: { cwd: '/task/output', timeout: 600000, shell: false, maxBuffer: Infinity } });
  assert.equal(result.id, 'test-command'); assert.equal(result.result, 'PASS');
  assert.equal(result.output, 'all passed\n'); assert.equal(result.summary, 'all passed');
});

test('nonzero exit extracts TAP and Node spec names; unknown names retain the gap and tail', async () => {
  const result = await testCommandSensor('npm test', '/out', { executeFile: fakeExec({ exitCode: 1, chunks: [['stdout', 'not ok 2 - 保存任'], ['stdout', '務\n✖ 編輯欄位 (2.51ms)\n'], ['stderr', '原因：欄位缺失\n']] }) });
  assert.equal(result.result, 'FAIL'); assert.equal(result.exitCode, 1);
  assert.deepEqual(result.failedTests, ['保存任務', '編輯欄位']);
  assert.match(result.detail, /保存任務/); assert.match(result.summary, /原因/);
  const unknown = await testCommandSensor('npm test', '/out', { executeFile: fakeExec({ exitCode: 2, chunks: [['stderr', 'unknown failure\n']] }) });
  assert.deepEqual(unknown.failedTests, []); assert.match(unknown.detail, /無法辨識/); assert.match(unknown.detail, /unknown failure/);
});

test('failure names handle interleaved streams and split UTF-8 chunks', async () => {
  const line = Buffer.from('not ok 1 - 測試名稱\n');
  const cut = Buffer.byteLength('not ok 1 - ') + 1;
  const result = await testCommandSensor('npm test', '/out', { executeFile: fakeExec({ exitCode: 1, chunks: [['stdout', line.subarray(0, cut)], ['stderr', 'debug\n'], ['stdout', line.subarray(cut)]] }) });
  assert.deepEqual(result.failedTests, ['測試名稱']);
});

test('startup failures, thrown executors and timeout are FAIL; missing command is SKIP', async () => {
  for (const executeFile of [fakeExec({ error: new Error('ENOENT'), exitCode: null }), () => { throw new Error('EACCES'); }]) {
    const result = await testCommandSensor('missing', '/out', { executeFile });
    assert.equal(result.result, 'FAIL'); assert.match(result.reason, /無法啟動/);
  }
  const timeout = await testCommandSensor('npm test', '/out', { executeFile: fakeExec({ exitCode: null, signal: 'SIGTERM', killed: true }) });
  assert.equal(timeout.result, 'FAIL'); assert.match(timeout.detail, /逾時/);
  const noRun = () => { throw new Error('must not run'); };
  for (const command of [undefined, '', '   ']) {
    const skipped = await testCommandSensor(command, '/out', { executeFile: noRun });
    assert.equal(skipped.result, 'SKIP'); assert.match(skipped.detail, /未執行/);
  }
  const rejected = await testCommandSensor('npm test && echo ok', '/out', { executeFile: noRun });
  assert.equal(rejected.result, 'FAIL'); assert.match(rejected.detail, /shell/);
});

test('large multibyte output stays within 64 KiB and summary has at most 50 lines', async () => {
  const result = await testCommandSensor('npm test', '/out', { executeFile: fakeExec({ exitCode: 1, chunks: [['stdout', 'not ok 1 - early failure\n'], ['stdout', Array.from({ length: 5000 }, (_, i) => `${i}：${'測'.repeat(40)}`).join('\n') + '\nLAST\n']] }) });
  assert.ok(Buffer.byteLength(result.output) <= TEST_OUTPUT_BYTES);
  assert.ok(result.summary.split('\n').length <= 50);
  assert.equal(result.truncated, true); assert.match(result.summary, /LAST$/);
  assert.deepEqual(result.failedTests, ['early failure']);
});

const report = data => `STATUS: DONE\nFILES: result.txt\n未完成：無\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\``;

test('execution report accepts testCommand, preserves omission and rejects invalid metadata', () => {
  assert.equal(parseExecution(report({ testCommand: 'npm test' })).testCommand, 'npm test');
  assert.equal(parseExecution(report({ testCommand: '' })).testCommand, '');
  assert.equal(parseExecution(report({})).testCommand, undefined);
  for (const value of [12, null, 'npm test | cat']) assert.match(parseExecution(report({ testCommand: value })).metadataError, /測試指令/);
});

test('card route reloads test command, rejects bad edits, and execution reports persist it', async t => {
  const root = await mkdtemp(path.join(process.cwd(), '.test-command-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let response = { testCommand: 'node "test file.js"' };
  const app = await requestApp(root, async input => input.mode === 'write' ? { text: report(response), provider: 'codex' } : fakeAgent(input), { executeFile: fakeExec() });
  const created = await app.coach.create({ request: '測試指令保存', profile: 'quick' }); await app.settle();
  const id = created.task.id;
  const get = async () => (await app.coach.store.get(id)).task;
  const session = await (await app.fetch('/api/session')).json();
  let seq = 0;
  const save = async card => app.fetch(`/api/tasks/${id}/card`, { method: 'POST', headers: { cookie: `awc=${session.csrfToken}`, 'x-csrf-token': session.csrfToken, 'idempotency-key': `test-command-${++seq}` }, body: JSON.stringify({ revision: (await get()).revision, card }) });
  const old = { ...(await get()).planning.card, audience: '', deliverable: '', success: [], constraints: [], unknowns: [] };
  assert.equal(old.testCommand, undefined); assert.equal((await save(old)).status, 200);
  const card = { ...old, testCommand: 'npm test' };
  assert.equal((await save(card)).status, 200);
  const reread = await requestApp(root);
  assert.equal((await reread.coach.store.get(id)).task.planning.card.testCommand, 'npm test');
  assert.equal((await save({ ...card, testCommand: 'npm test && pwd' })).status, 400);
  assert.equal((await save(old)).status, 200); assert.equal((await get()).planning.card.testCommand, 'npm test');
  await app.coach.store.mutate(id, 'latest', null, task => {
    task.planning.phase = 'execute'; task.planning.outline = { storyline: '測試', logic: [], sections: [], imageTotal: 0 };
    task.planning.workItems = [{ id: 'W1', title: '結果', detail: '', owner: 'ai', acceptance: [], dependsOn: [], status: 'TODO', attempts: 0 }]; return {};
  });
  await writeFile(path.join((await get()).allowedRoots[0], 'result.txt'), '成果');
  await (await app.coach.execute(id, 'W1')).done;
  assert.equal((await get()).planning.card.testCommand, response.testCommand);
  response = {};
  await app.coach.store.mutate(id, 'latest', null, task => { task.planning.workItems[0].status = 'REVIEW_FAIL'; return {}; });
  await (await app.coach.fix(id, 'W1')).done;
  assert.equal((await get()).planning.card.testCommand, 'node "test file.js"');
  const result = await testCommandSensor('npm test', (await get()).allowedRoots[0], { executeFile: fakeExec() });
  await app.coach.store.mutate(id, 'latest', null, task => { task.planning.workItems[0].sensors.push(result); return {}; });
  assert.equal((await (await requestApp(root)).coach.store.get(id)).task.planning.workItems[0].sensors.at(-1).result, 'PASS');
  assert.equal((await save({ ...card, testCommand: '' })).status, 200); assert.equal((await get()).planning.card.testCommand, '');
});

test('task card editor reads, edits and submits testCommand, with empty old-task default', async () => {
  const source = await readFile(new URL('../web/assets/upload.js', import.meta.url), 'utf8');
  const calls = [], jobs = [];
  const element = tag => ({ tag, children: [], append(...nodes) { this.children.push(...nodes); }, setAttribute() {} });
  const context = vm.createContext({ element, taskAttachmentPicker: () => ({ host: element('aside'), picker: { lock() {}, ids: async () => [], consume() {} } }), busy: (button, fn) => () => { const job = fn(); jobs.push(job); return job; }, coachAct: async (...args) => calls.push(args), openTask() {}, tell() {} });
  vm.runInContext(source.slice(source.indexOf('const cardDrafts')), context);
  const areas = form => form.children.filter(n => n.tag === 'label').map(n => n.children[1]);
  assert.equal(areas(context.cardEditor({ id: 'OLD', planning: { card: {} } }))[9].value, '');
  const form = context.cardEditor({ id: 'T', planning: { card: { title: '任務', goal: '驗證', testCommand: 'npm test' } } });
  assert.equal(areas(form)[9].value, 'npm test'); areas(form)[9].value = 'node "test file.js"';
  form.onsubmit({ preventDefault() {} }); await Promise.all(jobs);
  assert.equal(calls[0][2].card.testCommand, 'node "test file.js"');
});
