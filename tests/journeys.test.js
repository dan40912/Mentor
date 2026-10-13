import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../web/assets/project.js',import.meta.url),'utf8');
const node=(tag,text='')=>({tag,text,children:[],append(...children){this.children.push(...children);}});
const flatten=n=>[n,...n.children.flatMap(flatten)];
test('journeys merge recorded projects with briefs without merging similar names',()=>{
 const ctx=vm.createContext({});vm.runInContext(source,ctx);
 const result=ctx.journeyProjects([{id:'a',name:'A B',title:'Brief'}],[{project:'A B'},{project:'A-B'},{project:'A-B'},{}]);
 assert.equal(result.length,3);assert.equal(result[0].hasBrief,true);assert.equal(result[1].name,'A-B');assert.equal(result[2].name,'未分類');
});
test('task-only journey displays existing records, routes to conversations and previews outcomes',()=>{
 let opened,conversation,preview;
 const ctx=vm.createContext({element:node,section:title=>node('section',title),statuses:{COMPLETED:['已完成']},when:x=>x,
 openTask:id=>opened=id,showConversations:id=>conversation=id,openPreview:(id,file)=>preview=[id,file]});vm.runInContext(source,ctx);
 ctx.projectState.records=[{id:'TASK-history',project:'coffee-site',title:'優化歷史',status:'COMPLETED',updatedAt:'2026-10-10',goal:'整理來龍去脈',current:{summary:'813 輪對話',artifact:'/outputs/HISTORY.html'},allowedRoots:['/outputs']},{id:'TASK-other',project:'other',title:'別的專案'}];
 const box=node('div');ctx.drawJourneyRecords({name:'coffee-site',title:'coffee-site'},box);
 const nodes=flatten(box);assert.ok(nodes.some(n=>n.text==='813 輪對話'));assert.ok(!nodes.some(n=>n.text==='別的專案'));
 nodes.find(n=>n.text==='開啟任務與修改紀錄').onclick();assert.equal(opened,'TASK-history');
 nodes.find(n=>n.text==='查看每輪問答').onclick();assert.equal(conversation,'TASK-history');
 nodes.find(n=>n.text==='HISTORY.html').onclick();assert.deepEqual(preview,['TASK-history','HISTORY.html']);
});
