import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaskStore, parseTask, serializeTask, planningAction } from '../src/tasks.js';
import { Coach } from '../src/coach.js';
import { buildArgs, classify, extractJson, runAgent } from '../src/agents.js';
import { defaultStageSettings } from '../src/models.js';
import { Memory } from '../src/memory.js';
import { prompts, parseExecution } from '../src/coach.js';
import { previewArtifact } from '../src/server.js';

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-cli.mjs');
process.env.AWC_CODEX_BIN = fake;
process.env.AWC_CLAUDE_BIN = fake;

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'awc-coach-'));
  const store = new TaskStore(dir);
  const settings = { revision: 1, stages: { ...defaultStageSettings(), E: { provider: 'claude', modelId: 'sonnet', effort: 'high' } } };
  const memory = new Memory(path.join(dir, 'memory'));
  return { dir, store, memory, coach: new Coach(store, () => settings, dir, memory) };
}
const latest = async (store, id) => (await store.get(id)).task;

test('CLI arguments never include bypass flags and keep each mode in its sandbox', () => {
  for (const provider of ['codex', 'claude']) for (const mode of ['chat', 'read', 'write']) {
    const list = buildArgs({ provider, modelId: 'm', effort: 'low', mode, cwd: '/out', outputFile: '/tmp/o' });
    const args = list.join(' ');
    assert.doesNotMatch(args, /bypass|dangerously|full-auto|yolo/);
    if (provider === 'codex') assert.match(args, mode === 'write' ? /-s workspace-write/ : /-s read-only/);
    if (provider === 'claude') assert.equal(list[list.indexOf('--tools') + 1], { chat: '', read: 'Read,Glob,Grep', write: 'Read,Write,Edit,Glob,Grep' }[mode]);
  }
  assert.equal(classify("You've hit your session limit · resets 3:50am")[0], 'AGENT_QUOTA');
  assert.deepEqual(classify('Not logged in · Please run /login')[0], 'AGENT_NOT_LOGGED_IN');
  assert.deepEqual(classify("The 'gpt-6.1-sol' model is not supported")[0], 'AGENT_MODEL_UNSUPPORTED');
  assert.deepEqual(extractJson('前言\n```json\n{"a":1}\n```'), { a: 1 });
});

test('a not-logged-in CLI is reported clearly', async () => {
  process.env.FAKE_MODE = 'login';
  await assert.rejects(runAgent({ provider: 'claude', mode: 'chat', prompt: 'x' }), { code: 'AGENT_NOT_LOGGED_IN' });
  delete process.env.FAKE_MODE;
});

test('full flow: formulate, grill, outline, split, execute, review, human confirm', async () => {
  const { store, coach } = await setup();
  const created = await coach.create({ request: '我要做一份新品簡報給主管', profile: 'quick' });
  const id = created.task.id;
  assert.equal(created.task.planning.running.stage, 'A');
  await created.done;
  let task = await latest(store, id);
  assert.equal(task.planning.card.audience, '主管');
  const ai = task.planning.messages.filter(m => m.role === 'ai');
  assert.equal(ai.length, 2, 'A 完成後自動接著 B 反問');
  assert.equal(ai[1].questions[0].q, '要幾頁？');
  assert.match(ai[0].coaching, /讀者/);
  assert.equal(task.nextAction?.kind ?? (await store.list())[0].nextAction.kind, 'grill');

  const answered = await coach.answer(id, task.revision, 'k-answer-1', { message: '十頁，主管要當場決定' });
  await answered.done;
  task = await latest(store, id);
  assert.equal(task.planning.readyForOutline, true);

  await (await coach.draftOutline(id)).done;
  task = await latest(store, id);
  assert.equal(task.planning.phase, 'outline');
  assert.equal(task.planning.outline.imageTotal, 1);
  assert.equal(task.planning.workItems.length, 2);

  task = (await coach.approveOutline(id, task.revision, 'k-approve-1')).task;
  assert.equal(task.planning.phase, 'execute');

  await (await coach.execute(id, 'W1')).done;
  task = await latest(store, id);
  const w1 = task.planning.workItems.find(w => w.id === 'W1');
  assert.equal(w1.status, 'AWAITING_REVIEW');
  assert.deepEqual(w1.outputs.map(o => o.file), ['deck.html'], '越界的 ../escape.txt 不列入成果');
  assert.equal(await readFile(path.join(task.allowedRoots[0], 'deck.html'), 'utf8'), '<h1>痛點</h1><svg></svg>');

  await (await coach.review(id, 'W1')).done;
  task = await latest(store, id);
  assert.equal(task.planning.workItems[0].status, 'REVIEWED', 'AI 驗收通過後仍等人確認');
  assert.match(task.planning.workItems[0].review.coaching, /deck\.html/);

  task = (await coach.confirm(id, task.revision, 'k-c1', { itemId: 'W1', accept: true })).task;
  task = (await coach.confirm(id, task.revision, 'k-c2', { itemId: 'W2', note: '數據已放進資料夾' })).task;
  assert.equal(task.planning.phase, 'done');
  assert.equal(task.status, 'COMPLETED');
  assert.deepEqual(task.planning.learningTurns.map(t => t.stage), ['A', 'B', 'B', 'C', 'D', 'E']);
  for (const turn of task.planning.learningTurns) {
    assert.match(turn.prompt, /每次提問與演進/);
    assert.ok(turn.response);
    assert.equal(turn.status, 'completed');
    assert.equal(turn.learningStatus, 'suggested');
    assert.ok(turn.learning.evidence);
  }
  const reflected = await coach.reflect(id, task.revision, 'k-reflect-1', { turnId: task.planning.learningTurns[0].id, answer: '先講清楚決定，才能安排證據。' });
  assert.equal(reflected.task.planning.learningTurns[0].reflection.answer, '先講清楚決定，才能安排證據。');
  await assert.rejects(coach.reflect(id, reflected.task.revision, 'k-reflect-bad', { turnId: 'missing', answer: '回答' }), { code: 'TURN_NOT_FOUND' });
});

test('failed review goes to fix, and acceptance needs a reviewed item', async () => {
  const { store, coach } = await setup();
  const created = await coach.create({ request: '我要做一份新品簡報給主管', profile: 'quick' });
  await created.done;
  let task = await latest(store, created.task.id);
  await (await coach.answer(task.id, task.revision, 'k-a', { message: '十頁' })).done;
  await (await coach.draftOutline(task.id)).done;
  task = await latest(store, task.id);
  task = (await coach.approveOutline(task.id, task.revision, 'k-ap')).task;
  await assert.rejects(coach.confirm(task.id, task.revision, 'k-early', { itemId: 'W1', accept: true }), { code: 'NOT_REVIEWED' });
  await (await coach.execute(task.id, 'W1')).done;
  process.env.FAKE_MODE = 'review-fail';
  await (await coach.review(task.id, 'W1')).done;
  delete process.env.FAKE_MODE;
  task = await latest(store, task.id);
  const item = task.planning.workItems[0];
  assert.equal(item.status, 'REVIEW_FAIL');
  assert.deepEqual(item.fixes, ['補標題']);
  await (await coach.fix(task.id, 'W1')).done;
  assert.equal((await latest(store, task.id)).planning.learningTurns.at(-1).stage, 'F');
  assert.equal((await latest(store, task.id)).planning.learningTurns.at(-1).learningStatus, 'suggested');
  task = await latest(store, task.id);
  assert.equal(task.planning.workItems[0].status, 'AWAITING_REVIEW');
  assert.equal(task.planning.workItems[0].attempts, 2);
});

test('a verification-only fix keeps registered HTML and user instructions through repeated reviews', async () => {
  const { dir, store, coach } = await setup();
  const created = await coach.create({ request: '我要做一份新品簡報給主管', profile: 'quick' });
  await created.done;
  let task = await latest(store, created.task.id);
  await (await coach.answer(task.id, task.revision, 'k-answer', { message: '十頁' })).done;
  await (await coach.draftOutline(task.id)).done;
  task = await latest(store, task.id);
  task = (await coach.approveOutline(task.id, task.revision, 'k-outline')).task;
  await (await coach.execute(task.id, 'W1')).done;
  task = await latest(store, task.id);
  const originalSha = task.planning.workItems[0].outputs.find(o => o.file === 'deck.html').sha;
  process.env.FAKE_MODE = 'review-fail';
  await (await coach.review(task.id, 'W1')).done;
  delete process.env.FAKE_MODE;
  task = await latest(store, task.id);
  process.env.FAKE_MODE = 'verification-only';
  await (await coach.instruct(task.id, task.revision, 'k-fix-instruction', { text: '請保留原 HTML，補驗證紀錄', scope: 'W1' })).done;
  delete process.env.FAKE_MODE;
  task = await latest(store, task.id);
  const item = task.planning.workItems[0];
  assert.deepEqual(item.outputs.map(o => o.file), ['deck.html', 'verification.md']);
  assert.equal(item.outputs[0].sha, originalSha);
  assert.match((await previewArtifact(store, dir, task.id, 'deck.html')).content.toString(), /痛點/);
  assert.match(task.planning.learningTurns.at(-1).prompt, /請保留原 HTML，補驗證紀錄/);
  process.env.FAKE_MODE = 'review-fail';
  await (await coach.review(task.id, 'W1')).done;
  delete process.env.FAKE_MODE;
  task = await latest(store, task.id);
  assert.deepEqual(task.planning.workItems[0].fixes, ['補標題']);
  assert.match(task.planning.workItems[0].instructions.at(-1).text, /請保留原 HTML/);
  const reviewPrompt = task.planning.learningTurns.at(-1).prompt;
  assert.match(reviewPrompt, /請保留原 HTML，補驗證紀錄/);
  assert.match(reviewPrompt, /指示不代替成果證據/);
  process.env.FAKE_MODE = 'verification-only';
  await (await coach.fix(task.id, 'W1')).done;
  delete process.env.FAKE_MODE;
  task = await latest(store, task.id);
  assert.match(task.planning.learningTurns.at(-1).prompt, /請保留原 HTML，補驗證紀錄/);
  assert.equal(task.planning.workItems[0].outputs[0].sha, originalSha);
});

test('agent errors are recorded, running is cleared, and a second run is refused while busy', async () => {
  const { store, coach } = await setup();
  process.env.FAKE_MODE = 'login';
  const created = await coach.create({ request: '我要做一份新品簡報給主管', profile: 'quick' });
  await assert.rejects(coach.formulate(created.task.id), { code: 'AGENT_BUSY' });
  const result = await created.done;
  delete process.env.FAKE_MODE;
  assert.equal(result.error.code, 'AGENT_NOT_LOGGED_IN');
  const task = await latest(store, created.task.id);
  assert.equal(task.planning.running, null);
  assert.match(task.planning.messages.at(-1).text, /尚未登入/);
});

test('restart recovery marks an unfinished step as unknown', async () => {
  const { dir, store, coach } = await setup();
  const created = await coach.create({ request: '我要做一份新品簡報給主管', profile: 'quick' });
  await created.done;
  const file = path.join(dir, `${created.task.id}.md`);
  const task = parseTask(await readFile(file, 'utf8'), path.basename(file));
  const unfinished = task.planning.learningTurns.at(-1);
  unfinished.status = 'running';
  task.planning.running = { stage: 'D', agent: 'Codex', startedAt: new Date().toISOString(), turnId: unfinished.id };
  await writeFile(file, serializeTask(task));
  await new Coach(store, () => ({ stages: defaultStageSettings() }), dir, new Memory(path.join(dir, 'memory'))).recover();
  const after = await latest(store, created.task.id);
  assert.equal(after.planning.running, null);
  assert.match(after.planning.messages.at(-1).text, /結果未知/);
  assert.equal(after.planning.learningTurns.at(-1).status, 'unknown');
});

test('standard profile: skeleton first, sensors, diary, learning loop, rules for the next task, change requests', async () => {
  const { store, coach, memory } = await setup();
  const created = await coach.create({ request: '我要做一份新品簡報給主管', profile: 'standard' });
  await created.done;
  let task = await latest(store, created.task.id);
  assert.ok(task.planning.diary.some(d => d.heading === 'interpretations'), 'AI 日記成為學習候選');
  await (await coach.answer(task.id, task.revision, 'k-s1', { message: '十頁' })).done;
  await (await coach.draftOutline(task.id)).done;
  task = await latest(store, task.id);
  const [skeleton, ...rest] = task.planning.workItems;
  assert.equal(skeleton.id, 'W0', '程式補上骨架項目');
  assert.ok(skeleton.skeleton);
  assert.ok(rest.filter(i => i.owner === 'ai').every(i => i.dependsOn.includes('W0')), '其他 AI 項目等骨架完成');
  assert.equal(task.planning.outline.sensors.find(s => s.id === 'claim-sources').result, 'FAIL', '「無依據」的段落被抓出來');

  await (await coach.draftOutline(task.id, '第二段要補數據來源')).done;
  task = await latest(store, task.id);
  assert.equal(task.planning.outline.storyline, '新品值得做（改版）');
  assert.equal(task.planning.outline.version, 2);
  const events = await coach.events(task.id);
  assert.ok(events.some(e => e.type === 'CHANGES_REQUESTED' && e.text === '第二段要補數據來源'), '修改意見逐字記錄');
  assert.ok(events.some(e => e.type === 'HUMAN_REPLY' && e.text === '十頁'));

  task = (await coach.approveOutline(task.id, task.revision, 'k-s2')).task;
  await (await coach.execute(task.id, 'W0')).done;
  task = await latest(store, task.id);
  const sensors = task.planning.workItems[0].sensors;
  assert.equal(sensors.find(s => s.id === 'outputs-exist').result, 'PASS');
  assert.ok(!sensors.some(s => s.id === 'visual-count'), '骨架版不檢查圖片數量');

  const candidates = task.planning.diary.filter(d => d.status === 'candidate');
  const keep = candidates.filter(d => d.heading === 'tradeoffs').slice(0, 1).map(d => d.id);
  const learned = await coach.keepLearnings(task.id, task.revision, 'k-s3', { keep, add: { heading: 'interpretations', text: '主管簡報一律先講結論' } });
  assert.equal(learned.written.length, 2);
  assert.ok(learned.task.planning.diary.every(d => d.status !== 'candidate'), '沒勾的候選標成不保留');
  const project = await memory.read('project', task.project);
  assert.match(project, /## 取捨\n- 選 HTML 不選 PPT/);
  assert.match(project, /## 詮釋\n- 主管簡報一律先講結論/);
  assert.doesNotMatch(project, /預算上限未知/, '未決問題不升級成規則');
  await coach.keepLearnings(task.id, learned.task.revision, 'k-s4', { keep: [], add: { heading: 'interpretations', text: '主管簡報一律先講結論' } });
  assert.equal((await memory.read('project', task.project)).match(/主管簡報一律先講結論/g).length, 1, '相同規則不重複寫入');

  const next = await coach.create({ request: '另一份給主管的簡報', profile: 'standard' });
  await next.done;
  const nextTask = await latest(store, next.task.id);
  assert.match(nextTask.planning.rules, /主管簡報一律先講結論/, '下一個任務開工就帶著規則');
  assert.match(prompts.B(nextTask), /主管簡報一律先講結論/);
  assert.doesNotMatch(task.planning.rules || '', /主管簡報一律先講結論/, '進行中的任務不在中途改規則');
});

test('quick profile skips the skeleton but keeps a learning trail', async () => {
  const { store, coach } = await setup();
  const created = await coach.create({ request: '我要做一份新品簡報給主管', profile: 'quick' });
  await created.done;
  let task = await latest(store, created.task.id);
  assert.ok(task.planning.diary.length > 0);
  assert.equal(task.planning.learningTurns.length, 2);
  await (await coach.answer(task.id, task.revision, 'k-q1', { message: '十頁' })).done;
  await (await coach.draftOutline(task.id)).done;
  task = await latest(store, task.id);
  assert.ok(!task.planning.workItems.some(i => i.skeleton));
  await assert.rejects(coach.create({ request: '做一份簡報吧', profile: 'enterprise' }), { code: 'PROFILE_INVALID' });
});

test('failed CLI attempts keep their prompt; missing learning stays pending', async () => {
  const { store, coach } = await setup();
  const created = await coach.create({ request: '我要做一份新品簡報給主管', profile: 'quick' });
  await created.done;
  process.env.FAKE_MODE = 'login';
  try { await (await coach.grill(created.task.id)).done; }
  finally { delete process.env.FAKE_MODE; }
  let task = await latest(store, created.task.id);
  const failed = task.planning.learningTurns.at(-1);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorCode, 'AGENT_NOT_LOGGED_IN');
  assert.match(failed.prompt, /Grill me/);
  assert.equal(failed.learning, undefined);
  assert.equal(task.planning.running, null);
  process.env.FAKE_MODE = 'no-learning';
  try { await (await coach.grill(task.id)).done; }
  finally { delete process.env.FAKE_MODE; }
  task = await latest(store, task.id);
  assert.equal(task.planning.learningTurns.at(-1).learningStatus, 'pending');
  assert.equal(task.planning.learningTurns.at(-1).learning.lesson, '');
});

test('an unusable response keeps raw evidence and clears running without changing the outline', async () => {
  const { store, coach } = await setup();
  const created = await coach.create({ request: '我要做一份新品簡報給主管', profile: 'quick' });
  await created.done;
  let task = await latest(store, created.task.id);
  await (await coach.answer(task.id, task.revision, 'k-invalid-answer', { message: '十頁' })).done;
  process.env.FAKE_MODE = 'malformed';
  let result;
  try { result = await (await coach.draftOutline(task.id)).done; }
  finally { delete process.env.FAKE_MODE; }
  task = await latest(store, task.id);
  assert.equal(result.error.code, 'RESPONSE_INVALID');
  assert.equal(task.planning.running, null);
  assert.equal(task.planning.outline, null);
  assert.equal(task.planning.learningTurns.at(-1).status, 'failed');
  assert.match(task.planning.learningTurns.at(-1).response, /沒有 JSON/);
});

test('the next Alpha task really sends the retained principle in its CLI prompt', async () => {
  const { store, coach, memory } = await setup();
  const principle = '部分通過不得概括為完成，未執行的檢查要明列。';
  await memory.append('project', 'Alpha', '取捨', principle, '已保留的歷程原則');
  const created = await coach.create({ request: '請幫我整理 Alpha 的版本改動報告', profile: 'quick' });
  await created.done;
  const task = await latest(store, created.task.id);
  assert.equal(task.project, 'Alpha');
  assert.ok(task.planning.learningTurns.find(t => t.stage === 'B').prompt.includes(principle));
  assert.equal((await memory.list()).cards.length, 1, '這次 AI 的新建議沒有自行成為規則');
});

test('DONE without any file is treated as fake completion, and prompts carry the folder', async () => {
  const { store, coach } = await setup();
  const created = await coach.create({ request: '我要做一份新品簡報給主管', profile: 'quick' });
  await created.done;
  let task = await latest(store, created.task.id);
  await (await coach.answer(task.id, task.revision, 'k-n1', { message: '十頁' })).done;
  await (await coach.draftOutline(task.id)).done;
  task = await latest(store, task.id);
  task = (await coach.approveOutline(task.id, task.revision, 'k-n2')).task;
  process.env.FAKE_MODE = 'nofiles';
  await (await coach.execute(task.id, 'W1')).done;
  delete process.env.FAKE_MODE;
  task = await latest(store, task.id);
  const w1 = task.planning.workItems.find(w => w.id === 'W1');
  assert.equal(w1.status, 'BLOCKED', '沒有檔案的完成不送驗收');
  assert.match(w1.fixes.at(-1), /沒有新的檔案/);
  task.folderListing = await coach.listing(task.allowedRoots[0]);
  assert.match(prompts.D(task, w1, []), /產出資料夾（AI 的工作目錄）/);
  assert.match(prompts.B(task), /不要再問使用者資料在哪裡/);
  // 停下的原因直接寫在等你的那一行，不用打開紀錄
  assert.deepEqual(w1.blocked && { kind: w1.blocked.kind, reason: w1.blocked.reason, count: w1.blocked.count }, { kind: 'tool', reason: '回報完成但沒有產出檔案', count: 1 });
  assert.match(coach.nextStep(task, {}).stop.label, /W1「產出 HTML」做不下去：回報完成但沒有產出檔案$/);
});

test('blocked reasons, repeated stops, and review prompts that see the report but stay in scope', () => {
  const report = '做好了骨架。\nSTATUS: BLOCKED\nFILES: index.html\n證據：index.html 第 3 行\n未完成：沒有可用的瀏覽器，\n無法實際試玩。\n\n```json\n{}\n```';
  assert.equal(parseExecution(report).missing, '沒有可用的瀏覽器， 無法實際試玩。');
  assert.equal(parseExecution('STATUS: DONE\nFILES: a.html\n未完成：無').missing, '');
  assert.deepEqual(parseExecution('STATUS: DONE\nFILES: `deck.html`, [check.mjs](/out/check.mjs:12), "RETRO.md"').files, ['deck.html', '/out/check.mjs', 'RETRO.md']);
  const item = { id: 'W1', title: '骨架版', owner: 'ai', status: 'BLOCKED', skeleton: true, dependsOn: [], acceptance: ['可以開始遊戲'], outputs: [], log: [{ text: report }], blocked: { kind: 'tool', reason: '沒有可用的瀏覽器', count: 3 } };
  const task = { allowedRoots: ['/out'], project: 'Demo', planning: { phase: 'execute', profile: 'standard', request: '做遊戲', rules: '', messages: [], card: { title: '遊戲', success: ['完整可玩'], constraints: [], unknowns: [] }, outline: { storyline: '', logic: [], sections: [] }, workItems: [item] } };
  const coach = new Coach(null, () => ({}), '/tmp', null);
  const stop = coach.nextStep(task, {}).stop;
  assert.equal(stop.blocked, 'tool');
  assert.match(stop.label, /做不下去：沒有可用的瀏覽器（同一原因第 3 次）/);
  item.blocked = { kind: 'info', reason: '缺價格', count: 1 };
  assert.match(coach.nextStep(task, {}).stop.label, /需要你補資訊：缺價格$/);
  const review = prompts.E(task, item);
  assert.match(review, /執行者最後一次回報（自述，不算證據/);
  assert.match(review, /沒有可用的瀏覽器/);
  assert.match(review, /只核對這一項列出的驗收條件/);
  assert.match(review, /這一項是骨架版/);
  assert.doesNotMatch(prompts.E(task, { ...item, skeleton: false }), /這一項是骨架版/);
  assert.match(prompts.D(task, item, []), /只做這一項，不要提前做其他工作項目/);
  assert.match(prompts.C(task), /不要寫「有沒有回報」「是否貼出輸出」這類流程條件/);
});

test('files already in the output folder are recorded as material with a SHA-256 baseline', async () => {
  const { store, coach, dir } = await setup();
  const out = path.join(dir, 'material');
  await import('node:fs/promises').then(fs => fs.mkdir(out, { recursive: true }));
  await writeFile(path.join(out, 'README.md'), '素材');
  const created = await coach.create({ request: '依素材做一份簡報給主管', profile: 'quick', outputDir: out });
  await created.done;
  const task = await latest(store, created.task.id);
  assert.deepEqual(task.planning.baseline.map(b => b.file), ['README.md']);
  assert.match(prompts.A(task), /README\.md  [0-9a-f]{64}/);
});

test('GitHub Copilot is limited to tool-free chat stages', () => {
  const args = buildArgs({ provider: 'copilot', modelId: 'claude-opus-5.5', effort: 'low', mode: 'chat', cwd: '/x', outputFile: '/o' });
  assert.ok(args.some(a => a.startsWith('--excluded-tools=') && a.includes('view') && a.includes('create') && a.includes('bash')));
  assert.doesNotMatch(args.join(' '), /allow-all|yolo|allow-tool/);
  for (const mode of ['read', 'write']) {
    const args = buildArgs({ provider: 'copilot', mode, cwd: '/x' }).join(' ');
    assert.ok(!/excluded-tools=[^ ]*\b(view|glob|grep)\b/.test(args) && /excluded-tools=[^ ]*\bbash\b/.test(args));
  }
  assert.equal(classify('Error: Model "x" from --model flag is not available.')[0], 'AGENT_MODEL_UNSUPPORTED');
});

test('same-project next task sends retained principles in A, keeps original corrections beyond 16 messages, and records input and outputs by item', async () => {
  const {store,coach,memory}=await setup();
  await memory.append('project','Demo','取捨','局部修改保留 P1，數字期間核對原始來源','歷史學習');
  const created=await coach.create({request:'十頁Demo簡報給主管，P1不要修改',project:'Demo',profile:'quick'});
  await created.done;
  let task=await latest(store,created.task.id);
  assert.equal(task.project,'Demo');assert.equal(task.planning.card.project,'Demo');
  assert.match(task.planning.learningTurns[0].prompt,/局部修改保留 P1/);
  assert.equal(task.planning.learningTurns[0].userInput,'十頁Demo簡報給主管，P1不要修改');
  assert.equal(task.planning.learningTurns[0].provider,'codex');
  assert.equal(task.planning.learningTurns[1].inputKind,'automatic');
  task=(await store.mutate(task.id,task.revision,null,t=>{t.planning.messages.push({role:'user',stage:'B',text:'早期不能遺失的修正'});for(let i=0;i<24;i++)t.planning.messages.push({role:'ai',stage:'B',text:'AI 附加回覆 '+i});return {status:'BLOCKED'};})).task;
  assert.match(prompts.B(task),/早期不能遺失的修正/);
  assert.doesNotMatch(prompts.B(task),/AI 附加回覆 0\n/);
  await (await coach.answer(task.id,task.revision,'same-project-answer',{message:'十頁，先討論不要修改現有成果'})).done;
  await (await coach.draftOutline(task.id)).done;
  task=await latest(store,task.id);
  await (await coach.draftOutline(task.id,'保留 P1，調整 P2')).done;
  task=await latest(store,task.id);
  assert.equal(task.planning.learningTurns.at(-1).userInput,'保留 P1，調整 P2');
  await coach.approveOutline(task.id,task.revision,'same-project-approve');
  await (await coach.execute(task.id,'W1')).done;
  task=await latest(store,task.id);
  assert.equal(task.planning.learningTurns.at(-1).workItemId,'W1');
  assert.deepEqual(task.planning.learningTurns.at(-1).outputs.map(o=>o.file),['deck.html']);
  assert.match(task.planning.learningTurns.at(-1).prompt,/局部修改保留 P1/);
  await assert.rejects(coach.create({request:'建立任務測試',project:42}),{code:'PROJECT_INVALID'});
});

test('new same-project task receives compact editable project brief, without all archive rounds',async()=>{
 const {store,coach,dir}=await setup();const {Projects}=await import('../src/projects.js');
 const briefs=new Projects(path.join(dir,'vault','projects'));
 const p=await briefs.create({name:'Demo'});
 await briefs.save(p.id,{revision:p.revision,slideId:'why',point:'讓主管理解共用能力',detail:'先區分實際能力與未來規劃。',reason:'工作目標補清楚'});
 const created=await coach.create({request:'十頁Demo簡報給主管',project:'Demo',profile:'quick'});await created.done;
 const task=await latest(store,created.task.id);assert.match(task.planning.learningTurns[0].prompt,/讓主管理解共用能力/);
 assert.match(task.planning.learningTurns[1].prompt,/先區分實際能力與未來規劃/);
 assert.ok(task.planning.projectBrief.length<2400);assert.doesNotMatch(task.planning.projectBrief,/83 則|41 輪/);
});


test('zero-exit content filtering stops A, retains reply, and retry runs A then B once', async () => {
  const { store, coach } = await setup();
  process.env.FAKE_MODE = 'filter-zero';
  try {
    const created = await coach.create({ request: '整理Mentor使用說明', profile: 'quick' });
    const result = await created.done;
    assert.equal(result.error.code, 'AGENT_FILTERED');
    let task = await latest(store, created.task.id);
    assert.equal(task.planning.running, null);
    assert.deepEqual(task.planning.learningTurns.map(t => t.stage), ['A']);
    assert.match(task.planning.learningTurns[0].response, /content filtering/);
    assert.equal(planningAction(task).kind, 'retry');
    delete process.env.FAKE_MODE;
    const first = coach.retry(task.id, task.revision, 'retry-filter-1');
    const duplicate = coach.retry(task.id, task.revision, 'retry-filter-1');
    assert.equal(first, duplicate);
    await (await first).done;
    task = await latest(store, task.id);
    assert.deepEqual(task.planning.learningTurns.map(t => t.stage), ['A', 'A', 'B']);
    assert.equal(planningAction(task).label, '回答 AI 的 1 個問題');
    await assert.rejects(coach.retry(task.id, 1, 'retry-stale-1'), { code: 'REVISION_CONFLICT' });
  } finally { delete process.env.FAKE_MODE; }
});

test('invalid A card and B with no questions fail without accepting empty results', async () => {
  for (const mode of ['malformed-a', 'empty-b']) {
    process.env.FAKE_MODE = mode;
    try {
      const { store, coach } = await setup();
      const created = await coach.create({ request: '整理Mentor使用說明', profile: 'quick' });
      const result = await created.done;
      assert.equal(result.error.code, 'RESPONSE_INVALID');
      const task = await latest(store, created.task.id);
      assert.equal(task.planning.readyForOutline, false);
      assert.equal(task.planning.running, null);
      assert.equal(planningAction(task).kind, 'retry');
      assert.ok(task.planning.learningTurns.at(-1).response);
      const events = await coach.events(task.id);
      const stage = mode === 'malformed-a' ? 'A' : 'B';
      assert.equal(events.some(e => e.type === 'STAGE_COMPLETED' && e.stage === stage), false);
      assert.ok(events.some(e => e.type === 'STAGE_FAILED' && e.stage === stage));
    } finally { delete process.env.FAKE_MODE; }
  }
});

test('historical parse failures offer retry and quoted filtering text is still valid content', async () => {
  assert.equal(planningAction({ planning: { phase: 'grill', messages: [{ role: 'ai', questions: [], parseError: true }] } }).kind, 'retry');
  assert.doesNotMatch(planningAction({ planning: { phase: 'grill', messages: [{ role: 'ai', questions: [] }] } }).label, /0 個問題/);
  process.env.FAKE_MODE = 'quote-filter';
  try { assert.match((await runAgent({ provider: 'codex', mode: 'chat', prompt: 'x' })).text, /explanation/); }
  finally { delete process.env.FAKE_MODE; }
});
