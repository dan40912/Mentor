import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {FocusSessions} from '../src/focus-sessions.js';
import {FocusOrganization} from '../src/focus-organization.js';
const module={exports:{}};vm.runInNewContext(await readFile(new URL('../obsidian/mentor-work-center/focus.js',import.meta.url),'utf8'),{module,encodeURIComponent,TextEncoder});
const {mountFocus,pastedSource,capturePastedSource}=module.exports;
class El{
 constructor(tag,doc,text=''){this.tag=tag;this.ownerDocument=doc;this.textContent=text;this.children=[];this.value='';this.attrs={};this.classList={add(){}};}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[...nodes];}setAttribute(k,v){this.attrs[k]=v;}
 querySelectorAll(tag){return all(this).slice(1).filter(node=>node.tag===tag);}
}
const all=root=>[root,...root.children.flatMap(all)];
async function fixture(t){const dir=await mkdtemp(path.join(os.tmpdir(),'mentor-focus-ui-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(path.join(dir,'vault'));let now=1000000;const store=new FocusSessions(path.join(dir,'vault'),()=>now);return {store,get now(){return now;},set now(v){now=v;}};}
function ui(t,f,api,hooks={}){const doc={createElement:tag=>new El(tag,doc),createTextNode:text=>new El('#text',doc,text)},host=new El('section',doc),timers=[];let notices=0,beeps=0,key=0;
 class Audio{constructor(){this.destination={};this.currentTime=0;}async resume(){}async close(){}createGain(){return {gain:{},connect(){}};}createOscillator(){return {frequency:{},connect(){},start(){beeps++;},stop(){}};}}
 const control=mountFocus(host,{api:api||((route,input)=>input?f.store.change(route.split('/').at(-1),input):route.startsWith('/focus/materials?')?f.store.materials(new URLSearchParams(route.split('?')[1]).get('sessionId')):f.store.list()),now:()=>f.now,setInterval:fn=>{timers.push(fn);return fn;},clearInterval(){},requestKey:()=>`request-${++key}-`+Math.random().toString(36).slice(2),AudioContext:Audio,onTarget:()=>notices++,...hooks});t.after(()=>control.destroy());
 return {host,control,tick:()=>timers[0](),get notices(){return notices;},get beeps(){return beeps;},button:text=>all(host).find(n=>n.tag==='button'&&n.textContent===text)};}
test('shared control ticks beyond target, alerts only initiating view and preserves cross-client pause/end',async t=>{
 const f=await fixture(t),a=ui(t,f),b=ui(t,f);await a.control.refresh();await b.control.refresh();
 all(a.host).find(n=>n.tag==='input'&&n.type==='number').value='1';await a.button('開始專注').onclick();await b.control.refresh();
 f.now+=65000;a.tick();b.tick();a.tick();assert.equal(a.notices,1);assert.equal(a.beeps,1);assert.equal(b.notices,0);assert.ok(all(a.host).some(n=>n.textContent==='目標時間已到 · 已延長 00:05'));
 await b.button('暫停').onclick();await a.control.refresh();assert.ok(a.button('繼續專注'));f.now+=10000;a.tick();assert.ok(all(a.host).some(n=>n.textContent==='已暫停 · 已計時 01:05'));
 await a.button('結束這一輪').onclick();assert.equal((await f.store.list()).activeId,null);assert.ok(a.button('開始專注'));assert.ok(all(a.host).some(n=>n.textContent.includes('AI 整理需另行確認')));
});
test('lost start reply retries the exact persisted request and never creates another session',async t=>{
 const f=await fixture(t),seen=[];let lost=true;
 const a=ui(t,f,async(route,input)=>{if(!input)return f.store.list();seen.push(structuredClone(input));const result=await f.store.change(route.split('/').at(-1),input);if(lost){lost=false;throw Error('simulated lost response');}return result;});await a.control.refresh();await a.button('開始專注').onclick();assert.equal(a.button('重試未確認操作').hidden,false);
 await a.control.refresh();await a.button('重試未確認操作').onclick();assert.deepEqual(seen[0],seen[1]);assert.equal((await f.store.list()).sessions.length,1);assert.equal(a.button('重試未確認操作').hidden,true);
});
test('poll refresh keeps the unfinished goal and custom duration; invalid values do not submit',async t=>{
 const f=await fixture(t),a=ui(t,f);await a.control.refresh();const goal=all(a.host).find(n=>n.tag==='input'&&n.type==='text'),duration=all(a.host).find(n=>n.tag==='input'&&n.type==='number');goal.value='保留我的目標';duration.value='0';duration.oninput();assert.ok(all(a.host).filter(n=>n.tag==='button'&&n.attrs['aria-pressed']!==undefined).every(n=>n.attrs['aria-pressed']==='false'));await a.control.refresh();assert.equal(goal.value,'保留我的目標');assert.equal(duration.value,'0');await a.button('開始專注').onclick();assert.equal((await f.store.list()).sessions.length,0);
 duration.value='30';await a.button('開始專注').onclick();assert.equal((await f.store.list()).sessions[0].goal,'保留我的目標');
});

test('shared control attaches explicitly chosen source and previews both versions as inert text',async t=>{
 const f=await fixture(t),source={path:'研究/來源.md',status:'present',content:'開始 <script>not executable</script>'};
 const a=ui(t,f,null,{captureStart:async()=>({sourceBefore:source}),captureEnd:async path=>({path,status:'present',content:'結束的新內容'})});await a.control.refresh();await a.button('開始專注').onclick();
 assert.ok(all(a.host).some(n=>n.textContent.includes('已選來源：研究/來源.md')));await a.button('結束這一輪').onclick();await a.button('核對本輪材料與變更').onclick();
 const pres=all(a.host).filter(n=>n.tag==='pre');assert.ok(pres.some(n=>n.textContent===source.content));assert.ok(pres.some(n=>n.textContent==='結束的新內容'));assert.ok(all(a.host).some(n=>n.textContent.includes('送出前可選片段')));
});

test('shared organization UI previews before invoking AI, saves edits, exports a fixed version and keeps prior sessions reachable',async t=>{
 const f=await fixture(t),started=await f.store.change('start',{revision:0,requestKey:'ui-org-focus-start',targetMinutes:15,goal:'整理本輪',sourceBefore:{path:'來源.md',status:'present',content:'old point'}});await f.store.change('end',{revision:1,requestKey:'ui-org-focus-end',sessionId:started.activeId,sourceAfter:{path:'來源.md',status:'present',content:'new point'}});
 let calls=0;const service=new FocusOrganization(f.store,{agent:()=>({provider:'claude',modelId:'fictional-model',effort:'low'}),run:async()=>{calls++;return {text:JSON.stringify({points:[{text:'留下新重點',kind:'observation',source:'after',quote:'new point'}],openQuestions:[],nextSteps:['先請人核對'],handoff:'沿用這個來源版本。'})};}}),exports=[];
 const api=(route,input)=>{const url=new URL(route,'http://127.0.0.1');if(input){const methods={'prepare-organization':'prepare',organize:'start','save-organization':'save'};const action=route.split('/').at(-1);return methods[action]?service[methods[action]](input):f.store.change(action,input);}if(url.pathname==='/focus/materials')return f.store.materials(url.searchParams.get('sessionId'));if(url.pathname==='/focus/organization')return service.get(url.searchParams.get('sessionId'),url.searchParams.get('jobId'));if(url.pathname==='/focus/export')return service.export(url.searchParams.get('sessionId'),url.searchParams.get('jobId'),url.searchParams.get('publicationId'));return f.store.list();};
 const a=ui(t,f,api,{exportMarkdown:async output=>exports.push(output)});await a.control.refresh();await a.button('核對本輪材料與變更').onclick();await a.button('預覽送給 AI 的內容與模型').onclick();assert.equal(calls,0);assert.ok(all(a.host).some(n=>n.textContent.includes('fictional-model')));
 await a.button('確認這份材料，呼叫 AI 整理').onclick();await Promise.all([...service.pending.values()]);await a.button('查看 AI 整理與保存版本').onclick();const edit=all(a.host).find(n=>n.tag==='textarea'&&n.attrs['aria-label']==='核對並修改整理草稿');assert.ok(edit);edit.value='我核對後保留的重點';edit.oninput();await a.button('保存這份整理到 Mentor').onclick();await a.button('匯出這個保存版本').onclick();assert.equal(calls,1);assert.match(exports[0].markdown,/我核對後保留的重點/);assert.match(exports[0].markdown,/不表示事實已獨立驗證/);
 await f.store.change('start',{revision:(await f.store.list()).revision,requestKey:'ui-next-focus-start',targetMinutes:10,goal:'下一輪'});await a.control.refresh();assert.ok(a.button('查看這輪整理'));await a.button('查看這輪整理').onclick();assert.ok(all(a.host).some(n=>n.tag==='textarea'&&n.value==='我核對後保留的重點'));
});


test('task focus entry previews an editable linked goal, persists linkage only on start and protects an active session',async t=>{
 const f=await fixture(t),a=ui(t,f);await a.control.refresh();
 await a.control.prepareTask({taskId:'TASK-focus-one',title:'核對表格閱讀模式',goal:'核對表格閱讀模式'});
 assert.equal((await f.store.list()).sessions.length,0);
 const goal=all(a.host).find(n=>n.tag==='input'&&n.type==='text');assert.equal(goal.value,'核對表格閱讀模式');goal.value='只核對其中一張表';await a.control.prepareTask({taskId:'TASK-focus-one',title:'核對表格閱讀模式',goal:'核對表格閱讀模式'});assert.equal(all(a.host).find(n=>n.tag==='input'&&n.type==='text').value,'只核對其中一張表');
 await a.button('開始專注').onclick();const started=await f.store.list();assert.equal(started.sessions[0].taskId,'TASK-focus-one');assert.equal(started.sessions[0].goal,'只核對其中一張表');
 await assert.rejects(a.control.prepareTask({taskId:'TASK-focus-two',title:'另一個任務',goal:'另一個任務'}),/已有進行中/);assert.equal((await f.store.list()).revision,started.revision);
 await a.button('結束這一輪').onclick();assert.equal(all(a.host).find(n=>n.tag==='input'&&n.type==='text').value,'');
 await a.control.prepareTask({taskId:'TASK-focus-two',title:'另一個任務',goal:'另一個任務'});await a.button('移除任務關聯').onclick();await a.button('開始專注').onclick();assert.equal((await f.store.list()).sessions.at(-1).taskId,null);
});
test('task focus entry preserves an unrelated unsent goal and refuses to prepare while offline',async t=>{
 const f=await fixture(t);let offline=false;const a=ui(t,f,async()=>{if(offline)throw Error('offline');return f.store.list();});await a.control.refresh();
 const goal=all(a.host).find(n=>n.tag==='input'&&n.type==='text');goal.value='我的未開始目標';
 await assert.rejects(a.control.prepareTask({taskId:'TASK-focus-one',title:'任務',goal:'任務'}),/草稿/);assert.equal(goal.value,'我的未開始目標');goal.value='';offline=true;
 await assert.rejects(a.control.prepareTask({taskId:'TASK-focus-one',title:'任務',goal:'任務'}),/核對專注狀態/);assert.equal((await f.store.list()).sessions.length,0);
});


test('source preview cannot be opened twice and a late capture cannot start after the control closes',async t=>{
 const f=await fixture(t);let resolveCapture,captures=0;
 const a=ui(t,f,null,{captureStart:()=>{captures++;return new Promise(resolve=>{resolveCapture=resolve;});}});await a.control.refresh();
 const start=a.button('開始專注'),first=start.onclick();await start.onclick();assert.equal(captures,1);assert.equal((await f.store.list()).sessions.length,0);
 a.control.destroy();resolveCapture({sourceBefore:{path:'示範.md',status:'present',content:'選定來源'}});await first;assert.equal((await f.store.list()).sessions.length,0);
});
test('source ending capture cannot double-end and closing during capture leaves the active timer unchanged',async t=>{
 const f=await fixture(t);let finish,captures=0;
 const a=ui(t,f,null,{captureStart:async()=>({sourceBefore:{path:'示範.md',status:'present',content:'開始'}}),captureEnd:()=>{captures++;return new Promise(resolve=>{finish=resolve;});}});await a.control.refresh();await a.button('開始專注').onclick();
 const end=a.button('結束這一輪'),first=end.onclick();await end.onclick();assert.equal(captures,1);a.control.destroy();finish({path:'示範.md',status:'present',content:'結束'});await first;assert.equal((await f.store.list()).sessions[0].status,'running');
});


test('pasted materials require explicit unchanged preview, enforce limits and keep source labels fixed at ending',async()=>{
 const doc={createElement:tag=>new El(tag,doc)},host=new El('body',doc);let modal;
 const create=doc.createElement;doc.createElement=tag=>{const node=create(tag);if(tag==='dialog'){modal=node;node.showModal=()=>{};node.close=()=>node.onclose?.();node.remove=()=>{};}return node;};
 const pending=capturePastedSource(host),input=all(modal).find(n=>n.tag==='input'),content=all(modal).find(n=>n.tag==='textarea'),find=text=>all(modal).find(n=>n.tag==='button'&&n.textContent===text);
 input.value='研究/方案.md';content.value='<script>只當材料</script>';find('保存貼上內容並開始').onclick();assert.equal(find('保存貼上內容並開始').disabled,true);
 find('預覽將保存的材料').onclick();assert.ok(all(modal).some(n=>n.tag==='pre'&&n.textContent===content.value));assert.equal(find('保存貼上內容並開始').disabled,false);
 content.value='修改後';content.oninput();assert.equal(find('保存貼上內容並開始').disabled,true);find('預覽將保存的材料').onclick();find('保存貼上內容並開始').onclick();const result=await pending;assert.equal(result.sourceBefore.content,'修改後');
 const ending=capturePastedSource(host,{path:'研究/方案.md'});assert.equal(all(modal).find(n=>n.tag==='input').readOnly,true);find('先結束，標記尚未取得結束內容').onclick();assert.deepEqual(JSON.parse(JSON.stringify(await ending)),{path:'研究/方案.md',status:'unavailable',origin:'manual_paste'});
 for(const source of ['../outside.md','/outside.md','C:/outside.md'])assert.throws(()=>pastedSource(source,''));assert.throws(()=>pastedSource('來源.md','字'.repeat(34000)),/100 KB/);assert.throws(()=>pastedSource('來源.md','x'.repeat(50001)),/50,000/);
 const cancelled=capturePastedSource(host);modal.oncancel({preventDefault(){}});assert.equal(await cancelled,null);
});
test('cancelling end material entry keeps the session running',async t=>{
 const f=await fixture(t),a=ui(t,f,null,{captureStart:async()=>({sourceBefore:{path:'來源.md',status:'present',content:'原文'}}),captureEnd:async()=>null});await a.control.refresh();await a.button('開始專注').onclick();await a.button('結束這一輪').onclick();assert.equal((await f.store.list()).sessions[0].status,'running');
});
