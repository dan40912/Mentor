import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fixture, allText } from './fixtures/review-ui.js';
const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function polling(f){
  Object.assign(f.ctx,{state:{csrfToken:'old'},setInterval:fn=>{f.ctx.poll=fn;return 1;},clearInterval(){},renderOverview(){f.ctx.renders=(f.ctx.renders||0)+1;},userIsEditing:()=>false});
  vm.runInContext(script.slice(script.indexOf('let sessionRefresh;'),script.indexOf('async function submit(')),f.ctx);
  vm.runInContext(script.slice(script.indexOf('let pollTimer=null;'),script.indexOf('function renderPlanning(')),f.ctx);
  vm.runInContext(script.slice(script.indexOf('function openTask('),script.indexOf('function renderSessions(')),f.ctx);
  f.nodes['#task-dialog'].open=true;f.nodes['#task-dialog'].dataset.task=f.tasks[0].id;
  f.tasks[0].revision=1;f.tasks[0].planning.autopilot={};f.tasks[0].planning.messages=[];
  const updated=structuredClone(f.tasks);updated[0].revision=2;
  let first=true;
  f.ctx.fetch=async url=>{
    f.calls.push(url);
    if(url==='/api/session')return {ok:true,json:async()=>({csrfToken:'new'})};
    assert.equal(url,'/api/tasks');
    if(first){first=false;return {ok:false,status:403,json:async()=>({code:'SESSION_REQUIRED'})};}
    return {ok:true,json:async()=>({tasks:updated})};
  };
  f.ctx.ensurePolling();
}

test('403 → session 刷新 → 背景更新保留已開啟成果與 Git 改動清單，關閉才重繪內頁',async()=>{
  const f=fixture();f.tasks[0].planning.workItems[0].changes=[];
  f.ctx.probe={source:'git',changes:[{where:'Git 位置',what:'已載入差異',howToCheck:'核對'}]};
  await f.button.onclick();await tick();
  const frame=f.nodes['#preview-content'].children[0],sidebar=allText(f.nodes['#review-changes']),token=f.ctx.previewReturn;
  polling(f);await f.ctx.poll();
  assert.deepEqual(f.calls.slice(-3),['/api/tasks','/api/session','/api/tasks']);
  assert.equal(f.ctx.state.csrfToken,'new');assert.equal(f.ctx.renders,1);
  assert.equal(f.ctx.previewReturn,token);assert.equal(f.nodes['#preview-content'].children[0],frame);
  assert.equal(allText(f.nodes['#review-changes']),sidebar);assert.equal(f.nodes['#preview-status'].textContent,'');
  const refresh=[];f.ctx.openTask=(...args)=>refresh.push(args);f.dialog.close();
  assert.equal(refresh[0][0],f.tasks[0].id);assert.equal(refresh[0][1].background,true);
  assert.equal(f.ctx.previewReturn,null);
});

test('背景刷新期間延遲的成果與清單仍完成載入',async()=>{
  const f=fixture(),body=deferred(),changes=deferred();f.tasks[0].planning.workItems[0].changes=[];
  f.ctx.fetch=async()=>({ok:true,text:()=>body.promise});f.ctx.request=()=>changes.promise;
  const opening=f.button.onclick();await tick();polling(f);await f.ctx.poll();
  body.resolve('<html>延遲成果</html>');changes.resolve({changes:[{where:'延遲清單',what:'完成',howToCheck:'核對'}]});
  await opening;await tick();assert.equal(f.nodes['#preview-content'].children[0].tag,'iframe');
  assert.match(allText(f.nodes['#review-changes']),/延遲清單/);assert.equal(f.nodes['#preview-status'].textContent,'');
});

test('成果失敗顯示實際原因，重試可成功且不殘留載入中',async()=>{
  const f=fixture();f.ctx.fetch=async()=>({ok:false,json:async()=>({message:'檔案已移除'})});
  await f.button.onclick();assert.equal(f.nodes['#preview-status'].textContent,'無法預覽：檔案已移除');
  const retry=f.nodes['#preview-content'].children[0];assert.equal(retry.textContent,'重試');
  f.ctx.fetch=async()=>({ok:true,text:async()=>'<html>恢復</html>'});await retry.onclick();
  assert.equal(f.nodes['#preview-content'].children[0].tag,'iframe');assert.equal(f.nodes['#preview-status'].textContent,'');
});

test('改動清單與程式探測失敗都提供原因與重試',async()=>{
  const f=fixture();f.tasks[0].planning.workItems[0].changes=[];
  f.ctx.request=async()=>{throw new Error('清單讀取被拒');};await f.button.onclick();await tick();
  const sidebar=f.nodes['#review-changes'];assert.match(allText(sidebar),/清單讀取被拒/);
  const retry=sidebar.children[1];assert.equal(retry.textContent,'重試');
  f.ctx.request=async()=>({changes:[{where:'恢復清單',what:'完成',howToCheck:'核對'}]});await retry.onclick();
  assert.match(allText(sidebar),/恢復清單/);assert.doesNotMatch(allText(sidebar),/正在讀取|讀取被拒/);
  f.tasks[0].preview={url:'http://localhost:4330/'};
  f.ctx.request=async()=>{throw new Error('探測逾時');};await f.button.onclick();
  assert.match(f.nodes['#preview-status'].textContent,/探測逾時/);
  f.ctx.request=async()=>({reachable:true,url:'http://localhost:4330/'});await f.nodes['#preview-content'].children[0].onclick();
  assert.equal(f.nodes['#preview-status'].textContent,'');assert.equal(f.nodes['#preview-content'].children[1].tag,'iframe');
});

for(const action of ['切換項目','關閉','同一入口重開'])test(`${action}後舊成果 body 回應不覆蓋目前畫面`,async()=>{
  const f=fixture(),old=deferred();f.ctx.fetch=async()=>({ok:true,text:()=>old.promise});
  const opening=f.button.onclick();await tick();
  f.ctx.fetch=async()=>({ok:true,text:async()=>'<html>新成果</html>'});
  if(action==='關閉')f.dialog.close();
  else if(action==='同一入口重開')await f.button.onclick();
  else await f.ctx.openPreview('OTHER','result.html',f.button,'preview',f.tasks[1].planning.workItems[0]);
  const before=f.nodes['#preview-content'].children[0],status=f.nodes['#preview-status'].textContent;
  old.resolve('<html>舊成果</html>');await opening;
  assert.equal(f.nodes['#preview-content'].children[0],before);assert.equal(f.nodes['#preview-status'].textContent,status);
});

test('切換項目後舊清單與舊失敗都不覆蓋目前內容',async()=>{
  const f=fixture(),old=deferred();f.tasks[0].planning.workItems[0].changes=[];f.ctx.request=()=>old.promise;
  await f.button.onclick();f.ctx.request=async()=>({changes:[]});await f.ctx.openReview('TASK-review','W2',{});await tick();
  const before=allText(f.nodes['#review-changes']);old.resolve({changes:[{where:'舊清單'}]});await tick();
  assert.equal(allText(f.nodes['#review-changes']),before);
  let reject;f.ctx.fetch=()=>new Promise((_,r)=>{reject=r;});const opening=f.button.onclick();await tick();
  await f.ctx.openReview('TASK-review','W2',{});reject(new Error('舊錯誤'));await opening;
  assert.doesNotMatch(f.nodes['#preview-status'].textContent,/舊錯誤/);
});
