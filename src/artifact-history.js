import {mkdir,lstat,open,realpath,writeFile,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {TaskError,sha256} from './tasks.js';
import {artifactPath,validateArtifactName} from './artifact-path.js';
const MAX_FILE=50_000_000,MAX_TOTAL=200_000_000,MAX_FILES=200;
const validId=id=>typeof id==='string'&&/^TASK-[a-zA-Z0-9-]+$/.test(id);
const validVersion=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
const fail=(code,message,status=409)=>{throw new TaskError(status,code,message);};
function name(file){validateArtifactName(file);if(file.includes(':')||/[\x00-\x1f]/.test(file)||file.split('/').some(p=>!p||p==='.'||p==='..'))fail('ARTIFACT_HISTORY_PATH','成果版本路徑不正確。',400);return file;}
async function readSafe(root,file,limit){
 const absolute=path.resolve(root),canonical=await realpath(absolute);if(canonical!==path.join(await realpath(path.dirname(absolute)),path.basename(absolute)))fail('ARTIFACT_HISTORY_PATH','成果資料夾不可替換為連結。');
 const resolved=await artifactPath(root,file),before=await lstat(resolved);if(before.isSymbolicLink()||!before.isFile()||before.size>limit)fail('ARTIFACT_HISTORY_LIMIT','成果不是一般檔案或超過版本保存上限。',413);
 const handle=await open(resolved,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{
  const first=await handle.stat();if(first.dev!==before.dev||first.ino!==before.ino||first.size>limit)fail('ARTIFACT_HISTORY_CHANGED','保存前成果路徑已改變。');
  const bytes=await handle.readFile(),last=await handle.stat(),current=await artifactPath(root,file),onPath=await lstat(current);
  if(bytes.length>limit||current!==resolved||onPath.isSymbolicLink()||onPath.dev!==first.dev||onPath.ino!==first.ino||last.size!==first.size||last.mtimeMs!==first.mtimeMs||last.ctimeMs!==first.ctimeMs)fail('ARTIFACT_HISTORY_CHANGED','讀取期間成果已改變，沒有把它當成穩定版本。');return bytes;
 }finally{await handle.close();}
}
export class ArtifactHistory {
 constructor(vault){this.vault=path.resolve(vault);}
 async taskDir(id,create=false){
  if(!validId(id))fail('ARTIFACT_HISTORY_ID','成果版本任務識別不正確。',400);
  const canonical=await realpath(this.vault),expected=path.join(await realpath(path.dirname(this.vault)),path.basename(this.vault));if(canonical!==expected)fail('ARTIFACT_HISTORY_PATH','任務資料夾已變更。');
  let current=canonical;for(const part of ['artifact-history',id]){current=path.join(current,part);let info;try{info=await lstat(current);}catch(error){if(error.code!=='ENOENT')throw error;if(!create)return null;try{await mkdir(current,{mode:0o700});}catch(createError){if(createError.code!=='EEXIST')throw createError;}info=await lstat(current);}if(info.isSymbolicLink()||!info.isDirectory())fail('ARTIFACT_HISTORY_PATH','成果版本資料夾不可使用連結或檔案。');}
  return current;
 }
 async capture(task,{turnId,phase,outputs}){
  if(!validVersion(turnId)||!['before','after'].includes(phase))fail('ARTIFACT_HISTORY_ID','成果版本回合識別不正確。',400);
  const normalized=(outputs||[]).map(output=>typeof output==='string'?{file:output,sha:null}:{file:output.file||output.path,sha:output.sha||null});
  const selected=[...new Map(normalized.map(o=>[name(o.file),o])).values()].sort((a,b)=>a.file<b.file?-1:a.file>b.file?1:0);if(!selected.length)return null;if(selected.length>MAX_FILES)fail('ARTIFACT_HISTORY_LIMIT','已登記成果超過 200 份，未啟動新的寫入。',413);
  const base=await this.taskDir(task.id,true),id=randomUUID(),directory=path.join(base,id);await mkdir(directory,{mode:0o700});let total=0;
  const manifest={schema:1,id,taskId:task.id,turnId,phase,revision:task.revision,createdAt:new Date().toISOString(),files:[]};
  try{
   for(const output of selected){
    const index=manifest.files.length;let bytes;
    try{bytes=await readSafe(task.allowedRoots[0],output.file,MAX_FILE);}catch(error){if(phase==='before'&&error.code==='PREVIEW_MISSING'){manifest.files.push({index,file:output.file,status:'missing',recordedSha:output.sha||null});continue;}throw error;}
    const sha=sha256(bytes);total+=bytes.length;if(total>MAX_TOTAL)fail('ARTIFACT_HISTORY_LIMIT','成果合計超過 200 MB，未保存不完整版本。',413);
    if(phase==='after'&&sha!==output.sha)fail('ARTIFACT_HISTORY_CHANGED','成果與本輪登記 hash 不一致，未標記成已保存版本：'+output.file);
    await writeFile(path.join(directory,index+'.bin'),bytes,{flag:'wx',mode:0o600});manifest.files.push({index,file:output.file,status:'saved',sha,bytes:bytes.length,recordedSha:output.sha||null,matchesRecorded:output.sha?sha===output.sha:null});
   }
   const serialized=JSON.stringify(manifest,null,2)+'\n';await writeFile(path.join(directory,'manifest.json'),serialized,{flag:'wx',mode:0o600});return {...manifest,digest:sha256(serialized)};
  }catch(error){await rm(directory,{recursive:true,force:true});throw error;}
 }
 async manifest(taskId,version){
  if(!validVersion(version))fail('ARTIFACT_HISTORY_ID','成果版本識別不正確。',400);const base=await this.taskDir(taskId);if(!base)fail('ARTIFACT_HISTORY_MISSING','找不到已保存的成果版本。',404);
  const directory=path.join(base,version);let stat;try{stat=await lstat(directory);}catch(error){if(error.code==='ENOENT')fail('ARTIFACT_HISTORY_MISSING','找不到已保存的成果版本。',404);throw error;}if(stat.isSymbolicLink()||!stat.isDirectory())fail('ARTIFACT_HISTORY_PATH','成果版本路徑已變更。');
  let manifest,manifestBytes;try{manifestBytes=await readSafe(directory,'manifest.json',2_000_000);manifest=JSON.parse(manifestBytes.toString('utf8'));}catch(error){if(error instanceof TaskError)throw error;fail('ARTIFACT_HISTORY_INVALID','成果版本紀錄損壞，停止讀取。');}
  if(manifest.schema!==1||manifest.id!==version||manifest.taskId!==taskId||!validVersion(manifest.turnId)||!['before','after'].includes(manifest.phase)||!Array.isArray(manifest.files)||manifest.files.length>MAX_FILES)fail('ARTIFACT_HISTORY_INVALID','成果版本紀錄不完整。');
  for(const [i,file] of manifest.files.entries()){name(file.file);if(file.index!==i||!['missing','saved'].includes(file.status)||file.status==='saved'&&(!/^[a-f0-9]{64}$/.test(file.sha)||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>MAX_FILE))fail('ARTIFACT_HISTORY_INVALID','成果版本檔案紀錄不正確。');}
  return {...manifest,digest:sha256(manifestBytes)};
 }
 async read(taskId,version,index){
  const manifest=await this.manifest(taskId,version);if(!Number.isSafeInteger(index)||index<0||index>=manifest.files.length)fail('ARTIFACT_HISTORY_FILE','成果版本檔案識別不正確。',400);const file=manifest.files[index];if(file.status!=='saved')fail('ARTIFACT_HISTORY_MISSING','這個版本當時未保存內容，不改讀目前檔案。',404);
  const base=await this.taskDir(taskId),content=await readSafe(path.join(base,version),index+'.bin',MAX_FILE);if(content.length!==file.bytes||sha256(content)!==file.sha)fail('ARTIFACT_HISTORY_CORRUPT','保存版本已被修改或損壞，不當成原版本。');return {manifest,file,content};
 }
}
