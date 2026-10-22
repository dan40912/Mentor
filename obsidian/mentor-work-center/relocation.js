/* MIT. Read-only relocation compiler. No filesystem writes or model calls. */
const path=require('node:path').posix;
const {randomUUID}=require('node:crypto');
const {hash,safeNote,ROOT,HISTORY}=require('./organization');
const {noteCoverage,scanReferences}=require('./reference-coverage');
const key=value=>value.normalize('NFC').toLowerCase();
const protectedNote=name=>name.startsWith(ROOT+'/')||name.split('/')[0].toLowerCase()==='core';
function fail(message){throw new Error(message);}
function referencePath(name){
 if(typeof name!=='string'||name.startsWith('/')||name.includes('\\')||/[\x00-\x1f]/.test(name)||name.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.')))fail('連結目的地不是可核對的筆記庫路徑。');
 return name;
}
function replacement(ref,from,to,movingNote){
 const fragment=ref.link.includes('#')?ref.link.slice(ref.link.indexOf('#')):'';
 if(ref.link.startsWith('#')&&movingNote)return ref.original;
 const target=ref.target===from?to:referencePath(ref.target);
 const wiki=ref.original.match(/^(!?)\[\[([^|\]\n]+)(\|[^\]\n]*)?\]\]$/);
 if(wiki){
  if(/[\[\]#|^\r\n]/.test(target))fail('Wiki 連結的目的地含無法安全表示的字元。');
  return wiki[1]+'[['+target.replace(/\.md$/,'')+fragment+(wiki[3]||'')+']]';
 }
 const markdown=ref.original.match(/^(!?)\[([^\]\n]*)\]\((<[^>\n]*>|[^\s()]+)\)$/);
 if(markdown){
  const source=movingNote?to:ref.source;
  const relative=path.relative(path.dirname(source),target).split('/').map(encodeURIComponent).join('/');
  return markdown[1]+'['+markdown[2]+'](<'+relative+fragment+'>)';
 }
 fail('連結格式尚未支援，不能猜測改寫：'+ref.original);
}
function compileRelocation(notes,from,to,allPaths=notes.map(n=>n.path)){
 safeNote(from);safeNote(to);referencePath(from);referencePath(to);
 if(from===to||key(from)===key(to))fail('來源與目標相同，或只有大小寫／Unicode 表示差異。');
 if(protectedNote(from)||protectedNote(to))fail('不搬移 Core 或 Mentor 整理中的檔案。');
 if(!Array.isArray(notes)||!notes.length||notes.length>200)fail('本次需完整核對 1～200 份 Markdown，不能只掃描部分筆記。');
 if(!Array.isArray(allPaths)||allPaths.some(p=>key(p)===key(to)||key(to).startsWith(key(p)+'/')))fail('目標位置已存在檔案或資料夾。');
 const names=new Set(),source=notes.find(n=>n.path===from);if(!source)fail('找不到來源筆記。');
 const fromName=key(path.basename(from)),toName=key(path.basename(to));
 if(notes.some(n=>n.path!==from&&(key(path.basename(n.path))===fromName||key(path.basename(n.path))===toName)))fail('來源或目標檔名在其他資料夾有同名筆記，需先人工消除連結歧義。');
 const blockers=[],changes=[],sources=[];let referenceCount=0,scannedReferences=0;
 for(const name of allPaths)if(/\.(?:canvas|base|html?|mdx|svg|jsonl?|ya?ml|txt|csv|tsv|[cm]?js|css|toml|xml|excalidraw)$/i.test(name)&&!new RegExp('^'+ROOT+'/復原紀錄/(?:relocation-)?[a-f0-9-]{36}\\.json$').test(name))blockers.push({path:name,reason:'此檔案類型可能包含參照，尚未支援完整核對。'});
 for(const note of notes){
  safeNote(note.path);referencePath(note.path);if(names.has(key(note.path)))fail('掃描清單有重複或大小寫衝突。');names.add(key(note.path));
  if(typeof note.content!=='string'||note.content.length>200000)fail('筆記內容不正確或超過 200,000 字。');
  sources.push({path:note.path,hash:hash(note.content)});
  const coverage=noteCoverage(note);scannedReferences+=coverage.references.length;
  referenceCount+=Array.isArray(note.references)?note.references.length:0;if(referenceCount>10000)fail('連結超過 10,000 筆，不能忽略剩餘連結。');
  if(!coverage.verified){for(const reason of coverage.blockers)blockers.push({path:note.path,reason});continue;}
  const replacements=[];let previousEnd=-1;
  for(const ref of [...note.references].sort((a,b)=>a.start-b.start)){
   if(!Number.isSafeInteger(ref.start)||!Number.isSafeInteger(ref.end)||ref.start<previousEnd||ref.start<0||ref.end<=ref.start||ref.end>note.content.length||typeof ref.original!=='string'||typeof ref.link!=='string'||note.content.slice(ref.start,ref.end)!==ref.original){blockers.push({path:note.path,reason:'連結索引位置與原文不一致，請等待重新索引。'});continue;}
   previousEnd=ref.end;
   const movingNote=note.path===from;
   if(!ref.target){
    if(movingNote&&!/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref.link))blockers.push({path:note.path,reason:'來源有無法解析的內部連結：'+ref.original});
    continue;
   }
   if(ref.target!==from&&!movingNote)continue;
   if(protectedNote(note.path)||note.content.includes('awc:begin')){blockers.push({path:note.path,reason:'連結更新會修改 Core、Mentor 任務或整理產出，需先人工處理。'});continue;}
   try{const after=replacement({...ref,source:note.path},from,to,movingNote);if(after!==ref.original)replacements.push({start:ref.start,end:ref.end,before:ref.original,after,targetBefore:ref.target,targetAfter:ref.target===from?to:ref.target});}
   catch(error){blockers.push({path:note.path,reason:error.message});}
  }
  let after=note.content;for(const item of [...replacements].reverse())after=after.slice(0,item.start)+item.after+after.slice(item.end);
  if(note.path===from||after!==note.content)changes.push({path:note.path,targetPath:note.path===from?to:note.path,before:note.content,after,replacements});
 }
 if(allPaths.filter(name=>/\.md$/i.test(name)).some(name=>!names.has(key(name)))||notes.some(note=>!allPaths.includes(note.path)))fail('未完整提供筆記庫 Markdown 清單，不能核對部分來源。');
 if(source.content.includes('awc:begin'))blockers.push({path:from,reason:'Mentor 任務正本不可搬移。'});
 const plan={version:1,kind:'relocation-preview',id:randomUUID(),createdAt:new Date().toISOString(),from,to,sources,files:[...allPaths].sort(),changes,blockers,referenceCount,scannedReferences,indexCoverage:blockers.length?'BLOCKED':'VERIFIED_SUPPORTED_MARKDOWN',application:blockers.length?'BLOCKED':'REQUIRES_CONFIRMATION'};
 plan.digest=hash(JSON.stringify(plan));return plan;
}

const fingerprint=plan=>{const {digest,...body}=plan;return hash(JSON.stringify(body));};
function validateRelocation(plan){
 if(!plan||plan.version!==1||plan.kind!=='relocation-preview'||!/^[a-f0-9-]{36}$/.test(plan.id)||plan.digest!==fingerprint(plan))fail('搬移方案已變更，請重新預覽。');
 if(plan.indexCoverage!=='VERIFIED_SUPPORTED_MARKDOWN'||plan.application!=='REQUIRES_CONFIRMATION'||!Array.isArray(plan.blockers)||plan.blockers.length)fail('搬移核對未通過，不可套用。');
 safeNote(plan.from);safeNote(plan.to);referencePath(plan.from);referencePath(plan.to);
 if(protectedNote(plan.from)||protectedNote(plan.to)||key(plan.from)===key(plan.to))fail('搬移範圍不正確。');
 if(!Array.isArray(plan.files)||!Array.isArray(plan.sources)||!plan.sources.length||plan.sources.length>200||!Array.isArray(plan.changes)||!plan.changes.length||plan.changes.length>plan.sources.length)fail('搬移檔案清單不完整。');
 if(plan.files.some(p=>typeof p!=='string')||!plan.files.includes(plan.from)||plan.files.some(p=>key(p)===key(plan.to)||key(plan.to).startsWith(key(p)+'/')))fail('搬移檔案清單或目標不正確。');
 const sources=new Map();for(const source of plan.sources){safeNote(source.path);if(sources.has(source.path)||!/^[a-f0-9]{64}$/.test(source.hash))fail('來源版本格式不正確。');sources.set(source.path,source.hash);}
 if(plan.files.filter(p=>/\.md$/i.test(p)).some(p=>!sources.has(p))||[...sources.keys()].some(p=>!plan.files.includes(p)))fail('搬移未涵蓋完整 Markdown 清單。');
 const changed=new Set();for(const change of plan.changes){
  safeNote(change.path);if(changed.has(change.path)||protectedNote(change.path)||change.targetPath!==(change.path===plan.from?plan.to:change.path)||typeof change.before!=='string'||change.before.includes('awc:begin')||typeof change.after!=='string'||change.after.length>200000||sources.get(change.path)!==hash(change.before)||!Array.isArray(change.replacements))fail('搬移變更超出預覽範圍。');changed.add(change.path);
  const scanned=scanReferences(change.before);if(scanned.blockers.length)fail('搬移變更包含未支援語法。');
  let previous=-1;for(const item of change.replacements){
   const ref=scanned.references.find(r=>r.start===item.start&&r.end===item.end&&r.original===item.before);
   if(!ref||item.start<previous||!plan.files.includes(item.targetBefore)||item.targetAfter!==(item.targetBefore===plan.from?plan.to:item.targetBefore)||change.path!==plan.from&&item.targetBefore!==plan.from||item.after!==replacement({...ref,target:item.targetBefore,source:change.path},plan.from,plan.to,change.path===plan.from))fail('連結變更與預覽不一致。');previous=item.end;
  }
  let after=change.before;for(const item of [...change.replacements].reverse())after=after.slice(0,item.start)+item.after+after.slice(item.end);if(after!==change.after)fail('搬移不得任意改寫筆記正文。');
 }
 if(!changed.has(plan.from))fail('搬移缺少來源內容。');return plan;
}
class Relocation {
 constructor(io,coordinator=null){this.io=io;this.queue=Promise.resolve();this.coordinator=coordinator;}
 serial(run){if(this.coordinator)return this.coordinator.serial(run);const job=this.queue.then(run);this.queue=job.catch(()=>{});return job;}
 journalPath(id){if(!/^[a-f0-9-]{36}$/.test(id))fail('搬移識別不正確。');return HISTORY+'/relocation-'+id+'.json';}
 async load(id){const raw=await this.io.read(this.journalPath(id));if(raw===null)return null;let log;try{log=JSON.parse(raw);}catch{fail('搬移日誌損壞，停止操作。');}validateRelocation(log.plan);if(log.type!=='mentor-relocation'||log.plan.id!==id||typeof log.moved!=='boolean'||!Array.isArray(log.steps)||log.steps.length!==log.plan.changes.length||log.steps.some((s,i)=>s.path!==log.plan.changes[i].path||!['before','after'].includes(s.state)))fail('搬移日誌不完整。');return log;}
 async save(log){log.updatedAt=new Date().toISOString();await this.io.writeJournal(this.journalPath(log.plan.id),JSON.stringify(log,null,2));}
 async verify(log){
  const {plan}=log,files=(await this.io.listFiles()).filter(p=>p!==this.journalPath(plan.id)).sort();
  const expected=plan.files.map(p=>log.moved&&p===plan.from?plan.to:p).sort();if(JSON.stringify(files)!==JSON.stringify(expected))fail('筆記庫檔案清單已變更，停止搬移／復原。');
  if(await this.io.read(log.moved?plan.from:plan.to)!==null)fail('來源與目標同時存在，停止操作。');
  for(const source of plan.sources){const change=plan.changes.find(c=>c.path===source.path),step=log.steps.find(s=>s.path===source.path),name=log.moved&&source.path===plan.from?plan.to:source.path;
   const current=await this.io.read(name),expectedHash=change&&step.state==='after'?hash(change.after):source.hash;if(current===null||hash(current)!==expectedHash)fail('筆記版本已變更，保留目前內容：'+name);
  }
 }
 async apply(input){const plan=JSON.parse(JSON.stringify(input));return this.serial(async()=>{
  validateRelocation(plan);let log=await this.load(plan.id);if(log){if(log.plan.digest!==plan.digest)fail('搬移識別已被另一份方案使用。');if(log.status==='applied')return {...log,replayed:true};if(!['prepared','partial'].includes(log.status)||log.intent==='undo')fail('搬移結果未知或已撤回，先檢查日誌，不盲目重跑。');}
  else log={type:'mentor-relocation',version:1,plan,status:'prepared',intent:'apply',moved:false,steps:plan.changes.map(c=>({path:c.path,state:'before'}))};
  await this.verify(log);if(!await this.load(plan.id))await this.io.createJournal(this.journalPath(plan.id),JSON.stringify(log,null,2));
  log.status='applying';await this.save(log);
  try{
   if(!log.moved){const source=plan.changes.find(c=>c.path===plan.from);await this.io.rename(plan.from,plan.to,source.before);log.moved=true;await this.save(log);}
   for(const step of log.steps){if(step.state==='after')continue;const change=plan.changes.find(c=>c.path===step.path);if(change.before!==change.after)await this.io.compareWrite(change.targetPath,change.before,change.after);step.state='after';await this.save(log);}
   await this.verify(log);log.status='applied';log.error=null;
  }catch(error){log.status='unknown';log.error=error.message;}
  await this.save(log);return log;
 });}
 async inspect(id){
  const log=await this.load(id);if(!log)fail('找不到搬移日誌。');const before=await this.io.read(log.plan.from),after=await this.io.read(log.plan.to);
  const location=before!==null&&after===null?'before':before===null&&after!==null?'after':'conflict';const files=[];
  for(const change of log.plan.changes){const name=change.path===log.plan.from?(location==='after'?log.plan.to:log.plan.from):change.path,current=await this.io.read(name);files.push({path:change.path,currentPath:name,state:current===change.before?'before':current===change.after?'after':'conflict'});}
  return {...log,location,files};
 }
 async reconcile(id,confirmedStopped=false){return this.serial(async()=>{
  if(confirmedStopped!==true)fail('請先確認其他視窗或裝置沒有繼續執行同一搬移。');
  const inspected=await this.inspect(id),log=await this.load(id);if(!['unknown','applying','reverting'].includes(log.status))return inspected;
  if(inspected.location==='conflict'||inspected.files.some(f=>f.state==='conflict')){log.status='conflict';log.error='檔案不符合預覽前後版本，保留目前內容。';}
  else{
   log.moved=inspected.location==='after';log.steps=inspected.files.map(f=>({path:f.path,state:f.state}));
   try{await this.verify(log);log.status=log.intent==='undo'?(!log.moved&&log.steps.every(s=>s.state==='before')?'reverted':'undo-partial'):(log.moved&&log.steps.every(s=>s.state==='after')?'applied':'partial');log.error=null;}
   catch(error){log.status='conflict';log.error=error.message;}
  }
  await this.save(log);return {...log,files:inspected.files};
 });}
 async previewUndo(id){const log=await this.load(id);if(!log)fail('找不到搬移日誌。');if(!['applied','partial','undo-partial','reverted'].includes(log.status))fail('搬移結果未知，請先確認停止並核對。');await this.verify(log);return this.inspect(id);}
 async undo(id,expectedDigest){return this.serial(async()=>{
  const log=await this.load(id);if(!log)fail('找不到搬移日誌。');if(expectedDigest!==log.plan.digest)fail('復原方案已變更或尚未預覽，請重新核對。');if(log.status==='reverted')return {...log,replayed:true};if(!['applied','partial','undo-partial'].includes(log.status))fail('搬移結果未知，請先確認停止並核對。');
  await this.verify(log);log.status='reverting';log.intent='undo';await this.save(log);
  try{
   for(const step of [...log.steps].reverse()){if(step.state==='before')continue;const change=log.plan.changes.find(c=>c.path===step.path),name=log.moved&&change.path===log.plan.from?log.plan.to:change.path;if(change.after!==change.before)await this.io.compareWrite(name,change.after,change.before);step.state='before';await this.save(log);}
   if(log.moved){const source=log.plan.changes.find(c=>c.path===log.plan.from);await this.io.rename(log.plan.to,log.plan.from,source.before);log.moved=false;await this.save(log);}
   await this.verify(log);log.status='reverted';log.error=null;
  }catch(error){log.status='unknown';log.error=error.message;}
  await this.save(log);return log;
 });}
}
module.exports={compileRelocation,validateRelocation,Relocation};
