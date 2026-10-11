import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Conversations, parseConversation, textSha, nextRequest } from '../src/conversations.js';

const sample = { id: 'TASK-sample', title: '簡報', project: '同專案', goal: '主管理解', revision: 3, current: { summary: '待處理' }, scope: { locked: [{ text: 'P1 不改' }] }, facts: [{ label: '期間', value: '近一年', verified: true, source: '舊紀錄' }] };
const jsonl = rows => rows.map(r => JSON.stringify(r)).join('\n');

test('parser excludes tools/thinking/system duplicates, keeps command arguments and ancestry, and never guesses missing models', () => {
  const rows = [
    { type: 'user', uuid:'a', message:{content:'<command-name>/jay</command-name><command-args>請說人話</command-args>'} },
    { type:'assistant',uuid:'aa',parentUuid:'a', message:{model:'opus', content:[{type:'thinking',thinking:'私有推理'},{type:'text',text:'第一版'}]} },
    { type:'user',uuid:'b',message:{content:'換方向'} },
    { type:'assistant',uuid:'ab',parentUuid:'aa',message:{content:[{type:'text',text:'上一支線補充'}]} },
    { type:'user',isMeta:true,message:{content:'系統資料'} },
    { type:'user',message:{content:[{type:'tool_result',content:'工具結果'}]} },
    { type:'user',message:{content:'<command-name>/model</command-name>'} }
  ];
  const data = parseConversation(jsonl(rows),{provider:'claude',sourceId:'s',originalPath:'s.jsonl'});
  assert.equal(data.rounds.length,2);
  assert.equal(data.rounds[0].input,'請說人話');
  assert.equal(data.rounds[0].replies.length,2);
  assert.equal(data.rounds[0].replies[1].association,'ancestry');
  assert.equal(data.rounds[0].replies[1].model,null);
  assert.equal(data.rounds[1].status,'unanswered');
  assert.doesNotMatch(JSON.stringify(data),/私有推理|工具結果/);
  const cx = parseConversation(jsonl([{type:'event_msg',payload:{type:'user_message',message:'重複'}},{type:'response_item',payload:{type:'message',role:'assistant',channel:'analysis',content:[{type:'output_text',text:'私有推理'}]}},{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'唯一需求'}]}},{type:'response_item',payload:{type:'message',role:'assistant',channel:'final',content:[{type:'output_text',text:'回覆'}]}}]),{provider:'codex',sourceId:'x',originalPath:'x.jsonl'});
  assert.equal(cx.rounds.length,1); assert.equal(cx.rounds[0].replies[0].association,'chronological');
  assert.equal(cx.rounds[0].replies[0].model,null);
  assert.throws(()=>parseConversation('{oops}',{provider:'claude',sourceId:'s',originalPath:'s.jsonl'}),/停止匯入/);
});

test('generic history preserves failed/running/unrecorded turns without inventing input, and draft carries newer source conflicts', async t => {
  const dir = await mkdtemp(path.join(tmpdir(),'awc-conversation-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const reader = new Conversations(dir);
  assert.equal((await reader.read(sample)).rounds.length,0);
  const task = {...sample,planning:{learningTurns:[{id:'t1',agent:'Codex old',prompt:'actual',status:'failed',error:'額度',startedAt:'2026-01-01'},{id:'t2',provider:'copilot',modelId:'claude-opus-5.5',effort:'medium',userInput:'需求',inputKind:'user',prompt:'full',status:'running',startedAt:'2026-01-02'}]}};
  const data = await reader.read(task);
  assert.equal(data.rounds[0].input,'');assert.equal(data.rounds[0].rawInput,'actual');
  const unknown=await reader.read({...sample,planning:{learningTurns:[{id:'u',prompt:'只有 prompt',startedAt:'2026-01-01'}]}});assert.equal(unknown.rounds[0].provider,'unknown');
  assert.equal(data.rounds[0].status,'failed');assert.equal(data.rounds[1].status,'running');
  assert.equal(data.rounds[1].models[0].model,'claude-opus-5.5');assert.ok(data.limits.length);
  await assert.rejects(reader.read({...sample,id:'../secrets'}),{code:'TASK_INVALID'});
  const prompt = nextRequest(sample,{cautions:['最新改為 0～60 個月'],direction:'共用能力'});
  assert.match(prompt,/近一年.*曾標記核對/); assert.match(prompt,/最新改為 0～60 個月/);
  assert.match(prompt,/P1 不改/);assert.match(prompt,/範圍外/);assert.match(prompt,/已回答的不再問/);
});
