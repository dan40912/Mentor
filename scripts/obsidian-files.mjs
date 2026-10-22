import {lstat,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
export const PLUGIN_FILES=['manifest.json','main.js','organization.js','content-drafts.js','relocation.js','reference-coverage.js','styles.css'];
export const THEME_FILES=['manifest.json','theme.css'];
export const runtimeFiles=[...PLUGIN_FILES.map(name=>({source:'obsidian/mentor-work-center/'+name,target:'.obsidian/plugins/mentor-work-center/'+name})),...THEME_FILES.map(name=>({source:'themes/Mentor/'+name,target:'.obsidian/themes/Mentor/'+name}))];
const identities=new WeakMap();
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function readWithoutLinks(root,relative){
 if(typeof relative!=='string'||relative.includes('\\')||relative.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Expected a relative managed file path');
 let current=path.resolve(root);const parts=relative.split('/'),chain=[];
 for(const part of ['',...parts]){
  if(part)current=path.join(current,part);
  let info;try{info=await lstat(current);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  chain.push({path:current,dev:info.dev,ino:info.ino});
  if(info.isSymbolicLink())throw new Error('Refusing symlink: '+current);
  if(current!==path.join(path.resolve(root),...parts)&&!info.isDirectory())throw new Error('Expected directory: '+current);
  if(current===path.join(path.resolve(root),...parts)&&(!info.isFile()||info.size>2000000))throw new Error('Expected a regular file of at most 2 MB: '+current);
 }
 const handle=await open(current,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{const info=await handle.stat(),last=chain.at(-1);if(info.dev!==last.dev||info.ino!==last.ino)throw new Error('File changed during verification');const bytes=await handle.readFile();for(const item of chain){const now=await lstat(item.path);if(now.isSymbolicLink()||now.dev!==item.dev||now.ino!==item.ino)throw new Error('Path changed during verification: '+item.path);}identities.set(bytes,{dev:info.dev,ino:info.ino});return bytes;}finally{await handle.close();}
}

export async function writeGenerated(root,relative,bytes,before){
 const current=await readWithoutLinks(root,relative);
 if((current===null)!==(before===null)||current!==null&&sha256(current)!==sha256(before))throw new Error('Content changed during build; stopped: '+relative);
 if(current!==null){const original=identities.get(before),now=identities.get(current);if(!original||original.dev!==now.dev||original.ino!==now.ino)throw new Error('File was replaced during build: '+relative);if(current.equals(bytes))return;}
 const filename=path.join(root,...relative.split('/')),handle=await open(filename,constants.O_RDWR|(constants.O_NOFOLLOW||0)|(current===null?constants.O_CREAT|constants.O_EXCL:0),0o644);
 try{
  const info=await handle.stat(),onPath=await lstat(filename),known=current===null?null:identities.get(before);
  if(onPath.isSymbolicLink()||onPath.dev!==info.dev||onPath.ino!==info.ino||info.nlink>1||known&&(known.dev!==info.dev||known.ino!==info.ino))throw new Error('Output path changed or is linked: '+relative);
  if(current!==null&&sha256(await handle.readFile())!==sha256(before))throw new Error('Content changed before write: '+relative);
  await handle.truncate(0);let offset=0;while(offset<bytes.length){const result=await handle.write(bytes,offset,bytes.length-offset,offset);if(!result.bytesWritten)throw new Error('Output write made no progress');offset+=result.bytesWritten;}
 }finally{await handle.close();}
}
