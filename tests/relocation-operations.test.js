import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),organization={exports:{}},coverage={exports:{}},relocation={exports:{}};
vm.runInNewContext(await readFile(new URL('../obsidian/mentor-work-center/organization.js',import.meta.url),'utf8'),{module:organization,require});
vm.runInNewContext(await readFile(new URL('../obsidian/mentor-work-center/reference-coverage.js',import.meta.url),'utf8'),{module:coverage});
vm.runInNewContext(await readFile(new URL('../obsidian/mentor-work-center/relocation.js',import.meta.url),'utf8'),{module:relocation,require:n=>n==='./organization'?organization.exports:n==='./reference-coverage'?coverage.exports:require(n)});
const {Relocation,compileRelocation}=relocation.exports,{hash}=organization.exports;
function fixture(){
 const files=new Map([['A.md','[B](B.md)'],['B.md','[[A]]'],['C.md','unchanged']]);let failWrite=null,throwAfterRename=false,renames=0;
 const io={read:async p=>files.get(p)??null,listFiles:async()=>[...files.keys()],createJournal:async(p,text)=>{assert.equal(files.has(p),false);files.set(p,text);},writeJournal:async(p,text)=>{assert.ok(files.has(p));files.set(p,text);},compareWrite:async(p,b,a)=>{if(p===failWrite)throw Error('寫入失敗');assert.equal(files.get(p),b);files.set(p,a);},rename:async(from,to,expected)=>{assert.equal(files.has(to),false);assert.equal(files.get(from),expected);files.set(to,files.get(from));files.delete(from);renames++;if(throwAfterRename){throwAfterRename=false;throw Error('搬移後回報中斷');}}};
 const notes=[...files].map(([path,content])=>({path,content,references:coverage.exports.scanReferences(content).references.map(r=>({...r,target:path==='A.md'?'B.md':'A.md'}))}));
 return {files,io,plan:compileRelocation(notes,'A.md','新/A.md',[...files.keys()]),engine:new Relocation(io),get renames(){return renames;},set failWrite(p){failWrite=p;},set throwAfterRename(v){throwAfterRename=v;}};
}
test('relocation applies the exact preview once and restores paths and links after a fresh process loads its journal',async()=>{
 const f=fixture(),initial=new Map(f.files);const pair=await Promise.all([f.engine.apply(f.plan),f.engine.apply(f.plan)]);assert.equal(pair[0].status,'applied');assert.equal(pair[1].replayed,true);assert.equal(f.files.has('A.md'),false);assert.equal(f.files.get('B.md'),'[[新/A]]');assert.equal(f.files.get('新/A.md'),'[B](<../B.md>)');assert.equal((await f.engine.apply(f.plan)).replayed,true);assert.equal(f.renames,1);
 const restarted=new Relocation(f.io);await assert.rejects(restarted.undo(f.plan.id,hash('different preview')),/復原方案已變更/);assert.equal((await restarted.previewUndo(f.plan.id)).location,'after');assert.equal((await restarted.undo(f.plan.id,f.plan.digest)).status,'reverted');assert.equal((await restarted.undo(f.plan.id,f.plan.digest)).replayed,true);for(const [p,body] of initial)assert.equal(f.files.get(p),body);assert.equal(f.files.has('新/A.md'),false);await assert.rejects(restarted.apply(f.plan),/已撤回/);
});
test('partial writes require explicit reconciliation before retry and do not rename or execute twice',async()=>{
 const f=fixture();f.failWrite='B.md';assert.equal((await f.engine.apply(f.plan)).status,'unknown');assert.equal(f.files.get('新/A.md'),'[B](<../B.md>)');assert.equal(f.files.get('B.md'),'[[A]]');await assert.rejects(f.engine.apply(f.plan),/結果未知/);await assert.rejects(f.engine.reconcile(f.plan.id),/確認其他視窗/);
 f.failWrite=null;assert.equal((await f.engine.reconcile(f.plan.id,true)).status,'partial');assert.equal((await new Relocation(f.io).apply(f.plan)).status,'applied');assert.equal(f.renames,1);assert.equal((await f.engine.undo(f.plan.id,f.plan.digest)).status,'reverted');
});
test('crashes after a completed rename or undo rename are recovered from observed files rather than guessed from the last saved flag',async()=>{
 const f=fixture();f.throwAfterRename=true;assert.equal((await f.engine.apply(f.plan)).status,'unknown');assert.equal((await f.engine.load(f.plan.id)).moved,false);assert.equal((await f.engine.inspect(f.plan.id)).location,'after');assert.equal((await new Relocation(f.io).reconcile(f.plan.id,true)).status,'partial');assert.equal((await f.engine.apply(f.plan)).status,'applied');assert.equal(f.renames,1);
 f.throwAfterRename=true;assert.equal((await f.engine.undo(f.plan.id,f.plan.digest)).status,'unknown');assert.equal((await f.engine.inspect(f.plan.id)).location,'before');assert.equal((await new Relocation(f.io).reconcile(f.plan.id,true)).status,'reverted');assert.equal(f.files.get('B.md'),'[[A]]');assert.equal(f.files.get('A.md'),'[B](B.md)');assert.equal(f.renames,2);
});
test('stale snapshots, newly created files, altered previews and post-apply human edits never get overwritten',async()=>{
 const f=fixture();f.files.set('C.md','changed');await assert.rejects(f.engine.apply(f.plan),/版本已變更/);assert.equal(f.renames,0);assert.equal(f.files.size,3);f.files.set('C.md','unchanged');f.files.set('new.md','new reference');await assert.rejects(f.engine.apply(f.plan),/檔案清單已變更/);f.files.delete('new.md');
 const forged=structuredClone(f.plan);forged.changes[0].after='arbitrary rewrite';const {digest,...body}=forged;forged.digest=hash(JSON.stringify(body));await assert.rejects(f.engine.apply(forged),/不得任意改寫/);assert.equal(f.renames,0);
 await f.engine.apply(f.plan);f.files.set('B.md','人後來的內容');await assert.rejects(f.engine.previewUndo(f.plan.id),/保留目前內容/);await assert.rejects(f.engine.undo(f.plan.id,f.plan.digest),/保留目前內容/);assert.equal(f.files.get('B.md'),'人後來的內容');assert.equal(f.files.has('新/A.md'),true);
});

test('changes outside the link bundle during execution leave an unknown result and become a preserved conflict',async()=>{
 const f=fixture(),rename=f.io.rename;f.io.rename=async(...args)=>{await rename(...args);f.files.set('C.md','同時編輯的原文');};
 assert.equal((await f.engine.apply(f.plan)).status,'unknown');assert.equal(f.files.get('C.md'),'同時編輯的原文');assert.equal((await f.engine.reconcile(f.plan.id,true)).status,'conflict');await assert.rejects(f.engine.apply(f.plan),/結果未知/);await assert.rejects(f.engine.undo(f.plan.id,f.plan.digest),/結果未知/);assert.equal(f.files.get('C.md'),'同時編輯的原文');
 const blocked=fixture();blocked.plan.indexCoverage='BLOCKED';const {digest,...body}=blocked.plan;blocked.plan.digest=hash(JSON.stringify(body));await assert.rejects(blocked.engine.apply(blocked.plan),/核對未通過/);assert.equal(blocked.renames,0);
});

test('relocation survives a fresh journal reader on an isolated real filesystem with Unicode paths',async t=>{
 const fs=await import('node:fs/promises'),path=await import('node:path'),os=await import('node:os');const root=await fs.mkdtemp(path.join(os.tmpdir(),'mentor-relocation-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const disk=name=>path.join(root,...name.split('/'));
 const list=async(prefix='')=>{const found=[];for(const entry of await fs.readdir(disk(prefix),{withFileTypes:true})){const name=prefix?prefix+'/'+entry.name:entry.name;if(entry.isDirectory())found.push(...await list(name));else found.push(name);}return found;};
 const read=async name=>{try{return await fs.readFile(disk(name),'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}};
 const write=async(name,text,flag='w')=>{await fs.mkdir(path.dirname(disk(name)),{recursive:true});await fs.writeFile(disk(name),text,{encoding:'utf8',flag});};
 await write('A.md','[B](B.md)');await write('B.md','[[A]]');const plan=compileRelocation([{path:'A.md',content:'[B](B.md)',references:[{start:0,end:9,original:'[B](B.md)',link:'B.md',target:'B.md'}]},{path:'B.md',content:'[[A]]',references:[{start:0,end:5,original:'[[A]]',link:'A',target:'A.md'}]}],'A.md','知識庫/新名字.md',await list());
 const io={read,listFiles:list,createJournal:(name,text)=>write(name,text,'wx'),writeJournal:(name,text)=>write(name,text),compareWrite:async(name,before,after)=>{assert.equal(await read(name),before);await write(name,after);},rename:async(from,to,expected)=>{assert.equal(await read(from),expected);assert.equal(await read(to),null);await fs.mkdir(path.dirname(disk(to)),{recursive:true});await fs.rename(disk(from),disk(to));assert.equal(await read(to),expected);}};
 assert.equal((await new Relocation(io).apply(plan)).status,'applied');assert.equal(await read('A.md'),null);assert.equal(await read('B.md'),'[[知識庫/新名字]]');assert.equal((await new Relocation(io).undo(plan.id,plan.digest)).status,'reverted');assert.equal(await read('A.md'),'[B](B.md)');assert.equal(await read('B.md'),'[[A]]');assert.equal(await read('知識庫/新名字.md'),null);
});
