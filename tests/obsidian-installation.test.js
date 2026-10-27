import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,copyFile,readFile,writeFile,rm,rename,symlink,access,link} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readWithoutLinks,writeGenerated,runtimeFiles} from '../scripts/obsidian-files.mjs';
import {verifyObsidian} from '../scripts/verify-obsidian.mjs';
const exec=promisify(execFile),repo=fileURLToPath(new URL('../',import.meta.url));
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'mentor-install-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const relative of ['scripts/package-obsidian.mjs','scripts/obsidian-files.mjs','LICENSE']){await mkdir(path.dirname(path.join(root,relative)),{recursive:true});await copyFile(path.join(repo,relative),path.join(root,relative));}
 for(const relative of ['obsidian/mentor-work-center','obsidian/templates','obsidian/examples','themes/Mentor'])await cp(path.join(repo,relative),path.join(root,relative),{recursive:true});
 const target=path.join(root,'dist','mentor-obsidian'),build=()=>exec(process.execPath,[path.join(root,'scripts','package-obsidian.mjs')]);return {root,target,build};
}
test('tracked package upgrades preserve notes, filled templates, settings and journals; edited owned files stop the whole preflight',async t=>{
 const f=await fixture(t),plugin='.obsidian/plugins/mentor-work-center/';await writeFile(path.join(f.root,'obsidian/mentor-work-center/data.json'),'FICTIONAL_SOURCE_STATE');await f.build();await assert.rejects(access(path.join(f.target,plugin,'data.json')));
 const original=await readFile(path.join(f.target,'範本/任務.md'),'utf8'),oldRuntime=await readFile(path.join(f.target,plugin,'main.js'),'utf8');
 await writeFile(path.join(f.target,'範本/任務.md'),original+'\n人工填寫，不可覆蓋');await writeFile(path.join(f.root,'obsidian/mentor-work-center/main.js'),oldRuntime+'\n// fictional upgrade\n');
 await assert.rejects(f.build(),error=>error.stderr.includes('kept intact: 範本/任務.md'));assert.equal(await readFile(path.join(f.target,plugin,'main.js'),'utf8'),oldRuntime,'no earlier runtime replacement on failed note preflight');assert.match(await readFile(path.join(f.target,'範本/任務.md'),'utf8'),/人工填寫/);
 await writeFile(path.join(f.target,'範本/任務.md'),original);
 const assets={'我的筆記.md':'# 人工內容', '.obsidian/appearance.json':'{"cssTheme":"Personal"}',[plugin+'data.json']:'{"sources":{"TASK-fictional":{"path":"我的筆記.md"}}}','Mentor 整理/復原紀錄/fictional.json':'{"before":"人工筆記原文","after":"確認內容"}'};
 for(const [name,text] of Object.entries(assets)){await mkdir(path.dirname(path.join(f.target,name)),{recursive:true});await writeFile(path.join(f.target,name),text);}
 await f.build();assert.equal((await verifyObsidian(f.target,f.root)).passed,true);for(const [name,text] of Object.entries(assets))assert.equal(await readFile(path.join(f.target,name),'utf8'),text,name);
});
test('read-only verification catches mixed and missing modules without reading or changing saved state',async t=>{
 const f=await fixture(t);await f.build();const base=path.join(f.target,'.obsidian/plugins/mentor-work-center');await writeFile(path.join(base,'data.json'),'FICTIONAL_PRIVATE_STATE');
 await writeFile(path.join(base,'organization.js'),'old version');let result=await verifyObsidian(f.target,f.root);assert.equal(result.passed,false);assert.equal(result.results.find(r=>r.path.endsWith('/organization.js')).status,'different');assert.equal(await readFile(path.join(base,'organization.js'),'utf8'),'old version');
 await rm(path.join(base,'relocation.js'));result=await verifyObsidian(f.target,f.root);assert.equal(result.results.find(r=>r.path.endsWith('/relocation.js')).status,'missing');assert.equal(await readFile(path.join(base,'data.json'),'utf8'),'FICTIONAL_PRIVATE_STATE');
});
test('legacy builds without ownership records refuse differing files; directory symlinks are never build destinations',async t=>{
 const f=await fixture(t);await f.build();await rm(path.join(f.target,'.obsidian/mentor-build.json'));await writeFile(path.join(f.target,'00 工作首頁.md'),'原有人工首頁');await assert.rejects(f.build(),error=>error.stderr.includes('kept intact: 00 工作首頁.md'));assert.equal(await readFile(path.join(f.target,'00 工作首頁.md'),'utf8'),'原有人工首頁');
 const outside=path.join(f.root,'outside');await mkdir(outside);await writeFile(path.join(outside,'keep.md'),'outside original');await rename(path.join(f.root,'dist'),path.join(f.root,'old-dist'));await symlink(outside,path.join(f.root,'dist'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(f.build(),error=>error.stderr.includes('Build target must be a real directory'));assert.equal(await readFile(path.join(outside,'keep.md'),'utf8'),'outside original');await assert.rejects(access(path.join(outside,'mentor-obsidian')));
});

test('documented runtime-only upgrade and rollback preserve filled notes and plugin state on a real filesystem',async t=>{
 const f=await fixture(t);await f.build();const base='.obsidian/plugins/mentor-work-center/',oldMain=await readFile(path.join(f.target,base,'main.js'),'utf8');
 const assets={'範本/任務.md':'# 已填寫的任務\n人工確認內容','日常.md':'# 我的筆記',[base+'data.json']:'{"sources":{"TASK-fictional":{"path":"日常.md"}}}','Mentor 整理/復原紀錄/fictional.json':'{"before":"原文","after":"保存內容"}'};
 for(const [name,text] of Object.entries(assets)){await mkdir(path.dirname(path.join(f.target,name)),{recursive:true});await writeFile(path.join(f.target,name),text);}
 const backup=path.join(f.root,'runtime-backup');for(const entry of runtimeFiles){await mkdir(path.dirname(path.join(backup,entry.target)),{recursive:true});await copyFile(path.join(f.target,entry.target),path.join(backup,entry.target));}
 await writeFile(path.join(f.root,'obsidian/mentor-work-center/main.js'),oldMain+'\n// fictional newer runtime\n');for(const entry of runtimeFiles)await copyFile(path.join(f.root,entry.source),path.join(f.target,entry.target));assert.equal((await verifyObsidian(f.target,f.root)).passed,true);
 for(const entry of runtimeFiles)await copyFile(path.join(backup,entry.target),path.join(f.target,entry.target));assert.equal(await readFile(path.join(f.target,base,'main.js'),'utf8'),oldMain);assert.equal((await verifyObsidian(f.target,f.root)).passed,false,'rolled-back code is correctly different from the newer checkout');for(const [name,text] of Object.entries(assets))assert.equal(await readFile(path.join(f.target,name),'utf8'),text);
});

test('build writes reject late replacements and hard links instead of changing another file',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mentor-owned-write-'));t.after(()=>rm(root,{recursive:true,force:true}));const file=path.join(root,'owned.md');await writeFile(file,'old');const before=await readWithoutLinks(root,'owned.md');await rename(file,path.join(root,'old-inode.md'));await writeFile(file,'old');
 await assert.rejects(writeGenerated(root,'owned.md',Buffer.from('new'),before),/replaced/);assert.equal(await readFile(file,'utf8'),'old');
 const fresh=await readWithoutLinks(root,'owned.md');await link(file,path.join(root,'another-file.md'));await assert.rejects(writeGenerated(root,'owned.md',Buffer.from('new'),fresh),/linked/);assert.equal(await readFile(path.join(root,'another-file.md'),'utf8'),'old');
});
