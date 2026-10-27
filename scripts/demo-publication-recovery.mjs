import {mkdtemp,mkdir,writeFile,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {demoTask} from '../tests/fixtures/demo-task.js';
import {serializeTask,sha256} from '../src/tasks.js';
import {prepareExecutionWorkspace,publishExecutionWorkspace} from '../src/execution-workspace.js';
import {createRequestHandler} from '../src/server.js';
const port=Number(process.env.PORT||4364);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('PORT must be 1024–65535');await mkdir(path.resolve('.lab-home'),{recursive:true});
const root=await realpath(await mkdtemp(path.resolve('.lab-home/publication-recovery-demo-'))),vault=path.join(root,'vault'),out=path.join(root,'outputs');await mkdir(vault);await mkdir(out);await writeFile(path.join(out,'result.md'),'# 虛構原成果\n\n保留 Mentor UI，Obsidian 閱讀模式仍待測。\n');
const task=demoTask('TASK-publication-recovery-demo',out),turnId=randomUUID();task.title='【隔離測試】恢復中斷的成果發布';task.goal=task.title;task.planning.request=task.title;task.planning.card.title=task.title;task.planning.card.goal=task.title;task.planning.card.testCommand='';task.planning.outline={storyline:'虛構恢復流程',logic:[],sections:[]};task.planning.workItems=[{id:'W1',title:'恢復虛構原成果',detail:'不使用正式 Vault',owner:'ai',acceptance:['原成果保留'],dependsOn:[],status:'TODO',attempts:0,outputs:[{file:'result.md',sha:sha256(await readFile(path.join(out,'result.md')))}]}];
const workspace=await prepareExecutionWorkspace(out,vault,{taskId:task.id,turnId});await writeFile(path.join(workspace.candidate,'result.md'),'# 虛構 AI 候選\n\n這是模擬內容，未呼叫模型，也沒有通過驗收。\n');
try{await publishExecutionWorkspace(workspace,{checkpoint:async phase=>{if(phase==='after-original-move')throw Error('隔離測試：模擬發布中斷');}});}catch{}
task.planning.learningTurns=[{id:turnId,stage:'D',status:'failed',startedAt:new Date().toISOString(),completedAt:new Date().toISOString(),prompt:'隔離模擬，不呼叫模型。',simulated:true,errorCode:'EXECUTION_PUBLICATION_UNKNOWN',error:'模擬發布中斷，請核對候選與原成果備份。',executionWorkspace:{directory:workspace.directory,status:workspace.manifest.status,displaced:workspace.manifest.displaced}}];await writeFile(path.join(vault,task.id+'.md'),serializeTask(task));
await writeFile(path.join(root,'fixture.json'),JSON.stringify({root,out,workspace:workspace.directory,displaced:workspace.manifest.displaced,turnId},null,2));
const app=await createRequestHandler({root,port,runAgent:async()=>{throw Error('隔離恢復測試不允許呼叫模型。');}});
http.createServer(async(req,res)=>{if(req.url==='/'){const end=res.end.bind(res);res.end=value=>end(String(value).replace('<body>','<body><div class="notice" role="status">隔離恢復測試：全部為虛構資料，不呼叫 AI、不修改正式 Vault。</div>'));}await app.handler(req,res);}).listen(port,'127.0.0.1',()=>console.log('Recovery fixture ready: http://127.0.0.1:'+port+'/'));
