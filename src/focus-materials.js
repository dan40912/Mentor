import {TaskError,sha256} from './tasks.js';
const bad=message=>{throw new TaskError(400,'FOCUS_SOURCE_INVALID',message);};
export function sourceSnapshot(input,at,{allowUnavailable=false}={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['path','status','content','origin'].includes(key)))bad('來源快照格式不正確。');
 const {path,status,content,origin}=input;if(origin!==undefined&&!['manual_paste','obsidian_note'].includes(origin))bad('來源收集方式不正確。');const provenance=origin?{origin}:{};
 if(typeof path!=='string'||path.length>500||!path.toLowerCase().endsWith('.md')||path.startsWith('/')||path.includes('\\')||/[\x00-\x1f:]/.test(path)||path.split('/').some(part=>!part||part==='.'||part==='..'))bad('請提供筆記庫內的 Markdown 相對路徑；不接受任意磁碟路徑。');
 if(status==='present'){
  if(typeof content!=='string'||content.length>50000||Buffer.byteLength(content)>100000)bad('單份筆記快照上限 50,000 字元／100 KB，不會自動截斷。');
  return {path,status,...provenance,content,sha256:sha256(content),bytes:Buffer.byteLength(content),capturedAt:at};
 }
 if((status==='missing'||allowUnavailable&&status==='unavailable')&&content===undefined)return {path,status,...provenance,capturedAt:at};
 bad('來源狀態與內容不一致。');
}
export function materialsIndex(materials){
 if(!materials)return null;
 const {before,after}=materials;
 return {sourcePath:before.path,beforeOrigin:before.origin||null,afterOrigin:after?.origin||null,beforeSha256:before.sha256,beforeBytes:before.bytes,afterSha256:after?.sha256||null,afterStatus:after?.status||'not_captured',afterBytes:after?.bytes??null,changed:after?.status==='present'?before.sha256!==after.sha256:after?.status==='missing'?true:null,lateCapture:Boolean(after?.lateCapture)};
}
export function materialComparison(materials){
 if(!materials)return {status:'no_source',note:'這一輪未選擇保存來源，不會自動讀取其他筆記。'};
 const {before,after}=materials,index=materialsIndex(materials);
 if(!after||after.status==='unavailable')return {status:'after_unavailable',index,before,after:after||null,note:'沒有取得結束內容；不能當成刪除、沒有產出或沒有變更。'};
 const a=before.content.split('\n'),b=after.status==='missing'?[]:after.content.split('\n');let prefix=0,suffix=0;
 while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++;
 while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
 return {status:after.status==='missing'?'source_missing':index.changed?'changed':'unchanged',index,before,after,region:{commonPrefixLines:prefix,commonSuffixLines:suffix,before:a.slice(prefix,a.length-suffix),after:b.slice(prefix,b.length-suffix)},note:'顯示首尾相同區段之間的整段替換範圍，可能包含中間未變更內容，不是最小逐行差異。期間變更不代表使用者親自撰寫；AI、同步或其他人也可能改過。'};
}

export function validateStoredMaterials(materials){
 if(!materials)return;
 try{
  const check=s=>{if(!s||!Number.isSafeInteger(s.capturedAt)||s.capturedAt<0)throw Error();const normalized=sourceSnapshot({path:s.path,status:s.status,...(s.origin!==undefined?{origin:s.origin}:{}),...(s.status==='present'?{content:s.content}:{})},s.capturedAt,{allowUnavailable:true});if(s.status==='present'&&(s.sha256!==normalized.sha256||s.bytes!==normalized.bytes))throw Error();};
  check(materials.before);if(materials.before.status!=='present')throw Error();if(materials.after){check(materials.after);if(materials.after.path!==materials.before.path||materials.after.capturedAt<materials.before.capturedAt)throw Error();}
 }catch{throw new TaskError(409,'FOCUS_STATE_INVALID','已保存的來源快照不完整或 hash 不符，停止讀寫。');}
}
