import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {TaskStore} from '../src/tasks.js';
import {Coach} from '../src/coach.js';
import {Memory} from '../src/memory.js';
import {runAgent} from '../src/agents.js';
import {demoTask} from '../tests/fixtures/demo-task.js';
import {fileURLToPath} from 'node:url';
if(!process.argv.includes('--run')){console.log('Opt-in only: node scripts/live-question.mjs --run calls real Claude sonnet with fictional data and consumes account quota.');}else{
for(const variable of ['AWC_CODEX_BIN','AWC_CLAUDE_BIN'])if(process.env[variable])throw new Error('Live question test refuses CLI binary overrides');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const home=path.resolve(repo,'.lab-home/discussion-live-'+randomUUID().slice(0,8)),vault=path.join(home,'vault'),out=path.join(home,'outputs');await mkdir(vault,{recursive:true});await mkdir(out);
const task=demoTask('TASK-live-question',out);task.status='READY';task.goal='改善 Obsidian 表格閱讀，保留 Mentor Web UI';task.planning.request=task.goal;task.planning.card.goal=task.goal;task.planning.card.constraints=['不能修改原始筆記'];task.planning.workItems=[{id:'W1',title:'表格樣式',detail:'只調整表格',owner:'ai',status:'TODO',acceptance:['保留原文'],dependsOn:[],outputs:[]}];
const core=t=>({goal:t.goal,request:t.planning.request,scope:t.scope,phase:t.planning.phase,items:t.planning.workItems});
const hash=t=>createHash('sha256').update(JSON.stringify(core(t))).digest('hex'),before=hash(task);
const store=new TaskStore(vault);await store.create(task);const coach=new Coach(store,()=>({stages:{B:{provider:'claude',modelId:'sonnet',effort:'low'}}}),home,new Memory(path.join(vault,'memory')),args=>runAgent({...args,timeoutMs:120000}));
const result=await coach.discuss(task.id,1,'real-question-test-001',{question:'目前還沒有產出，為什麼不能說已完成？請只解釋，不要修改或驗收。'});await result.done;
const current=await coach.latest(task.id),reply=current.planning.messages.filter(m=>m.kind==='discussion'&&m.role==='ai').at(-1),turn=current.planning.learningTurns.at(-1);
const report={at:new Date().toISOString(),fixture:'fictional task',coreBeforeSha256:before,coreAfterSha256:hash(current),coreUnchanged:before===hash(current),status:turn.status,intent:reply?.discussion?.intent,answer:reply?.text,proposedChange:reply?.discussion?.proposedChange,usage:turn.usage};
await writeFile(path.join(home,'evidence.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({home,...report},null,2));if(!report.coreUnchanged||turn.status!=='completed')process.exitCode=1;

}
