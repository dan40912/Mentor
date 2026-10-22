import test from 'node:test';
import assert from 'node:assert/strict';
import {downstreamItems,sameWorkDefinition,invalidateDownstream} from '../src/work-item-impact.js';
import {ready,planningAction} from '../src/tasks.js';
import {Coach} from '../src/coach.js';

test('changed definitions include details and dependencies, but not dependency order',()=>{
 const a={title:'A',owner:'ai',detail:'keep sources',acceptance:['check'],dependsOn:['B','C']};
 assert.equal(sameWorkDefinition(a,{...a,detail:'replace sources'}),false);
 assert.equal(sameWorkDefinition(a,{...a,dependsOn:['B']}),false);
 assert.equal(sameWorkDefinition(a,{...a,dependsOn:['C','B']}),true);
});
test('a changed source invalidates every downstream acceptance and preserves artifacts and unrelated work',()=>{
 const item=(id,dependsOn=[],owner='ai')=>({id,dependsOn,owner,status:'DONE',outputs:[{file:id+'.md'}],review:{results:['old']},doneAt:'yesterday'});
 const items=[item('A'),item('B',['A']),item('C',['B']),item('H',['C'],'human'),item('other')];
 assert.deepEqual(downstreamItems(items,['A']).map(i=>i.id),['B','C','H']);
 items[0].status='REVIEW_FAIL';invalidateDownstream(items,['A'],'source changed');
 assert.deepEqual(items.map(i=>i.status),['REVIEW_FAIL','AWAITING_REVIEW','AWAITING_REVIEW','TODO','DONE']);
 assert.equal(items[1].outputs[0].file,'B.md');assert.equal(items[1].review.superseded,true);assert.equal(items[1].doneAt,undefined);assert.equal(ready(items,items[2]),false);
 assert.equal(items.at(-1).doneAt,'yesterday');
});
test('cyclic and diamond graphs terminate, deduplicate, and never invalidate the source itself',()=>{
 const items=[{id:'A',dependsOn:['C']},{id:'B',dependsOn:['A']},{id:'C',dependsOn:['A','B']}];
 assert.deepEqual(downstreamItems(items,['A']).map(i=>i.id),['B','C']);
});

test('reopened upstream work is recommended before stale downstream review in manual and autopilot flows',()=>{
 const items=[{id:'B',title:'downstream',owner:'ai',status:'AWAITING_REVIEW',recheck:'source changed',dependsOn:['A']},{id:'A',title:'source',owner:'ai',status:'TODO',dependsOn:[]}];
 const task={planning:{phase:'execute',workItems:items}};
 assert.equal(planningAction(task).id,'A');
 const calls=[];const step=Coach.prototype.nextStep.call({execute:(id,itemId)=>calls.push(itemId),review:()=>assert.fail('must wait for upstream')},{id:'TASK-impact',...task},{full:false,fixRounds:{}});
 step.run();assert.deepEqual(calls,['A']);
});
