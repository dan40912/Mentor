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
