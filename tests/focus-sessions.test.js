import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {FocusSessions} from '../src/focus-sessions.js';
import {requestApp} from './fixtures/request.js';
import {ObsidianBridge} from '../src/obsidian-bridge.js';
async function fixture(t){const dir=await mkdtemp(path.join(os.tmpdir(),'mentor-focus-'));t.after(()=>rm(dir,{recursive:true,force:true}));const vault=path.join(dir,'vault');await mkdir(vault);let now=100000;return {dir,vault,store:new FocusSessions(vault,()=>now),get now(){return now;},set now(value){now=value;}};}
test('focus reaches target without stopping, excludes explicit pauses and survives a fresh reader',async t=>{
 const f=await fixture(t);let result=await f.store.change('start',{revision:0,requestKey:'start-first',targetMinutes:10,goal:'整理三個取捨'});const id=result.activeId;
 f.now=100000+11*60000;result=await f.store.list();assert.equal(result.sessions[0].status,'running');assert.equal(result.sessions[0].timing.overtimeMs,60000);
 result=await f.store.change('pause',{revision:1,requestKey:'pause-first',sessionId:id});f.now+=120000;assert.equal((await f.store.list()).sessions[0].timing.elapsedMs,11*60000);
 result=await f.store.change('resume',{revision:2,requestKey:'resume-first',sessionId:id});f.now+=60000;
 result=await f.store.change('end',{revision:3,requestKey:'end-first',sessionId:id});assert.equal(result.activeId,null);assert.equal(result.sessions[0].timing.elapsedMs,12*60000);assert.equal(result.sessions[0].organizationStatus,'not_requested');
 const reloaded=await new FocusSessions(f.vault,()=>999999999).list();assert.equal(reloaded.sessions[0].timing.elapsedMs,12*60000);assert.equal(reloaded.sessions[0].events.length,4);
});
test('concurrent start has one writer; replay is durable and cannot change request contents',async t=>{
 const f=await fixture(t),input={revision:0,requestKey:'start-once',targetMinutes:15,goal:''};
 const results=await Promise.allSettled([f.store.change('start',input),f.store.change('start',{...input,requestKey:'start-other'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const restarted=new FocusSessions(f.vault,()=>100000);assert.equal((await restarted.change('start',input)).replayed,true);assert.equal((await restarted.list()).sessions.length,1);
 await assert.rejects(restarted.change('start',{...input,targetMinutes:30}),{code:'FOCUS_REQUEST_CONFLICT'});
 await assert.rejects(restarted.change('start',{...input,revision:1,requestKey:'start-another'}),{code:'FOCUS_ALREADY_ACTIVE'});
});
test('invalid duration, unknown writes, stale revision and backwards clock leave state intact',async t=>{
 const f=await fixture(t);for(const targetMinutes of [0,181,1.5,'15'])await assert.rejects(f.store.change('start',{revision:0,requestKey:'invalid-start',targetMinutes,goal:''}),{code:'FOCUS_INPUT_INVALID'});
 await assert.rejects(f.store.change('start',{revision:0,requestKey:'invalid-path',targetMinutes:15,goal:'',path:'/outside'}),{code:'FOCUS_INPUT_INVALID'});
 const result=await f.store.change('start',{revision:0,requestKey:'valid-start',targetMinutes:30,goal:''});f.now=99999;
 assert.equal((await f.store.list()).sessions[0].timing.clockChanged,true);
 await assert.rejects(f.store.change('end',{revision:1,requestKey:'backwards-end',sessionId:result.activeId}),{code:'FOCUS_CLOCK_CHANGED'});assert.equal((await f.store.list()).revision,1);
});
test('corrupt or linked state refuses writes rather than replacing user data',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.vault,'focus-sessions.json'),'invalid');await assert.rejects(f.store.list(),{code:'FOCUS_STATE_INVALID'});
 await rm(path.join(f.vault,'focus-sessions.json'));const other=path.join(f.dir,'other.json');await writeFile(other,'{}');await symlink(other,path.join(f.vault,'focus-sessions.json'));
 await assert.rejects(f.store.list(),{code:'TASK_SYMLINK'});
});
test('focus HTTP requires session and CSRF, never runs AI, and bridge scope stays bounded',async t=>{
 const f=await fixture(t),app=await requestApp(f.dir,async()=>assert.fail('timer must not invoke AI'));
 assert.equal((await app.fetch('/api/focus')).status,403);const cookie=(await app.fetch('/')).headers.get('set-cookie').split(';')[0];
 const csrf=(await(await app.fetch('/api/session',{headers:{cookie}})).json()).csrfToken;
 const input={revision:0,requestKey:'api-start-once',targetMinutes:15,goal:'整理筆記'};
 assert.equal((await app.fetch('/api/focus/start',{method:'POST',headers:{cookie},body:JSON.stringify(input)})).status,403);
 const response=await app.fetch('/api/focus/start',{method:'POST',headers:{cookie,'x-csrf-token':csrf},body:JSON.stringify(input)});assert.equal(response.status,200);assert.equal((await response.json()).sessions[0].status,'running');
 const bridge=new ObsidianBridge(),pair=bridge.prepare(),{token}=bridge.exchange(pair.code);
 for(const [method,url] of [['GET','/api/obsidian/focus'],['POST','/api/obsidian/focus/end']])assert.ok(bridge.authorize({method,url,headers:{authorization:'Bearer '+token}}).route.startsWith('/api/focus'));
 assert.throws(()=>bridge.authorize({method:'POST',url:'/api/obsidian/focus/delete-all',headers:{authorization:'Bearer '+token}}),{code:'BRIDGE_SCOPE'});
});
