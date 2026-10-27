import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {prepareExecutionWorkspace,inspectExecutionWorkspace,publishExecutionWorkspace,loadExecutionWorkspace,reconcileExecutionPublication} from '../src/execution-workspace.js';
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'mentor-execution-copy-'));t.after(()=>rm(root,{recursive:true,force:true}));const out=path.join(root,'output'),vault=path.join(root,'vault');await mkdir(out);await mkdir(vault);await writeFile(path.join(out,'result.md'),'baseline');return {root,out,vault,prepare:()=>prepareExecutionWorkspace(out,vault,{taskId:'TASK-copy',turnId:randomUUID()})};}
test('isolated candidate edits and deletes leave original files untouched, with full before/after index',async t=>{
 const f=await fixture(t),w=await f.prepare();await writeFile(path.join(w.candidate,'result.md'),'agent edit');await writeFile(path.join(w.candidate,'new.md'),'new');let check=await inspectExecutionWorkspace(w);assert.equal(check.conflict,false);assert.deepEqual(check.changes.map(c=>c.action),['create','modify']);assert.equal(await readFile(path.join(f.out,'result.md'),'utf8'),'baseline');assert.equal(await readFile(path.join(w.original,'result.md'),'utf8'),'baseline');await rm(path.join(w.candidate,'result.md'));check=await inspectExecutionWorkspace(w);assert.equal(check.changes.find(c=>c.path==='result.md').action,'delete');
});
test('concurrent human edits, additions and deletions are conflicts and both versions remain available',async t=>{
 const f=await fixture(t),w=await f.prepare();await writeFile(path.join(w.candidate,'result.md'),'agent edit');await writeFile(path.join(f.out,'result.md'),'human edit');assert.equal((await inspectExecutionWorkspace(w)).conflict,true);assert.equal(await readFile(path.join(f.out,'result.md'),'utf8'),'human edit');assert.equal(await readFile(path.join(w.candidate,'result.md'),'utf8'),'agent edit');await writeFile(path.join(f.out,'result.md'),'baseline');await writeFile(path.join(f.out,'human.md'),'new human file');assert.equal((await inspectExecutionWorkspace(w)).conflict,true);await rm(path.join(f.out,'human.md'));await rm(path.join(f.out,'result.md'));assert.equal((await inspectExecutionWorkspace(w)).conflict,true);
});
test('source symlinks and candidate symlinks are refused, with no copying outside the output root',async t=>{
 const f=await fixture(t);await symlink(f.vault,path.join(f.out,'linked'),'junction');await assert.rejects(f.prepare(),{code:'EXECUTION_WORKSPACE_UNSAFE'});await rm(path.join(f.out,'linked'));const w=await f.prepare();await symlink(f.vault,path.join(w.candidate,'linked'),'junction');await assert.rejects(inspectExecutionWorkspace(w),{code:'EXECUTION_WORKSPACE_UNSAFE'});
});


test('publishing applies a whole candidate tree and retains the actual original tree',async t=>{
 const f=await fixture(t),w=await f.prepare();await writeFile(path.join(w.candidate,'result.md'),'agent edit');await writeFile(path.join(w.candidate,'new.md'),'new file');const result=await publishExecutionWorkspace(w);t.after(()=>rm(path.dirname(result.displaced),{recursive:true,force:true}));assert.equal(result.status,'published');assert.equal(await readFile(path.join(f.out,'result.md'),'utf8'),'agent edit');assert.equal(await readFile(path.join(result.displaced,'result.md'),'utf8'),'baseline');assert.equal(w.manifest.status,'published');await assert.rejects(publishExecutionWorkspace(w),{code:'EXECUTION_WORKSPACE_UNSAFE'});
});
test('a source conflict before publishing never moves or replaces the human tree',async t=>{
 const f=await fixture(t),w=await f.prepare();await writeFile(path.join(w.candidate,'result.md'),'agent edit');await writeFile(path.join(f.out,'result.md'),'human edit');await assert.rejects(publishExecutionWorkspace(w),{code:'EXECUTION_OUTPUT_CONFLICT'});assert.equal(w.manifest.status,'conflict');assert.equal(await readFile(path.join(f.out,'result.md'),'utf8'),'human edit');
});
test('interruption after moving the original retains both trees and a durable unknown record',async t=>{
 const f=await fixture(t),w=await f.prepare();await writeFile(path.join(w.candidate,'result.md'),'agent edit');await assert.rejects(publishExecutionWorkspace(w,{checkpoint:async phase=>{if(phase==='after-original-move')throw Error('injected interruption');}}),{code:'EXECUTION_PUBLICATION_UNKNOWN'});t.after(()=>rm(w.manifest.publicationDirectory,{recursive:true,force:true}));assert.equal(JSON.parse(await readFile(path.join(w.directory,'manifest.json'),'utf8')).status,'unknown');assert.equal(await readFile(path.join(w.manifest.displaced,'result.md'),'utf8'),'baseline');assert.equal(await readFile(path.join(w.candidate,'result.md'),'utf8'),'agent edit');await assert.rejects(publishExecutionWorkspace(w),{code:'EXECUTION_WORKSPACE_UNSAFE'});
});
test('a concurrently recreated output directory is preserved instead of replaced',async t=>{
 const f=await fixture(t),w=await f.prepare();await writeFile(path.join(w.candidate,'result.md'),'agent edit');await assert.rejects(publishExecutionWorkspace(w,{checkpoint:async phase=>{if(phase==='after-original-move'){await mkdir(f.out);await writeFile(path.join(f.out,'human.md'),'human replacement');}}}),{code:'EXECUTION_OUTPUT_CONFLICT'});t.after(()=>rm(w.manifest.publicationDirectory,{recursive:true,force:true}));assert.equal(await readFile(path.join(f.out,'human.md'),'utf8'),'human replacement');assert.equal(await readFile(path.join(w.manifest.displaced,'result.md'),'utf8'),'baseline');
});


test('restart recovery restores the displaced tree only with confirmation and without replacing current content',async t=>{
 const f=await fixture(t),w=await f.prepare();await writeFile(path.join(w.candidate,'result.md'),'agent edit');await assert.rejects(publishExecutionWorkspace(w,{checkpoint:async phase=>{if(phase==='after-original-move')throw Error('stop');}}));t.after(()=>rm(w.manifest.publicationDirectory,{recursive:true,force:true}));
 const loaded=await loadExecutionWorkspace(w.directory,{storageRoot:f.vault,outputRoot:f.out,taskId:'TASK-copy'});await assert.rejects(reconcileExecutionPublication(loaded,{choice:'restore-original',confirmed:false}));await reconcileExecutionPublication(loaded,{choice:'restore-original',confirmed:true});assert.equal(await readFile(path.join(f.out,'result.md'),'utf8'),'baseline');assert.equal(loaded.manifest.status,'reconciled');assert.equal(await readFile(path.join(loaded.candidate,'result.md'),'utf8'),'agent edit');
});
test('recovery refuses a different task or an existing human directory and can explicitly keep that human version',async t=>{
 const f=await fixture(t),w=await f.prepare();await assert.rejects(publishExecutionWorkspace(w,{checkpoint:async phase=>{if(phase==='after-original-move'){await mkdir(f.out);await writeFile(path.join(f.out,'human.md'),'human replacement');}}}));t.after(()=>rm(w.manifest.publicationDirectory,{recursive:true,force:true}));await assert.rejects(loadExecutionWorkspace(w.directory,{storageRoot:f.vault,outputRoot:f.out,taskId:'TASK-other'}));
 const loaded=await loadExecutionWorkspace(w.directory,{storageRoot:f.vault,outputRoot:f.out,taskId:'TASK-copy'});await assert.rejects(reconcileExecutionPublication(loaded,{choice:'restore-original',confirmed:true}));await reconcileExecutionPublication(loaded,{choice:'keep-current',confirmed:true});assert.equal(await readFile(path.join(f.out,'human.md'),'utf8'),'human replacement');assert.equal(await readFile(path.join(loaded.manifest.displaced,'result.md'),'utf8'),'baseline');
});
