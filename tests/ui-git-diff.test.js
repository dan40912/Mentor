import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
function fixture(result={baseline:'a'.repeat(40),diff:'--- a/file\n+++ b/file\n@@ -1,2 +1,3 @@\n-<img src=x onerror=evil()>\n+<script>evil()</script> &\n+++added prefix\n---removed prefix\n context'}){
  function element(tag,text,className){return {tag,textContent:text,className,children:[],dataset:{},append(...nodes){this.children.push(...nodes);},set innerHTML(value){assert.fail('差異原文不可送進 HTML parser');}};}
  const content={classList:{remove(){}},replaceChildren(node){this.node=node;}},status={},dialog={open:false,showModal(){this.open=true;},querySelector(){return {focus(){}};}};
  const nodes={'#preview-dialog':dialog,'#preview-content':content,'#preview-status':status,'#preview-title':{},'#preview-modes':{},'#preview-source':{}};
  const calls=[];const ctx=vm.createContext({$:selector=>nodes[selector],element,previewReturn:null,previewMarkdown:'old',fetch:async url=>{calls.push(url);return {ok:true,json:async()=>result};},refreshSession:async()=>{}});
  vm.runInContext(script.slice(script.indexOf('function diffButton('),script.indexOf('// 行內表單取代 prompt()')),ctx);
  return {ctx,content,status,nodes,calls,element};
}

test('Git 任務產出列提供差異入口，舊任務靠即時 Git 偵測，非 Git 不顯示',async()=>{
  const f=fixture(),w={id:'W1',outputs:[{file:'code.js'}]};
  for(const task of [{id:'TASK-one',gitAvailable:true,gitBaseline:'a'.repeat(40)},{id:'TASK-old',gitAvailable:true}]){
    const button=f.ctx.diffButton(task,w);assert.equal(button.textContent,'看改了什麼');assert.equal(button.type,'button');assert.equal(button.dataset.previewItem,'W1');
    await button.onclick();assert.equal(f.calls.at(-1),`/api/tasks/${task.id}/diff?item=W1`);
  }
  assert.equal(f.ctx.diffButton({id:'TASK-plain',gitAvailable:false},w),null);
  assert.equal(f.ctx.diffButton({id:'TASK-stale',gitAvailable:false,gitBaseline:'a'.repeat(40)},w),null);
  assert.match(script,/card.append\(processFiles\(t,w\)\)/);
  assert.match(script,/const diff=diffButton\(task,item\);if\(diff\)box.append\(diff\)/);
  const server=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
  assert.match(server,/gitAvailable: !task.error && Boolean\(await gitHead\(task.allowedRoots\?\.\[0\]\)\)/);
  assert.match(server,/action === 'diff'[\s\S]*?itemDiff\(task, new URLSearchParams\(query \|\| ''\)\.get\('item'\)\)/);
});

test('前端執行差異預覽：textContent 保留攻擊字串，增刪行紅綠、標頭中性',async()=>{
  const f=fixture();await f.ctx.openDiff('TASK-one','W1',{});
  assert.equal(f.content.node.tag,'pre');assert.equal(f.content.node.tabIndex,0);
  const lines=f.content.node.children;assert.equal(lines[0].className,'diff-line');assert.equal(lines[1].className,'diff-line');
  assert.equal(lines[3].className,'diff-line diff-removed');assert.equal(lines[3].textContent,'-<img src=x onerror=evil()>');
  assert.equal(lines[4].className,'diff-line diff-added');assert.equal(lines[4].textContent,'+<script>evil()</script> &');
  assert.equal(lines[5].className,'diff-line diff-added');assert.equal(lines[6].className,'diff-line diff-removed');
  assert.equal(f.nodes['#preview-modes'].hidden,true);assert.equal(f.nodes['#preview-source'].hidden,true);
  assert.match(f.status.textContent,/比較基準/);
  assert.match(html,/\.diff-added\{color:#176b36;background:#e7f5eb\}/);assert.match(html,/\.diff-removed\{color:#a12622;background:#fdebea\}/);
});

test('沒有差異、API 錯誤與關閉／切換後的舊回應不覆蓋畫面',async()=>{
  const f=fixture({baseline:'a'.repeat(40),diff:''});await f.ctx.openDiff('TASK-one','W1',{});assert.equal(f.status.textContent,'這個項目的登記檔案沒有差異。');
  f.ctx.fetch=async()=>({ok:false,status:422,json:async()=>({message:'基準已不存在'})});await f.ctx.openDiff('TASK-one','W1',{});assert.match(f.status.textContent,/基準已不存在/);
  let resolve;f.ctx.fetch=async()=>({ok:true,json:()=>new Promise(r=>{resolve=r;})});const pending=f.ctx.openDiff('TASK-one','W1',{});
  await new Promise(r=>setImmediate(r));f.ctx.previewReturn={file:'another'};resolve({diff:'+stale',baseline:'a'.repeat(40)});await pending;assert.equal(f.content.node,undefined);
});
