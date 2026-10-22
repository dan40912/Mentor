import test from 'node:test';
import assert from 'node:assert/strict';
import {prompts} from '../src/coach.js';
import {demoTask} from './fixtures/demo-task.js';
const occurrences=(text,part)=>text.split(part).length-1;
test('A/B/C share initial request once while retaining later user corrections and repeated instructions',()=>{
 const task=demoTask();task.planning.request='INITIAL_UNIQUE_只改善表格，不重做網站';task.planning.messages=[{role:'user',stage:'A',text:task.planning.request},{role:'ai',stage:'A',text:'AI_TASK_CARD'},{role:'user',stage:'B',text:'CORRECTION_保留原配色'}];
 for(const stage of ['A','B','C'])assert.equal(occurrences(prompts[stage](task),task.planning.request),1,stage);
 for(const stage of ['B','C']){const text=prompts[stage](task);assert.ok(text.includes('CORRECTION_保留原配色'));assert.ok(text.includes('AI_TASK_CARD'));}
 task.planning.messages.push({role:'user',stage:'B',text:task.planning.request});
 for(const stage of ['B','C'])assert.equal(occurrences(prompts[stage](task),task.planning.request),2,'later explicit repetition remains chronological evidence');
});
test('only an exact first user message is deduplicated, never similar or later instructions',()=>{
 const task=demoTask();task.planning.request='ORIGINAL_SCOPE';task.planning.messages=[{role:'user',stage:'A',text:'ORIGINAL_SCOPE plus constraint'},{role:'user',stage:'B',text:'ORIGINAL_SCOPE'}];
 assert.ok(prompts.B(task).includes('使用者：ORIGINAL_SCOPE plus constraint'));assert.ok(prompts.B(task).includes('使用者：ORIGINAL_SCOPE\n'));
});
