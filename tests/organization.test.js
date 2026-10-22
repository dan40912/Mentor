import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
// Plugin module is CommonJS inside an ESM repo, so compile it as the Obsidian host does.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const module={exports:{}};
vm.runInNewContext(await readFile(new URL('../obsidian/mentor-work-center/organization.js',import.meta.url),'utf8'),{module,require});
const {Organization,hash}=module.exports;
function fixture(){const files=new Map([['研究/第一篇.md','# A'],['研究/第二篇.md','# B']]);let failPath=null;
const io={read:async p=>files.get(p)??null,createJournal:async(p,text)=>{if(files.has(p))throw Error('journal exists');files.set(p,text);},writeJournal:async(p,text)=>files.set(p,text),compareWrite:async(p,before,after)=>{if(p===failPath)throw Error('磁碟寫入失敗');if((files.get(p)??null)!==before)throw Error('內容已變更');if(after===null)files.delete(p);else files.set(p,after);}};
return{files,io,engine:new Organization(io),set failPath(p){failPath=p;}};}
test('index preview does not write; source and target changes invalidate it; repeated apply and undo are idempotent',async()=>{
const f=fixture(),plan=await f.engine.previewIndex(['研究/第一篇.md','研究/第二篇.md']);assert.equal(f.files.size,2);assert.match(plan.operations[0].after,/第一篇/);
f.files.set('研究/第一篇.md','新版');await assert.rejects(f.engine.apply(plan),{code:'SOURCE_STALE'});f.files.set('研究/第一篇.md','# A');
f.files.set(plan.operations[0].path,'外部建立');await assert.rejects(f.engine.apply(plan),{code:'TARGET_STALE'});f.files.delete(plan.operations[0].path);
assert.equal((await f.engine.apply(plan)).status,'applied');assert.equal((await f.engine.apply(plan)).replayed,true);
assert.equal((await f.engine.undo(plan.id)).status,'reverted');assert.equal((await f.engine.undo(plan.id)).replayed,true);assert.equal(f.files.has(plan.operations[0].path),false);assert.equal(f.files.get('研究/第一篇.md'),'# A');
});
test('batch exclusions, partial failure and retry preserve exact preview; undo keeps later user edits',async()=>{
const f=fixture();const plan=await f.engine.previewWrites([{path:'研究/第一篇.md',hash:hash('# A')}],[{path:'Mentor 整理/A.md',after:'A'},{path:'Mentor 整理/B.md',after:'B'},{path:'Mentor 整理/C.md',after:'C'}]);
f.failPath='Mentor 整理/B.md';let log=await f.engine.apply(plan,['op-0','op-1']);assert.equal(log.status,'partial');assert.equal(f.files.has('Mentor 整理/C.md'),false);assert.equal(f.files.get('Mentor 整理/A.md'),'A');
f.failPath=null;log=await f.engine.apply(plan,['op-0','op-1']);assert.equal(log.status,'applied');await assert.rejects(f.engine.apply(plan,['op-2']),{code:'PLAN_REUSED'});
f.files.set('Mentor 整理/A.md','使用者加了內容');const undone=await f.engine.undo(plan.id);assert.equal(undone.status,'undo-partial');assert.equal(undone.conflicts.length,1);assert.equal(f.files.get('Mentor 整理/A.md'),'使用者加了內容');assert.equal(f.files.has('Mentor 整理/B.md'),false);
});
test('tampered plans, hidden paths, source overlap and unknown crash results never blindly overwrite',async()=>{
const f=fixture();const plan=await f.engine.previewIndex(['研究/第一篇.md']);const bad=JSON.parse(JSON.stringify(plan));bad.operations[0].after='改過的方案';await assert.rejects(f.engine.apply(bad),{code:'PLAN_CHANGED'});
await assert.rejects(f.engine.previewWrites([], [{path:'.obsidian/config.md',after:'x'}]),{code:'PATH_INVALID'});
await assert.rejects(f.engine.previewWrites([], [{path:'Mentor 整理/../escape.md',after:'x'}]),{code:'PATH_INVALID'});
await assert.rejects(f.engine.previewWrites([{path:'Mentor 整理/target.md',hash:'x'}],[{path:'Mentor 整理/target.md',after:'x'}]),{code:'OUTPUT_OVERLAP'});
await f.engine.apply(plan);const log=await f.engine.load(plan.id);log.status='applying';await f.engine.save(log);await assert.rejects(f.engine.apply(plan),{code:'RECOVERY_REQUIRED'});await assert.rejects(f.engine.undo(plan.id),{code:'RECOVERY_REQUIRED'});assert.equal((await f.engine.inspect(plan.id)).files[0].state,'matches-after');assert.equal((await f.engine.reconcile(plan.id)).status,'applied');assert.equal((await f.engine.undo(plan.id)).status,'reverted');
});
test('undo restores previous managed content rather than deleting an existing note',async()=>{
const f=fixture();f.files.set('Mentor 整理/筆記索引.md','舊索引');const plan=await f.engine.previewIndex(['研究/第一篇.md']);await f.engine.apply(plan);await f.engine.undo(plan.id);assert.equal(f.files.get('Mentor 整理/筆記索引.md'),'舊索引');
});

test('index links encode filename fragments and queries; interrupted undo requires reconciliation',async()=>{
const f=fixture();f.files.set('研究/問題 #1?.md','# note');const plan=await f.engine.previewIndex(['研究/問題 #1?.md']);assert.match(plan.operations[0].after,/%231%3F\.md/);await f.engine.apply(plan);let log=await f.engine.load(plan.id);log.status='reverting';await f.engine.save(log);await assert.rejects(f.engine.undo(plan.id),{code:'RECOVERY_REQUIRED'});await f.engine.reconcile(plan.id);assert.equal((await f.engine.undo(plan.id)).status,'reverted');
});

test('classification previews exact source additions, preserves Properties and body, excludes items and undoes byte for byte',async()=>{
 const f=fixture(),original='---\ntags: [原標籤]\n# preserve comments\n---\n# 原文\n\n[[研究/第二篇]]';f.files.set('研究/第一篇.md',original);
 const plan=await f.engine.previewTags(['研究/第一篇.md','研究/第二篇.md'],['#研究/閱讀','待核對']);
 assert.equal(f.files.get('研究/第一篇.md'),original,'preview does not write');assert.equal(plan.version,2);
 assert.ok(plan.operations[0].after.startsWith(original+'\n\n'));assert.match(plan.operations[0].after,/#待核對 #研究\/閱讀/);
 assert.equal((await f.engine.apply(plan,['op-0'])).status,'applied');assert.equal((await f.engine.apply(plan,['op-0'])).replayed,true);assert.equal(f.files.get('研究/第二篇.md'),'# B');
 await assert.rejects(f.engine.previewTags(['研究/第一篇.md'],['待核對']),{code:'NO_CHANGES'});
 const add=await f.engine.previewTags(['研究/第一篇.md'],['第三類']);await f.engine.apply(add);assert.equal((f.files.get('研究/第一篇.md').match(/mentor:tags:v1/g)||[]).length,1);
 await f.engine.undo(add.id);await f.engine.undo(plan.id);assert.equal(f.files.get('研究/第一篇.md'),original);
});
test('classification refuses protected notes, malformed metadata, hidden Markdown tags and arbitrary body rewrites',async()=>{
 const f=fixture();for(const [name,body,code] of [['Core/rules.md','# rules','TAG_SCOPE'],['core/rules.md','# rules','TAG_SCOPE'],['task.md','<!-- awc:begin -->','TAG_SCOPE'],['open.md','```js\ncode','TAG_CONTEXT'],['comment.md','<!-- unfinished','TAG_CONTEXT'],['properties.md','---\ntitle: unfinished','TAG_CONTEXT'],['obsidian-comment.md','%% unfinished','TAG_CONTEXT'],['edited.md','<!-- mentor:tags:v1 -->\n#one notes\n<!-- /mentor:tags -->\n','TAG_BLOCK_CHANGED']]){f.files.set(name,body);await assert.rejects(f.engine.previewTags([name],['研究']),{code});}
 for(const tag of ['123','has space','x//y','../escape','[link]','x\nnext'])await assert.rejects(f.engine.previewTags(['研究/第一篇.md'],[tag]),{code:'TAGS_INVALID'});
 const plan=await f.engine.previewTags(['研究/第一篇.md'],['研究']);plan.operations[0].after='任意改寫原文';const {digest,...body}=plan;plan.digest=hash(JSON.stringify(body));await assert.rejects(f.engine.apply(plan),{code:'PLAN_INVALID'});
 await assert.rejects(f.engine.previewWrites([],[{path:'研究/第一篇.md',after:'arbitrary'}]),{code:'OUTPUT_SCOPE'});
});
test('classification uses stale checks, partial retry and conflict-aware undo for original notes',async()=>{
 const f=fixture();const stale=await f.engine.previewTags(['研究/第一篇.md'],['研究']);f.files.set('研究/第一篇.md','new');await assert.rejects(f.engine.apply(stale),{code:'TARGET_STALE'});f.files.set('研究/第一篇.md','# A');
 const plan=await f.engine.previewTags(['研究/第一篇.md','研究/第二篇.md'],['研究']);f.failPath='研究/第二篇.md';assert.equal((await f.engine.apply(plan)).status,'partial');
 f.failPath=null;assert.equal((await f.engine.apply(plan)).status,'applied');f.files.set('研究/第一篇.md','人工新內容');assert.equal((await f.engine.undo(plan.id)).status,'undo-partial');assert.equal(f.files.get('研究/第一篇.md'),'人工新內容');assert.equal(f.files.get('研究/第二篇.md'),'# B');
});
