// 任務控制：停止這次執行、補充指示、移到回收桶與回收桶頁。
// 草稿按任務保存在記憶體與 localStorage，背景更新與送出失敗都不清空。
const instructDrafts={reason:{},scope:{}};
const draftKey=id=>`awc-draft:${id}`;
function loadDraft(id){if(composerDrafts[id]!==undefined)return composerDrafts[id];try{return localStorage.getItem(draftKey(id))||'';}catch{return '';}}
function saveDraft(id,text){composerDrafts[id]=text;try{if(text)localStorage.setItem(draftKey(id),text);else localStorage.removeItem(draftKey(id));}catch{}}
function replaceTask(task){if(!task)return;const i=tasks.findIndex(x=>x.id===task.id);if(i>=0)tasks[i]=task;else tasks.push(task);renderOverview();if($('#task-dialog').open&&$('#task-dialog').dataset.task===task.id)openTask(task.id,{background:true});}
async function stopRun(t){const r=await request(`/api/tasks/${t.id}/stop`,{});replaceTask(r.task);ensurePolling();}
const stopNote=s=>s.unconfirmed?'CLI 還沒結束，系統持續確認中。確認前不能送出新指示或移到回收桶；你的輸入會保留。':'已送出停止，等 CLI 結束後才標示「已停止」。你的輸入會保留。';

// 狀態列：AI 執行中／正在停止／尚未確認停止／已停止。文字說明狀態，不只靠顏色。
function controlBar(t){
 const p=t.planning;if(!p||(!p.running&&!p.stopped))return null;
 const bar=element('div',undefined,'control-bar');bar.dataset.anchor=p.running?'running':'stopped-status';bar.tabIndex=-1;bar.setAttribute('role','status');bar.setAttribute('aria-live','polite');
 const text=element('div',undefined,'control-text');
 if(p.running){
  const s=p.running.stopping;bar.classList.add(s?(s.unconfirmed?'is-unconfirmed':'is-stopping'):'is-running');
  const line=element('span',undefined,'small');line.append(`${p.running.discussion?'任務問答':stageLabel(p.running.stage)}${p.running.workItemId?` ${itemName(p.running.workItemId)}`:''} · ${p.running.agent} · 已 `);const since=element('span','');since.dataset.since=p.running.startedAt;line.append(since);
  text.append(element('strong',s?(s.unconfirmed?'尚未確認停止':'正在停止…'):'AI 執行中'),line);if(s)text.append(element('span',stopNote(s),'small muted'));
  bar.append(element('span','',s?'pulse amber':'pulse'),text);
  if(!s){const stop=focusKey(element('button','停止這次執行','btn'),'stop');stop.onclick=busy(stop,()=>stopRun(t));bar.append(stop);}
  return bar;
 }
 const s=p.stopped;bar.classList.add('is-stopped');
 text.append(element('strong','已停止'),element('span',`${stageLabel(s.stage)}${s.itemId?` ${itemName(s.itemId)}`:''}（${s.agent}）沒有完成 · 停止於 ${when(s.at)}`,'small'));
 const kept=element('ul',undefined,'control-list');kept.append(element('li',`已保存：對話${s.stage==='A'?'':'、任務卡'}、已確認的成果與你的草稿。`));
 if(s.changed?.length)kept.append(element('li',`中斷期間有 ${s.changed.length} 個檔案變動，可能只寫了一半：${s.changed.join('、')}。不算完成，繼續時 AI 會先核對。`));
 if(s.afterRestart)kept.append(element('li','服務曾重啟，無法確認上次的 CLI 是否已結束；繼續前請確認沒有殘留程序。'));
 kept.append(element('li',s.stage==='A'?'繼續會重新制定任務卡，完成後接著需求釐清。':`繼續會從保存的成果重做「${stageLabel(s.stage)}」，不會回到 CLI 中斷的那一刻。`));
 text.append(kept);bar.append(element('span','','pulse off'),text);return bar;
}

// 統一的補充指示輸入區：依狀態決定回答、改計畫、修改工作項目、接續或新一輪。
function instructionBox(t,{extraButtons=[]}={}){
 const p=t.planning;const s=p.running?.stopping;const mode=p.stopped?'stopped':p.phase;
 const items=(p.workItems||[]).filter(w=>w.owner==='ai');
 const next=p.workItems?.find(w=>w.id===t.nextAction?.id);
 const current=p.workItems?.find(w=>w.id===p.running?.workItemId)||(next?.owner==='ai'?next:items.find(w=>w.status!=='DONE'));
 const form=element('form',undefined,'composer instruct');form.dataset.anchor=mode==='stopped'?'stopped':'instruct';form.noValidate=true;
 const id=`instruct-${t.id}`,label=element('label',{stopped:'繼續前要交代什麼？（可以空白）',grill:'你的回答',outline:'計畫哪裡要改？',execute:'想調整什麼？',done:'還想再做什麼？'}[mode]||'補充指示','instruct-label');label.htmlFor=id;
 const area=focusKey(element('textarea'),'composer');area.id=id;area.maxLength=6000;area.value=loadDraft(t.id);
 const executeExample=current?`例如：『${itemTitle(current.id,current.title)}』的結論放最前面`:'例如：結論放最前面。';
 area.placeholder={stopped:'例如：繼續前要補充的資訊。空白也可以直接繼續。',grill:'回答上面的問題；不知道就說不知道，AI 會先給預設值。',outline:'例如：第 3 段刪掉；結論移到最前面。',execute:executeExample,done:'例如：再做一份英文版。會建立新一輪，不覆寫已完成的紀錄。'}[mode];
 const count=element('span','','small muted counter');const hint=element('span','','small muted');hint.id=`${id}-hint`;area.setAttribute('aria-describedby',hint.id);
 form.append(label);
 const suggestions=mode==='execute'?(current?.status==='BLOCKED'?['資訊都在任務卡，照現有內容做完，缺的標成假設']:['照驗收意見修改','換個做法再試一次','這項我自己做']):{outline:['段落太多，併成 3 段','每段補上資料來源'],done:['再做一份英文版']}[mode]||[];
 if(suggestions.length){const chips=element('div',undefined,'buttons instruct-suggestions');for(const text of suggestions){const chip=element('button',text,'btn subtle');chip.type='button';chip.onclick=()=>{area.value=text;area.oninput();area.focus();};chips.append(chip);}form.append(chips);}
 form.append(area);
 const {host:attachmentHost,picker:attachments}=taskAttachmentPicker(t.id,'instruction');form.append(attachmentHost);
 // 套用範圍：執行階段才需要選；接續固定套用在中斷的步驟。
 let scope=null;
 if(mode==='stopped')form.append(element('p',`套用於：中斷的${stageLabel(p.stopped.stage)}${p.stopped.itemId?` ${itemName(p.stopped.itemId)}`:''}`,'small muted'));
 if(mode==='execute'){
  const cur=current;scope=element('select');scope.className='btn';scope.id=`${id}-scope`;
  options(scope,[['current',`正在做的：${cur?`${itemTitle(cur.id,cur.title)}`:''}`],...items.map(w=>[w.id,`${itemTitle(w.id,w.title)}（${itemStatus[w.status]?.[0]||w.status}）`]),['outline','重排整個計畫（排好後你要再核准一次）']]);
  scope.value=instructDrafts.scope[t.id]||'current';scope.onchange=()=>{instructDrafts.scope[t.id]=scope.value;sync();};
  const row=element('label',undefined,'instruct-field');row.htmlFor=scope.id;row.append(element('span','要改哪裡','small'),scope);form.append(row);
 }
 let reason=null;if(mode!=='grill'){reason=element('input');reason.id=`${id}-reason`;reason.maxLength=500;reason.placeholder='例如：主管要先看結論';reason.value=instructDrafts.reason[t.id]||'';reason.oninput=()=>{instructDrafts.reason[t.id]=reason.value;};reason.dataset.focus='reason';const row=element('label',undefined,'instruct-field');row.htmlFor=reason.id;row.append(element('span','為什麼要改（選填，AI 會參考）','small'),reason);form.append(row);}
 const impact=element('div',undefined,'impact');impact.hidden=true;impact.setAttribute('role','alert');
 const error=element('p','','field-error');error.setAttribute('role','alert');error.hidden=true;
 const primary=mode==='stopped'||(mode==='grill'&&!p.readyForOutline);
 const send=focusKey(element('button','',primary?'btn primary':'btn'),'send-instruct');send.type='submit';
 const row=element('div',undefined,'buttons');row.append(send,...extraButtons,hint,count);form.append(impact,error,row);
 function target(){const v=scope?.value;if(v&&v!=='current'&&v!=='outline')return p.workItems.find(w=>w.id===v);const next=p.workItems?.find(w=>w.id===t.nextAction?.id);return next?.owner==='ai'?next:items.find(w=>w.status!=='DONE');}
 function sync(){
  const has=Boolean(area.value.trim());count.textContent=`${area.value.length.toLocaleString()}／6,000`;
  const w=target();send.textContent=mode==='stopped'?(has?'送出並繼續':'繼續任務'):mode==='grill'?'送出回答':mode==='outline'?'請 AI 改計畫':mode==='done'?'建立新一輪':scope?.value==='outline'?'請 AI 重排計畫':w?.status==='TODO'?'交給 AI 開始做':'請 AI 照這樣改';
  send.disabled=Boolean(p.running);
  hint.textContent=p.running?(s?(s.unconfirmed?'尚未確認停止，暫時不能送出。':'正在停止，完成後才能送出。'):'可以先寫，停止這次執行後才能送出。'):mode==='grill'?'⌘／Ctrl + Enter 送出':mode==='stopped'?'會先顯示影響範圍再繼續':'';
 }
 area.oninput=()=>{saveDraft(t.id,area.value);error.hidden=true;if(!impact.hidden)impact.querySelector('.btn.subtle')?.click();sync();};
 area.onkeydown=e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();form.requestSubmit();}};
 let instructionProposalId=null;
 const payload=confirm=>({text:area.value,scope:scope?.value||'current',reason:reason?.value||'',confirmImpact:confirm,...(confirm&&instructionProposalId?{proposalId:instructionProposalId}:{})});
 const done=text=>{saveDraft(t.id,'');delete instructDrafts.reason[t.id];delete instructDrafts.scope[t.id];tell(mode==='stopped'?'已繼續任務，AI 從保存的成果接續。':mode==='grill'?'已送出回答，AI 繼續釐清。':mode==='outline'?`${agentOf('C')} 正在依你的意見改計畫。`:mode==='done'?'已建立新一輪，先前的完成紀錄保留。':scope?.value==='outline'?'已送出，計畫重排後需要你再核准一次。':'已送出補充指示。');};
 async function submitWith(confirm,button){
  if(p.running)return;
  const text=area.value;if(mode!=='stopped'&&!text.trim()){error.textContent=mode==='grill'?'先寫下回答。':'先寫下補充指示。';error.hidden=false;area.focus();return;}
  // 送出前先清草稿避免重建面板時又帶回；失敗時放回並把焦點留在輸入區。
  attachments.lock(true);area.disabled=true;if(reason)reason.disabled=true;if(scope)scope.disabled=true;
  try{const data=payload(confirm);data.attachmentIds=await attachments.ids();saveDraft(t.id,'');await coachAct(t,'instruct',data);attachments.consume(data.attachmentIds);done(text);}
  catch(e){saveDraft(t.id,text);const box=document.getElementById(id);if(box&&!box.value)box.value=text;
   const form2=box?.closest('form')||form;const imp=form2.querySelector('.impact'),err=form2.querySelector('.field-error');
   if(e.code==='CONFIRM_IMPACT'){instructionProposalId=e.plan?.id||null;showImpact(imp,e.message,box);return;}
   err.textContent=`沒有送出：${e.message}`;err.hidden=false;box?.focus();}
  finally{attachments.lock(false);area.disabled=false;if(reason)reason.disabled=false;if(scope)scope.disabled=false;}
 }
 function showImpact(box,message,areaNow){const owner=box.closest('form'),sendNow=owner?.querySelector('[data-focus="send-instruct"]');if(sendNow){sendNow.classList.remove('primary');sendNow.hidden=true;}box.replaceChildren();box.hidden=false;box.append(element('strong','這樣改會動到這些地方'),element('p',message));const ok=focusKey(element('button','知道了，送出','btn primary'),'impact-ok'),cancel=element('button','取消','btn subtle');ok.type='button';cancel.type='button';ok.onclick=busy(ok,()=>submitWith(true,ok));cancel.onclick=()=>{box.hidden=true;box.replaceChildren();if(sendNow){sendNow.hidden=false;if(primary)sendNow.classList.add('primary');}(areaNow||area).focus();};const r=element('div',undefined,'buttons');r.append(ok,cancel);box.append(r);ok.focus();}
 form.onsubmit=e=>{e.preventDefault();if(send.disabled)return;return busy(send,()=>submitWith(false,send))();};
 sync();return form;
}
// 把工作項目的修改導到同一個輸入區，套用範圍自動選好。
function focusInstruct(itemId,note){const form=$('#task-detail .instruct');if(!form)return;const area=form.querySelector('textarea');if(note!==undefined){area.value=note;area.oninput();}const sel=form.querySelector('select');if(sel&&itemId){sel.value=itemId;sel.dispatchEvent(new Event('change'));}form.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});form.querySelector('textarea').focus({preventScroll:true});}

// 任務選單：只處理這一個任務。移到回收桶不與主要送出並列。
function taskMenu(t){
 const slot=$('#task-menu-slot'),was=slot.querySelector('details'),keepOpen=was?.open&&was.dataset.task===t.id,hadFocus=was?.contains(document.activeElement);slot.replaceChildren();if(t.error)return;
 const menu=element('details',undefined,'task-menu');const sum=element('summary');sum.setAttribute('aria-label','任務選單');sum.append(svgIcon('<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',18));menu.append(sum);
 const panel=element('div',undefined,'menu-panel');const busyNow=Boolean(t.planning?.running);
 const trash=element('button','移到回收桶','menu-item');trash.disabled=busyNow;panel.append(trash);
 if(busyNow)panel.append(element('p',t.planning.running.stopping?'還在確認停止，結束後才能移到回收桶。':'AI 執行中。先停止這次執行，確認停止後才能移到回收桶。','small muted'));
 trash.onclick=()=>{menu.open=false;confirmTrash(t);};
 menu.onkeydown=e=>{if(e.key==='Escape'&&menu.open){e.preventDefault();e.stopPropagation();menu.open=false;sum.focus();}};
 menu.append(panel);menu.dataset.task=t.id;slot.append(menu);
 // 背景更新時保持選單開合與焦點
 if(keepOpen)menu.open=true;if(hadFocus)(keepOpen&&!trash.disabled?trash:sum).focus({preventScroll:true});
}
function confirmTrash(t){
 const detail=$('#task-detail');detail.querySelector('.trash-confirm')?.remove();
 const box=element('form',undefined,'trash-confirm');box.setAttribute('aria-label','移到回收桶');
 box.append(element('strong',`把「${t.title}」移到回收桶？`),element('p','任務、對話與事件紀錄一起移到回收桶，可以隨時還原。產出資料夾的檔案不動；同專案的其他任務照常使用專案規則。','small'));
 if(t.planning?.stopped)box.append(element('p','這個任務目前是「已停止」，還原後保持停止，不會自動呼叫 AI。','small muted'));
 const reason=element('input');reason.maxLength=500;reason.placeholder='例如：重複建立';reason.id='trash-reason';const l=element('label',undefined,'instruct-field');l.htmlFor=reason.id;l.append(element('span','原因（選填）','small'),reason);box.append(l);
 const err=element('p','','field-error');err.hidden=true;err.setAttribute('role','alert');box.append(err);
 const ok=focusKey(element('button','移到回收桶','btn'),'trash-ok'),cancel=element('button','取消','btn subtle');ok.type='submit';cancel.type='button';
 cancel.onclick=()=>{box.remove();$('#task-menu-slot summary')?.focus();};box.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancel.click();}};
 box.onsubmit=e=>{e.preventDefault();busy(ok,async()=>{try{const r=await request(`/api/tasks/${t.id}/trash`,{reason:reason.value});tasks=tasks.filter(x=>x.id!==t.id);closeSheet();renderOverview();tell(`已把「${r.trashed.name}」移到回收桶。可以在「回收桶」還原。`);}catch(error){err.textContent=`沒有移動：${error.message}`;err.hidden=false;throw error;}})();};
 const row=element('div',undefined,'buttons');row.append(ok,cancel);box.append(row);detail.prepend(box);reason.focus();
}

// 回收桶頁：還原為主操作；永久刪除只在這裡出現，要輸入完整名稱。
async function renderTrash(){
 const box=$('#trash-list');if(!box)return;box.replaceChildren(element('p','正在讀取回收桶…','muted'));
 let items;try{items=(await request('/api/trash')).items;}catch(e){box.replaceChildren(element('p',`回收桶未載入：${e.message}`,'notice'));return;}
 box.replaceChildren();if(!items.length){box.append(element('p','回收桶是空的。移到回收桶的任務與專案會留在這裡，直到你永久刪除；沒有自動清空期限。','muted'));return;}
 for(const it of items){
  const card=element('article',undefined,'card trash-card');card.dataset.trash=it.id;
  const head=element('div',undefined,'trash-head');head.append(element('span',it.kind==='project'?'專案':'任務',`badge ${it.kind==='project'?'blue':'gray'}`),element('h3',it.name));card.append(head);
  card.append(element('p',`移入於 ${when(it.at)}${it.reason?` · 原因：${it.reason}`:''}`,'small muted'));
  if(it.kind==='project')card.append(element('p',`含 ${it.taskIds.length} 個任務${it.rulesPaused?'；專案規則暫停帶入新任務，還原後恢復':''}。`,'small'));
  if(it.outputs?.length)card.append(element('p',`產出資料夾保留在原處：${it.outputs.join('、')}`,'small muted'));
  const files=element('details');files.append(element('summary',`一起保存的紀錄（${it.files.length}）`));const ul=element('ul',undefined,'small');for(const f of it.files)ul.append(element('li',f));files.append(ul);card.append(files);
  const status=element('p','','small');status.setAttribute('role','status');
  const restore=focusKey(element('button','還原','btn primary'),`restore-${it.id}`),purge=focusKey(element('button','永久刪除紀錄','btn danger-text'),`purge-${it.id}`);
  restore.onclick=busy(restore,async()=>{try{await request(`/api/trash/${it.id}/restore`,{});await loadTasks();tell(`已還原「${it.name}」。${it.kind==='project'&&it.rulesPaused?'專案規則已恢復帶入；':''}任務保持原本狀態，不會自動呼叫 AI。`);await renderTrash();(document.querySelector('#trash-list .btn')||$('#trash-heading'))?.focus();}catch(e){status.textContent=`沒有還原：${e.message}`;throw e;}});
  purge.onclick=()=>confirmPurge(card,it,purge);
  const row=element('div',undefined,'buttons');row.append(restore,purge);card.append(row,status);box.append(card);
 }
}
function confirmPurge(card,it,from){
 card.querySelector('.purge-confirm')?.remove();const form=element('form',undefined,'purge-confirm');
 form.append(element('strong','永久刪除這些紀錄？'),element('p','只刪除上面列出的Mentor紀錄，無法還原；產出檔案保留，另行人工管理。來源 session 不受影響。','small'));
 const input=element('input');input.id=`purge-${it.id}-name`;input.autocomplete='off';input.spellcheck=false;const l=element('label',undefined,'instruct-field');l.htmlFor=input.id;l.append(element('span',`輸入完整名稱「${it.name}」確認`,'small'),input);form.append(l);
 const err=element('p','','field-error');err.hidden=true;err.setAttribute('role','alert');
 const ok=element('button','永久刪除','btn destroy'),cancel=element('button','取消','btn subtle');ok.type='submit';cancel.type='button';ok.disabled=true;
 input.oninput=()=>{ok.disabled=input.value.trim()!==it.name;};
 cancel.onclick=()=>{form.remove();from.focus();};form.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();cancel.click();}};
 form.onsubmit=e=>{e.preventDefault();if(input.value.trim()!==it.name)return;busy(ok,async()=>{try{await request(`/api/trash/${it.id}/purge`,{confirm:input.value});tell(`已永久刪除「${it.name}」的紀錄；產出檔案仍在原處。`);await renderTrash();(document.querySelector('#trash-list .btn')||$('#trash-heading'))?.focus();}catch(error){err.textContent=`沒有刪除：${error.message}`;err.hidden=false;throw error;}})();};
 const row=element('div',undefined,'buttons');row.append(ok,cancel);form.append(err,row);card.append(form);input.focus();
}

// 專案選單：整個專案移到回收桶。有執行中任務時先列出數量，提供「先停止全部執行」。
function projectMenu(p,host){
 const menu=element('details',undefined,'task-menu project-menu');const sum=element('summary','專案選單','btn');menu.append(sum);const panel=element('div',undefined,'menu-panel');const trash=element('button','移到回收桶','menu-item');panel.append(trash);menu.append(panel);
 trash.onclick=()=>{menu.open=false;confirmProjectTrash(p,host,sum);};return menu;
}
async function confirmProjectTrash(p,host,from){
 host.querySelector('.trash-confirm')?.remove();const box=element('form',undefined,'trash-confirm');box.setAttribute('aria-label','專案移到回收桶');host.append(box);
 const status=element('p','','small');status.setAttribute('role','status');const err=element('p','','field-error');err.hidden=true;err.setAttribute('role','alert');
 const reason=element('input');reason.maxLength=500;reason.id='project-trash-reason';reason.placeholder='例如：專案已結束';const l=element('label',undefined,'instruct-field');l.htmlFor=reason.id;l.append(element('span','原因（選填）','small'),reason);
 const ok=focusKey(element('button','移到回收桶','btn'),'project-trash-ok'),stopAll=element('button','先停止全部執行','btn'),cancel=element('button','取消','btn subtle');ok.type='submit';stopAll.type='button';cancel.type='button';
 let timer=null;const close=()=>{clearInterval(timer);box.remove();from.focus();};cancel.onclick=close;box.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();close();}};
 async function refresh(){let s;try{s=await request(`/api/projects/${encodeURIComponent(p.id)}/summary`);}catch(e){status.textContent=e.message;return;}
  const stopping=s.tasks.filter(x=>x.stopping).length;status.textContent=s.running?`${s.total} 個任務，其中 ${s.running} 個執行中${stopping?`（${stopping} 個正在停止）`:''}。全部確認結束後才能移到回收桶。`:`${s.total} 個任務，沒有執行中的 AI。`;
  const hadFocus=box.contains(document.activeElement)&&document.activeElement!==reason;ok.disabled=s.running>0;stopAll.hidden=!s.running||stopping===s.running;if(!s.running){clearInterval(timer);timer=null;if(hadFocus||!box.contains(document.activeElement))ok.focus({preventScroll:true});}else if(!timer)timer=setInterval(()=>{if(!box.isConnected){clearInterval(timer);return;}refresh();},2000);}
 stopAll.onclick=busy(stopAll,async()=>{await request(`/api/projects/${encodeURIComponent(p.id)}/stop-all`,{});await refresh();loadTasks().catch(()=>{});});
 box.onsubmit=e=>{e.preventDefault();busy(ok,async()=>{try{const r=await request(`/api/projects/${encodeURIComponent(p.id)}/trash`,{reason:reason.value,name:p.name});clearInterval(timer);projectState.id=null;await loadTasks();await renderJourney();tell(`已把專案「${r.trashed.name}」與 ${r.trashed.taskIds.length} 個任務移到回收桶。產出資料夾不動，可以在「回收桶」還原。`);}catch(error){err.textContent=`沒有移動：${error.message}`;err.hidden=false;await refresh();throw error;}})();};
 box.append(element('strong',`把專案「${p.name}」移到回收桶？`),element('p','專案說明、專案規則，以及所屬任務的對話與事件會一起移到回收桶，可以還原。產出資料夾不動；這個專案的規則暫停帶入新任務，團隊規則保留。','small'),status,l,err);
 const row=element('div',undefined,'buttons');row.append(ok,stopAll,cancel);box.append(row);ok.disabled=true;stopAll.hidden=true;await refresh();reason.focus();
}

function questionBox(t){
 const box=element('details',undefined,'task-question');box.append(element('summary','有疑問？先問，不改成果'));
 box.append(element('p','只根據任務紀錄回答，不讀寫成果，也不接續自動流程。建議需另經修改預覽確認。','small muted'));
 const labels={question:'提問與解釋',change:'可能希望修改，尚未執行',cancel:'可能希望暫停，尚未變更工作狀態',unclear:'意圖尚待釐清'};
 for(const message of (t.planning.messages||[]).filter(m=>m.kind==='discussion').slice(-4)){
  box.append(element('strong',message.role==='user'?'你的問題':labels[message.discussion?.intent]||'問答紀錄'),element('p',message.text));
  if(message.role==='ai'&&message.discussion?.proposedChange){const use=element('button','帶入修改草稿','btn');use.type='button';use.onclick=()=>focusInstruct(message.discussion.scope,message.discussion.proposedChange);box.append(use);}
 }
 const form=element('form'),area=element('textarea');area.maxLength=6000;area.setAttribute('aria-label','只提問，不修改成果');area.placeholder='例如：這一輪為什麼改了表格？有哪些還沒驗證？';
 const draftKey='question:'+t.id;area.value=composerDrafts[draftKey]||'';area.oninput=()=>{composerDrafts[draftKey]=area.value;};
 const send=element('button','先回答這個問題','btn');send.type='submit';send.disabled=Boolean(t.planning.running||t.planning.stopped);const error=element('p','','field-error');error.setAttribute('role','alert');
 let sent=null;form.append(area,error,send);form.onsubmit=event=>{event.preventDefault();return busy(send,async()=>{
  const question=area.value.trim();if(!question){error.textContent='請先填入問題。';return;}
  if(!sent||sent.question!==question)sent={question,key:crypto.randomUUID()};
  area.disabled=true;
  try{const result=await request(`/api/tasks/${t.id}/ask`,{revision:t.revision,question},{'Idempotency-Key':sent.key});area.value='';delete composerDrafts[draftKey];replaceTask(result.task);ensurePolling();tell('已送出問答；原工作與驗收不會因此變更。');}catch(e){error.textContent=e.message;}finally{area.disabled=false;}
 })();};box.append(form);return box;
}
