import test from 'node:test';
import assert from 'node:assert/strict';
import {demoTask} from './fixtures/demo-task.js';
import {compactHandoff} from '../src/compact-handoff.js';
import {workCardsMarkdown} from '../src/work-cards.js';
test('handoff carries current hashes and bounded historical manifest references without embedding snapshot bodies',()=>{
 const task=demoTask();task.planning.workItems[0].outputs=[{file:'result.md',sha:'a'.repeat(64)}];
 task.planning.learningTurns=Array.from({length:4},(_,i)=>({id:'turn-'+i,stage:'D',status:'completed',prompt:'PRIVATE SNAPSHOT BODY',artifactHistory:{after:{id:'version-'+i,digest:String(i).repeat(64)}}}));
 const text=compactHandoff(task).content;assert.match(text,/result\.md｜SHA-256 a{64}/);
 assert.doesNotMatch(text,/version-0|PRIVATE SNAPSHOT BODY/);for(const i of [1,2,3])assert.ok(text.includes(`vault/artifact-history/${task.id}/version-${i}/manifest.json`));
 assert.match(text,/不以目前檔案替代/);assert.match(text,/matchesRecorded/);assert.match(text,/副本不代表已驗收/);
});

test('plain Markdown round records preserve snapshot lookup and distinguish legacy current-file references',()=>{
 const task=demoTask();task.planning.learningTurns=[{id:'turn',stage:'D',status:'completed',outputs:[{file:'saved.md',sha:'abc',snapshot:{id:'version',index:0}},{file:'old.md'}],artifactHistory:{after:{id:'version',digest:'digest'}}}];
 const text=workCardsMarkdown(task);assert.match(text,/saved.md｜SHA-256 abc/);assert.ok(text.includes(`vault/artifact-history/${task.id}/version/0.bin`));assert.ok(text.includes('manifest.json｜SHA-256 digest'));assert.match(text,/old.md.*未保存當輪內容/);
});
