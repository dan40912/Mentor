import { createHash } from 'node:crypto';
export function instructionPreview(task,plan,{text,scope,reason,attachmentIds}) {
  const body={revision:task.revision,request:text,scope,reason,attachmentIds,...plan};
  return {...body,id:createHash('sha256').update(JSON.stringify(body)).digest('hex')};
}
