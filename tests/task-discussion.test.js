import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {demoTask} from './fixtures/demo-task.js';
import {requestApp} from './fixtures/request.js';
import {serializeTask} from '../src/tasks.js';
import {discussionResult,organizationDraftMetadata} from '../src/task-discussion.js';
import {compactHandoff} from '../src/compact-handoff.js';
import {buildHandoff} from '../src/handoffs.js';
import {workCardsMarkdown} from '../src/work-cards.js';
import {prompts} from '../src/coach.js';

async function setup(t,runner){
 const home=await mkdtemp(path.join(tmpdir(),'mentor-question-'));t.after(()=>rm(home,{recursive:true,force:true}));
 await mkdir(path.join(home,'vault'));const out=path.join(home,'outputs');await mkdir(out);await writeFile(path.join(out,'note.md'),'UNCHANGED');
 const task=demoTask('TASK-question',out);task.status='READY';task.planning.workItems=[{id:'W1',title:'來源',detail:'原工作',owner:'ai',status:'DONE',acceptance:['保留原文'],dependsOn:[],outputs:[{file:'note.md'}],doneAt:'yesterday'}];
 task.planning.autopilot={full:false,waitingFor:{kind:'confirm'}};
 await writeFile(path.join(home,'vault',task.id+'.md'),serializeTask(task));
 const app=await requestApp(home,runner),cookie=(await app.fetch('/')).headers.get('set-cookie').split(';')[0],csrf=(await(await app.fetch('/api/session',{headers:{cookie}})).json()).csrfToken;
 const headers={cookie,'x-csrf-token':csrf,'content-type':'application/json','idempotency-key':'question-request-001'};
 return {app,task,out,headers,post:input=>app.fetch(`/api/tasks/${task.id}/ask`,{method:'POST',headers,body:JSON.stringify(input)})};
}

test('discussion normalizer strips action-shaped fields, rejects missing answers and never executes cancellation intent',()=>{
 const task=demoTask();assert.deepEqual(discussionResult(JSON.stringify({intent:'cancel',answer:'你可能希望暫停，尚未取消。',proposedChange:'delete everything',phase:'done',scope:'/outside'}),task),{intent:'cancel',answer:'你可能希望暫停，尚未取消。',proposedChange:'',scope:'current'});
 assert.throws(()=>discussionResult('{"intent":"change"}',task));
 assert.throws(()=>discussionResult(JSON.stringify({intent:'change',answer:'ok',proposedChange:'x'.repeat(6001),scope:'current'}),task));
 assert.equal(discussionResult(JSON.stringify({intent:'change',answer:'ok',proposedChange:'edit files',scope:'/outside'}),task).proposedChange,'');
});
test('authenticated questions run chat-only once, retain source state, do not resume autopilot and replay safely',async t=>{
 let calls=0,resumes=0;const seen=[];
 const f=await setup(t,async input=>{calls++;seen.push(input);return {text:JSON.stringify({intent:'change',answer:'可以先調整間距，尚未修改。',proposedChange:'只調整表格間距',scope:'W1',phase:'done'})};});
 f.app.coach.resumeAuto=()=>resumes++;
 const request={revision:1,question:'是否可以只改間距？'};
 assert.equal((await f.app.fetch(`/api/tasks/${f.task.id}/ask`,{method:'POST',body:JSON.stringify(request)})).status,403);
 const responses=await Promise.all([f.post(request),f.post(request)]);assert.ok(responses.every(r=>r.status===202));await f.app.settle();
 const current=await f.app.coach.latest(f.task.id);assert.equal(calls,1);assert.equal(resumes,0);assert.equal(seen[0].mode,'chat');assert.equal(seen[0].prompt.split(request.question).length-1,1,'current question is not repeated in the handoff context');assert.equal(current.goal,f.task.goal);assert.deepEqual(current.scope,f.task.scope);assert.deepEqual(current.planning.workItems,f.task.planning.workItems);assert.equal(current.planning.phase,'execute');assert.equal(await readFile(path.join(f.out,'note.md'),'utf8'),'UNCHANGED');
 assert.match(workCardsMarkdown(current),/問答回答（不是修改授權）：可以先調整間距/);
 assert.equal(current.planning.messages.at(-1).discussion.intent,'change');assert.equal(current.planning.learningTurns.at(-1).inputKind,'question');
 f.app.coach.questions.clear();const replay=await f.post(request);assert.equal(replay.status,200);assert.equal(calls,1,'persisted request record prevents restart replay from launching another CLI');
 assert.equal((await f.post({...request,question:'different'})).status,409);
 assert.match(compactHandoff(current).content,/最近問答（不是修改或取消授權）/);assert.match(buildHandoff(current),/問答中的問題（非修改授權）/);
 const prompt=prompts.C(current,'');assert.doesNotMatch(prompt,/是否可以只改間距|可以先調整間距/,'unapproved question/suggestion cannot become a new execution instruction');
});
test('stopping a question never converts the original task into a resumable Grill step',async t=>{
 let rejectRun;const f=await setup(t,()=>new Promise((resolve,reject)=>{rejectRun=reject;}));
 const started=await f.app.coach.discuss(f.task.id,1,'question-stop-001',{question:'為什麼還沒完成？'});
 await f.app.coach.stop(f.task.id,{graceMs:10,confirmMs:50});rejectRun(new Error('stopped'));await started.done;
 const current=await f.app.coach.latest(f.task.id);assert.equal(current.planning.stopped,null);assert.equal(current.planning.running,null);assert.equal(current.planning.learningTurns.at(-1).status,'stopped');assert.deepEqual(current.planning.workItems,f.task.planning.workItems);
});
test('question restart recovery preserves uncertainty without creating a write-work resume step',async t=>{
 const f=await setup(t,async()=>assert.fail('recovery must never run AI'));
 await f.app.coach.store.mutate(f.task.id,1,null,task=>{task.planning.running={stage:'B',discussion:true,turnId:'q-unknown',startedAt:new Date().toISOString(),stopping:{}};task.planning.learningTurns=[{id:'q-unknown',stage:'B',inputKind:'question',status:'running'}];return {status:'RUNNING'};});
 await f.app.coach.recover();const task=await f.app.coach.latest(f.task.id);assert.equal(task.planning.stopped??null,null);assert.equal(task.planning.learningTurns[0].status,'unknown');assert.equal(task.planning.phase,'execute');
});

test('organization metadata persists as inert provenance with a correlated, versioned answer',async t=>{
 let calls=0;const f=await setup(t,async()=>{calls++;return {text:JSON.stringify({intent:'question',answer:'## 知識草稿\n尚待核對。',scope:'current',proposedChange:''})};});
 const metadata={version:1,kind:'knowledge',sourcePath:'研究/來源.md',sourceSha256:'a'.repeat(64),excerptSha256:'b'.repeat(64),period:'',outputDir:'/outside'};
 const input={revision:1,question:'請依來源快照預寫內容，不修改任何檔案。',organizationDraft:metadata};
 const response=await f.post(input);assert.equal(response.status,202);await f.app.settle();
 const task=await f.app.coach.latest(f.task.id),user=task.planning.messages.find(m=>m.organizationDraft),answer=task.planning.messages.find(m=>m.inReplyTo===user.requestKey);
 assert.equal(user.organizationDraft.outputDir,undefined);assert.equal(answer.resultRevision,task.revision);assert.equal(answer.inReplyTo,user.requestKey);assert.deepEqual(task.planning.workItems,f.task.planning.workItems);
 const compact=compactHandoff(task).content;assert.match(compact,/正文保留於完整對話/);assert.doesNotMatch(compact,/## 知識草稿/);
 f.app.coach.questions.clear();assert.equal((await f.post(input)).status,200);assert.equal(calls,1);
 assert.equal((await f.post({...input,organizationDraft:{...metadata,period:'different'}})).status,409);
 assert.throws(()=>organizationDraftMetadata({...metadata,sourcePath:'../outside.md'}));
});
