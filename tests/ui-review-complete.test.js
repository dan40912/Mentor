import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, allText } from './fixtures/review-ui.js';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('成果按有效 change path、HTML、MD、圖片排序，過程檔案收合且數量正確', async () => {
  const f=fixture(), item=f.tasks[0].planning.workItems[0];
  item.outputs=['NEEDS_INPUT.md','trace.log','meta.json','process-notes.md','README.md','z.png','b.md','a.html','b.html'].map(file=>({file}));
  item.changes[0].path='b.md';
  const files=f.ctx.reviewFiles(item);
  assert.deepEqual(Array.from(files.candidates),['b.md','a.html','b.html','z.png']);
  assert.equal(files.process.length,5);
  item.changes[0].path='absent.html';assert.equal(f.ctx.reviewFiles(item).candidates[0],'a.html');
  const details=f.ctx.processFiles(f.tasks[0],item);assert.equal(details.tag,'details');assert.ok(!details.open);assert.equal(details.children[0].textContent,'過程檔案（5）');
  const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
  assert.match(html,/card.append\(processFiles\(t,w\)\)/);assert.doesNotMatch(html,/for\(const o of w.outputs\)/);
});

test('程式驗收探測後顯示 iframe／新分頁，選點切路徑；無回應可複製及重新檢查', async () => {
  const f=fixture(), task=f.tasks[0],item=task.planning.workItems[0];
  task.preview={url:'http://localhost:4330/',command:'node app.js'};
  item.changes[0].path='/search';f.ctx.probe={reachable:true,url:task.preview.url};
  await f.button.onclick();
  const content=f.nodes['#preview-content'];assert.equal(content.children[0].textContent,'在新分頁開啟');assert.equal(content.children[0].rel,'noopener noreferrer');assert.equal(content.children[1].src,task.preview.url);
  const point=f.nodes['#review-changes'].children[1];
  f.ctx.probe={reachable:true,url:'http://localhost:4330/search'};await point.children[4].onclick();
  assert.equal(f.calls.at(-1),'/api/tasks/TASK-review/preview-check?path=%2Fsearch');assert.equal(content.children[1].src,f.ctx.probe.url);
  f.ctx.probe={reachable:false,command:'node app.js'};await f.button.onclick();
  assert.match(allText(content),/沒有回應/);const box=content.children[0];await box.children[2].onclick();assert.equal(f.calls.at(-1),'node app.js');
  f.ctx.probe={reachable:true,url:task.preview.url};await box.children[3].onclick();assert.equal(content.children[1].tag,'iframe');
});

test('選點切換已登記檔案，逐點通過保存、有問題預填三欄並使用既有修改表單', async () => {
  const f=fixture(),item=f.tasks[0].planning.workItems[0];item.changes[0].path='result.html';
  await f.button.onclick();let point=f.nodes['#review-changes'].children[1];
  await point.children[4].onclick();assert.match(f.calls.at(-1),/preview\?file=result.html/);
  point=f.nodes['#review-changes'].children[1];await point.children[5].onclick();assert.equal(f.calls.at(-1)[1],'change-check');assert.equal(point.children[5].textContent,'已通過');
  point.children[6].onclick();assert.equal(f.dialog.open,false);assert.equal(f.calls.at(-1)[0],'W1');assert.match(f.calls.at(-1)[1],/在哪裡：搜尋頁\n改了什麼：加入搜尋欄位\n試試看：輸入 Mentor/);
  const control=await readFile(new URL('../web/assets/control.js',import.meta.url),'utf8');
  const area={oninput(){this.saved=this.value;},focus(){}},sel={dispatchEvent(){}};
  const ctx=vm.createContext({$:()=>({querySelector:s=>s==='select'?sel:area,scrollIntoView(){}}),Event:class{},matchMedia:()=>({matches:true})});
  vm.runInContext(control.slice(control.indexOf('function focusInstruct('),control.indexOf('// 任務選單')),ctx);
  ctx.focusInstruct('W1','預填原因');assert.equal(area.saved,'預填原因');assert.equal(sel.value,'W1');
});

test('MD／圖片候選沿用原有 renderer', async () => {
  const f=fixture(),item=f.tasks[0].planning.workItems[0];item.outputs=[{file:'guide.md'}];
  f.ctx.markdownPreviewText=text=>text;f.ctx.markdownPreviewBody=text=>text;
  await f.button.onclick();assert.equal(f.nodes['#preview-content'].children[0].className,'markdown-preview');
  item.outputs=[{file:'image.png'}];f.ctx.fetch=async()=>({ok:true,blob:async()=>new Blob(['image'])});
  await f.button.onclick();assert.equal(f.nodes['#preview-content'].children[0].tag,'img');assert.equal(f.nodes['#preview-content'].children[0].alt,'image.png');
});


test('VM 替代清單載入、逐點通過／退回事件及比較基準與無差異原因', async () => {
  const f = fixture(), item = f.tasks[0].planning.workItems[0];item.changes = [];
  const point = { where: 'result.html', what: 'Git 顯示修改此檔案。', howToCheck: '核對差異', path: 'result.html' };
  f.ctx.request = async url => { f.calls.push(url);return { source: 'git', baseline: 'a'.repeat(40), baselineSource: 'HEAD', changes: [point] }; };
  await f.button.onclick();await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.calls.some(url => String(url).includes('/review-changes?item=W1')));
  let sidebar = f.nodes['#review-changes'];assert.match(allText(sidebar), /比較基準：HEAD/);
  await sidebar.children[1].children[5].onclick();assert.equal(f.calls.at(-1)[1], 'change-check');
  sidebar.children[1].children[6].onclick();assert.match(f.calls.at(-1)[1], /Git 顯示修改此檔案/);
  f.ctx.request = async () => ({ source: 'git', changes: [], reason: '這個項目的登記檔案沒有差異。' });
  await f.button.onclick();await new Promise(resolve => setImmediate(resolve));assert.match(allText(sidebar), /沒有差異/);
});

test('VM 替代清單關閉後的延遲回應不覆蓋畫面，讀取失敗明示原因', async () => {
  const f = fixture(), item = f.tasks[0].planning.workItems[0];item.changes = [];
  let resolve;f.ctx.request = () => new Promise(r => { resolve = r; });
  await f.button.onclick();f.dialog.close();
  const before = allText(f.nodes['#review-changes']);resolve({ changes: [{ where: 'stale', what: 'stale', howToCheck: 'stale' }] });
  await new Promise(r => setImmediate(r));assert.equal(allText(f.nodes['#review-changes']), before);
  f.ctx.request = async () => { throw new Error('測試讀取失敗'); };
  await f.button.onclick();await new Promise(r => setImmediate(r));assert.match(allText(f.nodes['#review-changes']), /無法取得改動清單：測試讀取失敗/);
});
