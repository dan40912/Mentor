import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requestApp } from './fixtures/request.js';

test('HTTP task completion, decision, and selected review notes update the project note',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'mentor-note-http-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const runner=async({prompt,cwd})=>{
    if(prompt.includes('「任務制定」'))return{text:JSON.stringify({card:{title:'虛構選案',project:'虛構專案',goal:'比較虛構方案',audience:'主管',deliverable:'決策建議',success:['完成選擇'],constraints:[],unknowns:[]}})};
    if(prompt.includes('「Grill me」'))return{text:JSON.stringify({ready:true,questions:[],coaching:'資料已足夠。',card:{title:'虛構選案',goal:'比較虛構方案',audience:'主管',deliverable:'決策建議',success:['完成選擇'],constraints:[],unknowns:[]}})};
    if(prompt.includes('「擬定大綱」'))return{text:JSON.stringify({outline:{storyline:'比較兩個虛構方案',logic:['比較','選擇'],sections:[{no:1,title:'比較結果',point:'呈現虛構差異',evidence:'虛構資料',visual:{type:'none',count:0}}],imageTotal:0},workItems:[{id:'W1',title:'整理虛構比較',detail:'整理兩個虛構方案',owner:'ai',acceptance:['成果檔存在'],dependsOn:[]}]})};
    if(prompt.includes('「執行」')){const html='<h1>虛構比較</h1>\n```mentor-decision\n{"question":"選哪個？","options":[{"label":"方案甲","benefits":["省時"],"costs":["需確認"],"evidence":["虛構素材"]},{"label":"方案乙","benefits":["簡單"],"costs":["較慢"],"evidence":["虛構素材"]}],"unknowns":[],"recommendation":"方案甲","recommendationReason":"虛構示範"}\n```';await writeFile(path.join(cwd,'result.html'),html);return{text:'STATUS: DONE\nFILES: result.html\n證據：result.html\n未完成：無\n```json\n{"changes":[],"learning":{"change":"整理虛構比較","reason":"依虛構需求","evidence":"result.html","lesson":"先列出選擇標準","nextPrompt":"請比較虛構方案","question":"哪個標準最重要？"}}\n```'};}
    if(prompt.includes('「驗收」'))return{text:JSON.stringify({results:[{criterion:'成果檔存在',result:'PASS',evidence:'result.html'}],verdict:'PASS',fixes:[],coaching:'核對選項與證據。'})};
    if(prompt.includes('已完成任務紀錄')){const turnId=prompt.match(/"id":"([^"]+)","stage":"D"/)?.[1];return{text:JSON.stringify({candidates:[{turnId,kind:'lesson',text:'先列出選擇標準'},{turnId,kind:'question',text:'哪個標準最重要？'}]})};}
    return{text:'{}'};
  };
  const app=await requestApp(root,runner),page=await app.fetch('/'),cookie=page.headers.get('set-cookie').split(';')[0],session=await(await app.fetch('/api/session',{headers:{cookie}})).json(),csrf=session.csrfToken;
  let sequence=0;const post=async(url,data)=>app.fetch(url,{method:'POST',headers:{cookie,'x-csrf-token':csrf,'content-type':'application/json','idempotency-key':`note-http-${++sequence}`,'origin':app.address},body:JSON.stringify(data)});
  const created=await post('/api/tasks',{request:'比較虛構方案並記錄決策',profile:'quick',project:'虛構專案',proposal:{goal:'比較虛構方案',audience:'主管',format:'決策建議',steps:[{title:'整理虛構比較',purpose:'比較兩個虛構方案'}]}});assert.equal(created.status,202);let task=(await created.json()).task;await app.settle();
  await post(`/api/tasks/${task.id}/outline`,{revision:task.revision});await app.settle();task=await app.coach.latest(task.id);
  await post(`/api/tasks/${task.id}/approve`,{revision:task.revision});task=await app.coach.latest(task.id);
  await post(`/api/tasks/${task.id}/execute`,{itemId:'W1'});await app.settle();task=await app.coach.latest(task.id);assert.equal(task.planning.workItems[0].status,'AWAITING_REVIEW');
  const decision=await post(`/api/tasks/${task.id}/decision-card`,{revision:task.revision,file:'result.html',optionIndex:0,note:'虛構示範決定'});assert.equal(decision.status,200);
  task=await app.coach.latest(task.id);await post(`/api/tasks/${task.id}/review`,{itemId:'W1'});await app.settle();task=await app.coach.latest(task.id);
  await post(`/api/tasks/${task.id}/confirm`,{revision:task.revision,itemId:'W1',accept:true});task=await app.coach.latest(task.id);assert.equal(task.planning.phase,'done');
  await post(`/api/tasks/${task.id}/review-candidates`,{revision:task.revision});task=await app.coach.latest(task.id);assert.equal(task.planning.reviewCandidates.length,2);
  const selected=task.planning.reviewCandidates;await post(`/api/tasks/${task.id}/confirm-review`,{revision:task.revision,keep:selected.map(item=>item.id),always:[selected.find(item=>item.kind==='lesson').id]});
  const note=await(await app.fetch(`/api/tasks/${task.id}/project-note`,{headers:{cookie}})).json();
  assert.match(note.content,/方案甲/);assert.match(note.content,/先列出選擇標準/);assert.match(note.content,/哪個標準最重要/);
  assert.match(note.content,/已確認/);assert.doesNotMatch(note.content,/尚無使用者確認的回顧問題/);
  assert.ok((await readdir(path.join(root,'vault','notes'))).length>0);
});

test('GET project-note renders missing notes without writing a file',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'mentor-note-read-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const app=await requestApp(root),created=await app.coach.create({request:'虛構唯讀筆記測試',profile:'quick'});await app.settle();
  app.coach.store.onChanged=null;await rm(path.join(root,'vault','notes'),{recursive:true,force:true});
  const cookie=(await app.fetch('/')).headers.get('set-cookie').split(';')[0];
  const response=await app.fetch(`/api/tasks/${created.task.id}/project-note`,{headers:{cookie}});assert.equal(response.status,200);
  await assert.rejects(readdir(path.join(root,'vault','notes')),{code:'ENOENT'});
});
