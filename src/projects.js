import {readFile,writeFile,mkdir,rename,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {TaskError} from './tasks.js';
const slug = name => String(name).trim().replace(/[\\/:*?"<>|.\s]+/g,'-').slice(0,40);
const safe = id => typeof id==='string' && /^[\p{L}\p{N}-]{1,40}$/u.test(id);
export class Projects {
 constructor(dir){this.dir=dir;this.queue=Promise.resolve();}
 async read(id){if(!safe(id))throw new TaskError(400,'PROJECT_INVALID','專案名稱格式不正確。');try{return JSON.parse(await readFile(path.join(this.dir,id,'brief.json'),'utf8'));}catch(e){if(e.code==='ENOENT')throw new TaskError(404,'PROJECT_NOT_FOUND','尚未建立這個專案的說明。');throw e;}}
 async list(){let dirs=[];try{dirs=await readdir(this.dir,{withFileTypes:true});}catch(e){if(e.code!=='ENOENT')throw e;}const result=[];for(const d of dirs.filter(d=>d.isDirectory()&&safe(d.name))){const p=await this.read(d.name);result.push({id:p.id,name:p.name,title:p.title,revision:p.revision});}return result;}
 async context(name){try{const p=await this.read(slug(name));return `專案說明（可編輯草稿，第 ${p.revision} 版；使用者最新指示優先）：\n`+p.slides.map(s=>`${s.title}：${s.point}\n${s.detail}`).join('\n').slice(0,2200);}catch(e){if(e.code==='PROJECT_NOT_FOUND')return '';throw e;}}
 save(id,input){const run=this.queue.then(async()=>{const p=await this.read(id);if(input.revision!==p.revision)throw new TaskError(409,'REVISION_CONFLICT','專案說明已更新。請先重新整理；你的輸入仍保留在欄位。');
  const slide=p.slides.find(s=>s.id===input.slideId),entry=input.evolutionId&&p.evolution.find(e=>e.id===input.evolutionId);
  if(!slide||input.evolutionId&&!entry)throw new TaskError(400,'SLIDE_INVALID','找不到這頁或改版。');
  for(const key of ['point','detail','reason'])if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>1500)throw new TaskError(400,'TEXT_REQUIRED','請填重點、說明與這次修改原因，每欄最多 1,500 字。');
  if(input.point.length>(entry?700:140)||input.detail.length>700)throw new TaskError(400,'TEXT_TOO_LONG','講解頁重點最多 140 字，改版重點與說明最多 700 字；完整內容放在來源。');
  const target=entry||slide,before={point:target.point,detail:target.detail};
  if(before.point===input.point.trim()&&before.detail===input.detail.trim())return {project:p,unchanged:true};
  target.point=input.point.trim();target.detail=input.detail.trim();target.status='使用者編輯，尚未驗證';
  p.revision++;p.updatedAt=new Date().toISOString();
  (p.edits||=[]).push({revision:p.revision,at:p.updatedAt,slideId:slide.id,evolutionId:entry?.id||null,reason:input.reason.trim(),before,after:{point:target.point,detail:target.detail}});
  await this.write(p);return {project:p};});this.queue=run.catch(()=>{});return run;}
 async write(p){if(!safe(p.id))throw new TaskError(400,'PROJECT_INVALID','專案 ID 格式不正確。');const dir=path.join(this.dir,p.id);await mkdir(dir,{recursive:true});const file=path.join(dir,'brief.json'),tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(p,null,2)+'\n',{flag:'wx'});await rename(tmp,file);
  const md=[`# ${p.title}`,'> 可編輯說明草稿；保存不代表業務驗收。',`版本：${p.revision}`, ...p.slides.map(s=>`## ${s.title}\n\n${s.point}\n\n${s.detail}\n\n來源：${s.evidence}`),'## 每次為什麼改',...p.evolution.map(e=>`### ${e.date} ${e.label}\n\n改了什麼：${e.point}\n\n為什麼：${e.detail}\n\n${e.status}\n\n來源：${e.evidence}`),'## 你做過的修改',...(p.edits||[]).map(e=>`- 第 ${e.revision} 版 ${e.at}：${e.reason}（${e.evolutionId||e.slideId}）`)];await writeFile(path.join(dir,'README.md'),md.join('\n\n')+'\n');
 }
 create(input){const run=this.queue.then(()=>this.createProject(input));this.queue=run.catch(()=>{});return run;}
 async createProject({name}){if(typeof name!=='string'||!name.trim()||name.length>40)throw new TaskError(400,'PROJECT_INVALID','請填 1～40 字的專案名稱。');const id=slug(name);try{await this.read(id);throw new TaskError(409,'PROJECT_EXISTS','這個專案已存在，請直接修改原說明。');}catch(e){if(e.code!=='PROJECT_NOT_FOUND')throw e;}
  const p={id,name:name.trim(),title:name.trim(),revision:1,status:'初稿，待補資料',updatedAt:new Date().toISOString(),evolution:[],edits:[],slides:['為什麼做','目標與範圍','為什麼這樣改','目前到哪裡','下一步與學習'].map((title,i)=>({id:['why','goal','changes','now','next'][i],title,point:['先寫目前困擾誰，以及為什麼值得處理。','先寫這次要讓誰完成哪件事。','每次改版留下改了什麼，以及為什麼。','目前進度待補，尚未驗證。','先選一件能開始做的事。'][i],detail:'待補：這是共用草稿，請依專案內容修改。',evidence:'尚未提供來源',status:'待補'}))};await this.write(p);return p;
 }
}
