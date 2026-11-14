import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requestApp } from './fixtures/request.js';

test('task creation preserves available proposal agents and falls back with a user-visible note', async t => {
  const home=await mkdtemp(path.join(tmpdir(),'mentor-proposal-'));t.after(()=>rm(home,{recursive:true,force:true}));
  await writeFile(path.join(home,'.diagnosis.json'),JSON.stringify({claude:{ok:true},codex:{ok:true}}));
  const prompts=[];
  const runner=async ({prompt})=>{
    prompts.push(prompt);
    if(prompt.includes('「任務制定」'))return {text:JSON.stringify({card:{title:'提案測試',goal:'完成提案測試',audience:'主管',deliverable:'簡報',success:['可供決定'],constraints:[],unknowns:[]}})};
    if(prompt.includes('「Grill me」'))return {text:JSON.stringify({ready:true,questions:[],card:{title:'提案測試',goal:'完成提案測試',audience:'主管',deliverable:'簡報',success:['可供決定'],constraints:[],unknowns:[]}})};
    if(prompt.includes('「擬定大綱」'))return {text:JSON.stringify({outline:{storyline:'依提案製作',logic:['整理','完成'],sections:[]},workItems:[{id:'W1',title:'整理素材',owner:'ai',agent:'claude',detail:'整理資料',acceptance:['來源完整'],dependsOn:[]}]})};
    return {text:'已完成'};
  };
  const app=await requestApp(home,runner),cookie=(await app.fetch('/')).headers.get('set-cookie').split(';')[0],csrf=(await(await app.fetch('/api/session',{headers:{cookie}})).json()).csrfToken;
  let seq=0;
  const create=async (provider,key)=>{
    const headers={cookie,'x-csrf-token':csrf,'content-type':'application/json','idempotency-key':`proposal-flow-${++seq}`,'origin':app.address};
    return app.fetch('/api/tasks',{method:'POST',headers,body:JSON.stringify({request:'完成提案測試',profile:'quick',proposal:{goal:'完成提案測試',audience:'主管',format:'簡報',steps:[{title:'整理素材',purpose:'整理資料',agent:provider,reason:'依專長安排'}]}})});
  };
  const available=await create('claude');assert.equal(available.status,202);let task=(await available.json()).task;await app.settle();
  task=await app.coach.latest(task.id);assert.equal(task.planning.proposal.steps[0].agent,'claude');
  const outline=await app.coach.draftOutline(task.id);await outline.done;
  assert.match(prompts.find(prompt=>prompt.includes('「擬定大綱」')),/整理素材.*整理資料.*claude/s);
  task=await app.coach.latest(task.id);assert.equal(task.planning.workItems[0].agent,'claude');

  const fallback=await create('copilot');assert.equal(fallback.status,202);task=(await fallback.json()).task;await app.settle();task=await app.coach.latest(task.id);
  assert.equal(task.planning.proposal.steps[0].agent,'codex');
  assert.match(task.planning.messages.find(message=>message.role==='system')?.text,/尚未確認可用.*codex/);
});
