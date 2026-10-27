import {constants} from 'node:fs';
import {mkdir,mkdtemp,lstat,realpath,readdir,open,writeFile,readFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {renameReplace} from './platform.js';
import {TaskError,sha256} from './tasks.js';

const MAX_FILES=2000,MAX_BYTES=200*1024*1024,MAX_FILE=50*1024*1024;
const fail=message=>{throw new TaskError(409,'EXECUTION_WORKSPACE_UNSAFE',message);};
// This is a filesystem snapshot, not an OS sandbox or a cross-process lock.
async function snapshot(root){
 const canonical=await realpath(root);if(canonical!==path.resolve(root))fail('成果路徑已改變，未建立執行副本。');
 const files=[],directories=[];let total=0;
 async function walk(directory,prefix=''){
  const parent=await lstat(directory);if(parent.isSymbolicLink()||!parent.isDirectory())fail('成果資料夾不可使用連結。');
  if(directories.length>=4000)fail('成果超過 4,000 個資料夾上限。');directories.push({path:prefix,dev:parent.dev,ino:parent.ino});
  for(const entry of (await readdir(directory)).sort()){
   const full=path.join(directory,entry),relative=prefix?prefix+'/'+entry:entry,info=await lstat(full);
   if(info.isSymbolicLink())fail('執行副本不接受符號連結：'+relative);
   if(info.isDirectory()){await walk(full,relative);continue;}
   if(!info.isFile()||info.nlink!==1)fail('執行副本只接受沒有硬連結的一般檔案：'+relative);
   if(info.size>MAX_FILE||files.length>=MAX_FILES||total+info.size>MAX_BYTES)fail('成果超過執行副本上限（2,000 檔／單檔 50 MB／合計 200 MB）。');
   const handle=await open(full,constants.O_RDONLY|(constants.O_NOFOLLOW||0));let bytes;
   try{const before=await handle.stat();if(before.dev!==info.dev||before.ino!==info.ino||before.nlink!==1)fail('讀取時檔案已變更：'+relative);bytes=await handle.readFile();const after=await handle.stat();if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||bytes.length!==before.size)fail('讀取時內容已變更：'+relative);}finally{await handle.close();}
   total+=bytes.length;if(total>MAX_BYTES)fail('成果超過執行副本合計上限。');files.push({path:relative,sha256:sha256(bytes),mode:info.mode&0o777,bytes});
  }
  const after=await lstat(directory);if(after.isSymbolicLink()||after.dev!==parent.dev||after.ino!==parent.ino)fail('讀取時資料夾已變更。');
 }
 await walk(canonical);return {files,directories};
}
const fingerprint=s=>JSON.stringify({files:s.files.map(({path,sha256,mode})=>({path,sha256,mode})),directories:s.directories});
const index=s=>s.files.map(({path,sha256,bytes})=>({path,sha256,bytes:bytes.length}));
export async function prepareExecutionWorkspace(outputRoot,storageRoot,{taskId,turnId}){
 if(!/^TASK-[a-zA-Z0-9-]+$/.test(taskId)||!/^[a-f0-9-]{36}$/.test(turnId))fail('執行副本識別不正確。');
 const root=await realpath(outputRoot),storage=await realpath(storageRoot);
 if(root===storage||storage.startsWith(root+path.sep))fail('執行副本必須保存於成果目錄之外。');
 const before=await snapshot(root),base=path.join(storage,'execution-workspaces');
 try{await mkdir(base,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 const baseInfo=await lstat(base);if(baseInfo.isSymbolicLink()||!baseInfo.isDirectory())fail('執行副本保存位置不正確。');
 const directory=await mkdtemp(path.join(base,'run-')),candidate=path.join(directory,'candidate'),original=path.join(directory,'baseline');await mkdir(candidate);await mkdir(original);
 for(const target of [candidate,original]){for(const entry of before.directories.filter(d=>d.path))await mkdir(path.join(target,...entry.path.split('/')),{recursive:true});for(const file of before.files)await writeFile(path.join(target,...file.path.split('/')),file.bytes,{flag:'wx',mode:file.mode});}
 const manifest={schema:1,taskId,turnId,outputRoot:root,status:'prepared',createdAt:new Date().toISOString(),files:index(before),baselineFingerprint:fingerprint(before)};
 if(fingerprint(before)!==fingerprint(await snapshot(root)))fail('建立副本期間成果已變更，未啟動 AI。');
 await writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
 return {directory,candidate,original,manifest,baselineFingerprint:fingerprint(before)};
}
export async function inspectExecutionWorkspace(workspace){
 const current=await snapshot(workspace.manifest.outputRoot),candidate=await snapshot(workspace.candidate);
 const base=new Map(workspace.manifest.files.map(f=>[f.path,f])),next=new Map(candidate.files.map(f=>[f.path,f]));
 const changes=[...new Set([...base.keys(),...next.keys()])].sort().filter(file=>base.get(file)?.sha256!==next.get(file)?.sha256).map(file=>({path:file,beforeSha256:base.get(file)?.sha256||null,afterSha256:next.get(file)?.sha256||null,action:!next.has(file)?'delete':base.has(file)?'modify':'create'}));
 return {conflict:fingerprint(current)!==workspace.baselineFingerprint,changes,candidate:workspace.candidate,original:workspace.original};
}


async function journal(workspace,fields){
 const next={...workspace.manifest,...fields},temporary=path.join(workspace.directory,'manifest.pending.json');
 await writeFile(temporary,JSON.stringify(next,null,2),{mode:0o600});
 await renameReplace(temporary,path.join(workspace.directory,'manifest.json'));workspace.manifest=next;
}
const contentFingerprint=tree=>JSON.stringify({files:tree.files.map(({path,sha256,mode})=>({path,sha256,mode})),directories:tree.directories.map(d=>d.path)});
// Publish a complete tree, retaining the actual displaced tree (including open-file edits).
// Two directory renames are not a single atomic transaction: interrupted publication needs reconciliation.
export async function publishExecutionWorkspace(workspace,{checkpoint=async()=>{}}={}){
 if(workspace.manifest.status!=='prepared')fail('此副本已發布、衝突或結果未知，不可直接重試。');
 const inspection=await inspectExecutionWorkspace(workspace);
 if(inspection.conflict){await journal(workspace,{status:'conflict',changes:inspection.changes});throw new TaskError(409,'EXECUTION_OUTPUT_CONFLICT','原成果已被修改；保留原成果與 AI 副本，未發布。');}
 const candidate=await snapshot(workspace.candidate),root=workspace.manifest.outputRoot;
 const publicationDirectory=await mkdtemp(path.join(path.dirname(root),'.mentor-publication-')),incoming=path.join(publicationDirectory,'incoming'),displaced=path.join(publicationDirectory,'original');
 await mkdir(incoming,{mode:0o700});
 for(const entry of candidate.directories.filter(d=>d.path))await mkdir(path.join(incoming,...entry.path.split('/')),{recursive:true});
 for(const file of candidate.files)await writeFile(path.join(incoming,...file.path.split('/')),file.bytes,{flag:'wx',mode:file.mode});
 if(contentFingerprint(candidate)!==contentFingerprint(await snapshot(workspace.candidate)))fail('準備發布時 AI 副本已變更，未修改原成果。');
 await journal(workspace,{status:'publishing',changes:inspection.changes,publicationDirectory,incoming,displaced,candidateFingerprint:contentFingerprint(candidate)});
 try{
  await checkpoint('before-original-move');
  if(fingerprint(await snapshot(root))!==workspace.baselineFingerprint)throw new TaskError(409,'EXECUTION_OUTPUT_CONFLICT','發布前原成果已變更，未替換。');
  await rename(root,displaced);
  await journal(workspace,{status:'original_moved'});await checkpoint('after-original-move');
  if(fingerprint(await snapshot(displaced))!==workspace.baselineFingerprint)throw new TaskError(409,'EXECUTION_OUTPUT_CONFLICT','原成果在搬移時變更；實際內容保留於 original，需核對後恢復。');
  // rename cannot replace a non-empty directory. Never clear a destination created by another process.
  try{await lstat(root);throw new TaskError(409,'EXECUTION_OUTPUT_CONFLICT','成果位置已被其他程序重新建立，保留雙方內容。');}catch(error){if(error.code!=='ENOENT')throw error;}
  await rename(incoming,root);await checkpoint('after-candidate-move');
  if(contentFingerprint(await snapshot(root))!==workspace.manifest.candidateFingerprint)throw new TaskError(409,'EXECUTION_OUTPUT_CONFLICT','發布後內容已變更，未標記成功。');
  await journal(workspace,{status:'published',publishedAt:new Date().toISOString()});
  return {status:'published',changes:inspection.changes,displaced,candidate:workspace.candidate};
 }catch(error){
  await journal(workspace,{status:'unknown',errorCode:error.code||'EXECUTION_PUBLICATION_INTERRUPTED',error:error.message});
  throw new TaskError(409,error.code==='EXECUTION_OUTPUT_CONFLICT'?error.code:'EXECUTION_PUBLICATION_UNKNOWN','發布未完成或結果未知；不自動重試。候選、原成果及紀錄保留於 '+workspace.directory+'；原成果備份：'+displaced);
 }
}


export async function loadExecutionWorkspace(directory,{storageRoot,outputRoot,taskId}){
 const storage=await realpath(storageRoot),base=path.join(storage,'execution-workspaces');
 if(path.dirname(directory)!==base||!/^run-[a-zA-Z0-9]+$/.test(path.basename(directory))||await realpath(directory)!==directory||await realpath(base)!==base)fail('執行副本路徑不正確。');
 const file=path.join(directory,'manifest.json'),info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>2*1024*1024)fail('執行副本紀錄不正確。');
 const manifest=JSON.parse(await readFile(file,'utf8')),root=path.join(await realpath(path.dirname(outputRoot)),path.basename(outputRoot));
 if(manifest.schema!==1||manifest.taskId!==taskId||manifest.outputRoot!==root||typeof manifest.baselineFingerprint!=='string')fail('執行副本不屬於目前任務與成果路徑。');
 if(manifest.publicationDirectory){
  const publication=manifest.publicationDirectory;
  if(path.dirname(publication)!==path.dirname(root)||!/^\.mentor-publication-[a-zA-Z0-9]+$/.test(path.basename(publication))||await realpath(publication)!==publication||manifest.incoming!==path.join(publication,'incoming')||manifest.displaced!==path.join(publication,'original'))fail('發布備份路徑不正確。');
 }
 return {directory,candidate:path.join(directory,'candidate'),original:path.join(directory,'baseline'),manifest,baselineFingerprint:manifest.baselineFingerprint};
}
export async function reconcileExecutionPublication(workspace,{choice,confirmed}){
 if(confirmed===true&&workspace.manifest.status==='reconciled'&&workspace.manifest.recoveryChoice===choice)return {status:'reconciled',choice,replayed:true};
 if(confirmed!==true||!['restore-original','keep-current'].includes(choice)||!['publishing','original_moved','unknown'].includes(workspace.manifest.status))fail('需明確核對未知發布，再選擇保留目前成果或恢復原成果。');
 const root=workspace.manifest.outputRoot;
 if(choice==='restore-original'){
  try{await lstat(root);fail('成果位置已有內容，不會覆蓋；請先核對保留目前成果。');}catch(error){if(error.code!=='ENOENT')throw error;}
  await snapshot(workspace.manifest.displaced);
  await rename(workspace.manifest.displaced,root);
 }else await snapshot(root);
 await journal(workspace,{status:'reconciled',reconciledAt:new Date().toISOString(),recoveryChoice:choice});
 return {status:'reconciled',choice,candidate:workspace.candidate,displaced:workspace.manifest.displaced};
}
