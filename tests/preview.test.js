import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPreviewBoundaries } from './fixtures/preview-fixture.js';

const root = path.dirname(fileURLToPath(import.meta.url));

test('registered preview files and security boundaries without HTTP', verifyPreviewBoundaries);

test('preview UI isolates HTML, renders safe Markdown and preserves keyboard return path', async () => {
  const html = await readFile(path.join(root, '..', 'web', 'index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const vm = await import('node:vm');
  new vm.Script(script);
  const preview = script.slice(script.indexOf('async function openPreview('), script.indexOf('// 行內表單取代 prompt()'));
  assert.match(preview, /setAttribute\('sandbox',ext==='html'\?'allow-scripts':''\)/);
  // HTML 仍用已抓到的內容做 blob 網址；Markdown 僅插入安全 renderer 的結果。
  assert.match(preview, /previewBlob=URL\.createObjectURL\(body\);\s*node\.src=previewBlob;content\.replaceChildren\(node\)/);
  assert.match(preview, /http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'/);
  assert.match(preview, /catch\(error\)\{if\(dialog\.open&&previewReturn\?\.file===file&&previewReturn\?\.taskId===taskId&&previewReturn\?\.trigger===trigger\)/);
  assert.match(preview, /node\.innerHTML=markdownPreviewBody\(previewMarkdown,false\)/);
  assert.match(preview, /node\.textContent=raw;node\.tabIndex=0;content\.replaceChildren\(node\)/);
  assert.match(preview, /node=text\?element\('pre',undefined,'text-preview'\)/);
  assert.doesNotMatch(preview, /srcdoc|\.innerHTML\s*=\s*(?:html|wrapped|await response\.text)/);
  assert.match(html, /id="preview-dialog"/);
  assert.match(html, /preview-dialog'\)\.addEventListener\('close'/);
  assert.match(html, /\.focus\(\{preventScroll:true\}\)/);
});

test('HTML preview mode changes the iframe viewport width and remains keyboard accessible', async () => {
  const html = await readFile(path.join(root, '..', 'web', 'index.html'), 'utf8');
  assert.match(html, /#preview-content\.mobile iframe\{width:min\(390px,100%\)\}/);
  assert.match(html, /#preview-content iframe\{[^}]*border:0;/);
  assert.match(html, /id="preview-modes"[^>]*role="group"[^>]*hidden/);
  assert.match(html, /<button[^>]*data-preview-mode="desktop"[^>]*aria-pressed="true"/);
  assert.match(html, /<button[^>]*data-preview-mode="mobile"[^>]*aria-pressed="false"/);
  assert.match(html, /content\.classList\.remove\('mobile'\);modes\.hidden=true/);
  assert.match(html, /modes\.hidden=ext!=='html'/);
  assert.match(html, /classList\.toggle\('mobile',mode\.dataset\.previewMode==='mobile'\)/);
  assert.match(html, /setAttribute\('aria-pressed',String\(button===mode\)\)/);
  const handler = html.match(/\$\('#preview-modes'\)\.addEventListener\('click',event=>\{[^\n]+\}\);/)?.[0];
  assert.ok(handler);
  const buttons = ['desktop', 'mobile'].map(value => ({ dataset: { previewMode: value }, setAttribute(name, pressed) { this[name] = pressed; } }));
  let click, mobile = false;
  const modes = { addEventListener(type, fn) { assert.equal(type, 'click'); click = fn; }, querySelectorAll() { return buttons; } };
  const content = { classList: { toggle(name, enabled) { assert.equal(name, 'mobile'); mobile = enabled; } } };
  const vm = await import('node:vm');
  vm.runInNewContext(handler, { $: selector => selector === '#preview-modes' ? modes : content });
  click({ target: { closest: () => buttons[1] } });
  assert.equal(mobile, true);
  assert.deepEqual(buttons.map(button => button['aria-pressed']), ['false', 'true']);
  click({ target: { closest: () => buttons[0] } });
  assert.equal(mobile, false);
  assert.deepEqual(buttons.map(button => button['aria-pressed']), ['true', 'false']);
});
