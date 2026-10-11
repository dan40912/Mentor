import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const preview = script.slice(script.indexOf('function toggleDialogExpansion('), script.indexOf('// 行內表單取代 prompt()'));
function button(dataset = {}) {
  const attrs = { 'aria-pressed': 'false' }, label = {};
  return { dataset, hidden: false, label, getAttribute: key => attrs[key],
    setAttribute: (key, value) => { attrs[key] = value; }, querySelector: () => label, focus() {} };
}

test('兩個展開按鈕接上事件，任務按鈕位於選單左側，切換互不影響', () => {
  const dialogs = new Map(['task-dialog', 'preview-dialog'].map(id => {
    let expanded = false;
    return [id, { id, classList: { toggle: (_, force) => (expanded = force === undefined ? !expanded : force) } }];
  }));
  const buttons = [...dialogs.keys()].map(id => button({ expand: id }));
  const ctx = vm.createContext({ document: { getElementById: id => dialogs.get(id), querySelectorAll: () => buttons }, Blob });
  vm.runInContext(preview, ctx);
  const wiring = script.split('\n').find(line => line.startsWith("document.querySelectorAll('[data-expand]')"));
  vm.runInContext(wiring, ctx);
  for (const b of buttons) {
    assert.match(html, new RegExp('data-expand="' + b.dataset.expand + '"'));
    b.onclick();assert.equal(b.getAttribute('aria-pressed'), 'true');assert.equal(b.label.textContent, '收合');
    assert.match(b.getAttribute('aria-label'), /^收合/);
    b.onclick();assert.equal(b.getAttribute('aria-pressed'), 'false');assert.equal(b.label.textContent, '展開');
  }
  buttons[0].onclick();assert.equal(buttons[1].getAttribute('aria-pressed'), 'false');
  assert.ok(html.indexOf('data-expand="task-dialog"') < html.indexOf('<span id="task-menu-slot">'));
  assert.match(html, /@media\(min-width:701px\).*#task-dialog\.is-expanded,#preview-dialog\.is-expanded/);
});

test('實際 openPreview 的 Markdown 分支與原始碼按鈕來回切換，HTML 保留桌面／手機', async () => {
  const source = button(), desktop = button({ previewMode: 'desktop' }), mobile = button({ previewMode: 'mobile' });
  const modes = { hidden: true, querySelector: selector => selector.includes('desktop') ? desktop : mobile, querySelectorAll: () => [desktop, mobile] };
  const content = { classList: { remove() {} }, replaceChildren(node) { this.node = node; } };
  const dialog = { open: false, showModal() { this.open = true; }, querySelector: () => button() };
  const status = {}, title = {}, blobs = [], revoked = [];
  const nodes = { '#preview-dialog': dialog, '#preview-content': content, '#preview-status': status, '#preview-title': title,
    '#preview-modes': modes, '#preview-source': source };
  const raw = '# 標題\n\n**重點** <script>alert(1)</script> & 原文';
  const ctx = vm.createContext({
    $: selector => selector === '#preview-content .markdown-preview' ? content.node : nodes[selector],
    element: tag => ({ tag, setAttribute(key, value) { this[key] = value; } }),
    fetch: async () => ({ ok: true, text: async () => '<pre>'+raw.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</pre>' }),
    Blob, URL: { createObjectURL(blob) { blobs.push(blob);return 'blob:' + blobs.length; }, revokeObjectURL(url) { revoked.push(url); } },
    refreshSession: async () => {}, previewReturn: null, previewBlob: null
  });
  vm.runInContext(preview, ctx);
  const wire = script.split('\n').find(line => line.startsWith("$('#preview-source').onclick="));
  vm.runInContext(wire, ctx);
  await ctx.openPreview('task-1', 'readme.md', {});
  assert.equal(content.node.tag, 'div');assert.equal(content.node.sandbox, undefined);
  assert.equal(content.node.tabIndex, 0);assert.equal(blobs.length, 0);
  assert.match(html, /\.markdown-preview\{[^}]*overflow:auto/);
  assert.equal(modes.hidden, false);assert.equal(source.hidden, false);assert.equal(desktop.hidden, true);
  const rendered = content.node.innerHTML;
  assert.match(rendered, /<h1>標題<\/h1>/);assert.match(rendered, /<strong>重點<\/strong>/);
  assert.match(rendered, /&lt;script&gt;/);assert.doesNotMatch(rendered, /<script>/);
  source.onclick();
  assert.equal(source.getAttribute('aria-pressed'), 'true');
  assert.match(content.node.innerHTML, /<pre>\n# 標題/);
  assert.match(content.node.innerHTML, /\*\*重點\*\*/);
  assert.equal((content.node.innerHTML).split('<pre>\n')[1].split('</pre>')[0], ctx.escapeMarkdown(raw));
  source.onclick();assert.equal(source.getAttribute('aria-pressed'), 'false');
  assert.equal(content.node.innerHTML, rendered);assert.equal(revoked.length, 0);assert.equal(blobs.length, 0);
  assert.equal(content.node.sandbox, undefined);
  assert.match(html, /id="preview-modes"[^>]*>[\s\S]*?data-preview-mode="desktop"[\s\S]*?data-preview-mode="mobile"[\s\S]*?id="preview-source"[^>]*>原始碼<\/button><\/div>/);
  await ctx.openPreview('task-1', 'page.html', {});
  assert.equal(source.hidden, true);assert.equal(desktop.hidden, false);assert.equal(mobile.hidden, false);
  assert.equal(content.node.sandbox, 'allow-scripts');assert.equal(modes.hidden, false);
  assert.match(html, /id="preview-source"[^>]*aria-pressed="false" hidden/);
});

test('Markdown 原文在排版與原始碼模式均跳脫 HTML，只輸出安全片段', async () => {
  const ctx = vm.createContext({ Blob });vm.runInContext(preview, ctx);
  for (const source of [true, false]) {
    const body = ctx.markdownPreviewBody('<img src=x onerror="alert(1)"> & **內容**', source);
    assert.match(body, /&lt;img/);assert.match(body, /&quot;/);assert.match(body, /&amp;/);
    assert.doesNotMatch(body, /<img|script-src/);assert.doesNotMatch(body, /<script|<iframe/);
  }
});
