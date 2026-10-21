import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { classify, runAgent } from '../src/agents.js';
import { Coach, prompts } from '../src/coach.js';
import { TaskStore } from '../src/tasks.js';
import { Memory } from '../src/memory.js';
import { defaultStageSettings } from '../src/models.js';
import { killTree } from '../src/platform.js';
import { pendingFeedback, validateFeedback } from '../src/feedback.js';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const fake = fileURLToPath(new URL('fixtures/fake-cli.mjs', import.meta.url));
process.env.AWC_CODEX_BIN = fake;
process.env.AWC_CLAUDE_BIN = fake;

test('spec 6: quota precedes login; HTTP 401 excludes commit hashes', () => {
  for (const quota of ['usage limit', 'rate limit', 'quota', '429', 'session limit']) {
    for (const login of ['Not logged in', '401 Unauthorized', 'Please run /login']) {
      assert.equal(classify(`${login}\n${quota}`)[0], 'AGENT_QUOTA');
    }
  }
  for (const text of ['401 Unauthorized', 'status 401', 'HTTP 401', 'status: 401', 'status=401']) {
    assert.equal(classify(text)[0], 'AGENT_NOT_LOGGED_IN', text);
  }
  for (const text of ['commit 401c870', 'status 401c870', 'HTTP 401c870', '401', '1401']) {
    assert.equal(classify(text)[0], 'AGENT_FAILED', text);
  }
  assert.equal(classify('Not logged in · Please run /login')[0], 'AGENT_NOT_LOGGED_IN');
});

test('spec 6: a signalled CLI ignores stale login output', async t => {
  process.env.FAKE_MODE = 'slow-login';
  t.after(() => delete process.env.FAKE_MODE);
  await assert.rejects(runAgent({ provider: 'claude', prompt: 'x', onSpawn: child => {
    child.stderr.once('data', () => child.kill('SIGTERM'));
  } }), { code: 'AGENT_INTERRUPTED' });
});

async function setup(t) {
  const root = await mkdtemp(path.join(process.cwd(), '.preview-flow-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new TaskStore(root);
  const coach = new Coach(store, () => ({ stages: defaultStageSettings() }), root, new Memory(path.join(root, 'memory')));
  return { root, store, coach };
}
const latest = async (store, id) => (await store.get(id)).task;
async function loginOutput(coach, id) {
  while (!coach.children.has(id)) await new Promise(resolve => setTimeout(resolve, 1));
  const child = coach.children.get(id);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fake CLI login output not received')), 5000);
    child.stderr.once('data', data => {
      clearTimeout(timer);
      try { assert.match(String(data), /401 Unauthorized/); resolve(); } catch (error) { reject(error); }
    });
  });
}

test('spec 6: user stop retains stopped despite CLI login output', async t => {
  const { store, coach } = await setup(t);
  process.env.FAKE_MODE = 'slow-login';
  t.after(() => delete process.env.FAKE_MODE);
  const run = await coach.create({ request: 'test', profile: 'quick' });
  await loginOutput(coach, run.task.id);
  await coach.stop(run.task.id);
  const result = await run.done;
  const task = await latest(store, run.task.id);
  assert.equal(result.error.code, 'AGENT_CANCELLED');
  assert.equal(task.planning.learningTurns.at(-1).status, 'stopped');
  assert.equal(task.planning.learningTurns.at(-1).errorCode, 'AGENT_CANCELLED');
  assert.equal(task.planning.stopped.stage, 'A');
  assert.equal(task.planning.running, null);
  await coach.recover();
  assert.equal((await latest(store, task.id)).planning.learningTurns.at(-1).status, 'stopped');
});

test('spec 6: server shutdown kill path retains unknown before restart recovery', async t => {
  const { store, coach } = await setup(t);
  process.env.FAKE_MODE = 'slow-login';
  t.after(() => delete process.env.FAKE_MODE);
  const run = await coach.create({ request: 'test', profile: 'quick' });
  await loginOutput(coach, run.task.id);
  const source = await read('src/server.js');
  assert.match(source, /await coach.recover\(\)/);
  assert.match(source, /const stopped = server.stopAgents\(\)/);
  const server = {};
  vm.runInNewContext(source.split('\n').find(line => line.includes('server.stopAgents =')), { server, coach, killTree });
  assert.equal(server.stopAgents(), 1);
  const result = await run.done;
  assert.equal(result.error.code, 'AGENT_INTERRUPTED');
  await coach.recover();
  const turn = (await latest(store, run.task.id)).planning.learningTurns.at(-1);
  assert.equal(turn.status, 'unknown');
  assert.equal(turn.errorCode, 'AGENT_INTERRUPTED');
});

test('spec 6: restart with pending stop or unfinished CLI preserves uncertainty', async t => {
  const { store, coach } = await setup(t);
  const created = await coach.create({ request: 'test', profile: 'quick' });
  await created.done;
  for (const stopping of [false, true]) {
    await store.mutate(created.task.id, 'latest', null, task => {
      const turn = task.planning.learningTurns.at(-1);
      Object.assign(turn, { status: 'running' });
      task.planning.running = { stage: 'D', workItemId: 'W1', agent: 'Codex', turnId: turn.id, startedAt: turn.startedAt, ...(stopping ? { stopping: { requestedAt: turn.startedAt } } : {}) };
      return { status: 'RUNNING' };
    });
    await coach.recover();
    const task = await latest(store, created.task.id);
    assert.equal(task.planning.running, null);
    assert.equal(task.planning.learningTurns.at(-1).status, 'unknown');
    assert.notEqual(task.planning.learningTurns.at(-1).errorCode, 'AGENT_NOT_LOGGED_IN');
    if (stopping) {
      assert.equal(task.planning.stopped.afterRestart, true);
      assert.equal(task.planning.stopped.itemId, 'W1');
    }
  }
});

test('spec 7: feedback display names preserve IDs, ref and send/skip payloads', async () => {
  const task = { id: 'T', planning: { feedback: [], workItems: ['W0', 'W1', 'R1'].map(id => ({ id, title: '成果', owner: 'ai', status: 'DONE', doneAt: '2026-10-10' })) } };
  task.feedbackPrompt = pendingFeedback(task);
  const original = structuredClone(task), calls = [];
  const node = (tag, text = '') => ({ tag, textContent: text, value: '', children: [], append(...nodes) { this.children.push(...nodes); }, setAttribute() {},
    querySelector: () => ({ value: '4' }), querySelectorAll: () => [{ value: '符合需求' }] });
  const ctx = vm.createContext({ element: node, focusKey: n => n, busy: (n, fn) => fn, coachAct: async (...args) => calls.push(args), tell() {} });
  vm.runInContext(await read('web/assets/item-names.js'), ctx);
  vm.runInContext(await read('web/assets/feedback.js'), ctx);
  const card = ctx.feedbackCard(task);
  const all = root => [root, ...root.children.flatMap(all)];
  assert.ok(all(card).some(n => n.textContent === '骨架版「成果」、第 1 項「成果」、第 2 輪「成果」'));
  await all(card).find(n => n.textContent === '送出回饋').onclick();
  await all(card).find(n => n.textContent === '這次不評').onclick();
  assert.deepEqual(task, original);
  assert.equal(calls[0][0], task);
  assert.equal(JSON.stringify(calls[0][2]), JSON.stringify({ ref: original.feedbackPrompt.ref, score: 4, tags: ['符合需求'], note: '' }));
  assert.equal(JSON.stringify(calls[1][2]), JSON.stringify({ ref: original.feedbackPrompt.ref, skipped: true }));
  const entry = validateFeedback(task, calls[0][2]).entry;
  assert.deepEqual(entry.items, ['W0', 'W1', 'R1']);
  assert.equal(entry.ref, original.feedbackPrompt.ref);
  assert.equal(entry.about, original.feedbackPrompt.about);
});

test('spec 8: C prompt separates read-only planning from writing work items', () => {
  const prompt = prompts.C({ planning: { profile: 'quick', card: {}, messages: [] } });
  assert.match(prompt, /本階段只讀檔案，不寫檔/);
  assert.match(prompt, /執行階段會在產出資料夾寫檔/);
  assert.match(prompt, /detail 與驗收條件（acceptance）.*不加入本階段的權限限制/);
  assert.match(prompt, /不要寫「目前不執行」或「需要可寫環境」/);
});
