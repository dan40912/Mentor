// Opt-in smoke test: calls your authenticated CLIs, uses quota, writes only fictional isolated data.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Coach } from '../src/coach.js';
import { TaskStore, sha256 } from '../src/tasks.js';
import { Memory } from '../src/memory.js';
import { runAgent } from '../src/agents.js';
import { workCards } from '../src/work-cards.js';
import { compactHandoff } from '../src/compact-handoff.js';
if(!process.argv.includes('--run')){
  console.log('Opt-in only. Runs Codex → Claude Code using authenticated accounts and real quota.\nUse: node scripts/live-cross-ai.mjs --run');
}else{
  for(const variable of ['AWC_CODEX_BIN','AWC_CLAUDE_BIN'])if(/fake/i.test(process.env[variable]||''))throw new Error('Refusing fake CLI overrides for a live test');
  const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const home=path.join(repo,'.lab-home','live-cross-ai-'+randomUUID().slice(0,8)),vault=path.join(home,'vault'),out=path.join(home,'outputs');
  await mkdir(vault,{recursive:true});await mkdir(out);
  const requirements='# Fictional CSS test\nCreate mentor-table.css only. Scope selectors to .mentor-note. Style table, th and td; provide light and dark variants. No imports, URLs, hidden text or JavaScript. Keep requirements.md and verify.cjs unchanged. Do not claim Obsidian visual testing.\n';
  const verify=`const fs=require('node:fs'),assert=require('node:assert/strict');const css=fs.readFileSync('mentor-table.css','utf8');assert.match(css,/\\.mentor-note/);assert.match(css,/table/);assert.match(css,/\\bth\\b/);assert.match(css,/\\btd\\b/);assert.match(css,/theme-light/);assert.match(css,/theme-dark/);assert.doesNotMatch(css,/@import|url\\(|display\\s*:\\s*none|visibility\\s*:\\s*hidden/i);assert.equal((css.match(/{/g)||[]).length,(css.match(/}/g)||[]).length);console.log('PASS structural checks only; not an Obsidian visual test');`;
  await writeFile(path.join(out,'requirements.md'),requirements);await writeFile(path.join(out,'verify.cjs'),verify);
  const id='TASK-live-'+randomUUID().slice(0,8),time=new Date().toISOString();
  const task={id,revision:1,status:'READY',updatedAt:time,prelude:'\n# Fictional live CLI smoke test\n',notes:'\n',title:'Obsidian scoped table smoke test',project:'Live smoke (fictional)',goal:'Create a scoped table CSS file and independently review it. This is not product visual acceptance.',workspace:{label:'isolated test',root:out},allowedRoots:[out],scope:{allowed:['Create mentor-table.css in the output directory'],locked:[{text:'requirements.md and verify.cjs must remain unchanged',source:'smoke-test fixture'}],forbidden:['Network publication','Changing other files','Claiming real Obsidian visual acceptance']},current:{summary:'Prepared isolated test specification',sources:[]},decisions:[],checks:[],facts:[],learnings:[],parked:[],reports:[],next:'Codex writes CSS; Claude independently reviews; human visual acceptance remains pending.',planning:{phase:'execute',profile:'quick',request:requirements,card:{title:'Scoped table CSS',goal:'Create mentor-table.css',audience:'isolated test',deliverable:'CSS',success:['Scoped CSS, independent review'],constraints:['Only write mentor-table.css','Preserve all fixture files','No app visual acceptance claim'],unknowns:[],testCommand:'node verify.cjs'},rules:'',diary:[],messages:[],outline:{storyline:'Read fixture → write scoped CSS → independent review',logic:['Read requirements','Create CSS','Review'],sections:[{no:1,title:'Scoped table styles',point:'Light and dark readability',evidence:'requirements.md',visual:{type:'none',count:0}}],imageTotal:0},workItems:[{id:'W1',title:'Create scoped table styles',detail:'Read requirements.md, create mentor-table.css, run node verify.cjs. Do not modify fixtures. Final response must register the CSS file and report limitations.',owner:'ai',status:'TODO',acceptance:['mentor-table.css contains .mentor-note-scoped table, th and td rules for theme-light and theme-dark','node verify.cjs passes; do not claim this proves real app readability'],dependsOn:[],outputs:[],attempts:0}],running:null,readyForOutline:false,baseline:[{file:'requirements.md',sha:sha256(requirements)},{file:'verify.cjs',sha:sha256(verify)}]}};
  const store=new TaskStore(vault);await store.create(task);
  const settings={stages:{D:{provider:'codex',modelId:null,effort:null},E:{provider:'claude',modelId:null,effort:null}}};
  const coach=new Coach(store,()=>settings,home,new Memory(path.join(vault,'memory')),args=>runAgent({...args,timeoutMs:120000}));
  let failure=null;
  console.log('Isolated live-test directory: '+home);
  try{
    console.log('Starting Codex D (real CLI, maximum 120 seconds).');
    const executed=await(await coach.execute(id,'W1')).done;
    if(executed.error)throw new Error(executed.error.message);
    const after=(await store.get(id)).task;
    await writeFile(path.join(home,'handoff-summary.md'),compactHandoff(after,'claude').content);
    if(after.planning.workItems[0].status!=='AWAITING_REVIEW')throw new Error('Execution did not register a reviewable artifact');
    console.log('Starting Claude E (real CLI, maximum 120 seconds; disposable review copy).');
    const reviewed=await(await coach.review(id,'W1')).done;
    if(reviewed.error)throw new Error(reviewed.error.message);
  }catch(error){failure=error.message;console.log('Live test incomplete: '+failure);}
  const latest=(await store.get(id)).task,item=latest.planning.workItems[0];
  const fixturesUnchanged=sha256(await readFile(path.join(out,'requirements.md')))==sha256(requirements)&&sha256(await readFile(path.join(out,'verify.cjs')))==sha256(verify);
  const evidence={taskId:id,at:new Date().toISOString(),failure,fixturesUnchanged,itemStatus:item.status,sensors:item.sensors||[],review:item.review||null,rounds:workCards(latest).map(({source,contextMetrics,stage,status,agent,simulated})=>({source,contextMetrics,stage,status,agent,simulated})),humanAcceptance:'NOT_RUN',obsidianVisualAcceptance:'NOT_RUN'};
  await writeFile(path.join(home,'evidence.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({taskId:id,itemStatus:item.status,fixturesUnchanged,evidence:path.join(home,'evidence.json'),humanAcceptance:'NOT_RUN',failure},null,2));
  if(failure||!fixturesUnchanged||item.status!=='REVIEWED')process.exitCode=1;
}
