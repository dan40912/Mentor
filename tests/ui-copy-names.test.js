import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { itemName, itemNames } from '../src/item-names.js';
import { planningAction } from '../src/tasks.js';
import { Coach } from '../src/coach.js';
import { stages, profiles } from '../src/models.js';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const [shared, html, control, auto, server] = await Promise.all([
  read('web/assets/item-names.js'), read('web/index.html'), read('web/assets/control.js'),
  read('web/assets/auto.js'), read('src/server.js')
]);
const holder = html.split('\n').find(line => line.startsWith('const holderOf='));
const render = html.slice(html.indexOf('function renderPlanning('), html.indexOf('// 使用者正在輸入或展開行內表單時'));
const track = html.slice(html.indexOf('function trackOf('), html.indexOf('function track(t,'));
function node(tag, text = '', className = '') {
  return { tag, textContent: text ?? '', className, dataset: {}, style: {}, children: [],
    classList: { add() {} }, setAttribute() {}, remove() {},
    append(...children) { this.children.push(...children); },
    prepend(...children) { this.children.unshift(...children); }
  };
}
const all = root => [root, ...root.children.flatMap(c => typeof c === 'object' ? all(c) : [])];
const texts = root => all(root).map(n => n.textContent);
const work = (id, status = 'TODO', dependsOn = []) => ({ id, title: `${id} 的素材標題`, status, dependsOn, owner: 'ai', acceptance: [] });
const task = (phase, items = []) => ({ id: 'TASK-test', status: 'READY', planning: {
  phase, workItems: items, messages: [], card: {}, outline: { storyline: '主線', sections: [], coaching: '檢查來源' }
} });
function context(extra = {}) {
  const ctx = vm.createContext({ element: node, taskAttachmentPicker: () => ({ host: node('div'), picker: { ids: async () => [], lock() {}, consume() {} } }), section: title => node('section', title),
    focusKey: b => b, busy: (b, fn) => fn, state: { profiles: [], providers: [], stages },
    agentOfTask: () => 'AI', agentOf: () => 'AI', stageLabel: id => stages.find(s => s.id === id)?.name,
    agentChoices: () => [], agentValue: () => 'inherit', options() {},
    questionBox: () => node('details'),
    instructionBox: (t, { extraButtons = [] } = {}) => { const form = node('form');form.append(...extraButtons);return form; }, learningPanel: () => null, cardPanel: () => node('div'),
    auditPanel: () => node('details'), itemStatus: {}, visualIcon: {}, tell() {},
    ...extra });
  vm.runInContext(shared, ctx);
  vm.runInContext(html.slice(html.indexOf('function diffButton('),html.indexOf('async function openDiff(')),ctx);
  vm.runInContext(html.slice(html.indexOf('function reviewButton('), html.indexOf('function openReview(')), ctx);
  return ctx;
}

test('規格 5：前後端同源名稱與多項依賴格式，未知 id 原樣保留', () => {
  const ctx = context();
  for (const [id, name] of [['W0', '骨架版'], ['W1', '第 1 項'], ['R1', '第 2 輪'], ['R2', '第 3 輪'], ['OTHER', 'OTHER']]) {
    assert.equal(itemName(id), name);
    assert.equal(ctx.itemName(id), itemName(id));
  }
  assert.equal(itemNames(['W1', 'W2']), '第 1、2 項');
  assert.equal(ctx.itemNames(['W1', 'W2']), itemNames(['W1', 'W2']));
  assert.equal(itemNames(['W0', 'W1', 'R1']), '骨架版、第 1 項、第 2 輪');
  assert.equal(itemNames([]), '');
});

test('共用資源先載入，server 白名單、MIME 與檔案路徑可提供同一份實作', async () => {
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  for (const name of ['control', 'auto']) assert.ok(scripts.indexOf('/assets/item-names.js') < scripts.indexOf(`/assets/${name}.js`));
  assert.match(await read('src/item-names.js'), /import '\.\.\/web\/assets\/item-names\.js'/);
  const pattern = server.match(/(\/\^\\\/assets\\\/.*?\/).test\(req.url\)/)[1];
  const allowed = vm.runInNewContext(pattern);
  assert.ok(allowed.test('/assets/item-names.js'));
  assert.ok(!allowed.test('/assets/../item-names.js'));
  assert.ok(!allowed.test('/assets/other.js'));
  assert.match(server, /req.url.endsWith\('\.js'\) \? 'application\/javascript; charset=utf-8'/);
  assert.match(server, /readFile\(path.join\(webDir, 'assets', path.basename\(req.url\)\)\)/);
});

test('規格 1、2、9、26：label/button 原文與 holderOf 的 AI 動作分類', () => {
  const ctx = context();vm.runInContext(`${holder}\nglobalThis.classify = holderOf;`, ctx);
  const outline = task('outline');
  assert.deepEqual(planningAction(outline), { kind: 'outline', label: '看 AI 的計畫，沒問題就核准', button: '預覽計畫' });
  assert.equal(Coach.prototype.nextStep.call({}, outline, {}).stop.label, '看 AI 的計畫，沒問題就核准');
  const grill = task('grill');grill.planning.readyForOutline = true;
  assert.deepEqual(planningAction(grill), { kind: 'grill', label: '需求問清楚了，可以讓 AI 擬計畫', button: '讓 AI 擬計畫' });
  for (const [status, prefix, button] of [
    ['TODO', '交給 AI 做', '交給 AI 做'], ['AWAITING_REVIEW', '讓 AI 檢查', '讓 AI 檢查'],
    ['REVIEW_FAIL', '驗收沒過，讓 AI 照意見改', '讓 AI 照意見改']
  ]) {
    const t = task('execute', [work('W1', status)]);t.nextAction = planningAction(t);
    assert.equal(t.nextAction.label, `${prefix}：W1 的素材標題`);
    assert.equal(t.nextAction.button, button);assert.equal(t.nextAction.id, 'W1');
    assert.equal(ctx.classify(t), 'ai-ready');
  }
  const t = task('execute', [work('W1', 'REVIEWED')]);t.nextAction = planningAction(t);
  assert.equal(ctx.classify(t), 'you');
});

test('規格 3–8、10、26：實際 renderPlanning 標題、依賴、按鈕與 action payload', async () => {
  const calls = [], ctx = context({ coachAct: async (...args) => calls.push(args), focusInstruct: (...args) => calls.push(['focus', ...args]) });
  vm.runInContext(`${render}\n${track}`, ctx);
  const t = task('outline', [work('W0'), work('W1'), work('W2', 'DONE', ['W1', 'W2'])]);
  t.nextAction = planningAction(t);const detail = node('div');ctx.renderPlanning(t, detail);
  const copy = texts(detail);
  for (const text of ['成品架構', 'AI 打算這樣組織成品。這裡錯了，後面每一項都會跟著錯，所以先看這裡。',
    '要做的事（共 3 項）', '看這份計畫時注意', '預覽並核准計畫', '我要改', '要先完成：第 1、2 項']) assert.ok(copy.includes(text), text);
  assert.ok(copy.includes('骨架版 W0 的素材標題'));
  ctx.previewPlan = async task => calls.push([task, 'preview']);
  await all(detail).find(n => n.textContent === '預覽並核准計畫').onclick();
  assert.deepEqual(calls[0], [t, 'preview']);
  all(detail).find(n => n.textContent === '我要改').onclick();assert.deepEqual(calls[1], ['focus']);
  assert.equal(ctx.trackOf(t).nodes[2].name, '計畫');
  for (const ready of [false, true]) {
    const g = task('grill');g.planning.readyForOutline = ready;g.nextAction = planningAction(g);
    const view = node('div');ctx.renderPlanning(g, view);
    const button = all(view).find(n => n.textContent === (ready ? '讓 AI 擬計畫' : '先讓 AI 擬計畫'));
    assert.ok(button);await button.onclick();assert.equal(calls.at(-1)[1], 'outline');
  }
  for (const [status, text, action] of [['TODO', '交給 AI 做', 'execute'], ['AWAITING_REVIEW', '讓 AI 檢查', 'review'], ['REVIEW_FAIL', '讓 AI 照意見改', 'fix']]) {
    const e = task('execute', [work('W1', status)]);e.nextAction = planningAction(e);
    const view = node('div');ctx.renderPlanning(e, view);
    await all(view).find(n => n.textContent === text).onclick();
    assert.equal(calls.at(-1)[0], e);assert.equal(calls.at(-1)[1], action);
    assert.equal(calls.at(-1)[2].itemId, 'W1');assert.deepEqual(Object.keys(calls.at(-1)[2]), ['itemId']);
  }
  const waiting = task('execute', [work('W1'), work('W2', 'TODO', ['W1'])]);waiting.nextAction = planningAction(waiting);
  const view = node('div');ctx.renderPlanning(waiting, view);
  assert.ok(texts(view).includes('第 1 項完成後才能開始'));
  assert.deepEqual(waiting.planning.workItems[1].dependsOn, ['W1']);
});

test('規格 5、25：停點、impact、R1 顯示採名稱，route/phase/id/依賴不變', () => {
  const items = [work('W0', 'DONE'), work('W1', 'DONE'), work('W2', 'REVIEWED', ['W1'])];
  const t = task('execute', items), before = structuredClone(t);
  const plan = args => Coach.prototype.plan.call({}, t, args);
  const fix = plan({ text: '補來源', scope: 'W1' });
  assert.equal(fix.route, 'fix');assert.equal(fix.itemId, 'W1');
  assert.match(fix.impact, /第 1 項 已確認/);assert.match(fix.impact, /第 2 項 標為待核對/);assert.match(fix.impact, /骨架版 保持原樣/);
  const replan = plan({ text: '重排', scope: 'outline' });assert.equal(replan.route, 'replan');assert.match(replan.impact, /已確認的計畫/);assert.doesNotMatch(replan.impact, /大綱|W\d/);
  assert.deepEqual(t, before);
  t.planning.phase = 'done';const round = plan({ text: '英文版' });assert.equal(round.itemId, 'R1');assert.equal(round.route, 'round');assert.match(round.impact, /新增第 2 輪工作項目/);
  t.planning.phase = 'execute';t.planning.stopped = { stage: 'D', itemId: 'W1' };
  assert.match(plan({}).impact, /重做執行.* 第 1 項/);
  delete t.planning.stopped;t.planning.workItems = [work('W1', 'BLOCKED')];
  const stop = Coach.prototype.nextStep.call({}, t, {}).stop;assert.equal(stop.itemId, 'W1');assert.match(stop.label, /^第 1 項「/);
  t.planning.workItems[0].status = 'REVIEWED';assert.match(Coach.prototype.nextStep.call({}, t, {}).stop.label, /（第 1 項）/);
});

test('控制列、範圍選單、進度卡與模型資料使用新名稱，選單 value 保持 raw id', () => {
  assert.match(control, /itemName\(p.running.workItemId\)/);
  assert.match(control, /itemName\(p.stopped.itemId\)/);
  assert.match(control, /\[w.id,`\$\{itemTitle\(w.id,w.title\)\}/);
  assert.match(html, /element\('span',itemName\(i.id\),'chip-id'\)/);
  assert.match(html, /itemTitle\(item.id,item.title\)/);
  assert.equal(stages.find(s => s.id === 'C').name, '擬計畫');assert.equal(stages.find(s => s.id === 'C').mode, 'read');
  assert.doesNotMatch(profiles.find(p => p.id === 'quick').description, /大綱/);
  assert.match(auto, /label.textContent=stopLabel\(wait.label\)/);
});


test('控制列與 instructionBox 實際顯示名稱，scope value 與工作項目資料保持原值', () => {
  const ctx = context({ composerDrafts: {}, localStorage: { getItem: () => null }, when: () => '現在',
    options: (select, values) => { for (const [value, label] of values) { const option = node('option', label);option.value = value;select.append(option); } }
  });
  vm.runInContext(control, ctx);
  const t = task('execute', [work('W0', 'DONE'), work('W1'), work('R1')]);t.nextAction = planningAction(t);
  const before = structuredClone(t), form = ctx.instructionBox(t);
  const choices = all(form).filter(n => n.tag === 'option');
  assert.ok(choices.some(n => n.value === 'W0' && n.textContent.startsWith('骨架版 ')));
  assert.ok(choices.some(n => n.value === 'W1' && n.textContent.startsWith('第 1 項 ')));
  assert.ok(choices.some(n => n.value === 'R1' && n.textContent.startsWith('第 2 輪 ')));
  assert.ok(choices.some(n => n.value === 'current' && n.textContent.includes('第 1 項 ')));
  assert.deepEqual(t, before);
  t.planning.running = { stage: 'D', workItemId: 'W1', agent: 'AI' };
  const running = ctx.controlBar(t);
  assert.ok(all(running).some(n => n.children.some(c => typeof c === 'string' && c.includes('第 1 項'))));
  delete t.planning.running;t.planning.stopped = { stage: 'D', itemId: 'R1', agent: 'AI' };
  assert.ok(texts(ctx.controlBar(t)).some(text => text.includes('第 2 輪')));
  assert.ok(texts(ctx.instructionBox(t)).some(text => text.includes('第 2 輪')));
});


test('taskAgent 在驗收按鈕改名後仍顯示 E 階段的模型指派', () => {
  const ctx = context();ctx.state.settings = { stages: { D: { provider: 'codex' }, E: { provider: 'claude' } } };
  vm.runInContext(`${holder}\n${html.split('\n').find(line => line.startsWith('function taskAgent('))}`, ctx);
  for (const [status, stage] of [['TODO', 'D'], ['AWAITING_REVIEW', 'E'], ['REVIEW_FAIL', 'E']]) {
    const t = task('execute', [work('W1', status)]);t.nextAction = planningAction(t);
    assert.equal(ctx.taskAgent(t).id, stage);
  }
});

// ui-fullscreen-plan.md 6～9：執行正式渲染函式，檢查顯示與原始資料兩端。
test('全螢幕規格 6：四個入口共用去重規則，一般標題保留名稱，原資料不變', () => {
  const trackView = html.slice(html.indexOf('function track(t,'), html.indexOf('function avatar('));
  for (const [id, name] of [['W0', '骨架版'], ['W1', '第 1 項'], ['R1', '第 2 輪']]) {
    for (const title of [name, `${name}：完成版`, '補齊來源']) {
      const expected = title.startsWith(name) ? title : `${name} ${title}`;
      const t = task('execute', [{ ...work(id), title }]);t.nextAction = planningAction(t);
      const before = structuredClone(t);
      const ctx = context({ composerDrafts: {}, localStorage: { getItem: () => null },
        options: (select, values) => { for (const [value, label] of values) { const option = node('option', label);option.value = value;select.append(option); } }
      });
      vm.runInContext(`${control}\n${render}\n${track}\n${trackView}`, ctx);
      // 卡片（renderPlanning）
      const detail = node('div');ctx.renderPlanning(t, detail);
      assert.ok(all(detail).some(n => n.tag === 'strong' && n.textContent === expected));
      // 補充指示範例及套用範圍選單（包括 current 與 raw id 選項）
      const form = ctx.instructionBox(t);
      assert.equal(all(form).find(n => n.tag === 'textarea').placeholder, `例如：『${expected}』的結論放最前面`);
      const choices = all(form).filter(n => n.tag === 'option');
      assert.equal(choices.find(n => n.value === 'current').textContent, `正在做的：${expected}`);
      assert.equal(choices.find(n => n.value === id).textContent, `${expected}（TODO）`);
      // 頂部標籤：名稱固定獨立一欄，只有標題欄會截斷；tooltip 保留完整文字。
      const top = ctx.track(t, 'you');
      const chip = all(top).find(n => n.className.startsWith('chip-todo'));
      assert.equal(chip.children[0].textContent, name);
      assert.equal(chip.children[1].textContent, expected.slice(name.length).trimStart());
      assert.equal(chip.title, `${expected}｜待開始`);
      assert.deepEqual(t, before);
    }
  }
});

test('全螢幕規格 7～8：驗收提示更新，頂部編號不折行不收縮，標題可截斷', () => {
  const ctx = context();vm.runInContext(render, ctx);
  const w = { ...work('W1'), review: { agent: 'Claude', coaching: '檢查來源' } };
  const t = task('execute', [w]);t.nextAction = planningAction(t);
  const detail = node('div');ctx.renderPlanning(t, detail);
  assert.ok(texts(detail).includes('自己檢查時看這裡（Claude）'));
  assert.ok(!texts(detail).some(text => text.includes('你自己 review 時看這裡')));
  const rule = selector => html.slice(html.indexOf(`${selector}{`) + selector.length + 1).split('}')[0];
  assert.match(rule('.item-chips .chip-id'), /white-space:nowrap/);
  assert.match(rule('.item-chips .chip-id'), /flex-shrink:0/);
  for (const css of ['min-width:0', 'overflow:hidden', 'text-overflow:ellipsis', 'white-space:nowrap']) {
    assert.ok(rule('.item-chips .chip-title').includes(css), css);
  }
});

test('全螢幕規格 9：所有停點入口轉換開頭 W0、W1、R1，原始任務資料不變', () => {
  const boardSource = html.match(/const park=t.planning\?\.autopilot\?\.waitingFor;.*?card.append\(next\);/)[0];
  for (const [label, expected] of [
    ['W0「骨架版」需要資訊', '骨架版「骨架版」需要資訊'],
    ['W1：確認成果', '第 1 項：確認成果'], ['R1 等你確認', '第 2 輪 等你確認'],
    ['第 1 項：確認成果', '第 1 項：確認成果'], ['看 AI 的計畫，沒問題就核准', '看 AI 的計畫，沒問題就核准'],
    ['請確認 W1', '請確認 W1'], ['W1abc 保持文字', 'W1abc 保持文字'],
    ['W12 等你確認 R1', '第 12 項 等你確認 R1']
  ]) {
    const t = task('execute');t.nextAction = { kind: 'item', button: '確認成果' };
    t.planning.autopilot = { full: true, waitingFor: { kind: 'wait', label } };
    const before = structuredClone(t), card = node('div'), one = node('div'), caption = node('strong');
    const ctx = context({ t, card, one, caption, trackOf: () => ({ nodes: [{ name: '執行', state: 'now' }] }),
      oneText: { querySelector: () => caption }, jump: node('button') });
    vm.runInContext(`${auto}\ndecorateOneThing(t,{one,oneText,jump});`, ctx);
    assert.equal(caption.textContent, expected); // 任務頁的現在要做的一件事
    vm.runInContext(boardSource, ctx);
    assert.equal(card.children[0].textContent, `自動停住，等你：${expected}`); // 任務看板
    assert.deepEqual(t, before);
  }
});


test('實際工作項目卡的驗收按鈕傳入該任務與工作項目，無成果也有入口', async () => {
  const calls = [], ctx = context({ openReview: (...args) => calls.push(args) });
  vm.runInContext(render, ctx);
  const t = task('execute', [work('W1'), work('W2')]);t.nextAction = planningAction(t);
  const detail = node('div');ctx.renderPlanning(t, detail);
  const buttons = all(detail).filter(n => n.tag === 'button' && n.textContent === '驗收');
  assert.equal(buttons.length, 2);
  for (const [i, button] of buttons.entries()) {
    await button.onclick();
    assert.deepEqual(calls[i], [t.id, `W${i + 1}`, button]);
  }
});
