import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {TaskStore} from '../src/tasks.js';
import {Coach} from '../src/coach.js';
import {Memory} from '../src/memory.js';
import {runAgent} from '../src/agents.js';
import {demoTask} from '../tests/fixtures/demo-task.js';
if(!process.argv.includes('--run')){
 console.log('Opt-in only. node scripts/live-content-drafts.mjs --run uses real Claude quota for three fictional drafts; add --classification for one fictional tag-suggestion call instead. It previews but never applies notes to a Vault.');
}else{
 for(const name of ['AWC_CODEX_BIN','AWC_CLAUDE_BIN'])if(process.env[name])throw Error('Refusing live CLI overrides');
 const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),home=path.join(repo,'.lab-home','content-drafts-'+randomUUID().slice(0,8)),vault=path.join(home,'vault'),notes=path.join(home,'note-vault');await mkdir(vault,{recursive:true});await mkdir(notes);
 const require=createRequire(import.meta.url),organization={exports:{}},drafts={exports:{}};
 vm.runInNewContext(await readFile(path.join(repo,'obsidian/mentor-work-center/organization.js'),'utf8'),{module:organization,require});
 vm.runInNewContext(await readFile(path.join(repo,'obsidian/mentor-work-center/content-drafts.js'),'utf8'),{module:drafts,require:name=>name==='./organization'?organization.exports:require(name)});
 const source='# 虛構來源\n\n觀察：表格資訊擁擠，尚未完成實際閱讀測試。\n決策：保留原始筆記與 Mentor UI。\n未知：回顧期間、量化改善、人工驗收結果。\n';await writeFile(path.join(notes,'來源.md'),source);
 const task=demoTask('TASK-content-draft',home);task.status='READY';task.goal='從虛構來源預寫內容，僅供預覽';task.planning.request=task.goal;task.planning.workItems=[{id:'W1',title:'原工作保持原樣',owner:'ai',status:'TODO',detail:'這次不執行',acceptance:['不改原文'],dependsOn:[],outputs:[]}];
 const hash=value=>createHash('sha256').update(value).digest('hex'),core=t=>JSON.stringify({goal:t.goal,scope:t.scope,phase:t.planning.phase,workItems:t.planning.workItems}),before=hash(core(task));
 const store=new TaskStore(vault);await store.create(task);const coach=new Coach(store,()=>({stages:{B:{provider:'claude',modelId:'sonnet',effort:'low'}}}),home,new Memory(path.join(vault,'memory')),args=>runAgent({...args,timeoutMs:120000}));
 const engine=new organization.exports.Organization({read:async name=>readFile(path.join(notes,name),'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;}),createJournal:async()=>{throw Error('Preview test cannot write notes');},writeJournal:async()=>{throw Error('Preview test cannot write notes');},compareWrite:async()=>{throw Error('Preview test cannot write notes');}});
 const evidence={at:new Date().toISOString(),nodeVersion:process.version,requestedProvider:'claude',requestedModel:'sonnet',requestedEffort:'low',sourceSha256:hash(source),coreBeforeSha256:before,results:[],noteApplication:'NOT_RUN',humanContentAcceptance:'NOT_RUN',obsidianDesktop:'NOT_RUN'};
 const save=()=>writeFile(path.join(home,'evidence.json'),JSON.stringify(evidence,null,2));await save();console.log('Evidence directory: '+home);
 for(const kind of (process.argv.includes('--classification')?['tags']:['knowledge','weekly','source'])){
  console.log('Real CLI draft: '+kind);const current=await coach.latest(task.id),key=randomUUID(),request=drafts.exports.prepare(kind,'來源.md',hash(source),source,'');
  const run=await coach.discuss(task.id,current.revision,key,request);await run.done;
  const latest=await coach.latest(task.id),message=latest.planning.messages.find(m=>m.requestKey===key),reply=latest.planning.messages.find(m=>m.inReplyTo===key);
  let plan,basis;
  if(kind==='tags'){
   basis=drafts.exports.classification(message,reply,task.id,reply?.resultRevision);
   if(basis.suggestions.length)plan=await engine.previewTags([basis.sourcePath],basis.suggestions.map(item=>item.tag),basis);
  }else{
   const output=drafts.exports.output(message,reply,task.id,reply?.resultRevision);plan=await engine.previewWrites([{path:'來源.md',hash:hash(source)}],[output],'AI content draft');await engine.verifySources(plan);
  }
  const output=plan?.operations[0];
  const turn=latest.planning.learningTurns.at(-1);evidence.results.push({kind,status:turn.status,intent:reply.discussion.intent,resultRevision:reply.resultRevision,usage:turn.usage,elapsedMs:turn.elapsedMs,...(basis?{basis}:{}),previewPath:output?.path??null,previewSha256:output?hash(output.after):null,preview:output?.after??null,coreUnchanged:hash(core(latest))===before,sourceUnchanged:hash(await readFile(path.join(notes,'來源.md'),'utf8'))===hash(source)});await save();
 }
 console.log(JSON.stringify({evidence:path.join(home,'evidence.json'),results:evidence.results.map(({kind,status,intent,coreUnchanged,sourceUnchanged})=>({kind,status,intent,coreUnchanged,sourceUnchanged})),noteApplication:evidence.noteApplication,humanContentAcceptance:evidence.humanContentAcceptance},null,2));
 if(evidence.results.some(r=>r.status!=='completed'||!r.coreUnchanged||!r.sourceUnchanged))process.exitCode=1;
}
