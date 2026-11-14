import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaskStore } from '../src/tasks.js';
import { Coach } from '../src/coach.js';
import { defaultStageSettings } from '../src/models.js';
import { Memory } from '../src/memory.js';
import { runAgent } from '../src/agents.js';
import { requestApp } from './fixtures/request.js';

const fake=path.join(path.dirname(fileURLToPath(import.meta.url)),'fixtures','fake-cli.mjs');
const definitions=(titles,dependencies=[])=>titles.map((title,index)=>({id:`W${index+1}`,title,detail:`處理「${title}」並整理成果。`,owner:'ai',acceptance:['成果檔存在'],dependsOn:dependencies[index]||[],status:'TODO',attempts:0,outputs:[],review:null,fixes:[]}));

async function setup(t,{limit=2,titles=['工作一','工作二','相依工作'],dependencies=[[],[],['W1','W2']],mode='parallel:350'}={}){
  const dir=await mkdtemp(path.join(tmpdir(),'mentor-runs-'));
  const names=['AWC_CODEX_BIN','AWC_CLAUDE_BIN','AWC_COPILOT_BIN','FAKE_MODE','FAKE_RUN_LOG'];
  const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  t.after(async()=>{for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}await rm(dir,{recursive:true,force:true});});
  process.env.AWC_CODEX_BIN=process.env.AWC_CLAUDE_BIN=process.env.AWC_COPILOT_BIN=fake;
  const log=path.join(dir,'fake-runs.jsonl');process.env.FAKE_RUN_LOG=log;process.env.FAKE_MODE=mode;
  const store=new TaskStore(dir),settings={revision:1,maxParallelRuns:limit,stages:defaultStageSettings()},coach=new Coach(store,()=>settings,dir,new Memory(path.join(dir,'memory')));
  const created=await coach.create({request:'我要做一份新品簡報給主管十頁',profile:'quick'});await created.done;
  const result=await store.mutate(created.task.id,'latest',null,task=>{task.planning.phase='execute';task.planning.outline={storyline:'測試工作主線',logic:['整理','交付'],sections:[]};task.planning.workItems=definitions(titles,dependencies);task.planning.approvedPlan={id:'approved-test-plan',at:new Date().toISOString(),by:'human'};return{status:'READY'};});
  await writeFile(log,'');
  return{dir,store,coach,id:created.task.id,task:result.task,log};
}

async function until(check,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){const value=await check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,15));}assert.fail('等待多代理狀態逾時');}
async function events(file){return(await readFile(file,'utf8').catch(()=>'' )).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}
function peakConcurrent(rows){let active=0,peak=0;for(const row of rows){active+=row.event==='start'?1:-1;peak=Math.max(peak,active);}return peak;}

test('independent items overlap in isolated folders while dependent item stays queued',async t=>{
  const env=await setup(t);
  const queued=await env.coach.queueRuns(env.id,env.task.revision,'parallel-start-0001',{itemIds:['W1','W2','W3']});
  assert.equal(queued.runIds.length,3);
  const task=await until(async()=>{const current=(await env.store.get(env.id)).task;const first=current.planning.runs.filter(run=>run.workItemId==='W1'||run.workItemId==='W2');return first.length===2&&first.every(run=>run.status==='done')?current:null;});
  assert.equal(task.planning.runs.find(run=>run.workItemId==='W3').status,'queued');
  assert.match(task.planning.runs.find(run=>run.workItemId==='W3').step,/等待前置項目/);
  assert.deepEqual(task.planning.workItems.slice(0,2).map(item=>item.status),['AWAITING_REVIEW','AWAITING_REVIEW']);
  assert.deepEqual(task.planning.workItems.slice(0,2).flatMap(item=>item.outputs.map(output=>output.file)),['W1/deck.html','W2/deck.html']);
  assert.equal(peakConcurrent(await events(env.log)),2);
  assert.equal(await readFile(path.join(task.allowedRoots[0],'W1','deck.html'),'utf8'),'<h1>痛點</h1><svg></svg>');
  assert.equal(await readFile(path.join(task.allowedRoots[0],'W2','deck.html'),'utf8'),'<h1>痛點</h1><svg></svg>');
  for(const [index,itemId] of ['W1','W2'].entries()){
    await (await env.coach.review(env.id,itemId)).done;
    const latest=(await env.store.get(env.id)).task;
    await env.coach.confirm(env.id,latest.revision,`confirm-parallel-${index+1}`,{itemId,accept:true});
  }
  const completed=await until(async()=>{const latest=(await env.store.get(env.id)).task;return latest.planning.runs.find(run=>run.workItemId==='W3')?.status==='done'?latest:null;});
  assert.equal(completed.planning.workItems.find(item=>item.id==='W3').status,'AWAITING_REVIEW');
});

test('parallel limit queues work and failures do not stop another run; retry uses a compact handoff and another AI',async t=>{
  const env=await setup(t,{limit:1,titles:['故意失敗工作','正常工作'],dependencies:[[],[]],mode:'parallel-fail-one'});
  await env.coach.queueRuns(env.id,env.task.revision,'parallel-limit-0001',{itemIds:['W1','W2']});
  let current=await until(async()=>{const task=(await env.store.get(env.id)).task;return task.planning.runs.some(run=>run.status==='failed')&&task.planning.runs.some(run=>run.workItemId==='W2'&&run.status==='done')?task:null;});
  assert.equal(peakConcurrent(await events(env.log)),1);
  assert.equal(current.planning.stopped,null);
  const failed=current.planning.runs.find(run=>run.workItemId==='W1');
  process.env.FAKE_MODE='parallel:120';
  const retry=await env.coach.retryRun(env.id,failed.id,current.revision,'parallel-retry-0001',{provider:'claude'});
  current=await until(async()=>{const task=(await env.store.get(env.id)).task;return task.planning.runs.find(run=>run.id===retry.runId)?.status==='done'?task:null;});
  const retried=current.planning.runs.find(run=>run.id===retry.runId);
  assert.equal(retried.provider,'claude');
  const turn=current.planning.learningTurns.find(entry=>entry.id===retried.turnId);
  assert.match(turn.prompt,/接手摘要/);
  assert.match(turn.prompt,/## 目前理解/);
});

test('stopping one run leaves the other run active and lets it complete',async t=>{
  const env=await setup(t,{titles:['可停止工作','繼續工作'],dependencies:[[],[]],mode:'parallel-stop-one:1800'});
  await env.coach.queueRuns(env.id,env.task.revision,'parallel-stop-0001',{itemIds:['W1','W2']});
  let current=await until(async()=>{const task=(await env.store.get(env.id)).task;return task.planning.runs.some(run=>run.workItemId==='W1'&&run.status==='running')?task:null;});
  const stopping=current.planning.runs.find(run=>run.workItemId==='W1');
  await env.coach.stopRun(env.id,stopping.id);
  current=await until(async()=>{const task=(await env.store.get(env.id)).task;return task.planning.runs.find(run=>run.workItemId==='W1')?.status==='stopped'&&task.planning.runs.find(run=>run.workItemId==='W2')?.status==='done'?task:null;});
  assert.equal(current.planning.stopped,null);
  assert.equal(current.planning.workItems.find(item=>item.id==='W2').status,'AWAITING_REVIEW');
});

test('restart recovery marks every unfinished run unknown and does not start it again',async t=>{
  const env=await setup(t);
  const current=(await env.store.get(env.id)).task;
  await env.store.mutate(env.id,current.revision,null,task=>{
    const at=new Date().toISOString();
    task.planning.learningTurns.push({id:'turn-run-one',stage:'D',status:'running',workItemId:'W1'} ,{id:'turn-run-two',stage:'D',status:'running',workItemId:'W2'});
    task.planning.runs.push({id:'run-one',turnId:'turn-run-one',workItemId:'W1',status:'running',stage:'D',startedAt:at},{id:'run-two',turnId:'turn-run-two',workItemId:'W2',status:'running',stage:'D',startedAt:at});
    task.planning.running={stage:'D',turnId:'turn-run-one',workItemId:'W1',startedAt:at};
    return{status:'RUNNING'};
  });
  await new Coach(env.store,()=>({revision:1,maxParallelRuns:2,stages:defaultStageSettings()}),env.dir,new Memory(path.join(env.dir,'memory'))).recover();
  const recovered=(await env.store.get(env.id)).task;
  assert.equal(recovered.planning.running,null);
  assert.deepEqual(recovered.planning.runs.filter(run=>run.id==='run-one'||run.id==='run-two').map(run=>run.status),['unknown','unknown']);
  assert.equal(recovered.planning.messages.filter(message=>message.text.includes('結果未知')).length,2);
});

test('legacy running records migrate without losing fields and new work can continue',async t=>{
  const env=await setup(t,{titles:['舊格式工作','新工作'],dependencies:[[],[]],mode:'parallel:100'});
  const at=new Date().toISOString();
  await env.store.mutate(env.id,'latest',null,task=>{
    task.planning.runs=[];
    task.planning.learningTurns.push({id:'legacy-turn',stage:'D',status:'running',workItemId:'W1'});
    task.planning.running={stage:'D',provider:'codex',modelId:'gpt-test',effort:'high',agent:'Codex',mode:'write',startedAt:at,turnId:'legacy-turn',workItemId:'W1'};
    return{status:'RUNNING'};
  });
  const current=(await env.store.get(env.id)).task;
  const queued=await env.coach.queueRuns(env.id,current.revision,'legacy-continue-001',{itemIds:['W2']});
  const continued=await until(async()=>{const task=(await env.store.get(env.id)).task;return task.planning.runs.find(run=>run.id===queued.runIds[0])?.status==='done'?task:null;});
  const migrated=continued.planning.runs.find(run=>run.id==='legacy-turn');
  assert.equal(migrated.status,'running');
  assert.equal(migrated.provider,'codex');
  assert.equal(migrated.modelId,'gpt-test');
  assert.equal(migrated.effort,'high');
  assert.equal(migrated.startedAt,at);
  assert.equal(continued.planning.running.turnId,'legacy-turn');
  assert.equal(continued.planning.workItems.find(item=>item.id==='W2').status,'AWAITING_REVIEW');
});

test('queued work can change AI before start and running work cannot be reassigned',async t=>{
  const env=await setup(t,{limit:1,titles:['先開始','排隊工作'],dependencies:[[],[]],mode:'parallel:500'});
  await env.coach.queueRuns(env.id,env.task.revision,'reassign-queue-001',{itemIds:['W1','W2']});
  let current=await until(async()=>{const task=(await env.store.get(env.id)).task;return task.planning.runs.find(run=>run.workItemId==='W1')?.status==='running'&&task.planning.runs.find(run=>run.workItemId==='W2')?.status==='queued'?task:null;});
  await assert.rejects(env.coach.reassignRun(env.id,current.planning.runs.find(run=>run.workItemId==='W1').id,current.revision,'reassign-running-001',{provider:'claude'}),{code:'RUN_NOT_QUEUED'});
  const queuedRun=current.planning.runs.find(run=>run.workItemId==='W2');
  await env.coach.reassignRun(env.id,queuedRun.id,current.revision,'reassign-waiting-001',{provider:'claude'});
  current=await until(async()=>{const task=(await env.store.get(env.id)).task;return task.planning.runs.find(run=>run.id===queuedRun.id)?.status==='done'?task:null;});
  assert.equal(current.planning.runs.find(run=>run.id===queuedRun.id).provider,'claude');
  assert.equal(current.planning.learningTurns.find(turn=>turn.id===current.planning.runs.find(run=>run.id===queuedRun.id).turnId).provider,'claude');
});

test('runs API requires session, CSRF and an idempotency key, and GET returns compact run records',async t=>{
  const env=await setup(t,{titles:['API 工作一','API 工作二'],dependencies:[[],[]],mode:'parallel:100'});
  const app=await requestApp(env.dir);
  const created=await app.coach.create({request:'我要做一份 API 測試簡報給主管十頁',profile:'quick'});await created.done;
  const taskResult=await app.coach.store.mutate(created.task.id,'latest',null,task=>{task.planning.phase='execute';task.planning.outline={storyline:'API 測試主線',logic:['測試'],sections:[]};task.planning.workItems=definitions(['API 工作一','API 工作二'],[[],[]]);return{status:'READY'};});
  await writeFile(env.log,'');
  const id=created.task.id;
  const page=await app.fetch('/');
  const cookie=page.headers.get('set-cookie').split(';')[0];
  const settingsResponse=await app.fetch('/api/settings',{headers:{cookie}}),settings=await settingsResponse.json();
  const body=JSON.stringify({revision:taskResult.task.revision,itemIds:['W1','W2']});
  const missingCsrf=await app.fetch(`/api/tasks/${id}/runs`,{method:'POST',headers:{cookie,'Content-Type':'application/json','Idempotency-Key':'runs-api-no-csrf'},body});
  assert.equal(missingCsrf.status,403);
  const missingKey=await app.fetch(`/api/tasks/${id}/runs`,{method:'POST',headers:{cookie,'Content-Type':'application/json','X-CSRF-Token':settings.csrfToken},body});
  assert.equal(missingKey.status,400);
  const start=()=>app.fetch(`/api/tasks/${id}/runs`,{method:'POST',headers:{cookie,'Content-Type':'application/json','X-CSRF-Token':settings.csrfToken,'Idempotency-Key':'runs-api-start-0001'},body});
  const started=await start(),data=await started.json();
  assert.equal(started.status,202,JSON.stringify(data));assert.equal(data.runIds.length,2);
  const duplicate=await start(),duplicateData=await duplicate.json();assert.deepEqual(duplicateData.runIds,data.runIds);
  await new Promise(resolve=>setTimeout(resolve,500));
  await until(async()=>{const task=await app.coach.latest(id);return task.planning.runs.filter(run=>run.workItemId).length===2&&task.planning.runs.filter(run=>run.workItemId).every(run=>run.status==='done')&&!app.coach.pending.size&&!app.coach.runDrivers.size?task:null;});
  const listed=await app.fetch(`/api/tasks/${id}/runs`,{headers:{cookie}}),runs=await listed.json();
  assert.equal(listed.status,200);assert.deepEqual(runs.runs.filter(run=>run.workItemId).map(run=>run.status),['done','done']);
});

test('R3 API journey creates a proposal, approves a three-item plan, starts two agents, then unlocks the dependent agent',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'mentor-r3-http-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const envNames=['AWC_CODEX_BIN','AWC_CLAUDE_BIN','AWC_COPILOT_BIN','FAKE_MODE','FAKE_RUN_LOG'];
  const previous=Object.fromEntries(envNames.map(name=>[name,process.env[name]]));
  t.after(()=>{for(const name of envNames){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}});
  process.env.AWC_CODEX_BIN=process.env.AWC_CLAUDE_BIN=process.env.AWC_COPILOT_BIN=fake;
  process.env.FAKE_MODE='parallel:1800';process.env.FAKE_RUN_LOG=path.join(root,'fake-runs.jsonl');
  await writeFile(path.join(root,'.diagnosis.json'),JSON.stringify({codex:{ok:true},claude:{ok:true},copilot:{ok:false}}));
  const app=await requestApp(root,runAgent),page=await app.fetch('/'),cookie=page.headers.get('set-cookie').split(';')[0],session=await(await app.fetch('/api/session',{headers:{cookie}})).json();
  let keyIndex=0;const post=async(url,data)=>app.fetch(url,{method:'POST',headers:{cookie,'x-csrf-token':session.csrfToken,'content-type':'application/json','idempotency-key':`r3-journey-${++keyIndex}`,'origin':app.address},body:JSON.stringify(data)});
  const conversation=await post('/api/workspace-chat',{question:'R3_END_TO_END_FIXTURE：可以幫我做一份虛構資料的十頁簡報嗎？'});assert.equal(conversation.status,200);const proposalResult=await conversation.json();assert.equal(proposalResult.intent,'new_work');assert.equal(proposalResult.taskProposal.steps.length,3);
  const created=await post('/api/tasks',{request:proposalResult.taskProposal.goal,profile:'quick',proposal:proposalResult.taskProposal});
  assert.equal(created.status,202);let task=(await created.json()).task;await app.settle();
  const outline=await post(`/api/tasks/${task.id}/outline`,{revision:(await app.coach.latest(task.id)).revision});assert.equal(outline.status,202);await app.settle();
  task=await app.coach.latest(task.id);assert.equal(task.planning.workItems.length,3);assert.deepEqual(task.planning.workItems.map(item=>item.agent),['claude','codex','claude']);
  const approved=await post(`/api/tasks/${task.id}/approve`,{revision:task.revision});assert.equal(approved.status,200);
  task=await app.coach.latest(task.id);assert.equal(task.planning.phase,'execute');
  const started=await post(`/api/tasks/${task.id}/runs`,{revision:task.revision,itemIds:['W1','W2','W3']});assert.equal(started.status,202);
  const cookieGet={headers:{cookie}};
  const running=await until(async()=>{const response=await app.fetch(`/api/tasks/${task.id}/runs`,cookieGet),data=await response.json();const first=data.runs.filter(run=>['W1','W2'].includes(run.workItemId));return first.length===2&&first.every(run=>run.status==='running')?data.runs:null;});
  assert.equal(running.length,3);
  assert.equal(running.find(run=>run.workItemId==='W3').status,'queued');assert.match(running.find(run=>run.workItemId==='W3').step,/等待前置項目/);
  await until(async()=>{const data=await(await app.fetch(`/api/tasks/${task.id}/runs`,cookieGet)).json();const first=data.runs.filter(run=>['W1','W2'].includes(run.workItemId));return first.length===2&&first.every(run=>run.status==='done')?data:null;});
  for(const itemId of ['W1','W2']){task=await app.coach.latest(task.id);const reviewed=await post(`/api/tasks/${task.id}/review`,{itemId});assert.equal(reviewed.status,202);await app.settle();task=await app.coach.latest(task.id);const confirmed=await post(`/api/tasks/${task.id}/confirm`,{revision:task.revision,itemId,accept:true});assert.equal(confirmed.status,200);}
  const downstream=await until(async()=>{const data=await(await app.fetch(`/api/tasks/${task.id}/runs`,cookieGet)).json();return data.runs.find(run=>run.workItemId==='W3'&&run.status==='running')||null;});
  assert.equal(downstream.status,'running');
  await until(async()=>{const data=await(await app.fetch(`/api/tasks/${task.id}/runs`,cookieGet)).json();return data.runs.find(run=>run.workItemId==='W3'&&run.status==='done')||null;});
  await app.settle();
  const finalRuns=(await(await app.fetch(`/api/tasks/${task.id}/runs`,cookieGet)).json()).runs;
  assert.equal(finalRuns.filter(run=>run.workItemId==='W3').at(-1).status,'done');
});
