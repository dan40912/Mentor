import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {demoTask} from './fixtures/demo-task.js';
import {requestApp} from './fixtures/request.js';
import {serializeTask,sha256} from '../src/tasks.js';
import {prepareExecutionWorkspace,publishExecutionWorkspace} from '../src/execution-workspace.js';
const reply='STATUS: DONE\nFILES: result.md';
async function fixture(t,{conflict=false,stage='D',fail=false}={}){
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'mentor-safe-execute-')));t.after(()=>rm(root,{recursive:true,force:true}));const vault=path.join(root,'vault'),out=path.join(root,'output');await mkdir(vault);await mkdir(out);await writeFile(path.join(out,'result.md'),'baseline');
 const task=demoTask('TASK-safe-execute',out);task.planning.phase='execute';task.planning.card.testCommand='';task.planning.outline={storyline:'fictional',logic:[],sections:[]};task.planning.workItems=[{id:'W1',title:'fictional edit',detail:'',owner:'ai',acceptance:['saved'],dependsOn:[],status:stage==='F'?'REVIEW_FAIL':'TODO',outputs:[{file:'result.md',sha:sha256('baseline')}],attempts:0}];await writeFile(path.join(vault,task.id+'.md'),serializeTask(task));let cwd;
 const app=await requestApp(root,async input=>{cwd=input.cwd;assert.notEqual(cwd,out);if(conflict)await writeFile(path.join(out,'result.md'),'human edit');await writeFile(path.join(cwd,'result.md'),'agent edit');if(fail)throw Error('simulated interrupted execution');return {text:reply};});
 return {root,vault,out,task,app,get cwd(){return cwd;}};
}
test('D and F execute in a candidate and preserve concurrent human edits with raw response and candidate evidence',async t=>{
 for(const stage of ['D','F']){const f=await fixture(t,{conflict:true,stage});const result=await(await f.app.coach.execute(f.task.id,'W1',stage)).done;assert.equal(result.error.code,'EXECUTION_OUTPUT_CONFLICT');assert.equal(await readFile(path.join(f.out,'result.md'),'utf8'),'human edit');assert.equal(await readFile(path.join(f.cwd,'result.md'),'utf8'),'agent edit');const turn=(await f.app.coach.latest(f.task.id)).planning.learningTurns.at(-1);assert.equal(turn.executionWorkspace.status,'conflict');assert.equal(turn.response,reply);assert.equal(turn.status,'failed');}
});
test('successful D publication registers candidate hashes, while an interrupted execution leaves live outputs intact',async t=>{
 const f=await fixture(t);await(await f.app.coach.execute(f.task.id,'W1')).done;const task=await f.app.coach.latest(f.task.id);assert.equal(task.planning.workItems[0].status,'AWAITING_REVIEW');assert.equal(task.planning.workItems[0].outputs[0].sha,sha256('agent edit'));assert.equal(await readFile(path.join(f.out,'result.md'),'utf8'),'agent edit');assert.equal(task.planning.learningTurns.at(-1).executionWorkspace.status,'published');
 const stopped=await fixture(t,{fail:true});await(await stopped.app.coach.execute(stopped.task.id,'W1')).done;assert.equal(await readFile(path.join(stopped.out,'result.md'),'utf8'),'baseline');assert.equal(await readFile(path.join(stopped.cwd,'result.md'),'utf8'),'agent edit');
});
test('unknown publication blocks new execution and has authenticated, revision-bound explicit recovery',async t=>{
 const f=await fixture(t),turnId=randomUUID(),workspace=await prepareExecutionWorkspace(f.out,f.vault,{taskId:f.task.id,turnId});await assert.rejects(publishExecutionWorkspace(workspace,{checkpoint:async phase=>{if(phase==='after-original-move')throw Error('interrupted');}}));
 await f.app.coach.store.mutate(f.task.id,'latest',null,task=>{task.planning.learningTurns=[{id:turnId,stage:'D',status:'unknown',executionWorkspace:{directory:workspace.directory,status:'unknown'}}];return {};});
 await assert.rejects(f.app.coach.execute(f.task.id,'W1'),{code:'EXECUTION_PUBLICATION_PENDING'});
 const task=await f.app.coach.latest(f.task.id),input={revision:task.revision,turnId,choice:'restore-original',confirmed:true};
 const url=`/api/tasks/${task.id}/reconcile-publication`;assert.equal((await f.app.fetch(url,{method:'POST',body:JSON.stringify(input)})).status,403);
 const cookie=(await f.app.fetch('/')).headers.get('set-cookie').split(';')[0],csrf=(await(await f.app.fetch('/api/session',{headers:{cookie}})).json()).csrfToken,headers={cookie,'x-csrf-token':csrf,'Idempotency-Key':'recover-original'};
 const response=await f.app.fetch(url,{method:'POST',headers,body:JSON.stringify(input)});assert.equal(response.status,200);const result=await response.json();assert.equal(await readFile(path.join(f.out,'result.md'),'utf8'),'baseline');assert.equal(result.task.planning.learningTurns[0].executionWorkspace.status,'reconciled');
 const replay=await f.app.coach.reconcilePublication(task.id,task.revision,'recover-original',input);assert.equal(replay.task.revision,result.task.revision);
});
