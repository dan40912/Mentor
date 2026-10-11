import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaskStore, planningAction } from '../src/tasks.js';
import { Coach } from '../src/coach.js';
import { defaultStageSettings } from '../src/models.js';
import { Memory } from '../src/memory.js';
import { Trash } from '../src/trash.js';

// 任務控制：停止這次執行、繼續、補充指示、回收桶。全部用假 CLI，不耗額度。
const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-cli.mjs');
process.env.AWC_CODEX_BIN = fake;
process.env.AWC_CLAUDE_BIN = fake;

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'awc-control-'));
  const store = new TaskStore(dir);
  const settings = { revision: 1, stages: { ...defaultStageSettings(), E: { provider: 'claude', modelId: 'sonnet', effort: 'high' } } };
  const memory = new Memory(path.join(dir, 'memory'));
  const coach = new Coach(store, () => settings, dir, memory);
  return { dir, store, memory, coach, trash: new Trash(dir, store, coach) };
}
const latest = async (store, id) => (await store.get(id)).task;
const exists = file => access(file).then(() => true, () => false);
const mode = value => { if (value) process.env.FAKE_MODE = value; else delete process.env.FAKE_MODE; };
const waitFor = async (check, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return true; await new Promise(r => setTimeout(r, 50)); } return false; };

// 走到大綱已確認、W1 可執行。
async function toExecute(ctx, project = '') {
  const { store, coach } = ctx;
  mode();
  const created = await coach.create({ request: '我要做一份新品簡報給主管', profile: 'quick', project });
  await created.done;
  let task = await latest(store, created.task.id);
  await (await coach.answer(task.id, task.revision, `k-a-${task.id}`, { message: '十頁' })).done;
  await (await coach.draftOutline(task.id)).done;
  task = await latest(store, task.id);
  return (await coach.approveOutline(task.id, task.revision, `k-ap-${task.id}`)).task;
}

test('stop during A is confirmed only after the CLI exits, then resume redoes A and chains B', async () => {
  const { store, coach } = await setup();
  mode('slow');
  const created = await coach.create({ request: '我要做一份新品簡報給主管', profile: 'quick' });
  const id = created.task.id;
  assert.ok(await waitFor(() => coach.children.has(id)), 'CLI 已啟動');
  const stopping = await coach.stop(id);
  assert.equal(stopping.stopping, true);
  assert.ok(stopping.task.planning.running.stopping, '先標正在停止');
  assert.equal(planningAction(stopping.task).kind, 'stopping');
  // 重複按停止不會再送訊號或出錯
  assert.equal((await coach.stop(id)).stopping, true);
  assert.throws(() => coach.plan(stopping.task, { text: '先寫的補充' }), { code: 'AGENT_STOPPING' });
  // instruct 可能先遇到 pending 鎖，或讀到正在停止；兩個階段都必須阻擋寫入。
  await assert.rejects(coach.instruct(id, stopping.task.revision, 'k-busy', { text: '先寫的補充' }), error => ['AGENT_BUSY', 'AGENT_STOPPING'].includes(error.code));
  await created.done;
  let task = await latest(store, id);
  assert.equal(task.planning.running, null);
  assert.equal(task.planning.stopped.stage, 'A');
  assert.equal(task.planning.learningTurns.at(-1).status, 'stopped');
  assert.equal(planningAction(task).kind, 'stopped');
  assert.equal(task.status, 'BLOCKED');
  assert.ok(!task.planning.card.title, 'A 沒完成，不假裝有任務卡');
  const events = (await coach.events(id)).map(e => e.type);
  assert.ok(events.includes('STOP_REQUESTED') && events.includes('STAGE_STOPPED'));

  mode();
  const { plan } = await coach.instruct(id, task.revision, 'k-dry', { text: '讀者改成協理', dryRun: true });
  assert.equal(plan.route, 'resume');
  assert.match(plan.impact, /重新制定任務卡/);
  // 接續一定要先看影響摘要
  await assert.rejects(coach.instruct(id, task.revision, 'k-noconfirm', { text: '讀者改成協理' }), { code: 'CONFIRM_IMPACT' });
  const resumed = await coach.instruct(id, task.revision, 'k-resume', { text: '讀者改成協理', confirmImpact: true });
  await resumed.done;
  task = await latest(store, id);
  assert.equal(task.planning.stopped, null);
  assert.ok(task.planning.card.title);
  assert.deepEqual(task.planning.learningTurns.map(t => `${t.stage}:${t.status}`), ['A:stopped', 'A:completed', 'B:completed']);
  assert.match(task.planning.learningTurns[1].prompt, /接續說明/);
  assert.match(task.planning.learningTurns[1].prompt, /讀者改成協理/);
  assert.equal(task.planning.instructions[0].route, 'resume');
});

test('stopping D keeps partial files as unverified, item stays TODO, resume checks files first', async () => {
  const ctx = await setup();
  const { store, coach } = ctx;
  let task = await toExecute(ctx);
  mode('slow');
  const run = await coach.execute(task.id, 'W1');
  assert.ok(await waitFor(() => coach.children.has(task.id)));
  assert.ok(await waitFor(() => exists(path.join(task.allowedRoots[0], 'partial.html'))));
  await coach.stop(task.id);
  await run.done;
  task = await latest(store, task.id);
  const w1 = task.planning.workItems.find(w => w.id === 'W1');
  assert.equal(w1.status, 'TODO', '寫一半的檔案不算完成');
  assert.deepEqual(w1.outputs, []);
  assert.deepEqual(task.planning.stopped.changed, ['partial.html']);
  assert.equal(task.planning.stopped.itemId, 'W1');
  assert.ok(await exists(path.join(task.allowedRoots[0], 'partial.html')), '部分檔案保留');
  mode();
  const resumed = await coach.resume(task.id, task.revision, 'k-r');
  await resumed.done;
  task = await latest(store, task.id);
  assert.equal(task.planning.workItems.find(w => w.id === 'W1').status, 'AWAITING_REVIEW');
  assert.match(task.planning.learningTurns.at(-1).prompt, /partial\.html/);
  // 同一個 key 重送只執行一次
  await assert.rejects(coach.resume(task.id, task.revision, 'k-r'), error => ['IDEMPOTENCY_KEY_REUSED', 'NOT_STOPPED', 'TEXT_REQUIRED'].includes(error.code) || error.status === 409 || error.status === 400);
});

test('a CLI that will not exit is marked unconfirmed and blocks removal until close', async () => {
  const ctx = await setup();
  const { store, coach, trash } = ctx;
  mode('hang');
  process.env.FAKE_HANG_MS = '4000';
  const created = await coach.create({ request: '我要做一份新品簡報給主管', profile: 'quick' });
  const id = created.task.id;
  assert.ok(await waitFor(() => coach.children.has(id)));
  await new Promise(r => { const out = coach.children.get(id).stderr; out.on('data', b => { if (String(b).includes('HANG_READY')) r(); }); });
  await coach.stop(id, { graceMs: 100, confirmMs: 300 });
  assert.ok(await waitFor(async () => (await latest(store, id)).planning.running?.stopping?.unconfirmed, 2000), '超過時間仍未確認結束');
  const pending = await latest(store, id);
  assert.match(planningAction(pending).label, /尚未確認停止/);
  await assert.rejects(trash.trashTask(id), { code: 'TASK_STOPPING' });
  await created.done;
  const task = await latest(store, id);
  assert.equal(task.planning.stopped.stage, 'A');
  assert.equal(task.planning.running, null);
  mode(); delete process.env.FAKE_HANG_MS;
});

test('supplementary instructions route by state: answer, outline change, fix, replan with impact, new round', async () => {
  const ctx = await setup();
  const { store, coach } = ctx;
  mode();
  const created = await coach.create({ request: '我要做一份新品簡報給主管', profile: 'quick' });
  await created.done;
  let task = await latest(store, created.task.id);
  const id = task.id;
  await assert.rejects(coach.instruct(id, task.revision, 'k-long', { text: 'x'.repeat(6001) }), { code: 'TEXT_TOO_LONG' });
  await assert.rejects(coach.instruct(id, task.revision, 'k-empty', { text: '  ' }), { code: 'TEXT_REQUIRED' });
  // 等待回答：直接送出，不問影響
  await (await coach.instruct(id, task.revision, 'k-ans', { text: '十頁' })).done;
  task = await latest(store, id);
  assert.equal(task.planning.readyForOutline, true);
  await (await coach.draftOutline(id)).done;
  task = await latest(store, id);
  // 等待大綱確認：同一個輸入區送修改意見
  await (await coach.instruct(id, task.revision, 'k-ol', { text: '第二段先寫結論' })).done;
  task = await latest(store, id);
  assert.equal(task.planning.outline.version, 2);
  assert.equal(task.planning.outline.feedback, '第二段先寫結論');
  task = (await coach.approveOutline(id, task.revision, 'k-ap')).task;
  // 待執行項目：補充後直接執行，補充寫進提示
  await (await coach.instruct(id, task.revision, 'k-ex', { text: '標題用深藍色', scope: 'W1' })).done;
  task = await latest(store, id);
  assert.equal(task.planning.workItems[0].status, 'AWAITING_REVIEW');
  assert.match(task.planning.learningTurns.at(-1).prompt, /標題用深藍色/);
  await (await coach.review(id, 'W1')).done;
  task = await latest(store, id);
  assert.equal(task.planning.workItems[0].status, 'REVIEWED');
  // 等待驗收：送修改指示，交給修改並重新驗收
  await (await coach.instruct(id, task.revision, 'k-fix', { text: '第一頁加上日期', scope: 'W1' })).done;
  task = await latest(store, id);
  const w1 = task.planning.workItems[0];
  assert.equal(w1.status, 'AWAITING_REVIEW', '修改後要重新驗收');
  assert.ok(w1.fixes.includes('第一頁加上日期'));
  assert.equal(task.planning.learningTurns.at(-1).stage, 'F');
  // 修改已確認大綱：要看影響、重新確認，已完成且沒變的項目保留
  await (await coach.review(id, 'W1')).done;
  task = await latest(store, id);
  task = (await coach.confirm(id, task.revision, 'k-c1', { itemId: 'W1', accept: true })).task;
  await assert.rejects(coach.instruct(id, task.revision, 'k-rp0', { text: '多一段競品', scope: 'outline' }), error => error.code === 'CONFIRM_IMPACT' && /重新擬定/.test(error.message) && /第 1 項/.test(error.message));
  await (await coach.instruct(id, task.revision, 'k-rp', { text: '多一段競品', scope: 'outline', confirmImpact: true, reason: '主管要比較' })).done;
  task = await latest(store, id);
  assert.equal(task.planning.phase, 'outline', '改了核定大綱要重新確認');
  assert.equal(task.planning.workItems.find(w => w.id === 'W1').status, 'DONE', '內容沒變的已完成項目保留');
  assert.equal(task.planning.instructions.at(-1).reason, '主管要比較');
  task = (await coach.approveOutline(id, task.revision, 'k-ap2')).task;
  task = (await coach.confirm(id, task.revision, 'k-c2', { itemId: 'W2', note: '數據到位' })).task;
  assert.equal(task.planning.phase, 'done');
  // 已完成：追加指示建立新一輪，不覆寫舊紀錄
  await assert.rejects(coach.instruct(id, task.revision, 'k-round0', { text: '再做英文版' }), { code: 'CONFIRM_IMPACT' });
  await (await coach.instruct(id, task.revision, 'k-round', { text: '再做英文版', confirmImpact: true })).done;
  task = await latest(store, id);
  assert.equal(task.planning.phase, 'execute');
  assert.equal(task.planning.workItems.find(w => w.id === 'W1').status, 'DONE');
  const round = task.planning.workItems.find(w => w.id === 'R1');
  assert.equal(round.status, 'AWAITING_REVIEW');
  const events = (await coach.events(id)).filter(e => e.type === 'INSTRUCTION').map(e => e.route);
  assert.deepEqual(events, ['answer', 'outline', 'execute', 'fix', 'replan', 'round']);
});

test('trash keeps outputs, blocks running and depended tasks, restore stays stopped, purge needs the exact name', async () => {
  const ctx = await setup();
  const { dir, store, coach, trash } = ctx;
  let task = await toExecute(ctx);
  mode('slow');
  const run = await coach.execute(task.id, 'W1');
  assert.ok(await waitFor(() => coach.children.has(task.id)));
  await assert.rejects(trash.trashTask(task.id), { code: 'TASK_RUNNING' });
  assert.ok(await waitFor(() => exists(path.join(task.allowedRoots[0], 'partial.html'))));
  await coach.stop(task.id);
  await run.done;
  mode();
  task = await latest(store, task.id);
  // 依賴阻擋
  const other = await toExecute(ctx);
  const otherFile = path.join(dir, other.file);
  const text = await readFile(otherFile, 'utf8');
  await store.mutate(other.id, other.revision, null, t => { t.dependsOnTasks = [task.id]; });
  await assert.rejects(trash.trashTask(task.id), error => error.code === 'TASK_DEPENDED' && error.extra.dependents[0].id === other.id);
  await store.mutate(other.id, 'latest', null, t => { t.dependsOnTasks = []; });
  assert.ok(text);

  const { trashed } = await trash.trashTask(task.id, { reason: '重複建立' });
  assert.equal(trashed.kind, 'task');
  assert.ok(trashed.files.includes(`${task.id}.md`) && trashed.files.includes(`events/${task.id}.jsonl`));
  assert.ok(!(await store.list()).some(t => t.id === task.id));
  assert.ok(await exists(path.join(task.allowedRoots[0], 'partial.html')), '產出檔案保留');
  await assert.rejects(coach.execute(task.id, 'W1'), { code: 'TASK_NOT_FOUND' });
  assert.equal((await trash.list())[0].name, task.title);

  const restored = await trash.restore(trashed.id);
  assert.equal(restored.restored.id, trashed.id);
  const back = await latest(store, task.id);
  assert.equal(back.planning.stopped.stage, 'D', '還原後保持停止，不自動呼叫 AI');
  assert.equal(back.planning.running, null);
  assert.ok((await coach.events(task.id)).some(e => e.type === 'TASK_RESTORED'));

  const again = (await trash.trashTask(task.id)).trashed;
  await assert.rejects(trash.purge(again.id, { confirm: '新品' }), { code: 'CONFIRM_MISMATCH' });
  const purged = await trash.purge(again.id, { confirm: again.name });
  assert.equal(purged.purged.id, again.id);
  assert.deepEqual(await trash.list(), []);
  assert.ok(await exists(path.join(task.allowedRoots[0], 'partial.html')), '永久刪除紀錄也不動產出');
  await assert.rejects(trash.restore(again.id), { code: 'TRASH_NOT_FOUND' });
});

test('project trash moves brief, rules and all tasks; pauses its rules; blocks while a task runs', async () => {
  const ctx = await setup();
  const { dir, store, coach, trash, memory } = ctx;
  await memory.append('project', 'Demo', '取捨', '口徑先問Demo團隊', 'test');
  await memory.append('team', null, '取捨', '團隊規則保留', 'test');
  await mkdir(path.join(dir, 'projects', 'Demo'), { recursive: true });
  await writeFile(path.join(dir, 'projects', 'Demo', 'brief.json'), JSON.stringify({ id: 'Demo', name: 'Demo', slides: [] }));
  const a = await toExecute(ctx, 'Demo');
  const b = await toExecute(ctx, 'Demo');
  assert.match(await memory.rules('Demo'), /口徑先問/);
  mode('slow');
  const run = await coach.execute(a.id, 'W1');
  assert.ok(await waitFor(() => coach.children.has(a.id)));
  const summary = await trash.projectSummary('Demo');
  assert.deepEqual([summary.total, summary.running], [2, 1]);
  await assert.rejects(trash.trashProject('Demo'), error => error.code === 'PROJECT_RUNNING' && /2 個任務，其中 1 個執行中/.test(error.message));
  await coach.stop(a.id);
  await run.done;
  mode();
  const { trashed } = await trash.trashProject('Demo');
  assert.deepEqual(trashed.taskIds.sort(), [a.id, b.id].sort());
  assert.ok(trashed.rulesPaused);
  assert.ok(!(await memory.rules('Demo')).includes('口徑先問'), '專案規則暫停帶入');
  assert.match(await memory.rules('Demo'), /團隊規則保留/);
  assert.equal((await store.list()).length, 0);
  assert.ok(!(await exists(path.join(dir, 'projects', 'Demo'))));
  await assert.rejects(trash.trashProject('未分類'), { code: 'PROJECT_INVALID' });
  await trash.restore(trashed.id);
  assert.match(await memory.rules('Demo'), /口徑先問/, '還原時恢復專案規則');
  assert.equal((await store.list()).length, 2);
  assert.ok(await exists(path.join(dir, 'projects', 'Demo', 'brief.json')));
  const files = await readdir(dir);
  assert.ok(files.includes('trash'));
});

test('retry after a filtered Grill can switch AI for one run without changing settings', async () => {
  const { store, coach } = await setup();
  mode('malformed-a');
  const created = await coach.create({ request: '我要做一份新品簡報給主管', profile: 'quick' });
  await created.done;
  let task = await latest(store, created.task.id);
  assert.equal(task.planning.learningTurns.at(-1).status, 'failed');
  const failedAgent = task.planning.learningTurns.at(-1).provider;
  assert.equal(task.nextAction?.kind ?? (await store.list())[0].nextAction.kind, 'retry');
  mode();
  const other = failedAgent === 'claude' ? 'codex' : 'claude';
  await assert.rejects(coach.retry(task.id, task.revision, 'k-bad-provider', 'nope'), { code: 'PROVIDER_INVALID' });
  task = await latest(store, task.id);
  const started = await coach.retry(task.id, task.revision, 'k-alt-retry-1', other);
  await started.done;
  task = await latest(store, task.id);
  const turns = task.planning.learningTurns;
  assert.ok(turns.length >= 3);
  assert.equal(turns.find(t => t.status === 'completed').provider, other, '這一次改用另一個 AI');
  assert.ok(task.planning.card.title, '重試後任務卡完成，接著 B 提問');
  assert.equal(coach.settings().stages.A.provider, defaultStageSettings().A.provider, '角色設定沒有被改');
  // 同一個 key 換 provider 視為不同操作
  await assert.rejects(async () => coach.retry(task.id, task.revision, 'k-alt-retry-1', 'copilot'), { code: 'IDEMPOTENCY_KEY_REUSED' });
});

// ── 一路做到完 ──
const waitIdle = async (coach, store, id, ms = 15000) => waitFor(async () => { const t = await latest(store, id); return !coach.drivers.has(id) && !coach.pending.has(id) && !t.planning.running; }, ms);

test('autopilot runs A→B and parks at the question, resumes after the answer, parks at outline approval', async () => {
  const { store, coach } = await setup();
  mode();
  const created = await coach.create({ request: '我要做一份新品簡報給主管', profile: 'quick', autopilot: true });
  const id = created.task.id;
  await created.done;
  assert.ok(await waitIdle(coach, store, id));
  let task = await latest(store, id);
  assert.equal(task.planning.autopilot.waitingFor.kind, 'answer');
  assert.match(task.planning.autopilot.waitingFor.label, /回答 AI 的 1 個問題/);
  // 使用者回答後，不必再按任何按鈕就接到擬大綱
  await (await coach.answer(id, task.revision, 'k-auto-answer', { message: '十頁，主管要當場決定' })).done;
  coach.resumeAuto(id);
  assert.ok(await waitFor(async () => (await latest(store, id)).planning.autopilot?.waitingFor?.kind === 'approve', 15000));
  task = await latest(store, id);
  assert.equal(task.planning.phase, 'outline');
  assert.deepEqual(task.planning.learningTurns.map(t => t.stage), ['A', 'B', 'B', 'C']);
  // 確認大綱 → 自動做 D、E，停在「確認成果」
  await coach.approveOutline(id, task.revision, 'k-auto-approve');
  coach.resumeAuto(id);
  assert.ok(await waitFor(async () => (await latest(store, id)).planning.autopilot?.waitingFor?.kind === 'confirm', 15000));
  task = await latest(store, id);
  assert.equal(task.planning.workItems.find(w => w.id === 'W1').status, 'REVIEWED');
  assert.deepEqual(task.planning.learningTurns.slice(-2).map(t => t.stage), ['D', 'E']);
  // 一次確認 AI 驗收通過的項目，之後停在由你完成的項目
  await coach.confirmAll(id, task.revision, 'k-auto-confirm-all');
  coach.resumeAuto(id);
  assert.ok(await waitFor(async () => (await latest(store, id)).planning.autopilot?.waitingFor?.kind === 'human', 15000));
  task = await latest(store, id);
  assert.match(task.planning.autopilot.waitingFor.label, /提供數據/);
  await coach.confirm(id, task.revision, 'k-auto-human', { itemId: 'W2', note: '完成' });
  coach.resumeAuto(id);
  assert.ok(await waitFor(async () => !(await latest(store, id)).planning.autopilot, 15000));
  task = await latest(store, id);
  assert.equal(task.planning.phase, 'done');
});

test('full autopilot approves the outline itself and records it; failing reviews are fixed twice then parked', async () => {
  const { store, coach } = await setup();
  mode('review-fail');
  const created = await coach.create({ request: '我要做一份新品簡報給主管十頁', profile: 'quick', autopilot: true, full: true });
  const id = created.task.id;
  await created.done;
  // fake B 對「十頁」直接 ready，所以一路到驗收失敗
  assert.ok(await waitFor(async () => (await latest(store, id)).planning.autopilot?.waitingFor?.kind === 'fix-limit', 30000));
  const task = await latest(store, id);
  assert.deepEqual(task.planning.learningTurns.map(t => t.stage).join(''), 'ABCDEFEFE');
  assert.equal(task.planning.autopilot.fixRounds.W1, 2);
  assert.ok((await coach.events(id)).some(e => e.type === 'GATE_AUTO_APPROVED'));
  assert.match(task.planning.autopilot.waitingFor.label, /自動修了 2 輪/);
  mode();
});

test('full autopilot lets AI-passed items unlock the next ones and asks you once at the end; plain autopilot still waits', async () => {
  const { store, coach } = await setup();
  mode();
  const created = await coach.create({ request: '我要做一份新品簡報給主管十頁', profile: 'standard', autopilot: true, full: true });
  const id = created.task.id;
  await created.done;
  // standard 會補骨架 W0，W1 依賴 W0。完全自動時 W0 驗收通過就接著做 W1，兩項一起等你確認。
  assert.ok(await waitFor(async () => (await latest(store, id)).planning.autopilot?.waitingFor?.kind === 'confirm', 30000));
  let task = await latest(store, id);
  assert.deepEqual(task.planning.workItems.filter(i => i.owner === 'ai').map(i => `${i.id}:${i.status}`), ['W0:REVIEWED', 'W1:REVIEWED']);
  assert.match(task.planning.autopilot.waitingFor.label, /確認 2 項/);
  assert.match(task.planning.learningTurns.find(t => t.stage === 'D' && t.workItemId === 'W1').prompt, /已完成的其他項目與檔案：\n- 骨架版/);
  // 退回骨架時，已經用它做下去的 W1 標成待核對
  task = (await coach.confirm(id, task.revision, 'k-unlock-1', { itemId: 'W0', accept: false, note: '封面要換' })).task;
  assert.match(task.planning.workItems.find(i => i.id === 'W1').recheck, /骨架版 被退回/);
  await coach.setAutopilot(id, task.revision, 'k-unlock-2', { on: false });
  // 一般自動模式：W0 通過後就停下等你確認
  const plain = await coach.create({ request: '我要做一份新品簡報給主管十頁', profile: 'standard', autopilot: true });
  await plain.done;
  assert.ok(await waitFor(async () => (await latest(store, plain.task.id)).planning.autopilot?.waitingFor?.kind === 'approve', 15000));
  task = await latest(store, plain.task.id);
  await coach.approveOutline(task.id, task.revision, 'k-unlock-3');
  coach.resumeAuto(task.id);
  assert.ok(await waitFor(async () => (await latest(store, plain.task.id)).planning.autopilot?.waitingFor?.kind === 'confirm', 15000));
  task = await latest(store, plain.task.id);
  assert.deepEqual(task.planning.workItems.filter(i => i.owner === 'ai').map(i => `${i.id}:${i.status}`), ['W0:REVIEWED', 'W1:TODO']);
});

test('autopilot parks on AI failure with the reason, can resume with another AI, and ends when you stop it', async () => {
  const { store, coach } = await setup();
  mode('filter-zero');
  const created = await coach.create({ request: '我要做一份新品簡報給主管', profile: 'quick', autopilot: true });
  const id = created.task.id;
  await created.done;
  assert.ok(await waitFor(async () => (await latest(store, id)).planning.autopilot?.waitingFor?.kind === 'error', 8000));
  let task = await latest(store, id);
  assert.equal(task.planning.autopilot.waitingFor.code, 'AGENT_FILTERED');
  assert.equal(task.planning.learningTurns.filter(t => t.stage === 'A').length, 1, '失敗後不自動重試');
  mode();
  await coach.setAutopilot(id, task.revision, 'k-auto-resume-1', { provider: 'claude' });
  assert.ok(await waitFor(async () => (await latest(store, id)).planning.autopilot?.waitingFor?.kind === 'answer', 15000));
  task = await latest(store, id);
  assert.equal(task.planning.learningTurns.find(t => t.status === 'completed').provider, 'claude');
  // 關掉自動
  await coach.setAutopilot(id, (await latest(store, id)).revision, 'k-auto-off-1', { on: false });
  assert.equal((await latest(store, id)).planning.autopilot, null);
  // 停止會結束自動模式
  await coach.setAutopilot(id, (await latest(store, id)).revision, 'k-auto-on-2', { on: true });
  assert.ok(await waitFor(async () => (await latest(store, id)).planning.autopilot?.waitingFor?.kind === 'answer', 8000));
  mode('slow');
  await coach.answer(id, (await latest(store, id)).revision, 'k-auto-answer-2', { message: '十頁' });
  coach.resumeAuto(id);
  assert.ok(await waitFor(() => coach.children.has(id)));
  await coach.stop(id);
  assert.ok(await waitFor(async () => (await latest(store, id)).planning.autopilot === null && !coach.drivers.has(id), 10000));
  task = await latest(store, id);
  assert.equal(task.planning.stopped.stage, 'B');
  assert.equal(task.planning.autopilot, null);
  mode();
});
