import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { TaskStore, planningAction } from '../src/tasks.js';
import { Coach } from '../src/coach.js';
import { Memory } from '../src/memory.js';
import { defaultStageSettings } from '../src/models.js';

const root = new URL('../', import.meta.url);
const sharedNames = await readFile(new URL('../web/assets/item-names.js', import.meta.url), 'utf8');
const autoSource = await readFile(new URL('web/assets/auto.js', root), 'utf8');
const html = await readFile(new URL('web/index.html', root), 'utf8');
// 載入正式 busy，讓測試涵蓋防止連點與失敗後可重試的行為。
const busySource = html.split('\n').find(line => line.startsWith('function busy('));

function node(tag, text, className = '') {
  return {
    tag, textContent: text ?? '', className, dataset: {}, children: [], disabled: false, isConnected: true,
    classList: { add() {} },
    append(...children) { this.children.push(...children); },
    prepend(...children) { this.children.unshift(...children); },
    remove() { this.removed = true; },
    setAttribute() {}, removeAttribute() {},
    contains(child) { return this.children.includes(child); }
  };
}

function card(task, coachAct, previewPlan = async () => {}) {
  const one = node('div'), jump = node('button'), eyebrow = node('span'), label = node('strong');
  const positioned = [];
  const outline = { scrollIntoView: options => positioned.push(options), contains: () => false, querySelector: () => null };
  const detail = {
    querySelector: selector => selector === '[data-anchor="outline"]' ? outline : selector === '.one-thing' ? one : null,
    querySelectorAll: () => []
  };
  const context = vm.createContext({
    element: node, focusKey: (button, key) => { button.dataset.focus = key; return button; },
    trackOf: () => ({ nodes: [{ state: 'now', name: '計畫' }] }),
    state: { stages: [], providers: [] }, coachAct, previewPlan, tell() {},
    $: () => detail, matchMedia: () => ({ matches: true }), task,
    one, jump, oneText: { querySelector: selector => selector === '.eyebrow' ? eyebrow : label }
  });
  vm.runInContext(`${busySource}\n${sharedNames}\n${autoSource}\ndecorateOneThing(task,{one,oneText,jump});`, context);
  return { buttons: one.children[0].children, positioned, jump, label };
}

const approvalTask = () => ({
  id: 'TASK-skeleton',
  planning: { phase: 'outline', autopilot: { full: false, waitingFor: { kind: 'approve', label: '看 AI 的計畫，沒問題就核准' } }, workItems: [] },
  nextAction: { kind: 'outline', label: '看 AI 的計畫，沒問題就核准', button: '預覽計畫' }
});

test('規格 1、2：計畫動作與自動停點採用原文，kind 與 phase 不變', () => {
  const task = approvalTask();
  assert.deepEqual(planningAction(task), task.nextAction);
  assert.deepEqual(Coach.prototype.nextStep.call({}, task, task.planning.autopilot), {
    stop: { kind: 'approve', label: '看 AI 的計畫，沒問題就核准' }
  });
  assert.equal(task.planning.phase, 'outline');
  const full = Coach.prototype.nextStep.call({ approveOutlineAuto: id => id }, task, { full: true });
  assert.equal(full.run(), task.id, '完全自動仍走原本自動核准分支');
});

test('自動流程的兩個計畫入口只開預覽，不直接核准', async () => {
  const task=approvalTask(),calls=[],previews=[];
  const view=card(task,async(...args)=>calls.push(args),async current=>previews.push(current));
  const [approve,look]=view.buttons;
  look.onclick();await approve.onclick();
  assert.deepEqual(previews,[task,task]);assert.equal(calls.length,0);
  assert.equal(view.positioned.length,0);
});

test('核准按鈕沿用 busy：執行中不重送，失敗後可重試', async () => {
  let release, calls = 0;
  const view = card(approvalTask(), () => assert.fail('不可直接核准'), () => { calls++; return new Promise((resolve, reject) => { release = reject; }); });
  const approve = view.buttons[0];
  const pending = approve.onclick();
  assert.equal(approve.disabled, true);
  await approve.onclick();
  assert.equal(calls, 1);
  release(new Error('測試錯誤'));
  await pending;
  assert.equal(approve.disabled, false);
  assert.equal(approve.textContent, '預覽計畫，再核准');
});

async function waitFor(check) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  assert.fail('自動流程未在 15 秒內到達預期停點');
}

test('無連接埠完整路徑：後端停在 approve → 點卡片核准 → 接續執行與驗收', async t => {
  const dir = await realpath(await mkdtemp(new URL('.ui-copy-skeleton-', root)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fake = fileURLToPath(new URL('tests/fixtures/fake-cli.mjs', root));
  const names = ['AWC_CODEX_BIN', 'AWC_CLAUDE_BIN', 'FAKE_MODE'];
  const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => { for (const name of names) { if (original[name] === undefined) delete process.env[name]; else process.env[name] = original[name]; } });
  process.env.AWC_CODEX_BIN = fake;
  process.env.AWC_CLAUDE_BIN = fake;
  delete process.env.FAKE_MODE;
  const store = new TaskStore(dir);
  const settings = { revision: 1, stages: defaultStageSettings() };
  const coach = new Coach(store, () => settings, dir, new Memory(`${dir}/memory`));
  const created = await coach.create({ request: '我要做一份新品簡報給主管十頁', profile: 'quick', autopilot: true });
  await created.done;
  const latest = async () => (await store.get(created.task.id)).task;
  const idle = () => !coach.drivers.has(created.task.id) && !coach.pending.has(created.task.id);
  await waitFor(async () => (await latest()).planning.autopilot?.waitingFor?.kind === 'approve' && idle());
  const task = await latest();
  assert.equal(task.planning.phase, 'outline');
  assert.equal(task.planning.autopilot.waitingFor.label, '看 AI 的計畫，沒問題就核准');
  task.nextAction = planningAction(task);
  let confirmPreview;
  const view = card(task, () => assert.fail('不可直接核准'), async current => {
    confirmPreview = async () => {
    await coach.approveOutline(current.id, current.revision, 'skeleton-approve-001');
    coach.resumeAuto(current.id); // 與 server.js 的 approve 路由相同接續方式。
    };
  });
  view.buttons[1].onclick();
  assert.equal((await latest()).planning.phase, 'outline');
  await view.buttons[0].onclick();
  assert.equal((await latest()).planning.phase, 'outline');
  await confirmPreview();
  await waitFor(async () => (await latest()).planning.autopilot?.waitingFor?.kind === 'confirm' && idle());
  const approved = await latest();
  assert.equal(approved.planning.phase, 'execute');
  assert.equal(approved.planning.workItems.find(item => item.id === 'W1').status, 'REVIEWED');
  assert.deepEqual(approved.planning.learningTurns.slice(-2).map(turn => turn.stage), ['D', 'E']);
  assert.ok((await coach.events(task.id)).some(event => event.type === 'GATE_APPROVED'));
});
