/* MIT. Read-only relocation compiler. No filesystem writes or model calls. */
const path=require('node:path').posix;
const {randomUUID}=require('node:crypto');
const {hash,safeNote,ROOT}=require('./organization');
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
 const blockers=[],changes=[],sources=[];let referenceCount=0;
 for(const note of notes){
  safeNote(note.path);referencePath(note.path);if(names.has(key(note.path)))fail('掃描清單有重複或大小寫衝突。');names.add(key(note.path));
  if(typeof note.content!=='string'||note.content.length>200000)fail('筆記內容不正確或超過 200,000 字。');
  sources.push({path:note.path,hash:hash(note.content)});
  if(!Array.isArray(note.references)){blockers.push({path:note.path,reason:'尚無可核對的連結索引。'});continue;}
  const replacements=[];let previousEnd=-1;
  for(const ref of [...note.references].sort((a,b)=>a.start-b.start)){
   if(++referenceCount>10000)fail('連結超過 10,000 筆，請先縮小整個示範庫範圍，不能忽略剩餘連結。');
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
 if(source.content.includes('awc:begin'))blockers.push({path:from,reason:'Mentor 任務正本不可搬移。'});
 const plan={version:1,kind:'relocation-preview',id:randomUUID(),createdAt:new Date().toISOString(),from,to,sources,changes,blockers,referenceCount,indexCoverage:'UNVERIFIED',application:'NOT_IMPLEMENTED'};
 plan.digest=hash(JSON.stringify(plan));return plan;
}
module.exports={compileRelocation};
