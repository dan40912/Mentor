import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {prepareExecutionWorkspace,inspectExecutionWorkspace} from '../src/execution-workspace.js';
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
