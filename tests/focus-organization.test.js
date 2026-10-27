import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import path from 'node:path';
import os from 'node:os';
import {FocusSessions} from '../src/focus-sessions.js';
import {FocusOrganization} from '../src/focus-organization.js';
import {requestApp} from './fixtures/request.js';
const validReply=()=>JSON.stringify({points:[{text:'本輪留下新觀察',kind:'observation',source:'after',quote:'new point'}],openQuestions:['是否已實機核對？'],nextSteps:['先預覽，再請人確認'],handoff:'沿用本輪來源版本，未驗證的部分先核對。'});
async function fixture(t,runner){
 const root=await mkdtemp(path.join(os.tmpdir(),'mentor-focus-organize-'));t.after(()=>rm(root,{recursive:true,force:true}));const vault=path.join(root,'vault');await mkdir(vault);const store=new FocusSessions(vault),first=await store.change('start',{revision:0,requestKey:'initial-focus-start',targetMinutes:15,goal:'整理本輪',taskId:'TASK-focus-handoff',workItemId:'item-one',sourceBefore:{path:'研究/來源.md',status:'present',content:'PRIVATE_UNSELECTED_MARKER\nold point'}});
 await store.change('end',{revision:1,requestKey:'initial-focus-end',sessionId:first.activeId,sourceAfter:{path:'研究/來源.md',status:'present',content:'PRIVATE_UNSELECTED_MARKER\nnew point'}});
 let agent={provider:'claude',modelId:'fictional-model',effort:'low'},calls=[];
 const service=new FocusOrganization(store,{agent:()=>agent,run:async input=>{calls.push(input);return runner?runner(input):{text:validReply(),elapsedMs:12,usage:null};}});
 t.after(async()=>{await Promise.allSettled([...service.pending.values()]);});
 return {root,store,service,id:first.activeId,calls,set agent(value){agent=value;},input:()=>({revision:undefined,sessionId:first.activeId,beforeText:'old point',afterText:'new point',reflection:''})};
}
async function plan(f){const input={...f.input(),revision:(await f.store.list()).revision};return {input,plan:(await f.service.prepare(input)).plan};}
async function start(f,key='organization-once'){const p=await plan(f),input={...p.input,planId:p.plan.id,requestKey:key},result=await f.service.start(input);await Promise.all([...f.service.pending.values()]);return {input,result,job:(await f.service.get(f.id,result.jobId)).job};}
test('preview is free, exact selected context runs once and human edits save/export an explicit version',async t=>{
 const f=await fixture(t),p=await plan(f);assert.equal(f.calls.length,0);assert.equal(p.plan.taskId,'TASK-focus-handoff');assert.equal(p.plan.workItemId,'item-one');assert.doesNotMatch(p.plan.prompt,/PRIVATE_UNSELECTED_MARKER/);const {input,result,job}=await start(f);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].mode,'chat');assert.notEqual(f.calls[0].cwd,f.root);assert.equal(job.status,'draft');assert.equal(job.cliElapsedMs,12);assert.equal((await f.service.start(input)).replayed,true);assert.equal(f.calls.length,1);
 assert.doesNotMatch(JSON.stringify(await f.store.list()),/new point|PRIVATE_UNSELECTED_MARKER|本輪留下新觀察/);
 const current=await f.service.get(f.id,result.jobId),save={revision:current.revision,sessionId:f.id,jobId:job.id,requestKey:'save-publication-once',draftRevision:1,content:'我修改後的重點。\n\n待實機確認。'};
 const published=await f.service.save(save);assert.equal((await f.service.save(save)).replayed,true);assert.equal((await f.service.get(f.id,job.id)).job.publications.length,1);
 const exported=await f.service.export(f.id,job.id,published.publicationId);assert.match(exported.markdown,/我修改後的重點/);assert.match(exported.markdown,/不表示事實已獨立驗證或任務已驗收/);assert.match(exported.markdown,/開始 SHA-256/);assert.equal(exported.fileName.includes('/'),false);assert.match(exported.markdown,/本次核准的來源片段/);assert.match(exported.markdown,/new point/);assert.match(exported.markdown,/關聯任務：TASK-focus-handoff/);assert.match(exported.markdown,/關聯工作項目：item-one/);assert.doesNotMatch(exported.markdown,/PRIVATE_UNSELECTED_MARKER/);
 await assert.rejects(f.service.save({...save,requestKey:'save-stale-version',revision:published.revision}),{code:'FOCUS_DRAFT_CHANGED'});
});
test('changed model/plan and fabricated source are rejected before any CLI call',async t=>{
 const f=await fixture(t),p=await plan(f);f.agent={provider:'claude',modelId:'another-fictional-model',effort:'low'};
 await assert.rejects(f.service.start({...p.input,requestKey:'changed-model-request',planId:p.plan.id}),{code:'FOCUS_PLAN_CHANGED'});
 await assert.rejects(f.service.prepare({...p.input,afterText:'invented quote'}),{code:'FOCUS_EXCERPT_CHANGED'});assert.equal(f.calls.length,0);
});
test('unsupported response quotes remain raw failed evidence and cannot be saved',async t=>{
 const f=await fixture(t,async()=>({text:validReply().replace('new point','invented quote')})),{job,result}=await start(f);
 assert.equal(job.status,'failed');assert.equal(job.errorCode,'FOCUS_RESPONSE_INVALID');assert.match(job.response,/invented quote/);assert.equal(job.draft,undefined);
 await assert.rejects(f.service.save({revision:(await f.store.list()).revision,sessionId:f.id,jobId:result.jobId,requestKey:'save-invalid-draft',draftRevision:1,content:'fake success'}),{code:'FOCUS_DRAFT_CHANGED'});
 assert.equal((await f.store.materials(f.id)).comparison.after.content,'PRIVATE_UNSELECTED_MARKER\nnew point');
});
test('restart marks unknown, blocks duplicate execution and requires explicit stopped confirmation',async t=>{
 let resolveRun;const f=await fixture(t,()=>new Promise(resolve=>{resolveRun=resolve;})),p=await plan(f),started=await f.service.start({...p.input,planId:p.plan.id,requestKey:'restart-original'});
 // Wait until the injected runner is actually active, not an arbitrary timeout.
 while(!resolveRun)await new Promise(resolve=>setImmediate(resolve));
 const restarted=new FocusOrganization(f.store,{agent:()=>p.plan.agent,run:async()=>assert.fail('unknown execution must not run')});await restarted.recover();assert.equal((await restarted.get(f.id,started.jobId)).job.status,'unknown');
 const preview=await restarted.prepare({...p.input,revision:(await f.store.list()).revision});await assert.rejects(restarted.start({...p.input,revision:preview.plan.revision,planId:preview.plan.id,requestKey:'restart-blocked'}),{code:'FOCUS_ORGANIZATION_BUSY'});
 resolveRun({text:validReply()});await Promise.all([...f.service.pending.values()]);assert.equal((await restarted.get(f.id,started.jobId)).job.status,'unknown');
 const input={revision:(await f.store.list()).revision,sessionId:f.id,jobId:started.jobId,requestKey:'reconcile-confirmed'};await assert.rejects(restarted.reconcile(input),{code:'FOCUS_STOP_CONFIRMATION'});await restarted.reconcile({...input,confirmStopped:true});assert.equal((await restarted.get(f.id,started.jobId)).job.status,'cancelled');
});
test('stop waits for the runner to finish and never converts its reply into a draft',async t=>{
 const child=new EventEmitter();let rejectRun;const f=await fixture(t,input=>new Promise((resolve,reject)=>{rejectRun=reject;input.onSpawn(child);})),p=await plan(f),started=await f.service.start({...p.input,planId:p.plan.id,requestKey:'stoppable-run'});
 while(!rejectRun)await new Promise(resolve=>setImmediate(resolve));await f.service.stop({revision:0,sessionId:f.id,jobId:started.jobId,requestKey:'stop-request-once'});assert.equal((await f.service.get(f.id,started.jobId)).job.status,'stopping');
 child.emit('close',null,'SIGTERM');rejectRun(Object.assign(Error('interrupted'),{code:'AGENT_INTERRUPTED'}));await Promise.all([...f.service.pending.values()]);assert.equal((await f.service.get(f.id,started.jobId)).job.status,'cancelled');
});
test('organization HTTP stays authenticated and no AI runs before exact-plan confirmation',async t=>{
 const f=await fixture(t),app=await requestApp(f.root,async()=>({text:validReply()})),url='/api/focus/organization?sessionId='+f.id;
 assert.equal((await app.fetch(url)).status,403);const cookie=(await app.fetch('/')).headers.get('set-cookie').split(';')[0],csrf=(await(await app.fetch('/api/session',{headers:{cookie}})).json()).csrfToken,headers={cookie,'x-csrf-token':csrf};
 const input={...f.input(),revision:(await f.store.list()).revision};const prepared=await app.fetch('/api/focus/prepare-organization',{method:'POST',headers,body:JSON.stringify(input)});assert.equal(prepared.status,200);const {plan:p}=await prepared.json();assert.equal(app.focusOrganization.pending.size,0);
 const response=await app.fetch('/api/focus/organize',{method:'POST',headers,body:JSON.stringify({...input,planId:p.id,requestKey:'http-organization-start'})});assert.equal(response.status,202);await Promise.all([...app.focusOrganization.pending.values()]);assert.equal((await(await app.fetch(url,{headers:{cookie}})).json()).job.status,'draft');
});

test('simulated replies remain explicit in state and exported notes',async t=>{
 const f=await fixture(t,async()=>({text:validReply(),simulated:true})),{job}=await start(f);assert.equal(job.simulated,true);assert.equal((await f.store.list()).sessions[0].organizationRuns[0].simulated,true);
 const saved=await f.service.save({revision:(await f.store.list()).revision,sessionId:f.id,jobId:job.id,draftRevision:1,content:job.draft,requestKey:'save-simulated-reply'});assert.match((await f.service.export(f.id,job.id,saved.publicationId)).markdown,/示範／模擬回覆，未呼叫真實 CLI/);
});
