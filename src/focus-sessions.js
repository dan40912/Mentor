import {readFile,writeFile,rename,rm,lstat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {TaskStore,TaskError,sha256} from './tasks.js';
const fail=(code,message,status=409)=>{throw new TaskError(status,code,message);};
export function focusTiming(session,now=Date.now()){
 const until=session.status==='running'?now:session.lastEventAt;
 const clockChanged=until<session.lastEventAt;
 const elapsedMs=session.elapsedMs+(session.status==='running'?Math.max(0,until-session.lastEventAt):0);
 return {elapsedMs,remainingMs:Math.max(0,session.targetMinutes*60000-elapsedMs),overtimeMs:Math.max(0,elapsedMs-session.targetMinutes*60000),targetReached:elapsedMs>=session.targetMinutes*60000,clockChanged,basis:'wall-time-excluding-explicit-pauses; sleep-not-detected'};
}
export class FocusSessions{
 constructor(vault,clock=Date.now){this.paths=new TaskStore(vault);this.clock=clock;this.queue=Promise.resolve();}
 async read(){
  const file=await this.paths.safePath('focus-sessions.json');let raw;
  try{const info=await lstat(file);if(!info.isFile()||info.size>5_000_000)fail('FOCUS_STATE_INVALID','專注紀錄超過讀取上限或不是一般檔案。');raw=await readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')return {schema:1,revision:0,sessions:[],requests:[]};throw error;}
  let state;try{state=JSON.parse(raw);}catch{fail('FOCUS_STATE_INVALID','專注紀錄損壞，停止寫入。');}
  if(state.schema!==1||!Number.isSafeInteger(state.revision)||state.revision<0||!Array.isArray(state.sessions)||!Array.isArray(state.requests)||state.sessions.length>1000||state.requests.length>5000)fail('FOCUS_STATE_INVALID','專注紀錄格式不正確。');
  if(state.requests.some(r=>!r||typeof r.key!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(r.key)||typeof r.digest!=='string'||!/^[a-f0-9]{64}$/.test(r.digest)))fail('FOCUS_STATE_INVALID','專注操作識別紀錄損壞。');
  if(state.sessions.some(s=>!s||typeof s.id!=='string'||typeof s.goal!=='string'||s.goal.length>1000||!Array.isArray(s.events)||!s.events.length||s.events.length>5001||!Number.isSafeInteger(s.startedAt)||s.startedAt<0||!['running','paused','ended','cancelled'].includes(s.status)||!Number.isInteger(s.targetMinutes)||s.targetMinutes<1||s.targetMinutes>180||!Number.isSafeInteger(s.elapsedMs)||s.elapsedMs<0||!Number.isSafeInteger(s.lastEventAt))||state.sessions.filter(s=>['running','paused'].includes(s.status)).length>1)fail('FOCUS_STATE_INVALID','專注時段格式不正確。');
  return state;
 }
 project(state){return {revision:state.revision,sessions:state.sessions.map(session=>({...session,timing:focusTiming(session,this.clock())})),activeId:state.sessions.find(s=>['running','paused'].includes(s.status))?.id||null};}
 async list(){await this.queue;return this.project(await this.read());}
 change(action,input){
  const work=async()=>{
   if(!['start','pause','resume','end','cancel'].includes(action))fail('FOCUS_ACTION_INVALID','不支援的專注操作。',400);
   const keys=action==='start'?['revision','requestKey','targetMinutes','goal','taskId','workItemId']:['revision','requestKey','sessionId'];
   if(!input||Object.keys(input).some(key=>!keys.includes(key)))fail('FOCUS_INPUT_INVALID','專注操作包含不支援的欄位。',400);
   if(typeof input.requestKey!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(input.requestKey))fail('FOCUS_REQUEST_KEY','請提供這次操作的識別。',400);
   const state=await this.read(),digest=sha256(JSON.stringify({action,input})),old=state.requests.find(r=>r.key===input.requestKey);
   if(old){if(old.digest!==digest)fail('FOCUS_REQUEST_CONFLICT','相同操作識別已用於不同內容。');return {...this.project(state),replayed:true};}
   if(input.revision!==state.revision)fail('FOCUS_REVISION_CONFLICT','專注狀態已更新，請重新讀取。');
   if(state.requests.length>=5000)fail('FOCUS_CAPACITY','專注操作紀錄已達上限，請先匯出整理；沒有刪除舊識別。');
   const at=this.clock();if(!Number.isSafeInteger(at)||at<0)fail('FOCUS_CLOCK_CHANGED','系統時間不正確。');
   if(action==='start'){
    if(state.sessions.some(s=>['running','paused'].includes(s.status)))fail('FOCUS_ALREADY_ACTIVE','已有進行中的專注時段，請回到該輪。');
    if(state.sessions.length>=1000)fail('FOCUS_CAPACITY','專注時段紀錄已達上限。');
    if(!Number.isInteger(input.targetMinutes)||input.targetMinutes<1||input.targetMinutes>180||typeof input.goal!=='string'||input.goal.length>1000)fail('FOCUS_INPUT_INVALID','請選擇 1–180 分鐘，目標最多 1,000 字。',400);
    if(input.taskId!=null&&!/^TASK-[a-zA-Z0-9-]+$/.test(input.taskId)||input.workItemId!=null&&(!input.taskId||typeof input.workItemId!=='string'||!/^[a-zA-Z0-9-]{1,40}$/.test(input.workItemId)))fail('FOCUS_LINK_INVALID','關聯任務或項目不正確。',400);
    state.sessions.push({id:randomUUID(),status:'running',goal:input.goal.trim(),targetMinutes:input.targetMinutes,taskId:input.taskId||null,workItemId:input.workItemId||null,startedAt:at,lastEventAt:at,elapsedMs:0,events:[{action,at}],organizationStatus:'not_requested'});
   }else{
    const session=state.sessions.find(s=>s.id===input.sessionId);if(!session)fail('FOCUS_NOT_FOUND','找不到這個專注時段。',404);
    if(!['running','paused'].includes(session.status)||action==='pause'&&session.status!=='running'||action==='resume'&&session.status!=='paused')fail('FOCUS_STATE_CONFLICT','這個操作不適用於目前狀態。');
    if(at<session.lastEventAt)fail('FOCUS_CLOCK_CHANGED','系統時間倒退，請先核對時間；沒有改寫紀錄。');
    session.elapsedMs=focusTiming(session,at).elapsedMs;if(!Number.isSafeInteger(session.elapsedMs))fail('FOCUS_CLOCK_CHANGED','計時超過可保存範圍，請核對系統時間。');session.lastEventAt=at;session.status={pause:'paused',resume:'running',end:'ended',cancel:'cancelled'}[action];session.events.push({action,at});if(['end','cancel'].includes(action))session.endedAt=at;
   }
   state.revision++;state.requests.push({key:input.requestKey,digest});
   const serialized=JSON.stringify(state,null,2)+'\n';if(Buffer.byteLength(serialized)>5_000_000)fail('FOCUS_CAPACITY','專注紀錄已達儲存上限，沒有覆寫。');
   const target=await this.paths.safePath('focus-sessions.json'),temp=path.join(this.paths.dir,'.focus-'+randomUUID()+'.tmp');
   try{await writeFile(temp,serialized,{flag:'wx',mode:0o600});await this.paths.safePath('focus-sessions.json');await rename(temp,target);}finally{await rm(temp,{force:true});}
   return {...this.project(state),replayed:false};
  };
  const result=this.queue.then(work);this.queue=result.catch(()=>{});return result;
 }
}
