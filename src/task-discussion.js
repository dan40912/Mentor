import { extractJson } from './agents.js';

// An AI interpretation is advice, never authority to execute/cancel/change scope.
export function discussionResult(text,task) {
  const value=extractJson(text);
  if(!value||typeof value.answer!=='string'||!value.answer.trim()||value.answer.length>6000)throw new Error('問答缺少有效的回答，原文已保留；未變更任務工作。');
  let intent=['question','change','cancel','unclear'].includes(value.intent)?value.intent:'unclear';
  const scopes=['current','outline',...(task.planning.workItems||[]).filter(i=>i.owner==='ai').map(i=>i.id)];
  if(intent==='change'&&typeof value.proposedChange==='string'&&value.proposedChange.length>6000)throw new Error('修改建議超過 6,000 字，未截斷或套用；請縮小範圍。');
  if(intent==='change'&&!scopes.includes(value.scope))intent='unclear';
  return {intent,answer:value.answer.trim(),proposedChange:intent==='change'&&typeof value.proposedChange==='string'?value.proposedChange.trim():'',scope:scopes.includes(value.scope)?value.scope:'current'};
}

export function organizationDraftMetadata(value) {
  if(value==null)return null;
  if(value.version!==1||!['knowledge','weekly','source'].includes(value.kind)||typeof value.sourcePath!=='string'||!value.sourcePath.endsWith('.md')||value.sourcePath.includes('\\')||value.sourcePath.includes('\0')||value.sourcePath.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.'))||value.sourcePath.startsWith('Mentor 整理/'))throw new Error('整理來源與類型格式不正確。');
  if(!/^[a-f0-9]{64}$/.test(value.sourceSha256)||!/^[a-f0-9]{64}$/.test(value.excerptSha256)||typeof value.period!=='string'||value.period.length>80)throw new Error('整理來源版本或期間格式不正確。');
  return {version:1,kind:value.kind,sourcePath:value.sourcePath,sourceSha256:value.sourceSha256,excerptSha256:value.excerptSha256,period:value.period};
}
