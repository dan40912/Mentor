import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { requestApp } from './fixtures/request.js';

const upload = await readFile(new URL('../web/assets/upload.js', import.meta.url), 'utf8');
const control = await readFile(new URL('../web/assets/control.js', import.meta.url), 'utf8');
const feedback = await readFile(new URL('../web/assets/feedback.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
class Node {
  constructor(tag) { this.tagName=tag.toUpperCase(); this.children=[]; this.dataset={}; this.listeners={}; this.value=''; this.textContent=''; this.className=''; this.classList={add(){},remove(){}}; }
  append(...nodes) { for(const n of nodes) { if(n.parent)n.parent.children=n.parent.children.filter(x=>x!==n); n.parent=this; this.children.push(n); } }
  replaceChildren(...nodes) { this.children.forEach(n=>n.parent=null);this.children=[];this.append(...nodes); }
  setAttribute(k,v) { this[k]=v; }
  getAttribute(k) { return this[k]; }
  addEventListener(k,fn) { this.listeners[k]=fn; }
  matches(selector) { return selector.split(',').some(s=>{s=s.trim();const attr=s.match(/\[([^=\]]+)(?:="([^"]*)")?\]/); if(attr){const val=attr[1].startsWith('data-')?this.dataset[attr[1].slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]:this[attr[1]];if(attr[2]!==undefined?val!==attr[2]:val===undefined)return false;s=s.replace(attr[0],'');} if(s.includes(':checked')){if(!this.checked)return false;s=s.replace(':checked','');}return s.startsWith('.')?this.className.split(' ').includes(s.slice(1)):!s||this.tagName===s.toUpperCase();}); }
  querySelectorAll(selector) { const parts=selector.split(' ');const last=parts.pop();const all=this.children.flatMap(n=>[n,...(n.querySelectorAll?.('*')||[])]);return all.filter(n=>last==='*'||n.matches?.(last)).filter(n=>!parts.length||n.parent?.closest(parts.join(' '))); }
  querySelector(s) { return this.querySelectorAll(s)[0]||null; }
  closest(s) { return this.matches(s)?this:this.parent?.closest(s)||null; }
  focus() {} scrollIntoView() {} click() { return this.onclick?.(); }
}
const element=(tag,text,cls)=>{const n=new Node(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
const file=(name='資料.txt')=>({name,size:2,arrayBuffer:async()=>Buffer.from('ok')});
function browser(request=async()=>({})) {
  const roots=[];const document={createElement:tag=>new Node(tag),createTextNode:text=>({textContent:text}),getElementById:id=>roots.flatMap(r=>[r,...r.querySelectorAll('*')]).find(n=>n.id===id)};
  let run;const calls=[];const storage=new Map();
  const c=vm.createContext({document,request,element,composerDrafts:{},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},focusKey:(n,key)=>{n.dataset.focus=key;return n;},options:(n,values)=>{n.value=values[0][0];},busy:(_b,fn)=>()=>{run=fn();return run;},coachAct:async(t,action,data)=>{calls.push({id:t.id,action,data});return request(`/api/tasks/${t.id}/${action}`,data);},tell(){},openTask(){},agentOf:()=> 'AI',stageLabel:x=>x,itemStatus:{},tasks:[],$:()=>null});
  c.definition=()=>element('dl');
  vm.runInContext(upload+'\n'+control+'\n'+feedback+'\n'+html.slice(html.indexOf('function cardPanel('),html.indexOf('const headingName=')),c);
  return {c,roots,calls,wait:()=>run};
}
const task=(id='task-a',phase='grill')=>({id,planning:{phase,card:{title:'標題',goal:'目標',success:[],constraints:[],unknowns:[]},workItems:[{id:'W1',owner:'ai',status:'REVIEWED',title:'成果'}]},nextAction:{id:'W1'}});
function trigger(host,event,files) { if(event==='change'){host.children[1].files=files;host.children[1].listeners.change();}else{let prevented=false;host.listeners.dragover({preventDefault(){prevented=true;}});assert.ok(prevented);host.listeners.drop({preventDefault(){},dataTransfer:{files}});} }

for(const entry of ['card','conversation','output'])for(const event of ['change','drop'])test(`${entry} ${event} uses common picker with task identity and retains attachment IDs on submit`,async()=>{
  const requests=[];const b=browser(async(url,data)=>{requests.push({url,data});if(url==='/api/uploads/batches')return {id:'batch',results:data.names.map((name,index)=>({name,index}))};if(url.startsWith('/api/uploads?'))return {attachment:{id:'attachment-a'}};return {};});
  const t=task('task-a',entry==='output'?'execute':'grill');
  const form=entry==='card'?b.c.cardPanel(t.planning.card,t).querySelector('form'):b.c.instructionBox(t);b.roots.push(form);
  const host=form.querySelector('[data-attachment-entry]');trigger(host,event,[file(),file('拒絕.exe'),{name:'超大.txt',size:20_000_001}]);
  const saved=b.c.taskAttachmentPicker(t.id,entry==='card'?'card':'instruction');await saved.picker.ids();
  const batch=requests.find(r=>r.url==='/api/uploads/batches');assert.equal(batch.data.taskId,t.id);assert.equal(batch.data.entry,entry==='card'?'card':'instruction');
  const rows=host.children[2].children.map(n=>n.textContent).join('\n');assert.match(rows,/資料.txt：上傳成功/);assert.match(rows,/拒絕.exe：只支援/);assert.match(rows,/超大.txt：單檔不可/);
  if(entry!=='card'){const area=form.querySelector('textarea');area.value='保留第一頁，修改第二頁';area.oninput();if(entry==='output'){form.querySelector('select').value='W1';form.querySelector('select').onchange();}}
  form.onsubmit({preventDefault(){}});await b.wait();
  assert.equal(b.calls[0].id,t.id);assert.equal(b.calls[0].action,entry==='card'?'card':'instruct');assert.deepEqual(Array.from(b.calls[0].data.attachmentIds),['attachment-a']);
  if(entry==='output')assert.equal(b.calls[0].data.scope,'W1');
  assert.equal((await saved.picker.ids()).length,0);assert.equal(host.children[2].children.length,2,'只消耗成功識別，拒絕原因留在清單');
});

for(const entry of ['card','conversation','output'])test(`${entry} failed upload, polling rebuild, failed submit and retry preserve text and task ownership`,async()=>{
  let failUpload=true,failSubmit=true,release;const requests=[];
  const b=browser(async(url,data)=>{requests.push({url,data});if(url==='/api/uploads/batches')return {id:'batch',results:data.names.map((name,index)=>({name,index}))};if(url.startsWith('/api/uploads?')){await new Promise(r=>release=r);if(failUpload)throw new Error('連線中斷');return {attachment:{id:'kept-id'}};}if(failSubmit)throw new Error('保存失敗');return {};});
  const t=task('a',entry==='output'?'execute':'grill');const build=()=>entry==='card'?b.c.cardPanel(t.planning.card,t).querySelector('form'):b.c.instructionBox(t);
  let form=build();b.roots.push(form);let area=form.querySelector('textarea');area.value='尚未送出的文字';area.oninput();
  if(entry==='output'){form.querySelector('select').value='W1';form.querySelector('select').onchange();const reason=form.querySelector('[data-focus="reason"]');reason.value='主管要求';reason.oninput();}
  const cached=b.c.taskAttachmentPicker(t.id,entry==='card'?'card':'instruction');trigger(cached.host,'drop',[file()]);
  await new Promise(r=>setImmediate(r));assert.match(cached.host.children[2].children[0].textContent,/加入中/);
  // 真正執行輪詢函式，request 替身回傳新版任務後走 openTask 重建路徑。
  let poll;const originalRequest=b.c.request;
  Object.assign(b.c,{tasks:[{...t,revision:1,planning:{...t.planning,running:{stage:'D'}}}],setInterval:fn=>{poll=fn;return 1;},clearInterval(){},renderOverview(){},userIsEditing:()=>false,$:()=>({open:true,dataset:{task:t.id}}),openTask:()=>{form=build();b.roots.push(form);},request:async(url,...args)=>url==='/api/tasks'?{tasks:[{...t,revision:2}]}:originalRequest(url,...args)});
  vm.runInContext('let pollTimer=null;'+html.slice(html.indexOf('function ensurePolling()'),html.indexOf('setInterval(()=>{for(const el')),b.c);
  b.c.ensurePolling();await poll();
  assert.equal(form.querySelector('textarea').value,'尚未送出的文字');assert.equal(form.querySelector('[data-attachment-entry]'),cached.host);
  const other=b.c.taskAttachmentPicker('b',entry==='card'?'card':'instruction');assert.notEqual(other.host,cached.host);assert.equal((await other.picker.ids()).length,0);
  release();await cached.picker.ids();assert.match(cached.host.children[2].children[0].textContent,/連線中斷/);
  failUpload=false;cached.host.children[3].listeners.click();await new Promise(r=>setImmediate(r));release();assert.deepEqual(Array.from(await cached.picker.ids()),['kept-id']);
  form.onsubmit({preventDefault(){}});await b.wait().catch(()=>{});
  form=build();b.roots.push(form);assert.equal(form.querySelector('textarea').value,'尚未送出的文字');assert.deepEqual(Array.from(await cached.picker.ids()),['kept-id']);
  if(entry==='output'){assert.equal(form.querySelector('select').value,'W1');assert.equal(form.querySelector('[data-focus="reason"]').value,'主管要求');}
  failSubmit=false;form.onsubmit({preventDefault(){}});await b.wait();assert.equal((await cached.picker.ids()).length,0);assert.ok(requests.filter(r=>r.url.startsWith('/api/uploads?')).length===2,'刷新及保存重試不重傳成功附件');
});

test('feedback scoring keeps existing payload and never creates attachment picker',async()=>{
  const b=browser();const t=task();t.feedbackPrompt={moment:'confirm',ref:'r',scale:['差','普通','好'],tags:['清楚'],question:'成果如何'};
  const form=b.c.feedbackCard(t);assert.equal(form.querySelector('[data-attachment-entry]'),null);form.querySelector('.fb-scale').querySelectorAll('input')[1].checked=true;form.querySelector('.fb-tags input').checked=true;form.querySelector('textarea').value='下次多一點例子';
  await form.querySelector('[data-focus="feedback-send"]').onclick();await b.wait();assert.equal(b.calls[0].action,'feedback');assert.equal(JSON.stringify(b.calls[0].data),JSON.stringify({ref:'r',score:2,tags:['清楚'],note:'下次多一點例子'}));
});

test('real request handlers archive card, conversation and output IDs; reject wrong task and preserve retry after conflict',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'entry-'));const prompts=[];const app=await requestApp(dir,async({prompt})=>{prompts.push(prompt);return {text:JSON.stringify(prompt.includes('「任務制定」')?{card:{title:'測試',goal:'測試附件'}}:{ready:false,questions:[{q:'問題',why:'原因'}]}),provider:'codex'};});t.after(async()=>{await app.settle();await rm(dir,{recursive:true,force:true});});
  const home=await app.fetch('/');const headers={cookie:home.headers.get('set-cookie').split(';')[0],'x-csrf-token':(await(await app.fetch('/api/session')).json()).csrfToken};
  const post=async(url,data,key)=>app.fetch(url,{method:'POST',headers:{...headers,...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(data)});
  const create=async()=>{const r=await post('/api/tasks',{request:'測試四個附件入口'});const x=(await r.json()).task;await app.settle();return app.coach.latest(x.id);};
  let a=await create();const b=await create();
  const stage=async()=>{const batch=await(await post('/api/uploads/batches',{names:['資料.txt'],taskId:a.id})).json();const r=await app.fetch(`/api/uploads?name=${encodeURIComponent('資料.txt')}&batch=${batch.id}&index=0`,{method:'POST',headers,body:Buffer.from('附件指定文字')});return (await r.json()).attachment.id;};
  const first=await stage();const card={...a.planning.card,title:'修改標題',audience:'PM',deliverable:'文件'};
  assert.equal((await post(`/api/tasks/${b.id}/card`,{revision:b.revision,card,attachmentIds:[first]},'wrong-task-1')).status,403);
  assert.equal((await post(`/api/tasks/${a.id}/card`,{revision:a.revision-1,card,attachmentIds:[first]},'conflict-1')).status,409);
  const saved=await post(`/api/tasks/${a.id}/card`,{revision:a.revision,card,attachmentIds:[first]},'save-card-1');assert.equal(saved.status,200);a=(await saved.json()).task;assert.equal(a.title,'修改標題');assert.equal(a.attachments[0].id,first);
  const second=await stage();const answered=await post(`/api/tasks/${a.id}/instruct`,{revision:a.revision,text:'對話回答',attachmentIds:[second]},'reply-123');assert.equal(answered.status,202);await app.settle();a=await app.coach.latest(a.id);assert.deepEqual(a.planning.messages.find(m=>m.text==='對話回答').attachmentIds,[second]);assert.match(prompts.at(-1),/附件指定文字/);assert.ok(prompts.at(-1).includes(second));
  await app.coach.store.mutate(a.id,a.revision,null,x=>{x.planning.phase='execute';x.planning.workItems=[{id:'W1',owner:'ai',status:'DONE',title:'成果',dependsOn:[],fixes:[]}];return {};});a=await app.coach.latest(a.id);
  let routed;app.coach.fix=async(id,itemId)=>{routed={id,itemId};return {task:await app.coach.latest(id),done:Promise.resolve()};};
  const third=await stage();const input={revision:a.revision,text:'產出修改',scope:'W1',attachmentIds:[third]};
  assert.equal((await post(`/api/tasks/${a.id}/instruct`,input,'output-123')).status,409,'影響確認前不消耗附件');
  const fixed=await post(`/api/tasks/${a.id}/instruct`,{...input,confirmImpact:true},'output-124');assert.equal(fixed.status,202);a=await app.coach.latest(a.id);assert.equal(routed.itemId,'W1');assert.deepEqual(a.planning.instructions.at(-1).attachmentIds,[third]);assert.equal(a.attachments.length,3);
  for(const id of [first,second,third]){const r=await app.fetch(`/api/tasks/${a.id}/attachment?id=${id}`,{headers});assert.equal(r.status,200);assert.equal(await r.text(),'附件指定文字');}
});


test('new task submit failure and upload retry keep the draft text, batch identity and successful IDs', async () => {
  let failUpload=true,failCreate=true,run;const requests=[];
  const host=new Node('div'),form=new Node('form'),area=new Node('textarea'),button=new Node('button');button.type='submit';form.append(area,button);area.value='請整理這份草稿';form.reset=()=>{area.value='';};
  const b=browser(async(url,data)=>{requests.push({url,data});if(url==='/api/uploads/batches')return {id:'draft-batch',results:data.names.map((name,index)=>({name,index}))};if(url.startsWith('/api/uploads?')){if(failUpload)throw new Error('網路失敗');return {attachment:{id:'draft-file'}};}if(url==='/api/tasks'&&data){if(failCreate)throw new Error('建立失敗');return {task:{id:'new-task'}};}if(url==='/api/tasks')return {tasks:[]};return {};});
  Object.assign(b.c,{state:{},$:selector=>selector==='#draft-form'?form:selector==='#draft-attachments'?host:{close(){}},FormData:class{*[Symbol.iterator](){yield ['request',area.value];}},busy:(_button,fn)=>()=>{run=fn();return run;},renderOverview(){},ensurePolling(){}});
  vm.runInContext(html.slice(html.indexOf('const draftAttachments='),html.indexOf("$('#settings').onsubmit=")),b.c);
  trigger(host,'change',[file()]);await vm.runInContext('draftAttachments.ids()',b.c);assert.match(host.children[2].children[0].textContent,/網路失敗/);
  failUpload=false;host.children[3].listeners.click();assert.deepEqual(Array.from(await vm.runInContext('draftAttachments.ids()',b.c)),['draft-file']);
  form.onsubmit({preventDefault(){},currentTarget:form});await assert.rejects(run,/建立失敗/);assert.equal(area.value,'請整理這份草稿');assert.deepEqual(Array.from(await vm.runInContext('draftAttachments.ids()',b.c)),['draft-file']);
  failCreate=false;form.onsubmit({preventDefault(){},currentTarget:form});await run;
  assert.equal(area.value,'');assert.equal(host.children[2].children.length,0);assert.deepEqual(Array.from(requests.filter(r=>r.url==='/api/tasks'&&r.data).at(-1).data.attachmentIds),['draft-file']);
  assert.equal(requests.filter(r=>r.url==='/api/uploads/batches').length,1);assert.ok(requests.filter(r=>r.url.startsWith('/api/uploads?')).every(r=>r.url.includes('batch=draft-batch')));
});

test('impact confirmation preserves IDs, text and scope until confirmed',async()=>{
  const b=browser(async(url,data)=>{if(url==='/api/uploads/batches')return {id:'batch',results:[{index:0}]};if(url.startsWith('/api/uploads?'))return {attachment:{id:'confirm-id'}};if(!data.confirmImpact)throw Object.assign(new Error('W1 已確認，將重新驗收'),{code:'CONFIRM_IMPACT'});return {};});
  const t=task('impact-task','execute');const form=b.c.instructionBox(t);b.roots.push(form);const area=form.querySelector('textarea');area.value='調整第二頁';area.oninput();form.querySelector('select').value='W1';form.querySelector('select').onchange();const cached=b.c.taskAttachmentPicker(t.id,'instruction');trigger(cached.host,'drop',[file()]);await cached.picker.ids();
  form.onsubmit({preventDefault(){}});await b.wait();assert.equal(form.querySelector('.impact').hidden,false);assert.equal(area.value,'調整第二頁');assert.deepEqual(Array.from(await cached.picker.ids()),['confirm-id']);
  await form.querySelector('[data-focus="impact-ok"]').onclick();await b.wait();assert.equal(b.calls[1].data.scope,'W1');assert.equal(b.calls[1].data.confirmImpact,true);assert.deepEqual(Array.from(b.calls[1].data.attachmentIds),['confirm-id']);assert.equal((await cached.picker.ids()).length,0);
});
