import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
const organizationModule={exports:{}};
vm.runInNewContext(await readFile(new URL('../obsidian/mentor-work-center/organization.js',import.meta.url),'utf8'),{module:organizationModule,require:name=>name==='node:crypto'?crypto:path});
const contentModule={exports:{}};
vm.runInNewContext(await readFile(new URL('../obsidian/mentor-work-center/content-drafts.js',import.meta.url),'utf8'),{module:contentModule,require:name=>name==='./organization'?organizationModule.exports:path});
const relocationModule={exports:{}};
vm.runInNewContext(await readFile(new URL('../obsidian/mentor-work-center/relocation.js',import.meta.url),'utf8'),{module:relocationModule,require:name=>name==='./organization'?organizationModule.exports:name==='node:crypto'?crypto:path});
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
    if(name==='./organization')return organizationModule.exports;
    if(name==='./relocation')return relocationModule.exports;
    if(name==='./content-drafts')return contentModule.exports;
    if(name==='obsidian')return {Plugin,ItemView,Modal,MarkdownView,parseLinktext:link=>({path:link.split('#')[0]}),Notice:class{constructor(t){notices.push(t);}},PluginSettingTab:class{},Setting:class{},requestUrl:async input=>{requests.push(input);return {status:200,json:input.url.endsWith('/connect')?{token:'memory-only-secret'}:{task:{id:'TASK-plugin'}}};}};
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

test('native Vault adapter uses atomic process checks, journals results and preserves later edits on undo',async()=>{
  const f=fixture();const files=new Map([['來源.md','# 來源']]),folders=new Set(),trashed=[];
  const vault=f.plugin.app.vault;
  Object.assign(vault,{
    getAbstractFileByPath:p=>files.has(p)?{path:p,stat:{size:files.get(p).length}}:folders.has(p)?{path:p}:null,
    read:async file=>files.get(file.path),
    createFolder:async p=>{folders.add(p);},
    create:async(p,content)=>{if(files.has(p))throw Error('already exists');files.set(p,content);return {path:p,stat:{}};},
    process:async(file,fn)=>{const next=fn(files.get(file.path));files.set(file.path,next);},
    trash:async(file,system)=>{assert.equal(system,false);trashed.push(file.path);files.delete(file.path);}
  });
  await f.plugin.onload();const plan=await f.plugin.organization.previewIndex(['來源.md']);
  assert.equal(files.size,1);
  assert.equal((await f.plugin.organization.apply(plan)).status,'applied');
  const target=plan.operations[0].path;files.set(target,'使用者後來修改');
  assert.equal((await f.plugin.organization.undo(plan.id)).status,'undo-partial');
  assert.equal(files.get(target),'使用者後來修改');assert.equal(trashed.length,0);
  const second=await f.plugin.organization.previewIndex(['來源.md']);await f.plugin.organization.apply(second);await f.plugin.organization.undo(second.id);
  assert.equal(files.get(target),'使用者後來修改','previous managed content is restored exactly');
});

test('native correction previews a captured request before applying its exact revision and proposal',async()=>{
 const f=fixture();await f.plugin.onload();f.plugin.token='test-token';
 const calls=[];f.plugin.api=async(route,input,key)=>{calls.push({route,input,key});return input.dryRun?{plan:{revision:7,id:'proposal-1234567890',request:input.text,label:'請 AI 改計畫',impact:'重新驗收 A 與 B'}}:{}};
 f.plugin.instruction({id:'TASK-correction',revision:7,planning:{workItems:[]}});
 const editor=f.modal;const area=all(editor.contentEl).find(e=>e.attrs['aria-label']==='補充或修正內容');area.value='只改表格';
 await all(editor.contentEl).find(e=>e.text==='預覽這次修改的影響').onclick();
 assert.equal(calls.length,1);assert.equal(calls[0].input.dryRun,true);
 const preview=f.modal;assert.ok(all(preview.contentEl).some(e=>e.text==='只改表格'));
 await all(preview.contentEl).find(e=>e.text==='確認：請 AI 改計畫').onclick();
 assert.equal(calls.length,2);assert.equal(calls[1].input.proposalId,'proposal-1234567890');assert.equal(calls[1].input.revision,7);assert.equal(calls[1].input.text,'只改表格');assert.ok(calls[1].key);
});

test('native question entry submits only ask and keeps one request identity for a retry',async()=>{
 const f=fixture();await f.plugin.onload();f.plugin.token='test-token';const calls=[];
 f.plugin.api=async(route,input,key)=>{calls.push({route,input,key});throw new Error('network unavailable');};
 f.plugin.ask({id:'TASK-question',revision:3});const modal=f.modal;all(modal.contentEl).find(e=>e.attrs['aria-label']==='只提問，不修改成果').value='這輪改了什麼？';
 const ask=all(modal.contentEl).find(e=>e.text==='先回答這個問題');await ask.onclick();await ask.onclick();
 assert.equal(calls.length,2);assert.ok(calls.every(c=>c.route==='/tasks/TASK-question/ask'));assert.equal(calls[0].key,calls[1].key);assert.equal(calls[0].input.question,'這輪改了什麼？');assert.ok(f.notices.includes('network unavailable'));
});

test('native AI draft preview exposes exact source and retries the same ask without storing a note body in preferences',async()=>{
 const f=fixture();await f.plugin.onload();f.plugin.token='memory-only';
 const calls=[];f.plugin.api=async(route,input,key)=>{calls.push({route,input,key});if(route==='/tasks')return {tasks:[{id:'TASK-draft',revision:5,title:'測試整理',planning:{messages:[],workItems:[]}}]};throw Error('network interrupted');};
 await f.plugin.prepareContentDraft();assert.equal(calls.length,1);assert.equal(calls[0].route,'/tasks');
 const modal=f.modal;all(modal.contentEl).find(e=>e.attrs['aria-label']==='紀錄草稿的任務').value='TASK-draft';
 const send=all(modal.contentEl).find(e=>e.text==='確認來源，讓 AI 預寫草稿');await send.onclick();await send.onclick();
 const asks=calls.filter(c=>c.input);assert.equal(asks.length,2);assert.equal(asks[0].key,asks[1].key);assert.equal(asks[0].route,'/tasks/TASK-draft/ask');assert.equal(asks[0].input.organizationDraft.sourcePath,'測試.md');assert.match(asks[0].input.question,/原始筆記/);assert.equal(f.saved,undefined);
 f.read='改過的來源';await send.onclick();assert.equal(calls.filter(c=>c.input).length,2,'source drift blocks another transmission');
});

test('correlated AI content enters reversible preview only; later task revisions do not rewrite provenance',async()=>{
 const f=fixture();await f.plugin.onload();const org=organizationModule.exports,prepared=contentModule.exports.prepare('weekly','測試.md',org.hash('原始筆記'),'原始筆記','');
 const key='12345678-1234-1234-1234-123456789abc',request={role:'user',kind:'discussion',requestKey:key,text:prepared.question,organizationDraft:prepared.organizationDraft},reply={role:'ai',kind:'discussion',inReplyTo:key,resultRevision:8,text:'## 本週交付\n來源未記錄已驗收成果。',discussion:{intent:'question'}};
 const task={id:'TASK-draft',revision:99,planning:{messages:[request,reply]}};f.plugin.api=async()=>({tasks:[task]});
 const files=new Map([['測試.md','原始筆記']]);const io={read:async p=>files.get(p)??null,createJournal:async(p,text)=>{if(files.has(p))throw Error('exists');files.set(p,text);},writeJournal:async(p,text)=>files.set(p,text),compareWrite:async(p,before,after)=>{if((files.get(p)??null)!==before)throw Error('conflict');if(after===null)files.delete(p);else files.set(p,after);}};
 f.plugin.organization=new org.Organization(io);let plan,previews=0;f.plugin.showOrganizationPlan=p=>{plan=p;previews++;};
 await f.plugin.contentDraft(task.id,key);assert.equal(files.size,1);assert.equal(previews,1);assert.match(plan.operations[0].after,/mentor_revision: 8/);assert.match(plan.operations[0].after,/status: draft/);
 await f.plugin.organization.apply(plan);const count=files.size;await f.plugin.contentDraft(task.id,key);assert.equal(previews,1,'identical saved draft creates no new plan');assert.equal(files.size,count);
 await f.plugin.organization.undo(plan.id);assert.equal(files.get('測試.md'),'原始筆記');assert.equal(files.has(plan.operations[0].path),false);
 files.set('測試.md','來源更新');await assert.rejects(f.plugin.contentDraft(task.id,key),error=>error.code==='SOURCE_STALE');
});

test('native tag command previews selected notes without model calls and uses constrained, uneditable source previews',async()=>{
 const f=fixture();await f.plugin.onload();f.plugin.app.vault.getMarkdownFiles=()=>[{path:'測試.md'},{path:'第二.md'}];
 const files=new Map([['測試.md','---\ntags: [既有]\n---\n# 原文'],['第二.md','# 不選']]);
 const io={read:async p=>files.get(p)??null,createJournal:async(p,v)=>files.set(p,v),writeJournal:async(p,v)=>files.set(p,v),compareWrite:async(p,b,a)=>{assert.equal(files.get(p),b);files.set(p,a);}};
 f.plugin.organization=new organizationModule.exports.Organization(io);
 await f.plugin.prepareTags();assert.equal(f.requests.length,0);const chooser=f.modal;
 all(chooser.contentEl).find(e=>e.attrs['aria-label']==='要加上的分類標籤').value='研究/閱讀 待核對';
 await all(chooser.contentEl).find(e=>e.text==='預覽分類標籤變更').onclick();
 const preview=f.modal;assert.notEqual(preview,chooser);assert.equal(files.size,2);assert.equal(f.requests.length,0);assert.equal(all(preview.contentEl).filter(e=>e.tag==='textarea').length,0,'source body cannot be edited through a generic write');
 assert.ok(all(preview.contentEl).some(e=>e.text.includes('將為 1 份原筆記加上標籤')));
 await all(preview.contentEl).find(e=>e.text==='套用已選的整理方案').onclick();assert.match(files.get('測試.md'),/#待核對 #研究\/閱讀/);assert.equal(files.get('第二.md'),'# 不選');assert.equal(f.requests.length,0);
 const history=[...files.keys()].find(p=>p.endsWith('.json'));await f.plugin.organization.undo(JSON.parse(files.get(history)).plan.id);assert.equal(files.get('測試.md'),'---\ntags: [既有]\n---\n# 原文');
});

test('native AI classification passes through evidence, editable tags, exact preview and source-version checks',async()=>{
 const f=fixture();await f.plugin.onload();const org=organizationModule.exports;
 const prepared=contentModule.exports.prepare('tags','測試.md',org.hash('原始筆記'),'原始筆記',''),key='12345678-1234-1234-1234-123456789abc';
 const request={role:'user',kind:'discussion',text:prepared.question,organizationDraft:prepared.organizationDraft,requestKey:key};
 const reply={role:'ai',kind:'discussion',inReplyTo:key,resultRevision:8,text:JSON.stringify({summary:'建議人工核對',suggestions:[{tag:'研究',reason:'與來源相關',quote:'原始筆記'}]}),discussion:{intent:'question'}};
 f.plugin.api=async()=>({tasks:[{id:'TASK-tags',revision:99,planning:{messages:[request,reply]}}]});
 const files=new Map([['測試.md','原始筆記']]);f.plugin.app.vault.getMarkdownFiles=()=>[{path:'測試.md'},{path:'其他.md'}];
 f.plugin.organization=new org.Organization({read:async p=>files.get(p)??null,createJournal:async(p,v)=>files.set(p,v),writeJournal:async(p,v)=>files.set(p,v),compareWrite:async(p,b,a)=>{assert.equal(files.get(p),b);files.set(p,a);}});
 await f.plugin.contentDraft('TASK-tags',key);assert.equal(files.size,1);assert.ok(all(f.modal.contentEl).some(e=>e.tag==='blockquote'&&e.text==='原始筆記'));
 await all(f.modal.contentEl).find(e=>e.text==='帶入標籤草稿，再預覽變更').onclick();
 const chooser=f.modal;assert.ok(all(chooser.contentEl).some(e=>e.text==='測試.md'));
 assert.ok(!all(chooser.contentEl).some(e=>e.text==='其他.md'),'suggestions cannot expand to unrelated notes');
 const tags=all(chooser.contentEl).find(e=>e.attrs['aria-label']==='要加上的分類標籤');assert.equal(tags.value,'研究');tags.value='人工調整';
 files.set('測試.md','來源已改');await all(chooser.contentEl).find(e=>e.text==='預覽分類標籤變更').onclick();assert.match(f.notices.at(-1),/來源或任務版本不一致/);assert.equal(files.size,1);
 files.set('測試.md','原始筆記');await all(chooser.contentEl).find(e=>e.text==='預覽分類標籤變更').onclick();const preview=f.modal;
 await all(preview.contentEl).find(e=>e.text==='套用已選的整理方案').onclick();assert.match(files.get('測試.md'),/#人工調整/);
 const journal=JSON.parse(files.get([...files.keys()].find(p=>p.endsWith('.json'))));assert.equal(journal.plan.basis.resultRevision,8);assert.equal(journal.plan.basis.suggestions[0].tag,'研究');assert.equal(journal.plan.operations[0].tags[0],'人工調整');
 await f.plugin.organization.undo(journal.plan.id);assert.equal(files.get('測試.md'),'原始筆記');
});

test('native relocation command reads a full snapshot and exposes link differences without any write or model call',async()=>{
 const f=fixture();await f.plugin.onload();const files=new Map([['測試.md','原文'],['引用.md','[[測試]]']]);const entries=[...files.keys()].map(path=>({path,stat:{}}));
 Object.assign(f.plugin.app.vault,{getMarkdownFiles:()=>entries,getFiles:()=>entries,getAbstractFileByPath:p=>entries.find(file=>file.path===p)||null,read:async file=>files.get(file.path),rename:async()=>assert.fail('preview must never rename'),modify:async()=>assert.fail('preview must never modify')});
 f.plugin.app.metadataCache={getFileCache:file=>({links:file.path==='引用.md'?[{original:'[[測試]]',link:'測試',position:{start:{offset:0},end:{offset:6}}}]:[]}),getFirstLinkpathDest:link=>link==='測試'?entries[0]:null};
 await f.plugin.previewRelocation();assert.equal(f.requests.length,0);all(f.modal.contentEl).find(e=>e.attrs['aria-label']==='搬移目標筆記路徑').value='知識/新名字.md';
 await all(f.modal.contentEl).find(e=>e.text==='計算搬移與連結草稿').onclick();
 assert.equal(f.modal.title,'搬移與連結草稿 · 尚不可套用');assert.ok(all(f.modal.contentEl).some(e=>e.text.includes('[[知識/新名字]]')));assert.ok(all(f.modal.contentEl).some(e=>e.text.includes('尚未證明索引完整')));assert.equal(all(f.modal.contentEl).filter(e=>e.tag==='button').length,0);assert.equal(f.requests.length,0);assert.equal(files.get('測試.md'),'原文');assert.equal(files.get('引用.md'),'[[測試]]');
});
test('native relocation discards a snapshot if note contents change during scanning',async()=>{
 const f=fixture();await f.plugin.onload();const entry={path:'測試.md',stat:{}};let reads=0;
 Object.assign(f.plugin.app.vault,{getMarkdownFiles:()=>[entry],getFiles:()=>[entry],getAbstractFileByPath:p=>p===entry.path?entry:null,read:async()=>++reads===1?'原文':'後來修改'});f.plugin.app.metadataCache={getFileCache:()=>({}),getFirstLinkpathDest:()=>null};
 await f.plugin.previewRelocation();all(f.modal.contentEl).find(e=>e.attrs['aria-label']==='搬移目標筆記路徑').value='新.md';await all(f.modal.contentEl).find(e=>e.text==='計算搬移與連結草稿').onclick();assert.match(f.notices.at(-1),/掃描期間筆記已變更/);assert.equal(f.modal.title,'搬移／重新命名 · 只讀草稿');
});
