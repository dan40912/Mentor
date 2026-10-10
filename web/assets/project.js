// 講解頁只使用已整理的本機摘要；按保存才寫入，不呼叫模型。
var projectState={projects:[],id:null,slide:0,data:null,seq:0,drafts:{},archive:null,records:[]};
async function renderJourney(){
 const box=$('#journey-content'),seq=++projectState.seq;box.replaceChildren(element('p','正在讀取專案說明…','muted'));
 try{const [result,taskResult]=await Promise.all([request('/api/projects'),request('/api/tasks')]);if(seq!==projectState.seq)return;projectState.records=taskResult.tasks.filter(t=>!t.error&&!t.trashed);tasks=taskResult.tasks;result.projects=journeyProjects(result.projects,projectState.records);projectState.projects=result.projects;
 const tool=element('div',undefined,'journey-tools'),label=element('label',undefined,'field'),picker=element('select');picker.id='project-picker';options(picker,result.projects.map(p=>[p.id,p.title]));if(!result.projects.some(p=>p.id===projectState.id))projectState.id=result.projects[0]?.id||null;picker.value=projectState.id||'';label.append(element('span','選擇專案'),picker,element('small','既有任務會依專案顯示，說明與修改原因可另外補寫。'));tool.append(label);
 const create=element('details');create.append(element('summary','建立另一個專案說明'));const form=element('form'),name=element('input');name.required=true;name.maxLength=40;name.setAttribute('aria-label','新專案名稱');name.placeholder='例如：貸款 Agent';const hint=element('p','先建五頁草稿，未知內容會標待補，不會啟動 AI。','small muted'),add=element('button','建立說明草稿','btn');add.type='submit';form.append(name,hint,add);form.onsubmit=e=>{e.preventDefault();busy(add,async()=>{const r=await request('/api/projects',{name:name.value});projectState.id=r.project.id;projectState.slide=0;await renderJourney();tell('專案草稿已建立，先修改「為什麼做」。');})();};create.append(form);tool.append(create);
 const content=element('div');content.id='project-brief';box.replaceChildren(tool,content);
 picker.onchange=()=>{projectState.id=picker.value;projectState.slide=0;renderProjectBrief();};if(!projectState.id){content.append(element('p','目前沒有專案或任務紀錄。可以建立任務、在上方建立說明，或到「回收桶」還原。','muted'));return;}await renderProjectBrief();
 }catch(e){if(seq===projectState.seq)box.replaceChildren(element('p','專案說明未載入：'+e.message,'notice'));}
}
async function renderProjectBrief(){const seq=++projectState.seq,box=$('#project-brief');box.replaceChildren(element('p','正在讀取這個專案…','muted'));try{const selected=projectState.projects.find(p=>p.id===projectState.id);if(!selected?.hasBrief){projectState.data=selected;drawProjectBrief();return;}const {project}=await request('/api/projects/'+encodeURIComponent(projectState.id));if(seq!==projectState.seq)return;projectState.data=project;drawProjectBrief();}catch(e){if(seq===projectState.seq)box.replaceChildren(element('p',e.message,'notice'));}}
function drawProjectBrief(){
 const p=projectState.data,box=$('#project-brief');box.replaceChildren();drawJourneyRecords(p,box);if(!p.slides)return;const s=p.slides[projectState.slide];
 const lead=element('div',undefined,'section-heading');lead.append(element('h2',p.title),element('span','說明草稿 · 可修改','badge blue'));box.append(lead,element('p','先讀五頁說明，約 3 分鐘。需要細節再查改版與原文。','small muted'));
 const tabs=element('div',undefined,'history-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','專案講解頁');for(const [i,slide]of p.slides.entries()){const b=element('button',`${i+1} ${slide.title}`,'btn');b.setAttribute('aria-pressed',String(i===projectState.slide));b.onclick=()=>{projectState.slide=i;drawProjectBrief();};tabs.append(b);}box.append(tabs);
 const card=element('article',undefined,'card project-slide');card.append(element('p',`${projectState.slide+1}／5 · ${s.title}`,'eyebrow'),element('h3',s.point),element('p',s.detail,'project-detail'));
 const evidence=element('details');evidence.append(element('summary','這頁的依據與限制'),element('p',s.evidence,'small muted'),element('p',s.status||p.status,'small muted'));card.append(evidence);
 const edit=element('button','修改這頁','btn');edit.onclick=()=>editProjectPart(p,s,card);card.append(edit);box.append(card);
 const nav=element('div',undefined,'buttons'),prev=element('button','上一頁','btn'),next=element('button','下一頁','btn primary');prev.disabled=projectState.slide===0;next.disabled=projectState.slide===4;prev.onclick=()=>{projectState.slide--;drawProjectBrief();};next.onclick=()=>{projectState.slide++;drawProjectBrief();};nav.append(prev,next,element('span',`第 ${p.revision} 版 · 保存只更新說明，不代表成果已驗收`,'small muted'));box.append(nav);
 const changes=element('details',undefined,'history-note');changes.append(element('summary',`每次為什麼改 · ${p.evolution.length} 筆歷史＋${(p.edits||[]).length} 次說明修改`));
 for(const e of p.evolution){const d=element('details',undefined,'journey-row');d.id='evolution-'+e.id;d.append(element('summary',`${e.date} · ${e.label}`),element('h4','改了什麼'),element('p',e.point),element('h4','為什麼改'),element('p',e.detail),element('p',e.status,'small muted'),element('p','來源：'+e.evidence,'small muted'));if(e.originalChanges){const raw=element('details');raw.append(element('summary','完整改動清單'));for(const c of e.originalChanges)raw.append(element('p',c,'small'));d.append(raw);}const b=element('button','補寫或修改原因','btn');b.onclick=()=>editProjectPart(p,p.slides[2],d,e);d.append(b);changes.append(d);}
 for(const e of (p.edits||[]).slice().reverse()){const d=element('details',undefined,'journey-row');d.append(element('summary',`第 ${e.revision} 版 · ${when(e.at)} · ${e.reason}`),element('p',`修改 ${e.evolutionId||e.slideId}；來源是使用者本次輸入。`,'small muted'),element('h4','修改前'),element('p',e.before.point+'\n'+e.before.detail),element('h4','修改後'),element('p',e.after.point+'\n'+e.after.detail));changes.append(d);}box.append(changes);
 const actions=element('div',undefined,'buttons'),start=element('button','以此專案開新任務','btn');start.onclick=()=>{$('#new-task').click();$('#draft-form').elements.project.value=p.name;$('#draft-project').hidden=false;$('#draft-project').textContent=`專案：${p.name}。建立後會帶入這五頁摘要與保留規則，完整歷史不會整份送進 prompt。`;$('#draft-form').elements.request.value=`${p.title}\n目標：${p.slides[1].point}\n本次下一步：${p.slides[4].point}\n請先對齊範圍與未決事項，尚不修改正式成果。`;};actions.append(start,projectMenu(p,box));box.append(actions);
 const tokens=element('details',undefined,'history-note');tokens.append(element('summary','整理時怎麼少用 token'),element('p','這份說明直接讀本機摘要，不呼叫 AI。新任務最多帶入 2,200 字的專案重點；改版與原文只在需要時查閱。','small'),element('p','你修改哪一頁，就只保存那頁的差異與理由。日後新增來源，先比對檔案雜湊；內容沒變就不重整，新增部分再補原因。不估算未測量的 token 節省量。','small'));box.append(tokens);
}
function editProjectPart(p,s,host,entry){
 if(host.querySelector('.project-edit'))return;
 const part=entry||s,key=p.id+':'+part.id,draft=projectState.drafts[key]||{},form=element('form',undefined,'project-edit');
 const area=(name,title,value,max,hint)=>{const label=element('label',undefined,'field'),input=element('textarea');input.name=name;input.required=true;input.maxLength=max;input.value=draft[name]??value;input.oninput=()=>{(projectState.drafts[key]||={})[name]=input.value;};label.append(element('span',title),input,element('small',hint));form.append(label);return input;};
 area('point',entry?'改了什麼':'這頁的一句重點',part.point,entry?700:140,'先說具體問題或結果。');area('detail',entry?'為什麼這樣改':'給讀者的說明',part.detail,700,'不知道就寫待補；不要把推論寫成已確認。');area('reason','你這次為什麼修改說明','',1500,'保存後會留下這個理由，方便下次接手。');
 const buttons=element('div',undefined,'buttons'),save=element('button','保存說明','btn primary'),cancel=element('button','取消這次修改','btn');save.type='submit';cancel.type='button';cancel.onclick=()=>{delete projectState.drafts[key];form.remove();};buttons.append(save,cancel);form.append(buttons);form.onsubmit=e=>{e.preventDefault();busy(save,async()=>{const input={...Object.fromEntries(new FormData(form)),revision:p.revision,slideId:s.id,evolutionId:entry?.id};const r=await request('/api/projects/'+encodeURIComponent(p.id)+'/save',input);delete projectState.drafts[key];projectState.data=r.project;drawProjectBrief();tell(r.unchanged?'內容相同，沒有新增版本。':'說明已保存，修改原因也留下了。');})();};host.append(form);form.querySelector('textarea').focus();
}

function journeyProjects(briefs,records){
 const projects=briefs.map(p=>({...p,hasBrief:true}));
 for(const t of records){const name=t.project||'未分類';if(!projects.some(p=>p.name===name))projects.push({id:'records:'+name,name,title:name,hasBrief:false});}
 return projects;
}
function drawJourneyRecords(p,box){
 const records=projectState.records.filter(t=>(t.project||'未分類')===p.name).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
 const list=section(`${p.title} · ${records.length} 筆任務紀錄`);
 if(!records.length)list.append(element('p','這個專案還沒有任務紀錄。','muted'));
 for(const t of records){
  const card=element('article',undefined,'card');card.append(element('h3',t.title),element('p',`${statuses[t.status]?.[0]||t.status} · 最後更新 ${when(t.updatedAt)}`,'small muted'));
  if(t.goal)card.append(element('h4','目標'),element('p',t.goal));
  card.append(element('h4','目前成果'),element('p',t.current?.summary||'尚未記錄成果。'));
  if(t.nextAction?.label)card.append(element('p',t.nextAction.label,'small muted'));
  const buttons=element('div',undefined,'buttons'),open=element('button','開啟任務與修改紀錄','btn'),conversation=element('button','查看每輪問答','btn');open.onclick=()=>openTask(t.id);conversation.onclick=()=>showConversations(t.id);buttons.append(open,conversation);card.append(buttons);
  const files=new Set((t.planning?.workItems||[]).flatMap(w=>(w.outputs||[]).map(o=>o.file)));
  const root=t.allowedRoots?.[0],artifact=t.current?.artifact;
  if(root&&artifact?.startsWith(root+'/'))files.add(artifact.slice(root.length+1));
  const previewFiles=[...files].filter(file=>/\.(html|md|png|jpe?g|webp)$/i.test(file));
  if(previewFiles.length){const outputs=element('div',undefined,'buttons');outputs.append(element('span','成果檔案','small muted'));for(const file of previewFiles){const preview=element('button',file,'btn subtle');preview.onclick=()=>openPreview(t.id,file,preview);outputs.append(preview);}card.append(outputs);}
  list.append(card);
 }
 box.append(list);
}
