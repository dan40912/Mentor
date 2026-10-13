import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const expansion = script.slice(script.indexOf('function toggleDialogExpansion('), script.indexOf('// 行內表單取代 prompt()'));
const wiring = script.split('\n').find(line => line.startsWith("document.querySelectorAll('[data-expand]')"));
const key = id => `mentor-${id}-expanded-v1`;
function fixture(storage = new Map(), fail = {}) {
  const nodes = new Map(), buttons = [], reads = [], writes = [];
  function node(id) {
    const classes = new Set(), attrs = {}, listeners = {};
    return { id, dataset: {}, open: false, label: {},
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
        toggle(c, force) { const on = force === undefined ? !classes.has(c) : force;on ? classes.add(c) : classes.delete(c);return on; } },
      getAttribute: k => attrs[k], setAttribute: (k, v) => { attrs[k] = v; },
      addEventListener: (type, fn) => { listeners[type] = fn; },
      dispatch(type, event) { listeners[type]?.(event); },
      querySelector: () => node('child'),
      querySelectorAll: () => [], replaceChildren() {}, append() {}, focus() {}, contains: () => false,
      showModal() { this.open = true; }, close() { this.open = false;listeners.close?.(); }
    };
  }
  function get(selector) { if (!nodes.has(selector)) nodes.set(selector, node(selector.slice(1)));return nodes.get(selector); }
  for (const id of ['task-dialog', 'preview-dialog']) {
    get('#' + id);const b = node('button');b.dataset.expand = id;
    b.querySelector = () => b.label;buttons.push(b);
  }
  const ctx = vm.createContext({
    $: get, document: { getElementById: id => get('#' + id), querySelectorAll: () => buttons, activeElement: null }, Blob,
    localStorage: {
      getItem(k) { reads.push(k);if (fail.read) throw Error('blocked');return storage.get(k) ?? null; },
      setItem(k, v) { writes.push([k, v]);if (fail.write) throw Error('full');storage.set(k, v); }
    },
    fetch: async () => ({ ok: false, json: async () => ({ message: 'test fixture' }) }),
    tasks: [{ id: 'a', title: 'a', error: 'fixture' }, { id: 'b', title: 'b', error: 'fixture' }],
    restoreFocus: null, holderOf: () => 'you', holderText: { you: '你' }, taskMenu() {}, element: () => node('p'),
    matchMedia: () => ({ matches: true }), afterSheetClose() {}, previewReturn: null, previewBlob: null
  });
  vm.runInContext(expansion, ctx);vm.runInContext(wiring, ctx);
  vm.runInContext(script.slice(script.indexOf('function openTask('), script.indexOf('function renderSessions(')), ctx);
  vm.runInContext(script.split('\n').find(line => line.startsWith('function closeSheet(')), ctx);
  vm.runInContext(script.split('\n').find(line => line.startsWith("$('#task-dialog').addEventListener('cancel'")), ctx);
  // cancel 的選單／刪除確認分支保持原樣，此 fixture 驗證一般 Esc 關閉分支。
  get('#task-menu-slot details[open]');nodes.set('#task-menu-slot details[open]', null);
  nodes.set('#task-detail .trash-confirm', null);
  return { ctx, get, buttons, reads, writes };
}
function expectState(f, index, expanded) {
  const b = f.buttons[index], id = b.dataset.expand;
  assert.equal(f.get('#' + id).classList.contains('is-expanded'), expanded);
  assert.equal(b.getAttribute('aria-pressed'), String(expanded));
  assert.equal(b.label.textContent, expanded ? '收合' : '展開');
  assert.equal(b.getAttribute('aria-label'), `${expanded ? '收合' : '展開'}${index ? '成果預覽' : '任務頁'}`);
}

test('展開／收合同步標籤，兩組記憶獨立，重新載入還原 true 與 false', () => {
  const storage = new Map(), f = fixture(storage);
  expectState(f, 0, false);expectState(f, 1, false);assert.equal(f.writes.length, 0);
  f.buttons[0].onclick();expectState(f, 0, true);expectState(f, 1, false);
  f.buttons[1].onclick();expectState(f, 1, true);
  f.buttons[0].onclick();expectState(f, 0, false);expectState(f, 1, true);
  assert.equal(storage.get(key('task-dialog')), 'false');assert.equal(storage.get(key('preview-dialog')), 'true');
  const reloaded = fixture(storage);expectState(reloaded, 0, false);expectState(reloaded, 1, true);
  reloaded.buttons[0].onclick();const both = fixture(storage);expectState(both, 0, true);expectState(both, 1, true);
});

test('實際 openTask 與 openPreview 再次開啟沿用展開，Esc cancel 仍關閉任務', async () => {
  const f = fixture();f.buttons[0].onclick();f.buttons[1].onclick();
  f.ctx.openTask('a');assert.equal(f.get('#task-dialog').open, true);
  let prevented = false;f.get('#task-dialog').dispatch('cancel', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);assert.equal(f.get('#task-dialog').open, false);expectState(f, 0, true);
  f.ctx.openTask('b');assert.equal(f.get('#task-dialog').open, true);expectState(f, 0, true);
  await f.ctx.openPreview('a', 'first.html', {});assert.equal(f.get('#preview-dialog').open, true);
  f.get('#preview-dialog').close();await f.ctx.openPreview('b', 'second.html', {});
  assert.equal(f.get('#preview-dialog').open, true);expectState(f, 1, true);
});

for (const fail of [{ read: true }, { write: true }, { read: true, write: true }]) {
  test(`localStorage 失敗仍可操作：${JSON.stringify(fail)}`, async () => {
    const f = fixture(new Map([[key('task-dialog'), 'true'], [key('preview-dialog'), 'true']]), fail);
    for (let i = 0; i < 2; i++) {
      const initial = !fail.read;expectState(f, i, initial);
      f.buttons[i].onclick();expectState(f, i, !initial);f.buttons[i].onclick();expectState(f, i, initial);
      if (!initial) f.buttons[i].onclick();
    }
    f.ctx.openTask('a');f.get('#task-dialog').close();f.ctx.openTask('b');expectState(f, 0, true);
    await f.ctx.openPreview('a', 'x.html', {});f.get('#preview-dialog').close();
    await f.ctx.openPreview('a', 'y.html', {});expectState(f, 1, true);
    assert.equal(f.reads.length, 2);assert.ok(f.writes.length >= 4);
  });
}

test('非法儲存值採收合；靜態尺寸、閱讀欄寬、手機與 SVG 控制符合規格', () => {
  const f = fixture(new Map([[key('task-dialog'), 'garbage']]));expectState(f, 0, false);
  assert.match(html, /@media\(min-width:701px\)\{#task-dialog\.is-expanded,#preview-dialog\.is-expanded\{box-sizing:border-box;inset:16px;margin:0;width:calc\(100vw - 32px\);max-width:none;height:calc\(100dvh - 32px\);max-height:none/);
  assert.match(html, /#task-dialog\.is-expanded #task-detail\{max-width:1200px;margin-inline:auto\}/);
  assert.match(html, /@media\(max-width:700px\)\{\[data-expand\]\{display:none\}\}/);
  assert.match(html, /@media\(max-width:700px\)\{dialog\.sheet\{width:100vw/);
  assert.match(html, /@media\(max-width:700px\)\{#preview-dialog\{width:100%;max-width:100%;height:100dvh/);
  const task = html.match(/<dialog id="task-dialog"[\s\S]*?<\/dialog>/)[0];
  assert.ok(task.indexOf('data-expand="task-dialog"') < task.indexOf('id="task-menu-slot"'));
  for (const id of ['task-dialog', 'preview-dialog']) {
    const markup = html.match(new RegExp('<button[^>]+data-expand="' + id + '"[\\s\\S]*?</button>'))[0];
    assert.match(markup, /type="button"/);assert.match(markup, /aria-label="展開/);
    assert.equal((markup.match(/<svg[^>]+aria-hidden="true"/g) || []).length, 2);
  }
  assert.match(html, /\[data-expand\]\[aria-pressed="true"\] \.expand-icon\{display:none\}/);
  assert.match(html, /\[data-expand\]\[aria-pressed="true"\] \.collapse-icon\{display:inline\}/);
});
