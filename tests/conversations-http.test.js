import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, mkdtemp, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { textSha } from '../src/conversations.js';
import { demoTask } from './fixtures/demo-task.js';
import { TaskStore, serializeTask } from '../src/tasks.js';

// 合成的匯入紀錄：結構與真實匯入檔相同，內容是虛構的。
const DEMO_ID = 'TASK-demo-0001';
const demoRef = line => ({ sourceId: 'demo-source', line, recordId: `rec-${line}`, textSha: textSha(`text-${line}`) });
const archive = {
  taskId: DEMO_ID, importedAt: '2026-01-01T00:00:00.000Z',
  sources: [{ provider: 'claude', sourceId: 'demo-source', originalPath: '/demo/session.jsonl', sha256: textSha('demo'), rows: 4 }],
  rounds: [1, 2].map(n => ({ id: `round-${n}`, provider: 'claude', sourceId: 'demo-source', at: '2026-01-01T00:00:00.000Z', input: `問題 ${n}`, rawInput: `問題 ${n}`, inputKind: 'prompt', inputRef: demoRef(n), replies: [{ at: '2026-01-01T00:01:00.000Z', text: `回答 ${n}`, model: 'demo-model', effort: null, ref: demoRef(n + 10), association: 'ancestry' }], models: [{ model: 'demo-model', effort: null }], status: 'done', origin: 'imported' })),
  excluded: [], unpaired: [],
  lessons: [{ id: 'demo-lesson', title: '先問讀者', kind: 'prompt', observed: '需求沒說讀者是誰', cause: '缺少背景', certainty: 'observed', prevention: '交辦時先寫讀者與決策', nextPrompt: '這份文件的讀者要做什麼決定？', refs: [{ roundId: 'round-1', provider: 'claude', line: 1, role: 'input' }] }],
  snapshots: [], direction: '示範', summary: '虛構的示範對話', latest: null, cautions: [], limits: ['合成資料'],
};

test('history API requires same-origin authentication; retaining a lesson is deduplicated and never accepts business outcomes', {timeout:15000}, async t => {
  const dir=await realpath(await mkdtemp(path.join(tmpdir(),'awc-history-api-')));t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(path.join(dir,'vault/conversations'),{recursive:true});
  await writeFile(path.join(dir,'vault/conversations/TASK-demo-0001.json'),JSON.stringify(archive));
  await writeFile(path.join(dir,'vault/TASK-demo-0001.md'),serializeTask(demoTask('TASK-demo-0001')));
  const child=spawn(process.execPath,[path.join(path.dirname(fileURLToPath(import.meta.url)),'..','src','server.js')],{env:{...process.env,PORT:'0',MENTOR_HOME:dir},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}});
  const address=await new Promise((resolve,reject)=>{child.stdout.on('data',b=>{const m=b.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0]);});child.once('error',reject);child.once('exit',code=>reject(new Error('server exit '+code)));});
  assert.equal((await fetch(address+'/api/tasks/TASK-demo-0001/conversation')).status,403);
  const home=await fetch(address+'/');const cookie=home.headers.get('set-cookie').split(';')[0];
  assert.match(home.headers.get('content-security-policy'),/script-src 'self'/);
  const init=await (await fetch(address+'/api/settings',{headers:{cookie}})).json();
  const headers={cookie,'x-csrf-token':init.csrfToken,'content-type':'application/json',origin:address};
  const store=new TaskStore(path.join(dir,'vault'));const before=(await store.get('TASK-demo-0001')).task;
  const post=(body,extra={})=>fetch(address+'/api/tasks/TASK-demo-0001/conversation-rule',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
  assert.equal((await post({lessonId:archive.lessons[0].id},{'x-csrf-token':'bad'})).status,403);
  assert.equal((await post({lessonId:'made-up',text:'外部指定規則'})).status,404);
  assert.equal((await post({lessonId:archive.lessons[0].id},{origin:'http://evil.invalid'})).status,403);
  assert.equal((await (await post({lessonId:archive.lessons[0].id})).json()).added,true);
  assert.equal((await (await post({lessonId:archive.lessons[0].id})).json()).added,false);
  const after=(await store.get('TASK-demo-0001')).task;
  assert.deepEqual(after,before);
  const createProject=await fetch(address+'/api/projects',{method:'POST',headers,body:JSON.stringify({name:'測試專案'})});
  assert.equal(createProject.status,201);const project=(await createProject.json()).project;
  const saveProject=await fetch(address+'/api/projects/'+encodeURIComponent(project.id)+'/save',{method:'POST',headers,body:JSON.stringify({revision:project.revision,slideId:'why',point:'先了解目的',detail:'這是可編輯說明。',reason:'補清楚讀者'})});
  assert.equal(saveProject.status,200);assert.equal((await saveProject.json()).project.edits.length,1);
  assert.deepEqual((await store.get('TASK-demo-0001')).task,before);
  const history=await (await fetch(address+'/api/tasks/TASK-demo-0001/conversation',{headers:{cookie}})).json();
  assert.equal(history.rounds.length,2);
});
