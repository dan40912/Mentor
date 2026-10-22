import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { demoTask } from './fixtures/demo-task.js';
import { requestApp } from './fixtures/request.js';
import { serializeTask, parseTask } from '../src/tasks.js';
import { workCards, workCardsMarkdown, turnContext, measureText } from '../src/work-cards.js';
import { planPreview } from '../src/plan-preview.js';
import { compactHandoff } from '../src/compact-handoff.js';

async function setup(t) {
  const home = await mkdtemp(path.join(tmpdir(), 'mentor-readability-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(path.join(home, 'vault'));
  const task = demoTask('TASK-readability', home);
  task.planning.phase = 'outline';
  task.planning.request = '只調整 Obsidian 表格，不重做 Mentor UI';
  task.planning.card.goal = '調整表格';
  task.planning.card.constraints = ['不得修改 Mentor UI'];
  task.planning.outline = { storyline: '改善閱讀', version: 1, sections: [] };
  task.planning.workItems = [{ id: 'W1', title: '表格樣式', detail: '調整表頭與列距', owner: 'ai', acceptance: ['可停用'], dependsOn: [], status: 'TODO', outputs: [] }];
  await writeFile(path.join(home, 'vault', task.id + '.md'), serializeTask(task));
  const app = await requestApp(home);
  const cookie = (await app.fetch('/')).headers.get('set-cookie').split(';')[0];
  const csrfToken = (await (await app.fetch('/api/session', { headers: { cookie } })).json()).csrfToken;
  const headers = { cookie, 'x-csrf-token': csrfToken, 'content-type': 'application/json', 'idempotency-key': 'preview-approve-0001' };
  return { task, home, app, headers, post: input => app.fetch(`/api/tasks/${task.id}/approve`, { method: 'POST', headers, body: JSON.stringify(input) }) };
}

test('preview binds the revision and exact scope; wrong digest, stale revision, changed disk and repeated clicks cannot approve different work', async t => {
  const { task, home, app, headers, post } = await setup(t);
  assert.equal((await app.fetch(`/api/tasks/${task.id}/plan`)).status, 403);
  const { plan } = await (await app.fetch(`/api/tasks/${task.id}/plan`, { headers })).json();
  assert.deepEqual(plan.constraints, ['不得修改 Mentor UI']);
  assert.equal((await post({ revision: 1, proposalId: 'not-the-seen-plan' })).status, 409);
  const first = await post({ revision: 1, proposalId: plan.id });
  assert.equal(first.status, 200);
  const replay = await post({ revision: 1, proposalId: plan.id });
  assert.equal(replay.status, 200);
  const current = parseTask(await readFile(path.join(home, 'vault', task.id + '.md'), 'utf8'), task.id + '.md');
  assert.equal(current.revision, 2);
  assert.equal((await app.coach.events(task.id)).filter(event => event.type === 'GATE_APPROVED').length, 1, 'replayed approval records exactly one audit event');
  assert.equal(current.planning.approvedPlan.id, plan.id);
  assert.equal(current.planning.running, null, 'approval alone does not run a CLI');
  assert.equal((await post({ revision: 2, proposalId: plan.id })).status, 409, 'key cannot be reused for different revision');

  // A fresh file update changes both the effective revision and the digest.
  current.planning.phase = 'outline';
  await writeFile(path.join(home, 'vault', task.id + '.md'), serializeTask(current));
  const before = planPreview(current);
  const file = path.join(home, 'vault', task.id + '.md');
  const raw = await readFile(file, 'utf8');
  await writeFile(file, raw.replace('不得修改 Mentor UI', '禁止修改 Mentor UI 和設定'));
  const changed = (await app.coach.latest(task.id));
  assert.notEqual(planPreview(changed).id, before.id);
  await assert.rejects(app.coach.approveOutline(task.id, before.revision, 'other-preview-key', before.id), { code: 'REVISION_CONFLICT' });
});

test('work cards keep historical understanding, separate AI claims from machine evidence and preserve them in Markdown', () => {
  const task = demoTask();
  const context = turnContext(task);
  task.planning.learningTurns = [{ id: 'turn-1', stage: 'D', status: 'completed', beforeRevision: 2, afterRevision: 4, prompt: '表格', response: '完成', context, learning: { change: '換色', evidence: 'AI 說已測' }, outputs: [{ file: 'theme.css' }], checks: [{ id: 'syntax', result: 'FAIL', detail: '語法錯誤' }] }, { id: 'old', stage: 'D', status: 'unknown' }];
  task.goal = '後來換了目標';
  const cards = workCards(task);
  assert.equal(cards[0].context.interpretation, '示範目標');
  assert.equal(cards[0].checks[0].result, 'FAIL');
  assert.equal(cards[0].aiClaims.evidence, 'AI 說已測');
  assert.equal(cards[1].context, null);
  assert.equal(cards[1].aiClaims, null);
  assert.equal(cards[0].contextMetrics.input.tokens, null);
  assert.deepEqual(measureText('表格'), { characters: 2, utf8Bytes: 6, tokens: null, tokenSource: 'unavailable' });
  assert.match(workCardsMarkdown(task), /FAIL/);
  const restored = parseTask(serializeTask(task), task.id + '.md');
  assert.equal(restored.planning.learningTurns[0].context.interpretation, '示範目標');
});

test('compact handoff removes repeated AI history but never truncates boundaries or human corrections', () => {
  const task = demoTask();
  task.planning.request = '只調整 Obsidian';
  task.planning.card.success = ['原始欄名保持不變'];
  task.scope.forbidden = ['不能重做 Mentor UI'];
  task.planning.card.constraints = ['保留原始資料'.repeat(2000)];
  task.planning.messages = [{ role: 'user', text: '請保留表格欄名' }, { role: 'ai', text: '重複冗長內容'.repeat(9000) }];
  task.planning.learningTurns = [{ id: 'T1', prompt: '重複冗長內容'.repeat(9000), response: '同樣內容'.repeat(5000), status: 'completed' }];
  task.planning.running = { agent: 'Claude', stage: 'D' };
  const result = compactHandoff(task, 'codex');
  assert.match(result.content, /不能重做 Mentor UI/);
  assert.match(result.content, /請保留表格欄名/);
  assert.match(result.content, /原始欄名保持不變/);
  assert.ok(result.content.includes(task.planning.card.constraints[0]));
  assert.doesNotMatch(result.content, /重複冗長內容/);
  assert.match(result.content, /未確認停止前/);
  assert.equal(result.overRecommendedSize, true);
  assert.equal(result.metrics.summary.tokens, null);
  assert.ok(result.metrics.recordedPromptAndReply.utf8Bytes > result.metrics.summary.utf8Bytes);
});

test('CLI usage and elapsed time survive task persistence and reach authenticated work cards',async t=>{
 const {task,app,home,headers}=await setup(t);
 const usage={source:'codex.exec.turn.completed',inputTokens:120,cachedInputTokens:40,outputTokens:8,cacheCreationInputTokens:null,costEstimateUsd:null};
 app.coach.runAgent=async()=>({text:JSON.stringify({outline:{storyline:'表格閱讀',logic:[],sections:[],imageTotal:0},workItems:[{id:'W1',title:'表格',owner:'ai',detail:'調整樣式',acceptance:['保留來源'],dependsOn:[]}]}),usage,elapsedMs:42});
 const started=await app.coach.draftOutline(task.id);await started.done;
 const saved=parseTask(await readFile(path.join(home,'vault',task.id+'.md'),'utf8'),task.id+'.md');
 assert.deepEqual(saved.planning.learningTurns.at(-1).usage,usage);
 const response=await app.fetch(`/api/tasks/${task.id}/work-cards`,{headers});assert.equal(response.status,200);
 const card=(await response.json()).cards.at(-1);assert.equal(card.contextMetrics.elapsedMs,42);assert.equal(card.contextMetrics.usage.inputTokens,120);assert.match(card.contextMetrics.usageLabel,/CLI 回報/);assert.match(workCardsMarkdown(saved),/輸入 120/);
});

test('instruction dry runs never resume autopilot; exact content and revision bind subsequent application',async t=>{
 const {task,app,headers}=await setup(t);let resumes=0;app.coach.resumeAuto=()=>resumes++;
 const post=input=>app.fetch(`/api/tasks/${task.id}/instruct`,{method:'POST',headers,body:JSON.stringify(input)});
 const before=await app.coach.latest(task.id);
 const preview=await post({revision:before.revision,text:'只改表格列距',scope:'outline',dryRun:true});assert.equal(preview.status,200);
 const {plan}=await preview.json();assert.equal(resumes,0);assert.equal((await app.coach.latest(task.id)).revision,before.revision);
 assert.equal((await post({revision:before.revision,text:'改成重做網站',scope:'outline',confirmImpact:true,proposalId:plan.id})).status,409);
 assert.equal((await post({revision:before.revision-1,text:'只改表格列距',dryRun:true})).status,409);
 assert.equal(resumes,0);assert.equal((await app.coach.latest(task.id)).planning.request,before.planning.request);
});

test('editing accepted work previews and invalidates transitive acceptances without losing saved outputs',async t=>{
 const {task,app,home}=await setup(t);
 task.planning.phase='execute';
 task.planning.workItems=['A','B','C','unrelated'].map((id,index)=>({id,title:id,detail:id,owner:'ai',status:'DONE',acceptance:['check'],dependsOn:index===1?['A']:index===2?['B']:[],outputs:[{file:id+'.md'}],review:{results:[]},doneAt:'yesterday'}));
 await writeFile(path.join(home,'vault',task.id+'.md'),serializeTask(task));
 app.coach.fix=async()=>({task:await app.coach.latest(task.id)});
 const current=await app.coach.latest(task.id),input={text:'只修改 A 的資料來源',scope:'A'};
 const {plan}=await app.coach.instruct(task.id,current.revision,'impact-preview-key',{...input,dryRun:true});
 assert.match(plan.impact,/B/);assert.match(plan.impact,/C/);
 await app.coach.instruct(task.id,current.revision,'impact-apply-key',{...input,confirmImpact:true,proposalId:plan.id});
 const saved=await app.coach.latest(task.id);
 assert.deepEqual(saved.planning.workItems.map(i=>i.status),['REVIEW_FAIL','AWAITING_REVIEW','AWAITING_REVIEW','DONE']);
 assert.equal(saved.planning.workItems[2].outputs[0].file,'C.md');assert.equal(saved.planning.workItems[2].doneAt,undefined);
 await assert.rejects(app.coach.confirm(task.id,saved.revision,'impact-confirm-key',{itemId:'C',accept:true}),{code:'DEPENDENCY_PENDING'});
 await assert.rejects(app.coach.review(task.id,'C'),{code:'DEPENDENCY_PENDING'});
 assert.equal(saved.planning.request,task.planning.request);
});

test('replanning a detail-only change reopens its work and downstream review even when titles stay the same',async t=>{
 const {task,app,home}=await setup(t);task.planning.phase='execute';
 const definitions=[{id:'A',title:'來源',owner:'ai',detail:'原來源',acceptance:['可追溯'],dependsOn:[]},{id:'B',title:'成果',owner:'ai',detail:'依來源寫作',acceptance:['可讀'],dependsOn:['A']}];
 task.planning.workItems=definitions.map(i=>({...i,status:'DONE',outputs:[{file:i.id+'.md'}],doneAt:'old'}));
 await writeFile(path.join(home,'vault',task.id+'.md'),serializeTask(task));
 app.coach.runAgent=async()=>({text:JSON.stringify({outline:{sections:[],imageTotal:0},workItems:[{...definitions[0],detail:'改用新來源'},definitions[1]]})});
 const run=await app.coach.draftOutline(task.id,'只修正來源',{replan:true});await run.done;
 const saved=await app.coach.latest(task.id);assert.equal(saved.planning.phase,'outline');
 assert.equal(saved.planning.workItems[0].status,'TODO');assert.equal(saved.planning.workItems[0].previousOutputs[0].file,'A.md');assert.equal(saved.planning.workItems[1].status,'AWAITING_REVIEW');assert.equal(saved.planning.workItems[1].outputs[0].file,'B.md');
});
