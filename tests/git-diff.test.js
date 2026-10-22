import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { Coach } from '../src/coach.js';
import { TaskStore, serializeTask, parseTask } from '../src/tasks.js';
import { isGitRoot, gitHead, itemDiff, itemChanges } from '../src/git-diff.js';
import { requestApp } from './fixtures/request.js';
import { demoTask } from './fixtures/demo-task.js';
const exec = promisify(execFile);
const specialName = process.platform === 'win32' ? 'special[1].txt' : 'special*.txt';
const literalNames = process.platform === 'win32' ? [specialName, '-flag.txt'] : [specialName, ':(glob)*.txt', '-flag.txt'];
async function fixture(t) {
  const root = await mkdtemp(path.join(process.cwd(), '.git-diff-test.'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ceiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = root;
  t.after(() => { if (ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = ceiling; });
  const dir = path.join(root, 'repo');await mkdir(dir);
  const git = (...args) => exec('git', args, { cwd: dir, env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(root,'no-global'), GIT_CONFIG_NOSYSTEM: '1' } });
  await git('init');await git('config','core.autocrlf','false');await git('config','user.name','Fixture');await git('config','user.email','fixture@example.test');
  for (const file of ['edit.txt','delete.txt','other.txt',...literalNames]) await writeFile(path.join(dir,file), 'before\n');
  await git('add','--all');await git('commit','-m','baseline');
  const baseline = await gitHead(dir), task = demoTask('TASK-git-0001',dir);task.gitBaseline=baseline;
  task.planning.workItems[0].outputs=['edit.txt','delete.txt','new.txt'].map(file=>({file}));task.planning.workItems[1].outputs=[{file:'other.txt'}];
  return { root,dir,git,baseline,task };
}

test('建立任務保存 HEAD，序列化後跨 commit 仍用保存基準；舊任務改用目前 HEAD', async t => {
  const f=await fixture(t), vault=path.join(f.root,'vault');await mkdir(vault);
  const store=new TaskStore(vault), coach=new Coach(store,()=>({}),f.root,{rules:async()=>''});
  coach.formulate=async id=>({task:(await store.get(id)).task,done:Promise.resolve({error:'不呼叫 AI 的 fixture'})});
  const created=await coach.create({request:'確認 Git 基準保存',outputDir:f.dir});await created.done;
  let saved=(await store.get(created.task.id)).task;assert.equal(saved.gitBaseline,f.baseline);
  saved.planning.workItems=f.task.planning.workItems;
  saved=parseTask(serializeTask(saved));assert.equal(saved.gitBaseline,f.baseline);
  await writeFile(path.join(f.dir,'edit.txt'),'second commit\n');await f.git('add','edit.txt');await f.git('commit','-m','second');
  const head=await gitHead(f.dir);assert.notEqual(head,f.baseline);
  assert.match((await itemDiff(saved,'W1')).diff,/\+second commit/);
  delete saved.gitBaseline;const old=await itemDiff(saved,'W1');assert.equal(old.baseline,head);assert.equal(old.diff,'');
  await writeFile(path.join(f.dir,'edit.txt'),'uncommitted\n');assert.match((await itemDiff(saved,'W1')).diff,/-second commit/);
});

test('差異僅含本項登記檔案：已追蹤修改、刪除、staged 與未追蹤新增', async t => {
  const f=await fixture(t);await writeFile(path.join(f.dir,'edit.txt'),'after\n');await f.git('add','edit.txt');
  await rm(path.join(f.dir,'delete.txt'));await writeFile(path.join(f.dir,'new.txt'),'<script>新增 &</script>\n');await writeFile(path.join(f.dir,'other.txt'),'secret-other\n');
  const result=await itemDiff(f.task,'W1');assert.equal(result.baseline,f.baseline);assert.deepEqual(result.files,['edit.txt','delete.txt','new.txt']);
  assert.match(result.diff,/-before\n\+after/);assert.match(result.diff,/deleted file mode/);assert.match(result.diff,/\+<script>新增 &<\/script>/);assert.doesNotMatch(result.diff,/other.txt|secret-other/);
  assert.doesNotMatch((await itemDiff(f.task,'W2')).diff,/edit.txt|new.txt|delete.txt/);
  f.task.planning.workItems[0].outputs=[];assert.equal((await itemDiff(f.task,'W1')).diff,'');
});

test('拒絕越界、失效 symlink、資料夾與不存在項目，刪除檔父路徑也檢查', async t => {
  const f=await fixture(t);await writeFile(path.join(f.root,'outside.txt'),'outside');
  await symlink(f.root,path.join(f.dir,'escape'),'junction');await symlink(path.join(f.root,'absent'),path.join(f.dir,'dangling'),'junction');
  await mkdir(path.join(f.dir,'directory'));
  for(const file of ['../outside.txt',path.join(f.root,'outside.txt'),'bad\\name','bad\0name','escape/outside.txt','escape/deleted.txt','dangling/deleted.txt','directory','.git/config']){
    f.task.planning.workItems[0].outputs=[{file}];await assert.rejects(itemDiff(f.task,'W1'),error=>[400,403,415].includes(error.status),file);
  }
  await assert.rejects(itemDiff(f.task,'UNKNOWN'),{code:'DIFF_ITEM_MISSING'});
  f.task.gitBaseline='--help';await assert.rejects(itemDiff(f.task,'W1'),{code:'DIFF_BASELINE_INVALID'});
});

test('Git 參數為 execFile 陣列且 shell:false；特殊檔名與 pathspec 不擴大範圍', async t => {
  const f=await fixture(t), weird='$(touch HACKED); `touch HACKED`.txt';
  for(const file of [...literalNames,weird]) await writeFile(path.join(f.dir,file),'safe-new\n');
  await writeFile(path.join(f.dir,'special-other.txt'),'secret\n');
  for(const file of [...literalNames,weird]){
    f.task.planning.workItems[0].outputs=[{file}];const result=await itemDiff(f.task,'W1');assert.match(result.diff,/\+safe-new/);assert.doesNotMatch(result.diff,/special-other|\+secret/);
  }
  await assert.rejects(readFile(path.join(f.dir,'HACKED')),{code:'ENOENT'});
  const source=await readFile(new URL('../src/git-diff.js',import.meta.url),'utf8');
  assert.match(source,/promisify\(execFile\)/);assert.match(source,/run\('git', args, \{ cwd, shell: false/);assert.match(source,/GIT_LITERAL_PATHSPECS: '1'/);
  const calls=[];const ctx=vm.createContext({run:async(...args)=>{calls.push(args);return {stdout:''};},process:{env:{}}});
  vm.runInContext(source.slice(source.indexOf('const git ='),source.indexOf('export async function isGitRoot')).replace('const git =','globalThis.git ='),ctx);
  const args=['diff','a'.repeat(40),'--',weird];await ctx.git(f.dir,args);
  assert.equal(calls[0][0],'git');assert.equal(calls[0][1],args);assert.equal(calls[0][2].shell,false);assert.equal(calls[0][2].cwd,f.dir);
});

test('新增空檔、無尾端換行、ignored 檔可顯示；過大／無效 UTF-8 拒絕',async t=>{
  const f=await fixture(t);await writeFile(path.join(f.dir,'.gitignore'),'ignored.txt\n');
  for(const [file,text] of [['empty.txt',''],['no-newline.txt','last'],['ignored.txt','ignored\n']]){
    await writeFile(path.join(f.dir,file),text);f.task.planning.workItems[0].outputs=[{file}];const result=await itemDiff(f.task,'W1');assert.match(result.diff,/new file mode/);
    if(file==='no-newline.txt')assert.match(result.diff,/\\ No newline at end of file/);if(file==='ignored.txt')assert.match(result.diff,/\+ignored/);
  }
  f.task.planning.workItems[0].outputs=[{file:'large.txt'}];await writeFile(path.join(f.dir,'large.txt'),Buffer.alloc(2*1024*1024+1));await assert.rejects(itemDiff(f.task,'W1'),{code:'DIFF_TOO_LARGE'});
  await writeFile(path.join(f.dir,'large.txt'),Buffer.from([255]));await assert.rejects(itemDiff(f.task,'W1'),{code:'DIFF_FILE_UNSUPPORTED'});
});

test('非 Git 與不存在資料夾不提供基準；根目錄沒有 commit 或失去基準不回退掩蓋',async t=>{
  const f=await fixture(t),dir=path.join(f.root,'plain');await mkdir(dir);assert.equal(await gitHead(dir),null);assert.equal(await gitHead(path.join(f.root,'missing')),null);
  await exec('git',['init'],{cwd:dir});assert.equal(await gitHead(dir),null);
  f.task.allowedRoots=[dir];delete f.task.gitBaseline;await assert.rejects(itemDiff(f.task,'W1'),{code:'DIFF_NO_HEAD'});
  f.task.allowedRoots=[f.dir];f.task.gitBaseline='a'.repeat(40);await assert.rejects(itemDiff(f.task,'W1'),{code:'DIFF_FAILED'});
});


test('repo 根目錄比較含前後空白子路徑，從 index 移除的檔案不重複列新增',async t=>{
  const f=await fixture(t),folder=process.platform==='win32'?' nested folder':' nested ',dir=path.join(f.dir,folder);await mkdir(dir);await writeFile(path.join(dir,'base.txt'),'before\n');
  await f.git('add','--all');await f.git('commit','-m','nested baseline');f.task.gitBaseline=await gitHead(f.dir);
  await f.git('rm','--cached','--',`${folder}/base.txt`);await writeFile(path.join(dir,'new.txt'),'new nested\n');
  f.task.planning.workItems[0].outputs=[{file:`${folder}/base.txt`},{file:`${folder}/new.txt`}];
  const result=await itemDiff(f.task,'W1');assert.match(result.diff,/deleted file mode/);assert.match(result.diff,/\+new nested/);
  assert.equal((result.diff.match(/new file mode/g)||[]).length,1);
});

test('規格 5：改動數僅計去重登記路徑，包含刪除、新增空檔及 binary，排除未變更與未登記檔',async t=>{
  const f=await fixture(t);
  await writeFile(path.join(f.dir,'binary.bin'),Buffer.from([0,1]));await f.git('add','binary.bin');await f.git('commit','-m','binary baseline');
  f.task.gitBaseline=await gitHead(f.dir);
  await writeFile(path.join(f.dir,'edit.txt'),'changed\n');await rm(path.join(f.dir,'delete.txt'));
  await writeFile(path.join(f.dir,'empty.txt'),'');await writeFile(path.join(f.dir,'binary.bin'),Buffer.from([0,2]));
  await writeFile(path.join(f.dir,'secret.txt'),'unregistered');
  const item=f.task.planning.workItems[0];item.outputs=['edit.txt','edit.txt','delete.txt','empty.txt','binary.bin','other.txt'].map(file=>({file}));
  const result=await itemDiff(f.task,'W1');assert.equal(result.changedFileCount,4);assert.equal(result.files.length,5);assert.doesNotMatch(result.diff,/secret.txt/);
  item.outputs=[{file:'other.txt'}];assert.equal((await itemDiff(f.task,'W1')).changedFileCount,0);
  item.outputs=[];assert.equal((await itemDiff(f.task,'W1')).changedFileCount,0);
});

test('規格 5：改動數處理換行檔名、子目錄與 rename 的登記範圍',async t=>{
  const f=await fixture(t),dir=path.join(f.dir,'nested');await mkdir(dir);
  const special=process.platform==='win32'?'line break.txt':'line\nbreak.txt';await writeFile(path.join(dir,special),'before\n');await f.git('add','--all');await f.git('commit','-m','nested');
  f.task.gitBaseline=await gitHead(f.dir);await writeFile(path.join(dir,special),'after\n');
  f.task.planning.workItems[0].outputs=[{file:`nested/${special}`},{file:`nested/${special}`}];assert.equal((await itemDiff(f.task,'W1')).changedFileCount,1);
  f.task.allowedRoots=[f.dir];await f.git('mv','other.txt','renamed.txt');
  f.task.planning.workItems[0].outputs=[{file:'other.txt'}];assert.equal((await itemDiff(f.task,'W1')).changedFileCount,1);
  f.task.planning.workItems[0].outputs=[{file:'other.txt'},{file:'renamed.txt'}];assert.equal((await itemDiff(f.task,'W1')).changedFileCount,2);
});


test('根目錄判定：repo、worktree 與 symlink 可比較；子資料夾、ignored 與非 Git 不保存基準，舊基準也回 409', async t => {
  const f=await fixture(t), worktree=path.join(f.root,'worktree'), alias=path.join(f.root,'alias');
  await f.git('worktree','add','--detach',worktree);
  await symlink(f.dir,alias,'junction');
  const nested=path.join(f.dir,'nested'), ignored=path.join(f.dir,'ignored'), plain=path.join(f.root,'plain');
  for(const dir of [nested,ignored,plain])await mkdir(dir);
  await writeFile(path.join(f.dir,'.gitignore'),'ignored/\n');
  await f.git('check-ignore','ignored');
  await assert.rejects(exec('git',['rev-parse','--show-toplevel'],{cwd:plain}));
  await mkdir(path.join(f.root,'vault'));
  const store=new TaskStore(path.join(f.root,'vault')), coach=new Coach(store,()=>({}),f.root,{rules:async()=>''});
  coach.formulate=async id=>({task:(await store.get(id)).task,done:Promise.resolve({error:'不呼叫 AI 的 fixture'})});
  const server=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
  const availability=server.match(/gitAvailable: ([^}]+) }/)[1];
  const ctx=vm.createContext({gitHead});
  for(const [dir,available] of [[f.dir,true],[worktree,true],[alias,true],[nested,false],[ignored,false],[plain,false]]){
    assert.equal(await isGitRoot(dir),available,dir);
    assert.equal(await gitHead(dir),available?f.baseline:null,dir);
    const created=await coach.create({request:'核對產出資料夾 Git 基準',outputDir:dir});await created.done;
    const saved=(await store.get(created.task.id)).task;
    if(available)assert.equal(saved.gitBaseline,f.baseline,dir);else assert.ok(!saved.gitBaseline,dir);
    ctx.task={...f.task,allowedRoots:[dir],gitBaseline:f.baseline};
    assert.equal(await vm.runInContext(`(async()=>(${availability}))()`,ctx),available,dir);
    if(available)assert.equal((await itemDiff(ctx.task,'W1')).baseline,f.baseline,dir);
    else await assert.rejects(itemDiff(ctx.task,'W1'),{status:409,code:'DIFF_NOT_GIT_ROOT',message:'這個任務的產出資料夾不是 Git 專案，沒有差異可看'},dir);
  }
});


test('替代 changes 僅列實際登記異動，涵蓋新增、修改、刪除並保留 AI 回報優先', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.dir, 'edit.txt'), 'after\n');
  await rm(path.join(f.dir, 'delete.txt'));
  await writeFile(path.join(f.dir, 'new.txt'), 'new\n');
  await writeFile(path.join(f.dir, 'other.txt'), 'private\n');
  f.task.planning.workItems[0].outputs.push({ file: specialName });
  const listing = await itemChanges(f.task, 'W1');
  assert.equal(listing.baselineSource, 'task.gitBaseline');
  assert.deepEqual(listing.changes.map(c => c.where).sort(), ['delete.txt', 'edit.txt', 'new.txt']);
  for (const change of listing.changes) {
    assert.match(change.what, /Git 顯示(新增|修改|刪除)此檔案/);
    assert.doesNotMatch(JSON.stringify(change), /已通過|畫面效果|private/);
    assert.equal(change.status, undefined);
  }
  assert.equal(listing.changes.find(c => c.where === 'delete.txt').path, undefined);
  const reported = [{ where: '畫面', what: 'AI 回報', howToCheck: '閱讀' }];
  f.task.planning.workItems[0].changes = reported;
  assert.deepEqual(await itemChanges(f.task, 'W1'), { source: 'report', changes: reported });
});

test('替代清單明示 HEAD 備援、無差異、非 Git、無 HEAD 與失效基準', async t => {
  const f = await fixture(t);delete f.task.gitBaseline;
  let result = await itemChanges(f.task, 'W1');
  assert.equal(result.baselineSource, 'HEAD');assert.equal(result.baseline, f.baseline);
  assert.deepEqual(result.changes, []);assert.match(result.reason, /沒有差異/);
  const plain = path.join(f.root, 'plain');await mkdir(plain);f.task.allowedRoots = [plain];
  result = await itemChanges(f.task, 'W1');assert.equal(result.code, 'DIFF_NOT_GIT_ROOT');assert.ok(result.reason);
  await exec('git', ['init'], { cwd: plain });
  result = await itemChanges(f.task, 'W1');assert.equal(result.code, 'DIFF_NO_HEAD');assert.ok(result.reason);
  f.task.allowedRoots = [f.dir];f.task.gitBaseline = 'a'.repeat(40);
  result = await itemChanges(f.task, 'W1');assert.equal(result.code, 'DIFF_FAILED');assert.ok(result.reason);
});

test('requestApp 路由取得替代清單、保存逐點通過、拒絕舊清單及未登入請求', async t => {
  const f = await fixture(t), app = await requestApp(path.join(f.root, 'app'));
  const session = await (await app.fetch('/api/session')).json();
  const headers = { cookie: `awc=${session.csrfToken}`, 'x-csrf-token': session.csrfToken, 'idempotency-key': 'fallback-check-1' };
  const created = await app.coach.create({ request: '核對替代清單', outputDir: f.dir });await app.settle();
  const id = created.task.id;
  await app.coach.store.mutate(id, 'latest', null, task => {
    task.planning.workItems = f.task.planning.workItems;
    task.planning.workItems[0].status = 'AWAITING_REVIEW';return {};
  });
  await writeFile(path.join(f.dir, 'edit.txt'), 'after\n');
  const url = `/api/tasks/${id}/review-changes?item=W1`;
  assert.equal((await app.fetch(url)).status, 403);
  let result = await (await app.fetch(url, { headers })).json();assert.equal(result.changes.length, 1);
  const task = (await app.coach.store.get(id)).task;
  const response = await app.fetch(`/api/tasks/${id}/change-check`, { method: 'POST', headers, body: JSON.stringify({ revision: task.revision, itemId: 'W1', index: 0, change: result.changes[0] }) });
  assert.equal(response.status, 200);
  result = await (await app.fetch(url, { headers })).json();assert.equal(result.changes[0].status, 'PASS');
  await rm(path.join(f.dir, 'edit.txt'));
  const stale = await app.fetch(`/api/tasks/${id}/change-check`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'fallback-check-2' }, body: JSON.stringify({ revision: (await app.coach.store.get(id)).task.revision, itemId: 'W1', index: 0, change: result.changes[0] }) });
  assert.equal(stale.status, 409);
  assert.equal((await app.fetch(`/api/tasks/${id}/review-changes?item=UNKNOWN`, { headers })).status, 404);
});


test('替代清單可列未追蹤 binary 成果，原有差異預覽的 UTF-8 邊界保留', async t => {
  const f = await fixture(t);await writeFile(path.join(f.dir, 'new.png'), Buffer.from([255, 0]));
  f.task.planning.workItems[0].outputs = [{ file: 'new.png' }];
  const result = await itemChanges(f.task, 'W1');assert.equal(result.changes[0].where, 'new.png');assert.match(result.changes[0].what, /新增/);
  await assert.rejects(itemDiff(f.task, 'W1'), { code: 'DIFF_FILE_UNSUPPORTED' });
});
