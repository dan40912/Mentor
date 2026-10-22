import { mkdir, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import {runtimeFiles,readWithoutLinks,writeGenerated,sha256} from './obsidian-files.mjs';
import { fileURLToPath } from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=path.join(repo,'dist','mentor-obsidian');
// Only our fixed build output is writable. Never accept an arbitrary Vault argument.
for(const directory of [path.join(repo,'dist'),target]){
 let stat;try{stat=await lstat(directory);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(stat){if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Build target must be a real directory: '+directory);}else await mkdir(directory);
}
async function rejectLinks(dir) {
  if ((await lstat(dir)).isSymbolicLink()) throw new Error('Build tree must not contain symlinks');
  for (const entry of await readdir(dir,{withFileTypes:true})) {
    if(entry.isSymbolicLink())throw new Error('Build tree must not contain symlinks');
    if(entry.isDirectory())await rejectLinks(path.join(dir,entry.name));
  }
}
if((await lstat(path.join(repo,'dist'))).isSymbolicLink())throw new Error('dist must not be a symlink');
await rejectLinks(target);
const payload=[];
for(const entry of runtimeFiles){const bytes=await readWithoutLinks(repo,entry.source);if(!bytes?.length)throw new Error('Missing runtime source: '+entry.source);payload.push({path:entry.target,bytes});}
for(const [source,prefix] of [['obsidian/templates','範本/'],['obsidian/examples','']]){
  // Only flat, non-hidden Markdown examples are distributable. Never copy runtime state.
  for(const name of (await readdir(path.join(repo,source))).sort())if(!name.startsWith('.')&&name.endsWith('.md')){const bytes=await readWithoutLinks(repo,source+'/'+name);if(bytes===null)throw new Error('Missing source: '+name);payload.push({path:prefix+name,bytes});}
}
const license=await readWithoutLinks(repo,'LICENSE');if(!license?.length)throw new Error('Missing LICENSE');payload.push({path:'LICENSE',bytes:license});
payload.push({path:'安裝說明.md',bytes:Buffer.from(`# Mentor Obsidian 套裝\n\n這是獨立示範庫，不會修改你的正式筆記庫。\n\n1. 在 Obsidian 開啟這個資料夾。\n2. 在「外觀」選擇 Mentor 主題。\n3. 審閱插件原始碼與權限，再自行啟用「Mentor Work Center」。未自動啟用第三方插件。\n4. 啟動本機 Mentor，從工作台取得一次性配對碼。\n5. 命令面板選擇「配對本機服務」。\n6. 開啟「00 工作首頁」。原生 Templates 插件可選「範本」資料夾。\n\n憑證只保存於插件記憶體，重啟需重新配對。主題停用不影響 Markdown 原文。\n\n完整文件：${'https://github.com/dan40912/Mentor'}\n\n這個版本尚須 Obsidian 實機與真人操作驗收；機器測試不可替代它們。\n`)});
const stampPath='.obsidian/mentor-build.json',rawStamp=await readWithoutLinks(target,stampPath);let old=null;
if(rawStamp){try{old=JSON.parse(rawStamp);}catch{throw new Error('Build manifest is invalid; back up the existing directory before rebuilding.');}if(old.schema!==1||!Array.isArray(old.files)||old.files.some(f=>typeof f.path!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256)))throw new Error('Build manifest is invalid.');}
const previous=new Map((old?.files||[]).map(f=>[f.path,f.sha256]));
// Validate the entire payload before replacing any old file. Existing edited notes are assets.
for(const entry of payload){entry.before=await readWithoutLinks(target,entry.path);if(entry.before!==null&&sha256(entry.before)!==sha256(entry.bytes)&&previous.get(entry.path)!==sha256(entry.before))throw new Error('Existing content is not an unchanged generated file; kept intact: '+entry.path);}
for(const entry of payload){await mkdir(path.dirname(path.join(target,entry.path)),{recursive:true});await writeGenerated(target,entry.path,entry.bytes,entry.before);}
const manifest={schema:1,files:payload.map(entry=>({path:entry.path,bytes:entry.bytes.length,sha256:sha256(entry.bytes)})).sort((a,b)=>a.path.localeCompare(b.path))};
await mkdir(path.join(target,'.obsidian'),{recursive:true});await writeGenerated(target,stampPath,Buffer.from(JSON.stringify(manifest,null,2)+'\n'),rawStamp);
console.log(`Built standalone Vault: ${target}`);
