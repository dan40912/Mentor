import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseTask, sha256 } from '../src/tasks.js';
import { buildHandoff } from '../src/handoffs.js';
import { readHandoffSources } from '../src/handoff-history.js';
import { compactHandoff } from '../src/compact-handoff.js';
import { measureText } from '../src/work-cards.js';
const file=process.argv[2];
if(!file){console.error('Usage: npm run measure:handoff -- /absolute/MENTOR_HOME/vault/TASK-id.md');process.exitCode=1;}else{
 const resolved=await realpath(file),root=path.dirname(path.dirname(resolved)),raw=await readFile(resolved,'utf8'),task=parseTask(raw,path.basename(resolved));
 if(path.basename(path.dirname(resolved))!=='vault')throw new Error('Provide the task source in MENTOR_HOME/vault');
 const sources=await readHandoffSources(root,task),full=buildHandoff(task,sources,root),summary=compactHandoff(task);
 const original=measureText(full),compact=measureText(summary.content);
 console.log(JSON.stringify({taskId:task.id,revision:task.revision,sourceSha256:sha256(raw),full:original,compact,utf8ByteDifference:original.utf8Bytes-compact.utf8Bytes,quality:'Not established by this measurement. Verify scope, decisions, human corrections, evidence and next step separately.',tokenSavings:null,costSavings:null,method:'Two handoff formats from the same saved task and history. Counts are exact characters and UTF-8 bytes, not model tokenization.'},null,2));
}
