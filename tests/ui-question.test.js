import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const control=await readFile(new URL('../web/assets/control.js',import.meta.url),'utf8'),html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
const all=n=>[n,...n.children.flatMap(all)];
function setup(request){
 const element=(tag,text='')=>({tag,textContent:text,value:'',dataset:{},children:[],isConnected:true,append(...children){this.children.push(...children);},setAttribute(){},removeAttribute(){}});
 let sequence=0,polls=0;const replaced=[],drafts={},changes=[];
 const context=vm.createContext({element,composerDrafts:drafts,crypto:{randomUUID:()=>`question-${++sequence}`},request,replaceTask:t=>replaced.push(t),ensurePolling:()=>polls++,tell(){},focusInstruct:(...args)=>changes.push(args),restoreFocus:null});
 vm.runInContext(html.split('\n').find(line=>line.startsWith('function busy('))+'\n'+control.slice(control.indexOf('function questionBox(')),context);
 return {build:task=>context.questionBox(task),replaced,drafts,changes,get polls(){return polls;}};
}
const task=()=>({id:'TASK-question',revision:4,planning:{phase:'execute',messages:[],workItems:[]}});

test('question form preserves text and request identity on ambiguous failure; submit cannot invoke modification',async()=>{
 const calls=[];let fail=true;const b=setup(async(...args)=>{calls.push(args);if(fail)throw Error('offline');return {task:task()};});
 const box=b.build(task()),form=all(box).find(n=>n.tag==='form'),area=all(box).find(n=>n.tag==='textarea');area.value='是否可以只改表格？';area.oninput();
 await form.onsubmit({preventDefault(){}});assert.equal(area.value,'是否可以只改表格？');assert.equal(b.drafts['question:TASK-question'],area.value);
 fail=false;await form.onsubmit({preventDefault(){}});assert.equal(calls.length,2);assert.ok(calls.every(c=>c[0]==='/api/tasks/TASK-question/ask'));assert.equal(calls[0][2]['Idempotency-Key'],calls[1][2]['Idempotency-Key']);assert.equal(b.replaced.length,1);assert.equal(b.polls,1);assert.equal(b.drafts['question:TASK-question'],undefined);assert.equal(area.value,'');assert.equal(area.disabled,false);
});
test('AI modification advice can only fill an editable draft; it never starts a mutation',()=>{
 const b=setup(()=>assert.fail('advice must not call API')),t=task();t.planning.messages=[{kind:'discussion',role:'ai',text:'建議先調整間距',discussion:{intent:'change',proposedChange:'只調整列距',scope:'W1'}}];
 const box=b.build(t);all(box).find(n=>n.textContent==='帶入修改草稿').onclick();assert.deepEqual(b.changes,[['W1','只調整列距']]);
});
