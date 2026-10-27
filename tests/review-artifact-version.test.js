import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {demoTask} from './fixtures/demo-task.js';
import {requestApp} from './fixtures/request.js';
import {serializeTask,sha256} from '../src/tasks.js';
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'mentor-reviewed-version-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const vault=path.join(root,'vault'),out=path.join(root,'outputs');await mkdir(vault);await mkdir(out);await writeFile(path.join(out,'result.md'),'reviewed');
 const task=demoTask('TASK-review-version',out);task.planning.outline={storyline:'成果',logic:[]};task.planning.workItems=[{id:'W1',title:'成果',owner:'ai',acceptance:['內容正確'],dependsOn:[],status:'AWAITING_REVIEW',outputs:[{file:'result.md',sha:sha256('reviewed')}],attempts:1}];
 await writeFile(path.join(vault,task.id+'.md'),serializeTask(task));let duringReview=async()=>{};
 const app=await requestApp(root,async input=>{await duringReview(input);return {text:JSON.stringify({verdict:'PASS',results:[{criterion:'內容正確',result:'PASS',evidence:'result.md'}]})};});
 return {app,id:task.id,out,get:()=>app.coach.latest(task.id),set duringReview(fn){duringReview=fn;}};
}
test('review captures hashes; edited current files block single and batch acceptance until reviewed again',async t=>{
 const f=await fixture(t);await(await f.app.coach.review(f.id,'W1')).done;let task=await f.get();assert.equal(task.planning.workItems[0].status,'REVIEWED');assert.equal(task.planning.workItems[0].review.outputs[0].sha,sha256('reviewed'));
 await writeFile(path.join(f.out,'result.md'),'later human edit');
 await assert.rejects(f.app.coach.confirm(f.id,task.revision,'confirm-old',{itemId:'W1',accept:true}),{code:'REVIEW_VERSION_CHANGED'});
 await assert.rejects(f.app.coach.confirmAll(f.id,task.revision,'confirm-all-old'),{code:'REVIEW_VERSION_CHANGED'});
 assert.equal((await f.get()).planning.workItems[0].status,'REVIEWED');
 await(await f.app.coach.review(f.id,'W1')).done;task=await f.get();assert.equal(task.planning.workItems[0].review.outputs[0].sha,sha256('later human edit'));
 const accepted=await f.app.coach.confirm(f.id,task.revision,'confirm-current',{itemId:'W1',accept:true});assert.equal(accepted.task.planning.workItems[0].status,'DONE');
});
test('legacy review without version and deleted output cannot be accepted',async t=>{
 const f=await fixture(t);await f.app.coach.store.mutate(f.id,'latest',null,task=>{task.planning.workItems[0].status='REVIEWED';task.planning.workItems[0].review={results:[{result:'PASS'}]};return {};});
 let task=await f.get();await assert.rejects(f.app.coach.confirmAll(f.id,task.revision,'legacy'),{code:'REVIEW_VERSION_UNKNOWN'});
 await(await f.app.coach.review(f.id,'W1')).done;task=await f.get();await rm(path.join(f.out,'result.md'));
 await assert.rejects(f.app.coach.confirm(f.id,task.revision,'missing',{itemId:'W1',accept:true}),{code:'PREVIEW_MISSING'});assert.equal((await f.get()).planning.workItems[0].status,'REVIEWED');
});
test('changes during AI review invalidate PASS without overwriting the external edit',async t=>{
 const f=await fixture(t);f.duringReview=()=>writeFile(path.join(f.out,'result.md'),'concurrent edit');
 await(await f.app.coach.review(f.id,'W1')).done;const task=await f.get();assert.equal(task.planning.workItems[0].status,'AWAITING_REVIEW');assert.equal(task.planning.learningTurns.at(-1).errorCode,'REVIEW_VERSION_CHANGED');assert.equal(task.planning.workItems[0].review,undefined);
});
test('batch checks every item before accepting any of them',async t=>{
 const f=await fixture(t);await(await f.app.coach.review(f.id,'W1')).done;
 await f.app.coach.store.mutate(f.id,'latest',null,task=>{task.planning.workItems.push({...structuredClone(task.planning.workItems[0]),id:'W2',review:{outputs:[{file:'result.md',sha:sha256('stale')}]}});return {};});
 const task=await f.get();await assert.rejects(f.app.coach.confirmAll(f.id,task.revision,'batch'),{code:'REVIEW_VERSION_CHANGED'});assert.deepEqual((await f.get()).planning.workItems.map(i=>i.status),['REVIEWED','REVIEWED']);
});

test('reviewer modifications to the reviewed copy do not establish PASS for original bytes',async t=>{
 const f=await fixture(t);f.duringReview=async input=>{assert.notEqual(input.cwd,f.out);await writeFile(path.join(input.cwd,'result.md'),'patched to pass');};
 await(await f.app.coach.review(f.id,'W1')).done;const task=await f.get();assert.equal(task.planning.workItems[0].status,'AWAITING_REVIEW');assert.equal(task.planning.learningTurns.at(-1).errorCode,'REVIEW_VERSION_CHANGED');
});
