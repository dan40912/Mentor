import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {FocusSessions} from '../src/focus-sessions.js';
const module={exports:{}};vm.runInNewContext(await readFile(new URL('../obsidian/mentor-work-center/focus.js',import.meta.url),'utf8'),{module});
const {mountFocus}=module.exports;
class El{
 constructor(tag,doc,text=''){this.tag=tag;this.ownerDocument=doc;this.textContent=text;this.children=[];this.value='';this.attrs={};this.classList={add(){}};}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[...nodes];}setAttribute(k,v){this.attrs[k]=v;}
 querySelectorAll(tag){return all(this).slice(1).filter(node=>node.tag===tag);}
}
const all=root=>[root,...root.children.flatMap(all)];
async function fixture(t){const dir=await mkdtemp(path.join(os.tmpdir(),'mentor-focus-ui-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(path.join(dir,'vault'));let now=1000000;const store=new FocusSessions(path.join(dir,'vault'),()=>now);return {store,get now(){return now;},set now(v){now=v;}};}
function ui(t,f,api){const doc={createElement:tag=>new El(tag,doc),createTextNode:text=>new El('#text',doc,text)},host=new El('section',doc),timers=[];let notices=0,beeps=0,key=0;
 class Audio{constructor(){this.destination={};this.currentTime=0;}async resume(){}async close(){}createGain(){return {gain:{},connect(){}};}createOscillator(){return {frequency:{},connect(){},start(){beeps++;},stop(){}};}}
 const control=mountFocus(host,{api:api||((route,input)=>input?f.store.change(route.split('/').at(-1),input):f.store.list()),now:()=>f.now,setInterval:fn=>{timers.push(fn);return fn;},clearInterval(){},requestKey:()=>`request-${++key}-`+Math.random().toString(36).slice(2),AudioContext:Audio,onTarget:()=>notices++});t.after(()=>control.destroy());
 return {host,control,tick:()=>timers[0](),get notices(){return notices;},get beeps(){return beeps;},button:text=>all(host).find(n=>n.tag==='button'&&n.textContent===text)};}
test('shared control ticks beyond target, alerts only initiating view and preserves cross-client pause/end',async t=>{
 const f=await fixture(t),a=ui(t,f),b=ui(t,f);await a.control.refresh();await b.control.refresh();
 all(a.host).find(n=>n.tag==='input'&&n.type==='number').value='1';await a.button('開始專注').onclick();await b.control.refresh();
 f.now+=65000;a.tick();b.tick();a.tick();assert.equal(a.notices,1);assert.equal(a.beeps,1);assert.equal(b.notices,0);assert.ok(all(a.host).some(n=>n.textContent==='目標時間已到 · 已延長 00:05'));
 await b.button('暫停').onclick();await a.control.refresh();assert.ok(a.button('繼續專注'));f.now+=10000;a.tick();assert.ok(all(a.host).some(n=>n.textContent==='已暫停 · 已計時 01:05'));
 await a.button('結束這一輪').onclick();assert.equal((await f.store.list()).activeId,null);assert.ok(a.button('開始專注'));assert.ok(all(a.host).some(n=>n.textContent.includes('內容整理尚未接上')));
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
