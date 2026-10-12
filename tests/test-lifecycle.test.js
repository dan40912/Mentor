import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { requestApp, fakeAgent } from './fixtures/request.js';

async function until(check) {
  const deadline = Date.now() + 5000;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error('等待流程逾時');
    await new Promise(resolve => setImmediate(resolve));
  }
}

async function fixture(t, command = 'npm test') {
  const root = await mkdtemp(path.join(process.cwd(), '.test-lifecycle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [], runs = [];
  const executeFile = (file, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    runs.push({ file, args, options, finish(code, output) {
      child.stdout.emit('data', Buffer.from(output)); child.emit('close', code, null);
    } });
    return child;
  };
  let reviewCount = 0;
  const app = await requestApp(root, async input => {
    if (input.prompt.includes('「驗收」角色')) {
      const task = await app.coach.latest(id);
      calls.push({ stage: 'E', prompt: input.prompt, saved: structuredClone(task.planning.workItems[0]) });
      const pass = ++reviewCount > 1;
      return { text: JSON.stringify({ verdict: pass ? 'PASS' : 'FAIL', results: [{ criterion: '成果', result: pass ? 'PASS' : 'FAIL', evidence: '核對成果' }], fixes: pass ? [] : ['修正成果'] }) };
    }
    if (input.mode === 'write') {
      const task = await app.coach.latest(id);
      calls.push({ stage: task.planning.running.stage, prompt: input.prompt });
      return { text: 'STATUS: DONE\nFILES: result.txt\n未完成：\n```json\n{"changes":[]}\n```' };
    }
    return fakeAgent(input);
  }, { executeFile });
  // 此處測流程順序與 prompt，沿用原資料夾唯讀驗收，不建立外部暫存副本。
  app.coach.reviewCopy = async () => null;
  const created = await app.coach.create({ request: '測試生命週期', profile: 'quick' });
  await app.settle();
  const id = created.task.id;
  await app.coach.store.mutate(id, 'latest', null, task => {
    task.planning.phase = 'execute'; task.planning.card.testCommand = command;
    task.planning.outline = { storyline: '成果', logic: [], sections: [], imageTotal: 0 };
    task.planning.workItems = [{ id: 'W1', title: '成果', detail: '', owner: 'ai', acceptance: ['成果'], dependsOn: [], status: 'TODO', attempts: 0 }];
    return {};
  });
  const get = () => app.coach.latest(id);
  await writeFile(path.join((await get()).allowedRoots[0], 'result.txt'), '成果');
  return { app, id, get, calls, runs };
}

function checkSandbox(prompt) {
  assert.match(prompt, /Mentor server.*沙箱外/);
  assert.match(prompt, /監聽被拒.*不算阻擋.*不要因此回報 BLOCKED/);
  assert.match(prompt, /以 Mentor 保存的測試結果為準/);
  assert.match(prompt, /JSON 提供 testCommand/);
}

async function complete(f, stage, code, output) {
  const count = f.runs.length;
  const started = await f.app.coach.execute(f.id, 'W1', stage);
  await until(() => f.runs.length === count + 1);
  const task = await f.get();
  assert.equal(task.planning.running.stage, stage);
  assert.notEqual(task.planning.workItems[0].status, 'AWAITING_REVIEW');
  const eCount = f.calls.filter(c => c.stage === 'E').length;
  await assert.rejects(f.app.coach.review(f.id, 'W1'), { code: 'AGENT_BUSY' });
  assert.equal(f.calls.filter(c => c.stage === 'E').length, eCount);
  f.runs.at(-1).finish(code, output);
  assert.equal((await started.done).extra?.error, undefined);
  const saved = (await f.get()).planning.workItems[0];
  assert.equal(saved.status, 'AWAITING_REVIEW');
  assert.equal(saved.sensors.filter(s => s.id === 'test-command').length, 1);
  // 重新讀磁碟確認保存，再手動進 E。
  await (await f.app.coach.review(f.id, 'W1')).done;
  assert.deepEqual(f.calls.at(-1).saved.sensors, saved.sensors);
}

test('manual D and consecutive F wait for persisted current-round test evidence before E', async t => {
  const f = await fixture(t);
  await complete(f, 'D', 0, 'ROUND1 PASS\n');
  assert.match(f.calls.at(-1).prompt, /執行回合 1，D.*PASS/);
  await complete(f, 'F', 1, 'not ok 1 - 儲存結果\nROUND2 尾段原因\n');
  const fix1 = f.calls.find(c => c.stage === 'F');
  assert.match(fix1.prompt, /執行回合 1，D.*PASS/);
  const e2 = f.calls.at(-1).prompt;
  assert.match(e2, /執行回合 2，F.*FAIL/);
  assert.match(e2, /失敗測試：儲存結果/); assert.match(e2, /測試退出碼：1/); assert.match(e2, /ROUND2 尾段原因/);
  assert.doesNotMatch(e2, /ROUND1 PASS/);
  await f.app.coach.store.mutate(f.id, 'latest', null, task => { task.planning.workItems[0].status = 'REVIEW_FAIL'; return {}; });
  await complete(f, 'F', 0, 'ROUND3 PASS\n');
  const fix2 = f.calls.filter(c => c.stage === 'F').at(-1).prompt;
  assert.match(fix2, /執行回合 2，F.*FAIL/); assert.match(fix2, /失敗測試：儲存結果/); assert.match(fix2, /ROUND2 尾段原因/);
  assert.doesNotMatch(fix2, /ROUND1 PASS/);
  assert.match(f.calls.at(-1).prompt, /執行回合 3，F.*PASS/); assert.doesNotMatch(f.calls.at(-1).prompt, /ROUND2 尾段原因/);
  for (const c of f.calls.filter(c => c.stage !== 'E')) checkSandbox(c.prompt);
  assert.equal(f.runs[0].options.cwd, (await f.get()).allowedRoots[0]);
  assert.equal(f.runs[0].options.shell, false);
});

test('autopilot waits for both D and F tests; FAIL can enter E and next F uses that failure', async t => {
  const f = await fixture(t);
  await f.app.coach.setAutopilot(f.id, (await f.get()).revision, null, { on: true });
  await until(() => f.runs.length === 1);
  assert.deepEqual(f.calls.map(c => c.stage), ['D']);
  assert.equal((await f.get()).planning.running.stage, 'D');
  f.runs[0].finish(1, 'not ok 1 - 自動修正\nAUTO FAIL TAIL\n');
  await until(() => f.runs.length === 2);
  assert.deepEqual(f.calls.map(c => c.stage), ['D', 'E', 'F']);
  assert.equal((await f.get()).planning.running.stage, 'F');
  assert.equal(f.calls[1].saved.sensors.at(-1).result, 'FAIL');
  assert.equal(f.calls[1].saved.sensors.at(-1).attempt, 1);
  assert.match(f.calls[2].prompt, /失敗測試：自動修正/); assert.match(f.calls[2].prompt, /AUTO FAIL TAIL/);
  f.runs[1].finish(0, 'AUTO ROUND2 PASS\n');
  await until(async () => (await f.get()).planning.autopilot?.waitingFor?.kind === 'confirm');
  assert.deepEqual(f.calls.map(c => c.stage), ['D', 'E', 'F', 'E']);
  assert.equal(f.calls[3].saved.sensors.at(-1).result, 'PASS');
  assert.equal(f.calls[3].saved.sensors.at(-1).attempt, 2);
  assert.doesNotMatch(f.calls[3].prompt, /AUTO FAIL TAIL/);
  for (const c of f.calls.filter(c => c.stage !== 'E')) checkSandbox(c.prompt);
});

test('unset command replaces prior PASS with SKIP and still allows E', async t => {
  const f = await fixture(t, '');
  await f.app.coach.store.mutate(f.id, 'latest', null, task => {
    task.planning.workItems[0].sensors = [{ id: 'test-command', result: 'PASS', detail: 'STALE PASS' }]; return {};
  });
  await (await f.app.coach.execute(f.id, 'W1')).done;
  assert.equal(f.runs.length, 0);
  await (await f.app.coach.review(f.id, 'W1')).done;
  assert.equal(f.calls.at(-1).saved.sensors.at(-1).result, 'SKIP');
  assert.match(f.calls.at(-1).prompt, /未設定測試指令，未執行測試/);
  assert.match(f.calls.at(-1).prompt, /SKIP 表示未執行.*不可視為 PASS/);
  assert.doesNotMatch(f.calls.at(-1).prompt, /STALE PASS/);
});
