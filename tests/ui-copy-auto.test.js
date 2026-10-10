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

function card(task, coachAct) {
  const one = node('div'), jump = node('button'), eyebrow = node('span'), label = node('strong');
  const positioned = [];
  const outline = { scrollIntoView: options => positioned.push(options), contains: () => false, querySelector: () => null };
  const detail = {
    querySelector: selector => selector === `[data-anchor="${task.nextAction.kind}"]` || selector === `[data-item="${task.nextAction.id}"]` ? outline : selector === '.one-thing' ? one : null,
    querySelectorAll: () => []
  };
  const holderSource = html.split('\n').find(line => line.startsWith('const holderOf='));
  const context = vm.createContext({
    element: node, focusKey: (button, key) => { button.dataset.focus = key; return button; },
    trackOf: () => ({ nodes: [{ state: 'now', name: '計畫' }] }),
    state: { stages: [], providers: [{ id: 'claude', name: 'Claude', runnable: true, modes: ['read'] }] }, coachAct, tell() {},
    $: () => detail, matchMedia: () => ({ matches: true }), task,
    one, jump, oneText: { querySelector: selector => selector === '.eyebrow' ? eyebrow : label }
  });
  vm.runInContext(`${holderSource}\n${busySource}\n${autoSource}\ndecorateOneThing(task,{one,oneText,jump});`, context);
  return { buttons: one.children[0].children, positioned, jump, label, eyebrow, one };
}


const fullCopy = '計畫不用你核准，每一項 AI 自己檢查過就做下一項。全部做完，你再一次看。';
const taskAt = (kind, full = false) => ({
  id: 'TASK-auto-ui',
  planning: { phase: 'execute', autopilot: { full, waitingFor: { kind, label: '等你處理' } },
    workItems: [{ id: 'W1', owner: 'ai', status: 'REVIEWED' }] },
  nextAction: { kind: 'item', id: 'W1', button: '確認成果' }
});
const descendants = n => [n, ...(n.children || []).flatMap(descendants)];
const find = (view, tag, text) => descendants(view.one).find(n => n.tag === tag && (text === undefined || n.textContent === text));

test('11：確認主按鈕送 confirm-all；先看成果只定位，不送 API', async () => {
  const task = taskAt('confirm'), calls = [], view = card(task, async (...args) => calls.push(args));
  const [confirm, look] = view.buttons;
  assert.equal(confirm.textContent, '確認通過，讓 AI 繼續');
  assert.equal(confirm.className, 'btn primary');
  assert.equal(look.textContent, '先看成果');
  assert.equal(look.className, 'btn');
  look.onclick();
  assert.equal(view.positioned.length, 1);
  assert.equal(calls.length, 0);
  await confirm.onclick();
  assert.deepEqual(calls, [[task, 'confirm-all']]);
  assert.equal(view.positioned.length, 1);
});

test('11：其他停點只定位；error 保留同模型與換模型恢復動作', async () => {
  for (const kind of ['answer', 'human', 'fix-limit', 'needs-info', 'wait', 'error']) {
    const task = taskAt(kind), calls = [], view = card(task, async (...args) => calls.push(args));
    const go = find(view, 'button', '去處理：確認成果');
    assert.ok(go, kind);
    go.onclick();
    assert.equal(view.positioned.length, 1, kind);
    assert.equal(calls.length, 0, kind);
    if (kind === 'error') {
      await find(view, 'button', '用同一個 AI 繼續').onclick();
      assert.equal(calls[0][1], 'autopilot');
      assert.equal(calls[0][2].full, false);
      await find(view, 'button', '改用 Claude 繼續這一次').onclick();
      assert.equal(calls[1][1], 'autopilot');
      assert.equal(calls[1][2].provider, 'claude');
    }
  }
});

test('12–15：停點、進行中與兩處完全自動說明採規格原文', () => {
  const task = taskAt('approve');
  task.planning.phase = 'outline'; task.nextAction.kind = 'outline';
  const view = card(task, () => {});
  assert.match(view.eyebrow.textContent, /^需要你看一下 · /);
  assert.ok(find(view, 'p', '看過成品架構和要做的事，沒問題就按核准，AI 會一路做到驗收完。'));
  assert.ok(find(view, 'small', fullCopy));
  task.planning.autopilot.waitingFor = null;
  assert.equal(card(task, () => {}).label.textContent, 'AI 自己在跑。需要你時會停下來叫你。');
  assert.equal(planningAction(task).label, 'AI 自己在跑。需要你時會停下來叫你。');
  task.planning.autopilot = null;
  assert.ok(find(card(task, () => {}), 'small', fullCopy));
  const dialog = html.slice(html.indexOf('<dialog id="draft-dialog"'), html.indexOf('</dialog>', html.indexOf('<dialog id="draft-dialog"')));
  assert.ok(dialog.includes(`<small>${fullCopy}計畫錯了後面會白跑，建議只用在小任務。</small>`));
});

test('16：未開自動的人工步驟採指定文案，仍沿用 autopilot', async () => {
  const task = taskAt('human'); task.planning.autopilot = null;
  const calls = [], view = card(task, async (...args) => calls.push(args));
  await find(view, 'button', '這步之後交給 AI 跑完').onclick();
  assert.equal(calls[0][1], 'autopilot');
  assert.equal(calls[0][2].full, false);
});

test('17：一般自動的每種停點可勾選 full:true，完全自動與進行中不顯示切換', async () => {
  for (const kind of ['approve', 'confirm', 'answer', 'human', 'fix-limit', 'needs-info', 'wait', 'error']) {
    const task = taskAt(kind), calls = [], view = card(task, async (...args) => calls.push(args));
    assert.ok(find(view, 'strong', '改成完全自動'), kind);
    const checkbox = find(view, 'input');
    assert.equal(checkbox.checked, false);
    checkbox.checked = true;
    await checkbox.onchange();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], task);
    assert.equal(calls[0][1], 'autopilot');
    assert.equal(JSON.stringify(calls[0][2]), '{"full":true}');
    assert.equal(checkbox.disabled, false);
    assert.equal(find(card(taskAt(kind, true), () => {}), 'strong', '改成完全自動'), undefined);
  }
  const task = taskAt('confirm'); task.planning.autopilot.waitingFor = null;
  assert.equal(find(card(task, () => {}), 'input'), undefined);
});

test('17：切換期間不重送，失敗還原勾選並可重試；取消勾選不送 API', async () => {
  let reject, calls = 0;
  const checkbox = find(card(taskAt('approve'), () => { calls++; return new Promise((resolve, fail) => { reject = fail; }); }), 'input');
  await checkbox.onchange();
  assert.equal(calls, 0);
  checkbox.checked = true;
  const pending = checkbox.onchange();
  assert.equal(checkbox.disabled, true);
  await checkbox.onchange();
  assert.equal(calls, 1);
  reject(new Error('切換失敗')); await pending;
  assert.equal(checkbox.checked, false);
  assert.equal(checkbox.disabled, false);
  checkbox.checked = true;
  const retry = checkbox.onchange();
  assert.equal(calls, 2);
  reject(new Error('重試失敗')); await retry;
});

async function waitFor(check) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  assert.fail('自動流程未在 15 秒內到達預期停點');
}

test('無連接埠：停點切成完全自動 → 批次確認 → 人工項目停點', async t => {
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
  const created = await coach.create({ request: '我要做一份新品簡報給主管十頁', profile: 'standard', autopilot: true });
  await created.done;
  const latest = async () => (await store.get(created.task.id)).task;
  const idle = () => !coach.drivers.has(created.task.id) && !coach.pending.has(created.task.id);
  await waitFor(async () => (await latest()).planning.autopilot?.waitingFor?.kind === 'approve' && idle());

  const task = await latest(); task.nextAction = planningAction(task);
  const switchView = card(task, async (current, action, payload) => {
    assert.equal(action, 'autopilot');
    await coach.setAutopilot(current.id, current.revision, 'auto-ui-full-001', payload);
  });
  const checkbox = find(switchView, 'input'); checkbox.checked = true;
  await checkbox.onchange();
  await waitFor(async () => (await latest()).planning.autopilot?.waitingFor?.kind === 'confirm' && idle());
  const reviewed = await latest(); reviewed.nextAction = planningAction(reviewed);
  assert.equal(reviewed.planning.autopilot.full, true);
  assert.deepEqual(reviewed.planning.workItems.filter(i => i.owner === 'ai').map(i => i.status), ['REVIEWED', 'REVIEWED']);
  const confirmView = card(reviewed, async (current, action) => {
    assert.equal(action, 'confirm-all');
    await coach.confirmAll(current.id, current.revision, 'auto-ui-confirm-001');
    coach.resumeAuto(current.id);
  });
  confirmView.buttons[1].onclick();
  assert.ok((await latest()).planning.workItems.some(i => i.status === 'REVIEWED'));
  await confirmView.buttons[0].onclick();
  await waitFor(async () => (await latest()).planning.autopilot?.waitingFor?.kind === 'human' && idle());
  assert.ok((await latest()).planning.workItems.filter(i => i.owner === 'ai').every(i => i.status === 'DONE'));
});
