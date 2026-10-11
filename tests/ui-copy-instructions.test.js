import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { Coach } from '../src/coach.js';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const [source, shared, html] = await Promise.all([
  read('web/assets/control.js'), read('web/assets/item-names.js'), read('web/index.html')
]);
const busy = html.split('\n').find(line => line.startsWith('function busy('));
const options = html.split('\n').find(line => line.startsWith('function options('));
const all = root => [root, ...root.children.flatMap(all)];
function element(tag, text = '', className = '') {
  const n = { tag, textContent: text, className, children: [], dataset: {}, disabled: false, hidden: false, isConnected: true,
    append(...children) { for (const c of children) { c.parent = this; this.children.push(c); } },
    replaceChildren(...children) { this.children = []; this.append(...children); },
    setAttribute() {}, removeAttribute() {}, focus() { this.focused = true; },
    closest(tag) { return this.tag === tag ? this : this.parent?.closest(tag); },
    querySelector(selector) {
      return all(this).slice(1).find(c => selector.startsWith('[data-focus=') ? c.dataset.focus === selector.match(/"(.*?)"/)[1]
        : selector.startsWith('.') ? selector.slice(1).split('.').every(cls => c.className.split(' ').includes(cls)) : c.tag === selector);
    },
    click() { return this.onclick?.(); },
    requestSubmit() { return this.onsubmit({ preventDefault() {} }); }
  };
  n.classList = { add(cls) { if (!n.className.split(' ').includes(cls)) n.className += ` ${cls}`; },
    remove(cls) { n.className = n.className.split(' ').filter(x => x !== cls).join(' '); } };
  return n;
}
const work = (id, status = 'TODO') => ({ id, title: id === 'W2' ? '市場分析' : '資料整理', owner: 'ai', status, dependsOn: [] });
const taskAt = (phase = 'execute', status = 'TODO') => ({ id: 'TASK-instructions', nextAction: { id: 'W2' },
  planning: { phase, workItems: [work('W1', 'DONE'), work('W2', status)] } });
function setup(task, act = async () => {}, storage = new Map()) {
  let form;
  const ctx = vm.createContext({ element, taskAttachmentPicker: () => ({ host: element('div'), picker: { ids: async () => [], lock() {}, consume() {} } }), composerDrafts: {},
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    focusKey: (n, key) => { n.dataset.focus = key; return n; },
    itemStatus: {}, stageLabel: () => '執行', agentOf: () => 'AI', tell() {}, coachAct: act,
    document: { getElementById: id => all(form).find(n => n.id === id) }
  });
  vm.runInContext(`${shared}\n${busy}\n${options}\n${source}`, ctx);
  const render = () => { form = ctx.instructionBox(task); return form; };
  render();
  return { ctx, storage, render, get form() { return form; }, get area() { return form.querySelector('textarea'); },
    get send() { return form.querySelector('[data-focus="send-instruct"]'); },
    get chips() { return form.querySelector('.instruct-suggestions')?.children || []; } };
}
const label = view => view.form.querySelector('.instruct-label').textContent;
const enter = (view, text) => { view.area.value = text; view.area.oninput(); };

test('18–20：grill、outline、execute、BLOCKED、done、stopped 原文與建議數量', () => {
  const cases = [
    ['grill', 'TODO', '你的回答', '回答上面的問題；不知道就說不知道，AI 會先給預設值。', []],
    ['outline', 'TODO', '計畫哪裡要改？', '例如：第 3 段刪掉；結論移到最前面。', ['段落太多，併成 3 段', '每段補上資料來源']],
    ['execute', 'TODO', '想調整什麼？', '例如：『第 2 項 市場分析』的結論放最前面', ['照驗收意見修改', '換個做法再試一次', '這項我自己做']],
    ['execute', 'BLOCKED', '想調整什麼？', '例如：『第 2 項 市場分析』的結論放最前面', ['資訊都在任務卡，照現有內容做完，缺的標成假設']],
    ['done', 'DONE', '還想再做什麼？', '例如：再做一份英文版。會建立新一輪，不覆寫已完成的紀錄。', ['再做一份英文版']],
    ['stopped', 'TODO', '繼續前要交代什麼？（可以空白）', '例如：繼續前要補充的資訊。空白也可以直接繼續。', []]
  ];
  for (const [phase, status, title, placeholder, chips] of cases) {
    const task = taskAt(phase === 'stopped' ? 'execute' : phase, status);
    if (phase === 'stopped') task.planning.stopped = { stage: 'D', itemId: 'W2' };
    const view = setup(task);
    assert.equal(label(view), title, phase);
    assert.equal(view.area.placeholder, placeholder, phase);
    assert.deepEqual(view.chips.map(n => n.textContent), chips, phase);
    if (chips.length) assert.ok(view.form.children.indexOf(view.chips[0].parent) < view.form.children.indexOf(view.area));
  }
});

test('18：執行中取 running 項目，名稱支援骨架及輪次；無項目不捏造 id', () => {
  for (const [id, display] of [['W0', '骨架版'], ['R1', '第 2 輪'], ['W2', '第 2 項']]) {
    const task = taskAt();task.planning.workItems.push({ ...work(id), title: '市場分析' });
    task.nextAction.id = 'W1';task.planning.running = { workItemId: id, stage: 'D' };
    assert.equal(setup(task).area.placeholder, `例如：『${display} 市場分析』的結論放最前面`);
  }
  const task = taskAt();task.planning.workItems = [];
  assert.equal(setup(task).area.placeholder, '例如：結論放最前面。');
});

test('19：每種 chip 只填值，保存草稿並更新字數；重建及重新載入後保留，不呼叫 API', () => {
  for (const [phase, status] of [['outline', 'TODO'], ['execute', 'TODO'], ['execute', 'BLOCKED'], ['done', 'DONE']]) {
    let calls = 0;const task = taskAt(phase, status), view = setup(task, () => { calls++; });
    for (const text of view.chips.map(n => n.textContent)) {
      const chip = view.chips.find(n => n.textContent === text);
      assert.equal(chip.type, 'button');chip.click();
      assert.equal(view.area.value, chip.textContent);
      assert.equal(view.storage.get(`awc-draft:${task.id}`), chip.textContent);
      assert.equal(view.form.querySelector('.counter').textContent, `${chip.textContent.length.toLocaleString()}／6,000`);
      view.render();assert.equal(view.area.value, chip.textContent);
      assert.equal(setup(task, () => { calls++; }, view.storage).area.value, chip.textContent);
    }
    assert.equal(calls, 0);
    assert.equal(task.planning.workItems[1].owner, 'ai');
  }
});

test('21–23：範圍、原因與四種送出原文；payload scope 及後端 itemId 保持原值', async () => {
  const coach = new Coach(null, () => ({}), '.', null);
  assert.equal(setup(taskAt('outline')).send.textContent, '請 AI 改計畫');
  assert.equal(coach.plan(taskAt('outline'), { text: '改' }).label, '請 AI 改計畫');
  const task = taskAt(), calls = [], view = setup(task, async (t, action, payload) => calls.push({ action, ...payload }));
  const scope = view.form.querySelector('select'), reason = view.form.querySelector('input');
  assert.ok(all(view.form).some(n => n.textContent === '要改哪裡'));
  assert.ok(all(view.form).some(n => n.textContent === '為什麼要改（選填，AI 會參考）'));
  assert.equal(scope.children[0].textContent, '正在做的：第 2 項 市場分析');
  assert.equal(scope.children.at(-1).textContent, '重排整個計畫（排好後你要再核准一次）');
  assert.deepEqual(scope.children.map(n => n.value), ['current', 'W1', 'W2', 'outline']);
  for (const [value, button, route, itemId] of [
    ['current', '交給 AI 開始做', 'execute', 'W2'], ['W2', '交給 AI 開始做', 'execute', 'W2'],
    ['W1', '請 AI 照這樣改', 'fix', 'W1'], ['outline', '請 AI 重排計畫', 'replan', undefined]
  ]) {
    scope.value = value;scope.onchange();enter(view, '結論先寫');reason.value = '主管要看';reason.oninput();
    assert.equal(view.send.textContent, button);
    const plan = coach.plan(task, { text: view.area.value, scope: value });
    assert.equal(plan.label, button);assert.equal(plan.route, route);assert.equal(plan.itemId, itemId);
    await view.form.requestSubmit();
    assert.deepEqual(calls.at(-1), { action: 'instruct', text: '結論先寫', scope: value, reason: '主管要看', confirmImpact: false, attachmentIds: [] });
  }
});

test('執行中、停止中及未確認停止：chip 可保存草稿，按鈕及快捷鍵禁止送出', async () => {
  for (const stopping of [undefined, {}, { unconfirmed: true }]) {
    const task = taskAt();task.planning.running = { stage: 'D', workItemId: 'W2', stopping };
    let calls = 0;const view = setup(task, () => { calls++; });view.chips[0].click();
    assert.equal(view.send.disabled, true);
    await view.form.requestSubmit();await view.area.onkeydown({ key: 'Enter', ctrlKey: true, preventDefault() {} });
    assert.equal(calls, 0);assert.equal(view.storage.get(`awc-draft:${task.id}`), '照驗收意見修改');
  }
});

test('送出失敗保留文字、原因與範圍草稿，背景重建可重試；成功才清除', async () => {
  const task = taskAt();let fail = true;
  const view = setup(task, async () => { if (fail) throw new Error('連線失敗'); });
  const scope = view.form.querySelector('select'), reason = view.form.querySelector('input');
  scope.value = 'W2';scope.onchange();reason.value = '主管要求';reason.oninput();enter(view, '保留這份草稿');
  await view.form.requestSubmit();
  assert.equal(view.area.value, '保留這份草稿');
  assert.equal(view.form.querySelector('.field-error').textContent, '沒有送出：連線失敗');
  view.render();assert.equal(view.area.value, '保留這份草稿');
  assert.equal(view.form.querySelector('select').value, 'W2');assert.equal(view.form.querySelector('input').value, '主管要求');
  fail = false;await view.form.requestSubmit();view.render();
  assert.equal(view.area.value, '');assert.equal(view.storage.has(`awc-draft:${task.id}`), false);
  assert.equal(view.form.querySelector('select').value, 'current');assert.equal(view.form.querySelector('input').value, '');
});

test('24：影響確認原文，取消及修改草稿不確認；明確點擊才送 confirmImpact:true', async () => {
  const task = taskAt(), calls = [];
  const view = setup(task, async (t, action, payload) => {
    calls.push({ ...payload });if (!payload.confirmImpact) throw Object.assign(new Error('會重排計畫'), { code: 'CONFIRM_IMPACT' });
  });
  const scope = view.form.querySelector('select');scope.value = 'outline';scope.onchange();enter(view, '重排');
  await view.form.requestSubmit();
  assert.equal(view.form.querySelector('.impact').hidden, false);assert.equal(view.send.hidden, true);
  assert.equal(view.form.querySelector('.impact').querySelector('strong').textContent, '這樣改會動到這些地方');
  assert.equal(view.form.querySelector('[data-focus="impact-ok"]').textContent, '知道了，送出');
  assert.equal(view.storage.get(`awc-draft:${task.id}`), '重排');assert.equal(calls.length, 1);
  view.form.querySelector('.impact').querySelector('.btn.subtle').click();
  assert.equal(view.send.hidden, false);assert.equal(calls.length, 1);
  await view.form.requestSubmit();view.chips[0].click();
  assert.equal(view.form.querySelector('.impact').hidden, true);assert.equal(calls.length, 2);
  await view.form.requestSubmit();
  await view.form.querySelector('[data-focus="impact-ok"]').click();
  assert.equal(calls.length, 4);assert.equal(calls.at(-1).confirmImpact, true);assert.equal(calls.at(-1).scope, 'outline');
  assert.equal(calls.at(-1).text, '照驗收意見修改');assert.equal(view.storage.has(`awc-draft:${task.id}`), false);
});

test('stopped 可空白接續、done 仍建立新一輪；影響確認後才送出', async () => {
  for (const phase of ['stopped', 'done']) {
    const task = taskAt(phase === 'stopped' ? 'execute' : phase);
    if (phase === 'stopped') task.planning.stopped = { stage: 'D', itemId: 'W2' };
    const calls = [], view = setup(task, async (t, action, payload) => {
      calls.push({ ...payload });if (!payload.confirmImpact) throw Object.assign(new Error('需確認'), { code: 'CONFIRM_IMPACT' });
    });
    if (phase === 'done') view.chips[0].click();
    assert.equal(view.send.textContent, phase === 'done' ? '建立新一輪' : '繼續任務');
    await view.form.requestSubmit();assert.equal(calls.length, 1);assert.equal(calls[0].confirmImpact, false);
    await view.form.querySelector('[data-focus="impact-ok"]').click();assert.equal(calls.length, 2);
    assert.equal(calls[1].confirmImpact, true);assert.equal(calls[1].text, phase === 'done' ? '再做一份英文版' : '');
  }
});

test('影響確認開啟後若開始執行，確認按鈕也不能送出且草稿保留', async () => {
  const task = taskAt();let calls = 0;
  const view = setup(task, async () => { calls++;throw Object.assign(new Error('需確認'), { code: 'CONFIRM_IMPACT' }); });
  enter(view, '保留草稿');await view.form.requestSubmit();
  task.planning.running = { stage: 'D', workItemId: 'W2' };
  await view.form.querySelector('[data-focus="impact-ok"]').click();
  assert.equal(calls, 1);assert.equal(view.area.value, '保留草稿');
  assert.equal(view.storage.get(`awc-draft:${task.id}`), '保留草稿');
});
