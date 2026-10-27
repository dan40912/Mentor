import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
const source=process.cwd(),load=file=>import(pathToFileURL(path.join(source,file)));
const {demoTask}=await load('tests/fixtures/demo-task.js'),{requestApp}=await load('tests/fixtures/request.js'),{serializeTask,sha256}=await load('src/tasks.js');
const root=await mkdtemp(path.join(os.tmpdir(),'mentor-conflict-probe-'));
try{
 const vault=path.join(root,'vault'),out=path.join(root,'outputs');await mkdir(vault);await mkdir(out);await writeFile(path.join(out,'result.md'),'baseline');
 const task=demoTask('TASK-conflict-probe',out);task.planning.phase='execute';task.planning.outline={storyline:'fictional output',logic:[],sections:[]};task.planning.workItems=[{id:'W1',title:'fictional edit',owner:'ai',acceptance:['saved'],dependsOn:[],status:'TODO',outputs:[{file:'result.md',sha:sha256('baseline')}],attempts:0}];await writeFile(path.join(vault,task.id+'.md'),serializeTask(task));
 let actualCwd;const app=await requestApp(root,async input=>{actualCwd=input.cwd;await writeFile(path.join(out,'result.md'),'concurrent human edit');await writeFile(path.join(input.cwd,'result.md'),'simulated agent output');return {text:'STATUS: DONE\nFILES: result.md\nCHANGES: fictional edit'};});
 await(await app.coach.execute(task.id,'W1')).done;const final=await readFile(path.join(out,'result.md'),'utf8'),state=await app.coach.latest(task.id);
 const report={date:'2026-10-27',implementationSha256:sha256(await readFile(path.join(source,'src/coach.js'))),simulated:true,modelCalls:0,runnerReceivesLiveOutputDirectory:actualCwd===out,concurrentHumanEditPreserved:final==='concurrent human edit',finalContent:final,itemStatus:state.planning.workItems[0].status,conclusion:final==='concurrent human edit'?'preserved in this probe':'Reproduced concurrent human edit overwrite; historical snapshots do not prevent it.'};
 console.log(JSON.stringify(report,null,2));
}finally{await rm(root,{recursive:true,force:true});}
