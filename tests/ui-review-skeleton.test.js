import test from 'node:test';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture, allText } from './fixtures/review-ui.js';

const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

test('工作項目驗收事件帶入 taskId／itemId，HTML 在左側，右側呈現三欄改動', async () => {
  const f = fixture();assert.equal(f.button.textContent, '驗收');assert.equal(f.button.dataset.previewItem, 'W1');
  assert.match(script, /card\.append\(reviewButton\(t,w\)\)/);
  await f.button.onclick();
  assert.equal(f.dialog.open, true);
  assert.equal(vm.runInContext('previewReturn.taskId', f.ctx), 'TASK-review');
  assert.equal(vm.runInContext('previewReturn.itemId', f.ctx), 'W1');
  assert.equal(f.calls[0], '/api/tasks/TASK-review/preview?file=result.html');
  assert.equal(f.nodes['#preview-title'].textContent, '驗收：搜尋骨架');
  assert.equal(f.nodes['#preview-layout'].classList.contains('review-layout'), true);
  const frame = f.nodes['#preview-content'].children[0];
  assert.equal(frame.tag, 'iframe');assert.equal(frame.src, 'blob:review');assert.equal(frame.getAttribute('sandbox'), 'allow-scripts');
  assert.match(await f.blobs[0].text(), /<label>搜尋<input>/);
  const right = f.nodes['#review-changes'];assert.equal(right.hidden, false);
  assert.match(allText(right), /搜尋頁\n加入搜尋欄位\n試試看\n輸入 Mentor，確認結果出現。/);
  assert.match(html, /id="preview-layout"><div id="preview-content"><\/div><aside id="review-changes"/);
  assert.match(html, /#preview-layout\.review-layout\{display:grid;grid-template-columns:minmax\(0,2fr\) minmax\(240px,1fr\)/);
});

test('沒有 HTML 成果或改動資料時顯示空狀態，不請求第一個說明檔', async () => {
  const f = fixture(), empty = f.tasks[0].planning.workItems[1];
  empty.outputs = [{ file: 'NEEDS_INPUT.md' }];
  f.ctx.probe = { source: 'git', changes: [], reason: '這個項目的登記檔案沒有差異。' };
  await f.ctx.reviewButton(f.tasks[0], empty).onclick();
  assert.equal(f.dialog.open, true);assert.deepEqual(f.calls, ['/api/tasks/TASK-review/review-changes?item=W2']);
  assert.match(allText(f.nodes['#preview-content']), /尚未登記可預覽成果/);
  assert.match(allText(f.nodes['#review-changes']), /沒有差異/);
  assert.equal(f.nodes['#preview-modes'].hidden, true);
  empty.outputs = [];await f.ctx.openReview('TASK-review', 'W2', {});
  assert.ok(f.calls.every(url => url === '/api/tasks/TASK-review/review-changes?item=W2'));
});

test('驗收沿用展開／收合記憶，關閉重開不重設，普通預覽清除右欄', async () => {
  const f = fixture(), expand = f.element('button');expand.dataset.expand = 'preview-dialog';
  f.ctx.restoreDialogExpansion(expand);assert.equal(expand.getAttribute('aria-pressed'), 'false');
  await f.button.onclick();f.ctx.toggleDialogExpansion(expand);
  assert.equal(f.dialog.classList.contains('is-expanded'), true);assert.equal(expand.label.textContent, '收合');
  f.dialog.close();await f.ctx.openReview('TASK-review', 'W2', {});
  assert.equal(f.dialog.classList.contains('is-expanded'), true);
  f.ctx.toggleDialogExpansion(expand);assert.equal(expand.getAttribute('aria-pressed'), 'false');assert.equal(expand.label.textContent, '展開');
  f.dialog.close();await f.button.onclick();assert.equal(f.dialog.classList.contains('is-expanded'), false);
  await f.ctx.openPreview('TASK-review', 'result.html', {});
  assert.equal(f.nodes['#review-changes'].hidden, true);assert.equal(f.nodes['#review-changes'].children.length, 0);
  assert.equal(f.nodes['#preview-layout'].classList.contains('review-layout'), false);
});
