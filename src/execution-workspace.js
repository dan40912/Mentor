import {constants} from 'node:fs';
import {mkdir,mkdtemp,lstat,realpath,readdir,open,writeFile} from 'node:fs/promises';
import path from 'node:path';
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
const fingerprint=s=>JSON.stringify({files:s.files.map(({path,sha256})=>({path,sha256})),directories:s.directories});
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
 const manifest={schema:1,taskId,turnId,outputRoot:root,status:'prepared',createdAt:new Date().toISOString(),files:index(before)};
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
