import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink,truncate} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ArtifactHistory} from '../src/artifact-history.js';
import {sha256} from '../src/tasks.js';
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'mentor-history-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const vault=path.join(root,'vault'),outputs=path.join(root,'outputs');await mkdir(vault);await mkdir(outputs);
 return {root,vault,outputs,history:new ArtifactHistory(vault),task:{id:'TASK-history',revision:3,allowedRoots:[outputs]},turnId:randomUUID()};
}
test('saved bytes survive later output edits and a fresh history reader verifies their hash',async t=>{
 const f=await fixture(t),original='第一輪\n';await writeFile(path.join(f.outputs,'成果.md'),original);
 const snapshot=await f.history.capture(f.task,{turnId:f.turnId,phase:'after',outputs:[{file:'成果.md',sha:sha256(original)}]});
 await writeFile(path.join(f.outputs,'成果.md'),'第二輪');
 const saved=await new ArtifactHistory(f.vault).read(f.task.id,snapshot.id,0);
 assert.equal(saved.content.toString(),original);assert.equal(saved.manifest.digest,snapshot.digest);assert.equal(saved.file.matchesRecorded,true);
});
test('before records missing files and actual pre-run content without inventing old bytes',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.outputs,'note.md'),'human edit');
 const snapshot=await f.history.capture(f.task,{turnId:f.turnId,phase:'before',outputs:[{file:'note.md',sha:sha256('old')},'gone.md']});
 assert.equal(snapshot.files[0].status,'missing');assert.equal(snapshot.files[1].matchesRecorded,false);
 await assert.rejects(f.history.read(f.task.id,snapshot.id,0),{code:'ARTIFACT_HISTORY_MISSING'});
 assert.equal((await f.history.read(f.task.id,snapshot.id,1)).content.toString(),'human edit');
});
test('after hash mismatch removes partial archive and leaves current outputs untouched',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.outputs,'a.md'),'a');await writeFile(path.join(f.outputs,'b.md'),'b');
 await assert.rejects(f.history.capture(f.task,{turnId:f.turnId,phase:'after',outputs:[{file:'a.md',sha:sha256('a')},{file:'b.md',sha:sha256('wrong')}]}),{code:'ARTIFACT_HISTORY_CHANGED'});
 assert.deepEqual(await readdir(path.join(f.vault,'artifact-history',f.task.id)),[]);
 assert.equal(await readFile(path.join(f.outputs,'b.md'),'utf8'),'b');
});
test('corrupt saved bytes refuse reading rather than falling back to current output',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.outputs,'a.md'),'original');
 const snapshot=await f.history.capture(f.task,{turnId:f.turnId,phase:'after',outputs:[{file:'a.md',sha:sha256('original')}]});
 await writeFile(path.join(f.vault,'artifact-history',f.task.id,snapshot.id,'0.bin'),'tampered');
 await assert.rejects(f.history.read(f.task.id,snapshot.id,0),{code:'ARTIFACT_HISTORY_CORRUPT'});
});
test('archive rejects traversal, oversized files and linked archive directories',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.history.capture(f.task,{turnId:f.turnId,phase:'before',outputs:['../outside.md']}),{code:'PREVIEW_NAME_INVALID'});
 const large=path.join(f.outputs,'large.md');await writeFile(large,'');await truncate(large,50_000_001);
 await assert.rejects(f.history.capture(f.task,{turnId:f.turnId,phase:'before',outputs:['large.md']}),{code:'ARTIFACT_HISTORY_LIMIT'});
 await rm(path.join(f.vault,'artifact-history'),{recursive:true});await symlink(f.outputs,path.join(f.vault,'artifact-history'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(f.history.capture(f.task,{turnId:f.turnId,phase:'before',outputs:['large.md']}),{code:'ARTIFACT_HISTORY_PATH'});
});
