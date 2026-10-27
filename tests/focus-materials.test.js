import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {FocusSessions} from '../src/focus-sessions.js';
import {requestApp} from './fixtures/request.js';
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'mentor-focus-materials-'));t.after(()=>rm(root,{recursive:true,force:true}));const vault=path.join(root,'vault');await mkdir(vault);let at=10000;return {root,vault,store:new FocusSessions(vault,()=>at),advance:()=>{at+=10000;}};}
const before={path:'研究/表格.md',status:'present',content:'標題\n舊結論\n共同內容\n舊下一步\n尾段'};
const start=store=>store.change('start',{revision:0,requestKey:'source-start',targetMinutes:15,goal:'整理表格',sourceBefore:before});
test('source bodies are opt-in and absent from polling; comparison preserves both disjoint edits and deletions',async t=>{
 const f=await fixture(t),started=await start(f.store);assert.equal(JSON.stringify(started).includes('舊結論'),false);f.advance();
 await f.store.change('end',{revision:1,requestKey:'source-end',sessionId:started.activeId,sourceAfter:{...before,content:'標題\n新結論\n共同內容\n新下一步\n尾段'}});
 const {comparison:c}=await f.store.materials(started.activeId);assert.equal(c.status,'changed');assert.deepEqual(c.region.before,['舊結論','共同內容','舊下一步']);assert.deepEqual(c.region.after,['新結論','共同內容','新下一步']);assert.match(c.note,/不代表使用者親自撰寫/);assert.equal(c.before.content,before.content);
 assert.equal(JSON.stringify(await f.store.list()).includes('舊結論'),false);
});
test('unavailable end is not unchanged or deleted; late capture is explicit and cannot overwrite saved content',async t=>{
 const f=await fixture(t),started=await start(f.store);f.advance();await f.store.change('end',{revision:1,requestKey:'source-end',sessionId:started.activeId});
 assert.equal((await f.store.materials(started.activeId)).comparison.status,'after_unavailable');f.advance();
 await f.store.change('capture',{revision:2,requestKey:'source-late',sessionId:started.activeId,sourceAfter:{...before,content:'較晚的內容'}});const c=(await f.store.materials(started.activeId)).comparison;assert.equal(c.index.lateCapture,true);assert.ok(c.after.capturedAt>20000);assert.equal((await f.store.list()).sessions[0].elapsedMs,10000);
 await assert.rejects(f.store.change('capture',{revision:3,requestKey:'source-overwrite',sessionId:started.activeId,sourceAfter:before}),{code:'FOCUS_STATE_CONFLICT'});
});
test('missing source and zero edits are distinct, invalid paths and oversize input leave no partial session',async t=>{
 const f=await fixture(t);for(const sourceBefore of [{...before,path:'../secret.md'},{...before,content:'x'.repeat(50001)},{path:before.path,status:'missing'}])await assert.rejects(f.store.change('start',{revision:0,requestKey:'invalid-source',targetMinutes:10,goal:'',sourceBefore}),{code:'FOCUS_SOURCE_INVALID'});
 assert.equal((await f.store.list()).sessions.length,0);const started=await start(f.store);
 await assert.rejects(f.store.change('end',{revision:1,requestKey:'wrong-source',sessionId:started.activeId,sourceAfter:{...before,path:'別的筆記.md'}}),{code:'FOCUS_SOURCE_INVALID'});
 await f.store.change('end',{revision:1,requestKey:'missing-source',sessionId:started.activeId,sourceAfter:{path:before.path,status:'missing'}});assert.equal((await f.store.materials(started.activeId)).comparison.status,'source_missing');
});
test('saved source tampering fails closed and authenticated material reads never invoke AI',async t=>{
 const f=await fixture(t),started=await start(f.store),app=await requestApp(f.root,async()=>assert.fail('snapshot must not call AI'));
 const url='/api/focus/materials?sessionId='+started.activeId;assert.equal((await app.fetch(url)).status,403);const cookie=(await app.fetch('/')).headers.get('set-cookie').split(';')[0];assert.equal((await app.fetch(url,{headers:{cookie}})).status,200);
 const file=path.join(f.vault,'focus-sessions.json'),state=JSON.parse(await readFile(file,'utf8'));state.sessions[0].materials.before.content='tampered';await writeFile(file,JSON.stringify(state));await assert.rejects(f.store.list(),{code:'FOCUS_STATE_INVALID'});
});

test('identical snapshots remain unchanged without inventing work or discarding their original versions',async t=>{
 const f=await fixture(t),started=await start(f.store);await f.store.change('end',{revision:1,requestKey:'unchanged-end',sessionId:started.activeId,sourceAfter:before});const c=(await f.store.materials(started.activeId)).comparison;assert.equal(c.status,'unchanged');assert.equal(c.before.content,before.content);assert.deepEqual(c.region.before,[]);assert.deepEqual(c.region.after,[]);
});

test('operation capacity reserves the ability to end an already active session',async t=>{
 const f=await fixture(t),started=await start(f.store),file=path.join(f.vault,'focus-sessions.json'),state=JSON.parse(await readFile(file,'utf8'));
 state.requests=Array.from({length:5000},(_,i)=>({key:'capacity-'+String(i).padStart(5,'0'),digest:'a'.repeat(64)}));await writeFile(file,JSON.stringify(state));
 await assert.rejects(f.store.change('pause',{revision:1,requestKey:'pause-capacity',sessionId:started.activeId}),{code:'FOCUS_CAPACITY'});
 const ended=await f.store.change('end',{revision:1,requestKey:'end-capacity',sessionId:started.activeId,sourceAfter:before});assert.equal(ended.activeId,null);assert.equal((await f.store.list()).sessions[0].status,'ended');
});


test('source collection labels persist without claiming file authenticity and invalid labels are refused',async t=>{
 const f=await fixture(t),session=await f.store.change('start',{revision:0,requestKey:'manual-source-start',targetMinutes:10,goal:'手動材料',sourceBefore:{...before,origin:'manual_paste'}});
 await f.store.change('end',{revision:1,requestKey:'manual-source-end',sessionId:session.activeId,sourceAfter:{...before,origin:'obsidian_note'}});
 const index=(await f.store.list()).sessions[0].materials;assert.equal(index.beforeOrigin,'manual_paste');assert.equal(index.afterOrigin,'obsidian_note');assert.equal((await f.store.materials(session.activeId)).comparison.before.origin,'manual_paste');
 await assert.rejects(f.store.change('start',{revision:2,requestKey:'invalid-source-method',targetMinutes:10,goal:'拒絕錯誤方式',sourceBefore:{...before,origin:'verified-authentic'}}),{code:'FOCUS_SOURCE_INVALID'});
});
