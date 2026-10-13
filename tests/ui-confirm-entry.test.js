import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fixture, allText } from './fixtures/review-ui.js';

const auto = await readFile(new URL('../web/assets/auto.js', import.meta.url), 'utf8');
const names = await readFile(new URL('../web/assets/item-names.js', import.meta.url), 'utf8');
function topEntry() {
  const f = fixture(), one = f.element('div'), item = f.tasks[0].planning.workItems[0];
  vm.runInContext(names + '\n' + auto.slice(auto.indexOf('function appendConfirmArtifacts('), auto.indexOf('function jumpToNext(')), f.ctx);
  f.ctx.appendConfirmArtifacts(f.tasks[0], one, [item]);
  return { ...f, one, row: one.children[0].children[0], item };
}

test('單一頂部成果列包含名稱、驗收及預設收合的過程檔案入口', () => {
  const f = topEntry(), [name, button, details] = f.row.children;
  assert.equal(f.one.children[0].children.length, 1);
  assert.equal(f.row.children.length, 3);
  assert.equal(name.textContent, '第 1 項 搜尋骨架');
  assert.equal(button.textContent, '驗收');assert.equal(button.type, 'button');
  assert.equal(details.tag, 'details');assert.notEqual(details.open, true);
  assert.equal(details.getAttribute('open'), undefined);
  assert.equal(details.children[0].tag, 'summary');
  assert.equal(details.children[0].textContent, '過程檔案（1）');
  assert.equal(details.children[1].textContent, 'NEEDS_INPUT.md');
  assert.equal(f.calls.length, 0);
});

test('頂部驗收按鈕帶入該項 taskId／itemId，載入既有成果與改動清單', async () => {
  const f = topEntry(), button = f.row.children[1];
  await button.onclick();
  assert.equal(f.dialog.open, true);
  assert.equal(vm.runInContext('previewReturn.taskId', f.ctx), f.tasks[0].id);
  assert.equal(vm.runInContext('previewReturn.itemId', f.ctx), f.item.id);
  assert.equal(vm.runInContext('previewReturn.trigger', f.ctx), button);
  assert.deepEqual(f.calls, ['/api/tasks/TASK-review/preview?file=result.html']);
  assert.equal(f.nodes['#preview-title'].textContent, '驗收：搜尋骨架');
  assert.equal(f.nodes['#preview-content'].children[0].tag, 'iframe');
  assert.match(await f.blobs[0].text(), /<label>搜尋<input>/);
  assert.match(allText(f.nodes['#review-changes']), /加入搜尋欄位/);
});


test('多項頂部成果各列包含正確名稱與檔案數，驗收開啟對應項目', async () => {
  const f=topEntry(),task=f.tasks[0];
  const second=task.planning.workItems[1];second.title='第二份成果';
  second.outputs=[{file:'second.html'},{file:'trace.log'},{file:'process-notes.md'}];
  const empty={id:'W3',title:'空檔案',outputs:[],changes:[]};task.planning.workItems.push(empty);
  f.one.replaceChildren();f.ctx.appendConfirmArtifacts(task,f.one,task.planning.workItems);
  const rows=f.one.children[0].children;
  assert.equal(rows.length,3);
  for(const [index,expected] of [['第 1 項 搜尋骨架',['NEEDS_INPUT.md']],['第 2 項 第二份成果',['trace.log','process-notes.md']],['第 3 項 空檔案',[]]].entries()){
    const [name,button,details]=rows[index].children;
    assert.equal(rows[index].children.length,3);assert.equal(name.textContent,expected[0]);
    assert.equal(button.textContent,'驗收');assert.equal(button.dataset.previewItem,task.planning.workItems[index].id);
    assert.notEqual(details.open,true);assert.equal(details.children[0].textContent,`過程檔案（${expected[1].length}）`);
    assert.deepEqual(details.children.slice(1).map(n=>n.textContent),expected[1]);
  }
  await rows[1].children[1].onclick();assert.equal(f.ctx.previewReturn.itemId,'W2');
  assert.match(f.calls.at(-1),/file=second.html/);
  const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
  assert.match(html,/\.confirm-artifacts \.outputs\{[^}]*flex-wrap:nowrap;align-items:baseline/);
});
