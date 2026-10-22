/* MIT. Reversible, version-bound note writes; no AI calls and no arbitrary source moves. */
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path').posix;
const ROOT = 'Mentor 整理';
const HISTORY = ROOT + '/復原紀錄';
const hash = value => createHash('sha256').update(value).digest('hex');
function fail(code, message) { const error = new Error(message);error.code=code;throw error; }
function safeNote(name) {
  if (typeof name!=='string' || !name.endsWith('.md') || name.includes('\\') || name.startsWith('/') || name.includes('\0') || name.split('/').some(x=>!x||x==='..'||x==='.'||x.startsWith('.'))) fail('PATH_INVALID','筆記路徑需為筆記庫內的 Markdown，不可包含隱藏或上層目錄。');
  return name;
}
function managed(name) { safeNote(name);if(!name.startsWith(ROOT+'/')||name.startsWith(HISTORY+'/'))fail('OUTPUT_SCOPE','整理只可寫入「Mentor 整理」中的 Markdown。');return name; }
const TAG_BEGIN='<!-- mentor:tags:v1 -->', TAG_END='<!-- /mentor:tags -->';
function normalizeTags(tags) {
  if(!Array.isArray(tags)||!tags.length||tags.length>12)fail('TAGS_INVALID','請輸入 1～12 個標籤。');
  const clean=tags.map(tag=>typeof tag==='string'?tag.replace(/^#/,''):'');
  if(clean.some(tag=>tag.length>80||!tag.split('/').every(segment=>/^[\p{L}\p{N}_-]+$/u.test(segment))||!/[\p{L}_-]/u.test(tag)))fail('TAGS_INVALID','標籤使用文字、數字、底線或連字號，階層用 /；不可只有數字。');
  return [...new Set(clean)].sort();
}
function tagText(name,before,tags) {
  safeNote(name);
  if(name.startsWith(ROOT+'/')||name.split('/')[0].toLowerCase()==='core'||typeof before!=='string'||before.includes('awc:begin'))fail('TAG_SCOPE','只為一般來源筆記加標籤，不修改 Core、Mentor 任務或整理產出。');
  let body=before,existing=[];
  if(before.includes(TAG_BEGIN)||before.includes(TAG_END)){
    const start=before.indexOf(TAG_BEGIN),end=before.indexOf(TAG_END);
    if(start<0||end<start||before.indexOf(TAG_BEGIN,start+1)>=0||before.indexOf(TAG_END,end+1)>=0||before.slice(end+TAG_END.length).trim())fail('TAG_BLOCK_CHANGED','分類區塊已被手動調整，請先人工整理，不自動覆寫。');
    const lines=before.slice(start+TAG_BEGIN.length,end);
    existing=normalizeTags(lines.trim().split(/\s+/));
    if(lines!=='\n'+existing.map(tag=>'#'+tag).join(' ')+'\n')fail('TAG_BLOCK_CHANGED','分類區塊包含非標籤內容，不自動覆寫。');
    body=before.slice(0,start);
  }
  // An unfinished code fence/comment would hide tags from Obsidian's index.
  let fence=null;for(const line of body.split(/\r?\n/)){const match=line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);if(match){if(!fence)fence={char:match[1][0],length:match[1].length};else if(match[1][0]===fence.char&&match[1].length>=fence.length&&!match[2].trim())fence=null;}}
  const lines=body.split(/\r?\n/),frontmatterOpen=lines[0]==='---'&&!lines.slice(1).some(line=>line==='---'||line==='...');
  if(fence||frontmatterOpen||((body.match(/%%/g)||[]).length%2)||body.lastIndexOf('<!--')>body.lastIndexOf('-->'))fail('TAG_CONTEXT','筆記有尚未結束的 Properties、程式區塊或註解，請先修正再加標籤。');
  const merged=normalizeTags([...new Set([...existing,...normalizeTags(tags)])]);
  return body+(body.endsWith('\n\n')||!body?'':body.endsWith('\n')?'\n':'\n\n')+TAG_BEGIN+'\n'+merged.map(tag=>'#'+tag).join(' ')+'\n'+TAG_END+'\n';
}
function fingerprint(plan) { const {digest,...body}=plan;return hash(JSON.stringify(body)); }
function validatePlan(plan) {
  if(!plan||![1,2].includes(plan.version)||!/^[a-f0-9-]{36}$/.test(plan.id)||plan.digest!==fingerprint(plan))fail('PLAN_CHANGED','方案內容已改變，請重新產生預覽。');
  if(!Array.isArray(plan.sources)||!Array.isArray(plan.operations)||!plan.operations.length||plan.operations.length>40||plan.sources.length>40)fail('PLAN_INVALID','方案數量不正確。');
  const seen=new Set();
  for(const source of plan.sources){safeNote(source.path);if(seen.has(source.path))fail('SOURCE_DUPLICATE','來源重複。');seen.add(source.path);}
  const targets=new Set(),operationIds=new Set();for(const op of plan.operations){if(typeof op.id!=='string'||!/^op-[0-9]+$/.test(op.id)||operationIds.has(op.id))fail('PLAN_INVALID','操作識別重複或不正確。');operationIds.add(op.id);if(plan.version===2){if(plan.kind!=='tags'||op.after!==tagText(op.path,op.before,op.tags))fail('PLAN_INVALID','標籤方案只能新增你預覽的分類區塊。');}else managed(op.path);if(seen.has(op.path)||targets.has(op.path))fail('OUTPUT_OVERLAP','來源與產出不可重疊，產出也不可重複。');targets.add(op.path);if(typeof op.after!=='string'||op.after.length>200000||!(op.before===null||typeof op.before==='string'))fail('PLAN_INVALID','產出內容不正確。');}
}
const markdownLabel = value => value.replace(/[\[\]\\]/g,'\\$&').replace(/[\r\n]/g,' ');
function indexText(title, sources, target) {
  return `---\ntype: mentor-index\n---\n# ${title.replace(/[\r\n]/g,' ')}\n\n> 依已選筆記的檔名預寫的索引，不是 AI 摘要；原文仍保留在原位置。\n\n## 筆記索引\n\n${sources.map(s=>`- [${markdownLabel(path.basename(s.path,'.md'))}](<${path.relative(path.dirname(target),s.path).split('/').map(segment=>encodeURIComponent(segment)).join('/')}>)`).join('\n')}\n\n## 接下來可以做什麼\n選取需要理解的內容，再用「從目前筆記或選取內容準備任務」交給 AI。索引本身不會啟動 AI 或改變任務狀態。\n`;
}

class Organization {
  constructor(adapter) { this.io=adapter;this.queue=Promise.resolve(); }
  serial(run) { const job=this.queue.then(run);this.queue=job.catch(()=>{});return job; }
  async previewIndex(paths,title='筆記索引',target=ROOT+'/筆記索引.md') {
    if(!Array.isArray(paths)||!paths.length||paths.length>40)fail('SOURCE_LIMIT','請選 1～40 份筆記，超過時先縮小資料夾範圍。');
    target=managed(target);const sources=[];
    for(const name of [...new Set(paths)].sort()){safeNote(name);if(name.startsWith(ROOT+'/'))fail('SOURCE_SCOPE','整理資料夾不作為自己的來源。');const content=await this.io.read(name);if(content===null)fail('SOURCE_MISSING','來源已不存在：'+name);sources.push({path:name,hash:hash(content)});}
    return this.previewWrites(sources,[{path:target,after:indexText(title,sources,target)}],'建立筆記索引');
  }
  async previewTags(paths,tags) {
    tags=normalizeTags(tags);
    if(!Array.isArray(paths)||!paths.length||paths.length>40)fail('SOURCE_LIMIT','請選 1～40 份筆記。');
    const operations=[];for(const name of [...new Set(paths)].sort()){
      safeNote(name);const before=await this.io.read(name);if(before===null)fail('SOURCE_MISSING','來源已不存在：'+name);
      const after=tagText(name,before,tags);if(after!==before)operations.push({id:'op-'+operations.length,path:name,before,after,tags});
    }
    if(!operations.length)fail('NO_CHANGES','已選筆記已有這些分類標籤，不需重複套用。');
    const plan={version:2,kind:'tags',id:randomUUID(),label:'加上分類標籤',createdAt:new Date().toISOString(),sources:[],operations};plan.digest=fingerprint(plan);validatePlan(plan);return plan;
  }
  async previewWrites(sources, outputs, label='保存整理內容') {
    if(!Array.isArray(outputs)||!outputs.length||outputs.length>40)fail('OUTPUT_LIMIT','一次最多準備 40 份產出。');
    const operations=[];for(const output of outputs){managed(output.path);operations.push({id:'op-'+operations.length,path:output.path,before:await this.io.read(output.path),after:output.after});}
    const plan={version:1,id:randomUUID(),label,createdAt:new Date().toISOString(),sources,operations};plan.digest=fingerprint(plan);validatePlan(plan);return plan;
  }
  journalPath(id) { if(!/^[a-f0-9-]{36}$/.test(id))fail('ID_INVALID','整理識別不正確。');return `${HISTORY}/${id}.json`; }
  async load(id) { const raw=await this.io.read(this.journalPath(id));if(raw===null)return null;let log;try{log=JSON.parse(raw);}catch{fail('JOURNAL_INVALID','復原紀錄無法讀取，停止自動操作。');}validatePlan(log.plan);if(log.plan.id!==id||!Array.isArray(log.steps))fail('JOURNAL_INVALID','復原紀錄不完整。');return log; }
  async save(log) { await this.io.writeJournal(this.journalPath(log.plan.id),JSON.stringify(log,null,2)); }
  async verifySources(plan) { for(const source of plan.sources){const now=await this.io.read(source.path);if(now===null||hash(now)!==source.hash)fail('SOURCE_STALE','來源已改變，請重新預覽：'+source.path);} }
  async apply(plan, ids=plan.operations.map(o=>o.id)) { return this.serial(async()=>{
    validatePlan(plan);const selected=[...new Set(ids)].sort();if(!selected.length||selected.some(id=>!plan.operations.some(op=>op.id===id)))fail('SELECTION_INVALID','請選擇方案中的產出。');
    let log=await this.load(plan.id);
    if(log){if(log.plan.digest!==plan.digest||JSON.stringify(log.selected)!==JSON.stringify(selected))fail('PLAN_REUSED','同一方案不能套用不同選擇，請重新預覽。');if(log.status==='applied')return {...log,replayed:true};if(!['partial','prepared'].includes(log.status))fail('RECOVERY_REQUIRED','這次操作已撤回或結果未知，請先檢查復原紀錄，不自動重跑。');}
    await this.verifySources(plan);
    const ops=plan.operations.filter(op=>selected.includes(op.id));
    if(!log){
      for(const op of ops){const now=await this.io.read(op.path);if(now!==op.before)fail('TARGET_STALE','目標已改變，請重新預覽：'+op.path);}
      log={version:1,plan,selected,status:'prepared',steps:ops.map(op=>({id:op.id,status:'pending'})),updatedAt:new Date().toISOString()};
      await this.io.createJournal(this.journalPath(plan.id),JSON.stringify(log,null,2));
    }
    log.status='applying';await this.save(log);
    try{
      for(const step of log.steps){
        const op=ops.find(o=>o.id===step.id),now=await this.io.read(op.path);
        if(step.status==='applied'){if(now!==op.after)fail('TARGET_CONFLICT','已套用的內容又被修改，停止重跑：'+op.path);continue;}
        if(now===op.after){step.status='applied';step.recovered=true;await this.save(log);continue;}
        await this.io.compareWrite(op.path,op.before,op.after);step.status='applied';await this.save(log);
      }
      log.status='applied';log.error=null;
    }catch(error){log.status='partial';log.error=error.message;}
    log.updatedAt=new Date().toISOString();await this.save(log);return log;
  }); }
  async reconcile(id) { return this.serial(async()=>{
    const inspected=await this.inspect(id);
    if(!['applying','reverting'].includes(inspected.status))return inspected;
    const log=await this.load(id);
    for(const step of log.steps){const actual=inspected.files.find(f=>f.id===step.id);step.status=actual.state==='matches-after'?'applied':actual.state==='matches-before'?'pending':'conflict';}
    log.status=inspected.status==='reverting'?'undo-partial':inspected.files.every(f=>f.state==='matches-after')?'applied':'partial';
    log.reconciledAt=new Date().toISOString();await this.save(log);return {...log,files:inspected.files};
  }); }
  async inspect(id) {
    const log=await this.load(id);if(!log)fail('JOURNAL_MISSING','找不到復原紀錄。');
    const files=[];for(const step of log.steps){const op=log.plan.operations.find(o=>o.id===step.id);if(!op)fail('JOURNAL_INVALID','操作紀錄缺少產出。');const current=await this.io.read(op.path);files.push({id:op.id,path:op.path,state:current===op.after?'matches-after':current===op.before?'matches-before':'conflict'});}
    return {...log,files};
  }
  async undo(id) { return this.serial(async()=>{
    const log=await this.load(id);if(!log)fail('JOURNAL_MISSING','找不到復原紀錄。');
    if(['applying','reverting'].includes(log.status))fail('RECOVERY_REQUIRED','操作可能尚在執行，請確認停止後再檢查結果。');
    if(log.status==='reverted')return {...log,replayed:true};
    const conflicts=[];log.status='reverting';await this.save(log);
    for(const step of [...log.steps].reverse()){
      const op=log.plan.operations.find(o=>o.id===step.id);if(!op)fail('JOURNAL_INVALID','操作紀錄缺少產出。');
      try{
        const current=await this.io.read(op.path);
        if(current===op.before){step.status='reverted';await this.save(log);continue;}
        if(current!==op.after)fail('UNDO_CONFLICT','套用後有人修改，保留目前內容：'+op.path);
        await this.io.compareWrite(op.path,op.after,op.before);step.status='reverted';await this.save(log);
      }catch(error){conflicts.push({path:op.path,error:error.message});}
    }
    log.status=conflicts.length?'undo-partial':'reverted';log.conflicts=conflicts;log.updatedAt=new Date().toISOString();await this.save(log);return log;
  }); }
}
module.exports={Organization,ROOT,HISTORY,hash,safeNote,validatePlan};
