import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TaskStore, serializeTask, parseTask, nextHumanAction, buildBrief, BRIEF_LIMIT, sha256 } from '../src/tasks.js';

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'awc-'));
  const allowed = path.join(dir, 'deck');
  await mkdir(allowed);
  const deck = path.join(allowed, 'deck.html');
  await writeFile(deck, 'v1');
  const task = {
    id: 'TASK-t1', revision: 1, status: 'BLOCKED', updatedAt: 'x', prelude: '\n# 標題\n\n', notes: '\n\n## 人工筆記\n原本的筆記\n',
    title: '測試任務', project: 'p', goal: '目標', workspace: { label: 'w', root: dir }, allowedRoots: [allowed],
    scope: { allowed: ['另存新版本'], locked: [{ text: 'P1 不要改', source: 'L1' }], forbidden: ['對外發布'] },
    current: { summary: '摘要', artifact: deck, sources: [{ provider: 'Codex', sessionId: 's', locator: 'L1' }] },
    decisions: [{ id: 'D1', status: 'OPEN', question: '以哪頁為準？', options: [{ id: 'a', label: 'A', cost: '' }, { id: 'b', label: 'B', cost: '' }] }],
    checks: [
      { id: 'C1', kind: 'artifact', label: '成果檔', path: deck, baselineSha: sha256('v1'), result: 'NOT_RUN', note: '' },
      { id: 'C2', kind: 'human', label: '版面', result: 'NOT_RUN', note: '' }
    ],
    facts: [{ label: '月活', value: '約 2,000 次', source: 'L2', verified: false }],
    learnings: [{ mistake: 'm', signal: 's', nextTime: 'n' }], parked: [], reports: [], next: '唯一下一步'
  };
  await writeFile(path.join(dir, 'TASK-t1.md'), serializeTask(task));
  return { dir, deck, allowed, store: new TaskStore(dir) };
}

test('round trip keeps human notes outside the generated block', async () => {
  const { dir, store } = await fixture();
  const file = path.join(dir, 'TASK-t1.md');
  await writeFile(file, (await readFile(file, 'utf8')) + '\n人後來補的一行\n');
  await store.decide('TASK-t1', 1, 'key-00001', { decisionId: 'D1', optionId: 'a' });
  const text = await readFile(file, 'utf8');
  assert.match(text, /原本的筆記/);
  assert.match(text, /人後來補的一行/);
  assert.equal(parseTask(text, 'TASK-t1.md').revision, 2);
});

test('stale revision is rejected and does not write', async () => {
  const { dir, store } = await fixture();
  const before = await readFile(path.join(dir, 'TASK-t1.md'), 'utf8');
  await assert.rejects(store.decide('TASK-t1', 0, 'key-00002', { decisionId: 'D1', optionId: 'a' }), { code: 'REVISION_CONFLICT', status: 409 });
  assert.equal(await readFile(path.join(dir, 'TASK-t1.md'), 'utf8'), before);
});

test('duplicate clicks with the same idempotency key change the task once', async () => {
  const { store } = await fixture();
  const [a, b] = await Promise.all([
    store.markCheck('TASK-t1', 1, 'key-00003', { checkId: 'C2', result: 'PASS' }),
    store.markCheck('TASK-t1', 1, 'key-00003', { checkId: 'C2', result: 'PASS' })
  ]);
  assert.equal(a.task.revision, 2);
  assert.equal(b.task.revision, 2);
  assert.equal((await store.get('TASK-t1')).task.revision, 2);
});

test('one human action, decisions first', async () => {
  const { store } = await fixture();
  let { task } = await store.get('TASK-t1');
  assert.equal(nextHumanAction(task).kind, 'decision');
  ({ task } = await store.decide('TASK-t1', 1, 'key-00004', { decisionId: 'D1', optionId: 'b' }));
  assert.equal(task.status, 'READY');
  assert.equal(nextHumanAction(task).id, 'C2');
});

test('artifact check detects a human edit and needs explicit baseline acceptance', async () => {
  const { store, deck } = await fixture();
  let { task } = await store.runCheck('TASK-t1', 1, 'key-00005', { checkId: 'C1' });
  assert.equal(task.checks[0].result, 'PASS');
  await writeFile(deck, 'v2 人改過');
  ({ task } = await store.runCheck('TASK-t1', 2, 'key-00006', { checkId: 'C1' }));
  assert.equal(task.checks[0].result, 'FAIL');
  assert.equal(task.status, 'BLOCKED');
  ({ task } = await store.runCheck('TASK-t1', 3, 'key-00007', { checkId: 'C1', acceptAsBaseline: true }));
  assert.equal(task.checks[0].result, 'PASS');
  assert.equal(task.checks[0].baselineSha, sha256('v2 人改過'));
});

test('artifact outside allowed roots is refused, including through symlinks', async () => {
  const { dir, store, allowed } = await fixture();
  const outside = path.join(dir, 'secret.txt');
  await writeFile(outside, 'secret');
  await symlink(outside, path.join(allowed, 'link.html'));
  const file = path.join(dir, 'TASK-t1.md');
  const task = parseTask(await readFile(file, 'utf8'), 'TASK-t1.md');
  task.checks[0].path = path.join(allowed, 'link.html');
  await writeFile(file, serializeTask(task));
  await assert.rejects(store.runCheck('TASK-t1', 1, 'key-00008', { checkId: 'C1' }), { code: 'PATH_OUTSIDE_ROOT' });
  task.checks[0].path = path.join(allowed, '..', 'secret.txt');
  await writeFile(file, serializeTask(task));
  await assert.rejects(store.runCheck('TASK-t1', 1, 'key-00009', { checkId: 'C1' }), { code: 'PATH_OUTSIDE_ROOT' });
});

test('DONE report does not complete the task; stale report is rejected', async () => {
  const { store } = await fixture();
  await store.decide('TASK-t1', 1, 'key-00010', { decisionId: 'D1', optionId: 'a' });
  await assert.rejects(store.report('TASK-t1', 2, 'key-00011', { text: 'TASK_ID: TASK-t1\nBASE_REVISION: 1\nSTATUS: DONE\n證據：x' }), { code: 'REPORT_STALE' });
  await assert.rejects(store.report('TASK-t1', 2, 'key-00014', { text: 'TASK_ID: TASK-t1\nBASE_REVISION: 2\nSTATUS: DONE\n完成事項：改了 P6' }), { code: 'REPORT_NO_EVIDENCE' });
  await assert.rejects(store.report('TASK-t1', 2, 'key-00015', { text: 'TASK_ID: TASK-t1\nBASE_REVISION: 2\nSTATUS: DONE\nSTATUS: BLOCKED\n證據：x' }), { code: 'REPORT_FORMAT' });
  const { task } = await store.report('TASK-t1', 2, 'key-00012', { text: 'TASK_ID: TASK-t1\nBASE_REVISION: 2\nSTATUS: DONE\n完成事項：改了 P6\n證據：P6 截圖' });
  assert.equal(task.status, 'AWAITING_ACCEPTANCE');
  assert.ok(task.checks.every(c => c.result === 'NOT_RUN'));
  await assert.rejects(store.accept('TASK-t1', 3, 'key-00013'), { code: 'ACCEPTANCE_INCOMPLETE' });
});

test('brief stays within 8,000 characters and keeps constraints and open decisions', async () => {
  const { store } = await fixture();
  const { task } = await store.get('TASK-t1');
  task.learnings = Array.from({ length: 200 }, (_, i) => ({ mistake: `很長的教訓 ${i}`.repeat(5), nextTime: 'x' }));
  const brief = buildBrief(task, 'codex');
  assert.ok(brief.chars <= BRIEF_LIMIT);
  for (const text of ['P1 不要改', '對外發布', '以哪頁為準？', '約 2,000 次', 'BASE_REVISION: 1', '唯一下一步']) assert.ok(brief.text.includes(text), text);
});

test('idempotency key reused for a different operation is refused', async () => {
  const { store } = await fixture();
  await store.markCheck('TASK-t1', 1, 'key-00020', { checkId: 'C2', result: 'PASS' });
  await assert.rejects(store.markCheck('TASK-t1', 1, 'key-00020', { checkId: 'C2', result: 'FAIL' }), { code: 'IDEMPOTENCY_KEY_REUSED' });
});

test('"ask someone first" keeps the task blocked until a real decision', async () => {
  const { dir, store } = await fixture();
  const file = path.join(dir, 'TASK-t1.md');
  const task = parseTask(await readFile(file, 'utf8'), 'TASK-t1.md');
  task.decisions[0].options[0].waits = true;
  await writeFile(file, serializeTask(task));
  let result = await store.decide('TASK-t1', 1, 'key-00021', { decisionId: 'D1', optionId: 'a' });
  assert.equal(result.task.status, 'BLOCKED');
  assert.equal(result.task.decisions[0].status, 'WAITING');
  result = await store.decide('TASK-t1', 2, 'key-00022', { decisionId: 'D1', optionId: 'b', note: '對方回覆以 B 為準' });
  assert.equal(result.task.decisions[0].status, 'DECIDED');
  assert.equal(result.task.decisions[0].history.length, 2);
});

test('direct human edit of the state block bumps the effective revision', async () => {
  const { dir, store } = await fixture();
  const file = path.join(dir, 'TASK-t1.md');
  await writeFile(file, (await readFile(file, 'utf8')).replace('"goal": "目標"', '"goal": "人改過的目標"'));
  const { task } = await store.get('TASK-t1');
  assert.equal(task.revision, 2);
  await assert.rejects(store.decide('TASK-t1', 1, 'key-00023', { decisionId: 'D1', optionId: 'a' }), { code: 'REVISION_CONFLICT' });
  const result = await store.decide('TASK-t1', 2, 'key-00024', { decisionId: 'D1', optionId: 'a' });
  assert.equal(result.task.goal, '人改過的目標');
  assert.equal((await store.get('TASK-t1')).task.revision, 3);
});

test('report with a new ARTIFACT rebinds checks, and acceptance re-verifies the file', async () => {
  const { store, allowed } = await fixture();
  await store.decide('TASK-t1', 1, 'key-00030', { decisionId: 'D1', optionId: 'a' });
  const v2 = path.join(allowed, 'deck_v2.html');
  await writeFile(v2, 'v2');
  let { task } = await store.report('TASK-t1', 2, 'key-00031', { text: `TASK_ID: TASK-t1\nBASE_REVISION: 2\nSTATUS: DONE\nARTIFACT: ${v2}\n證據：P6 截圖` });
  assert.ok(task.checks[0].path.endsWith('deck_v2.html'));
  ({ task } = await store.runCheck('TASK-t1', 3, 'key-00032', { checkId: 'C1' }));
  ({ task } = await store.markCheck('TASK-t1', 4, 'key-00033', { checkId: 'C2', result: 'PASS', note: '看過' }));
  await writeFile(v2, 'v2 被改了');
  await assert.rejects(store.accept('TASK-t1', 5, 'key-00034'), { code: 'ACCEPTANCE_INCOMPLETE' });
  const outside = path.join(path.dirname(allowed), 'outside-report.txt');
  await writeFile(outside, 'outside');
  await assert.rejects(store.report('TASK-t1', 5, 'key-00035', { text: `TASK_ID: TASK-t1\nBASE_REVISION: 5\nSTATUS: DONE\nARTIFACT: ${outside}\n證據：x` }), { code: 'PATH_OUTSIDE_ROOT' });
});

test('task file symlinks are refused', async () => {
  const { dir, store } = await fixture();
  await symlink(path.join(dir, 'TASK-t1.md'), path.join(dir, 'TASK-link.md'));
  await assert.rejects(store.get('TASK-link'), { code: 'TASK_SYMLINK' });
});
