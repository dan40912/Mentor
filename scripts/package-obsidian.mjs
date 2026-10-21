import { mkdir, cp, copyFile, readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=path.join(repo,'dist','mentor-obsidian');
// Only our fixed build output is writable. Never accept an arbitrary Vault argument.
await mkdir(target,{recursive:true});
if((await lstat(target)).isSymbolicLink())throw new Error('Build target must not be a symlink');
async function rejectLinks(dir) {
  if ((await lstat(dir)).isSymbolicLink()) throw new Error('Build tree must not contain symlinks');
  for (const entry of await readdir(dir,{withFileTypes:true})) {
    if(entry.isSymbolicLink())throw new Error('Build tree must not contain symlinks');
    if(entry.isDirectory())await rejectLinks(path.join(dir,entry.name));
  }
}
if((await lstat(path.join(repo,'dist'))).isSymbolicLink())throw new Error('dist must not be a symlink');
await rejectLinks(target);
const config=path.join(target,'.obsidian');
await mkdir(config,{recursive:true});
for(const dir of ['plugins','themes'])await mkdir(path.join(config,dir),{recursive:true});
for(const dir of [config,path.join(config,'plugins'),path.join(config,'themes')])if((await lstat(dir)).isSymbolicLink())throw new Error('Build subdirectory must not be a symlink');
await cp(path.join(repo,'obsidian','mentor-work-center'),path.join(config,'plugins','mentor-work-center'),{recursive:true});
await cp(path.join(repo,'themes','Mentor'),path.join(config,'themes','Mentor'),{recursive:true});
await cp(path.join(repo,'obsidian','templates'),path.join(target,'範本'),{recursive:true});
for(const file of await readdir(path.join(repo,'obsidian','examples')))await copyFile(path.join(repo,'obsidian','examples',file),path.join(target,file));
await copyFile(path.join(repo,'LICENSE'),path.join(target,'LICENSE'));
await writeFile(path.join(target,'安裝說明.md'),`# Mentor Obsidian 套裝\n\n這是獨立示範庫，不會修改你的正式筆記庫。\n\n1. 在 Obsidian 開啟這個資料夾。\n2. 在「外觀」選擇 Mentor 主題。\n3. 審閱插件原始碼與權限，再自行啟用「Mentor Work Center」。未自動啟用第三方插件。\n4. 啟動本機 Mentor，從工作台取得一次性配對碼。\n5. 命令面板選擇「配對本機服務」。\n6. 開啟「00 工作首頁」。原生 Templates 插件可選「範本」資料夾。\n\n憑證只保存於插件記憶體，重啟需重新配對。主題停用不影響 Markdown 原文。\n\n完整文件：${'https://github.com/dan40912/Mentor'}\n\n這個版本尚須 Obsidian 實機與真人操作驗收；機器測試不可替代它們。\n`);
for(const file of ['manifest.json','main.js','organization.js','styles.css'])if(!(await readFile(path.join(config,'plugins','mentor-work-center',file))).length)throw new Error('Missing plugin file');
console.log(`Built standalone Vault: ${target}`);
