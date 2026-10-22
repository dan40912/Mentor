import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),organization={exports:{}},drafts={exports:{}};
vm.runInNewContext(await readFile(new URL('../obsidian/mentor-work-center/organization.js',import.meta.url),'utf8'),{module:organization,require});
vm.runInNewContext(await readFile(new URL('../obsidian/mentor-work-center/content-drafts.js',import.meta.url),'utf8'),{module:drafts,require:name=>name==='./organization'?organization.exports:require(name)});
const {prepare,output,snapshotOf}=drafts.exports,{hash}=organization.exports,key='12345678-1234-1234-1234-123456789abc';
const request=kind=>{const p=prepare(kind,'研究/原始 #1?.md',hash('完整筆記'),'選取的原文','');return {role:'user',text:p.question,organizationDraft:p.organizationDraft,requestKey:key};};
const reply=()=>({role:'ai',kind:'discussion',inReplyTo:key,resultRevision:7,text:'## 理解\n來源支持這個觀察，尚未驗證。',discussion:{intent:'question'}});

test('all three AI draft types retain versioned sources, unknown periods and managed paths',()=>{
 for(const kind of ['knowledge','weekly','source']){const r=request(kind),result=output(r,reply(),'TASK-draft',7);assert.match(result.path,/^Mentor 整理\//);assert.match(result.after,/status: draft/);assert.match(result.after,/尚待核對/);assert.match(result.after,/source_sha256:/);assert.match(result.after,/mentor_revision: 7/);assert.match(result.after,/%231%3F\.md/);assert.equal(snapshotOf(r).excerptSha256,hash('選取的原文'));if(kind==='weekly')assert.match(result.after,/期間未指定/);}
});
test('drafts never silently truncate sources or accept mismatched replies/snapshots',()=>{
 assert.throws(()=>prepare('knowledge','來源.md',hash('x'),'x'.repeat(3501)),/3,500/);
 assert.throws(()=>prepare('knowledge','../來源.md',hash('x'),'x'));
 assert.throws(()=>prepare('knowledge','Mentor 整理/來源.md',hash('x'),'x'));
 const r=request('knowledge');r.text=r.text.replace('選取的原文','改過的內容');assert.throws(()=>output(r,reply(),'TASK-draft',7),/不一致/);
 assert.throws(()=>output(request('source'),{...reply(),inReplyTo:'other'},'TASK-draft',7),/尚未取得/);
 assert.throws(()=>output(request('source'),reply(),'TASK-draft',undefined),/識別不正確/);
 assert.throws(()=>output(request('source'),{...reply(),discussion:{intent:'unclear'}},'TASK-draft',7),/尚未取得/);
});
