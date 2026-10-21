import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
const source=await readFile(new URL('../obsidian/mentor-work-center/main.js',import.meta.url),'utf8');
class El {
  constructor(tag='',options={}){this.tag=tag;this.text=options.text||'';this.value=options.value||'';this.children=[];this.attrs=options.attr||{};}
  createEl(tag,options){const e=new El(tag,options);this.children.push(e);return e;}
  createDiv(){return this.createEl('div');}
  addClass(){} empty(){this.children=[];} appendText(value){this.text+=value;}
}
const all=e=>[e,...e.children.flatMap(all)];
function fixture(){
  let lastModal, saved, read='原始筆記',requests=[];
  const notices=[];
  class Modal { constructor(){this.contentEl=new El();}setTitle(t){this.title=t;}open(){lastModal=this;this.onOpen();}close(){this.onClose();} }
  class Plugin {async loadData(){return {address:'http://127.0.0.1:4350',sources:{}};}async saveData(data){saved=structuredClone(data);}registerView(){}addRibbonIcon(){}addCommand(){}addSettingTab(){} }
  class ItemView{} class MarkdownView{}
  const view={file:{path:'測試.md',basename:'測試'},editor:{getSelection:()=>''}};
  const app={workspace:{getActiveViewOfType:()=>view,getLeavesOfType:()=>[]},vault:{read:async()=>read}};
  const context={module:{exports:{}},URL,window:{},document:{},require:name=>{
    if(name==='node:crypto')return crypto;
    if(name==='obsidian')return {Plugin,ItemView,Modal,MarkdownView,Notice:class{constructor(t){notices.push(t);}},PluginSettingTab:class{},Setting:class{},requestUrl:async input=>{requests.push(input);return {status:200,json:input.url.endsWith('/connect')?{token:'memory-only-secret'}:{task:{id:'TASK-plugin'}}};}};
    throw Error(name);
  }};
  vm.runInNewContext(source,context);
  const plugin=new context.module.exports();plugin.app=app;
  return {plugin,notices,requests,get modal(){return lastModal;},get saved(){return saved;},set read(value){read=value;}};
}

test('plugin pairing refuses remote hosts and saves preferences without a credential',async()=>{
  const f=fixture();await f.plugin.onload();f.plugin.open=async()=>{};
  f.plugin.pair();const fields=all(f.modal.contentEl).filter(e=>e.tag==='input');
  fields[0].value='https://remote.example';fields[1].value='pairing-code';
  await all(f.modal.contentEl).find(e=>e.text==='配對這個本機工作區').onclick();
  assert.equal(f.requests.length,0);
  assert.match(f.notices[0],/只能連到/);
  fields[0].value='http://127.0.0.1:4350';
  await all(f.modal.contentEl).find(e=>e.text==='配對這個本機工作區').onclick();
  assert.equal(f.plugin.token,'memory-only-secret');
  assert.ok(!JSON.stringify(f.saved).includes('memory-only-secret'));
  assert.ok(!JSON.stringify(f.saved).includes('pairing-code'));
  f.plugin.onunload();assert.equal(f.plugin.token,null);
});

test('source preview does not start work, stale note is rejected and retry reuses the creation key',async()=>{
  const f=fixture();await f.plugin.onload();f.plugin.token='memory-only';f.plugin.open=async()=>{};
  await f.plugin.prepare();
  assert.equal(f.requests.length,0,'opening preview does not call the AI');
  const create=all(f.modal.contentEl).find(e=>e.text==='建立這份任務，讓 AI 先擬方案');
  f.read='外部修改';await create.onclick();
  assert.equal(f.requests.length,0);assert.match(f.notices.at(-1),/已改變/);
  f.read='原始筆記';let keys=[];
  f.plugin.api=async(route,input,key)=>{keys.push(key);throw Error('網路中斷');};
  await create.onclick();await create.onclick();assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
  all(f.modal.contentEl).find(e=>e.tag==='textarea').value='更改目標';await create.onclick();assert.notEqual(keys[2],keys[1]);
});

test('oversized notes are refused instead of silently truncating boundaries',async()=>{
  const f=fixture();await f.plugin.onload();f.plugin.token='x';f.read='保留原文'.repeat(2000);
  await assert.rejects(f.plugin.prepare(),/超過 4,500/);
  assert.equal(f.requests.length,0);
});
