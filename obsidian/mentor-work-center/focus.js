/* Shared native/Web focus control. Timer ticks never call a model or write state. */
(function(){
 const organizationLabels={running:'AI 整理中，尚未保存',stopping:'正在確認停止',unknown:'結果未知，先核對原 CLI',failed:'整理失敗，可查看原始回覆',cancelled:'已停止／取消，未當成成果',draft:'草稿已產生，等待你核對',saved:'已有使用者保存版本'};
 const agentLabel=agent=>[({codex:'Codex',claude:'Claude Code',copilot:'GitHub Copilot'})[agent.provider]||agent.provider,agent.modelId||'預設模型',agent.effort||''].filter(Boolean).join(' · ');
 const format=ms=>{const seconds=Math.floor(Math.max(0,ms)/1000);return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');};
 function mountFocus(host,options){
  const doc=host.ownerDocument,api=options.api,now=options.now||Date.now,every=options.setInterval||setInterval,clear=options.clearInterval||clearInterval,key=options.requestKey||(()=>crypto.randomUUID());
  let data=null,drawKey=null,busy=false,disposed=false,pending=null,goal,minutes,display,note,controls,sound=true,audio=null,owned=null,notified=false,lastReceived=0,draftGoal='',draftMinutes='15',draftLink=null,organizationLine=null,organizationSessionId=null;const editedDrafts=new Map();
  const el=(tag,text,cls)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  host.classList.add('mentor-focus');host.replaceChildren();const heading=el('h3','專注一輪'),body=el('div'),materialsPanel=el('section'),message=el('p','','mentor-caption');message.setAttribute('role','status');host.append(heading,body,materialsPanel,message);
  const active=()=>data?.sessions.find(session=>session.id===data.activeId);
  function tick(){
   if(organizationLine){const job=data?.sessions.find(s=>s.id===organizationSessionId)?.organizationRuns?.at(-1);organizationLine.textContent=job?'整理狀態：'+(organizationLabels[job.status]||'未知'):'尚未呼叫 AI 整理。';}
   const s=active();if(!s||!display)return;
   const elapsed=s.elapsedMs+(s.status==='running'?Math.max(0,now()-s.lastEventAt):0),remaining=s.targetMinutes*60000-elapsed;
   display.textContent=s.status==='paused'?`已暫停 · 已計時 ${format(elapsed)}`:remaining>0?`還有 ${format(remaining)}`:`目標時間已到 · 已延長 ${format(-remaining)}`;
   note.textContent=`${s.goal||'本輪目標未填'} · 設定 ${s.targetMinutes} 分鐘。計時不代表實際注意力，睡眠尚未排除。${now()<s.lastEventAt?' 系統時間倒退，請先核對時間。':''}${now()-lastReceived>15000?' 連線狀態待確認；畫面時間為本機推算。':''}`;
   if(s.status==='running'&&remaining<=0&&owned===s.id&&!notified){notified=true;message.textContent='目標時間已到，計時繼續；你可以繼續寫，準備好再結束。';options.onTarget?.();if(sound&&audio){try{const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.connect(gain);gain.connect(audio.destination);gain.gain.value=0.12;oscillator.frequency.value=660;oscillator.start();oscillator.stop(audio.currentTime+0.35);}catch{message.textContent+=' 聲音未能播放。';}}}
  }
  function button(parent,label,fn){const b=el('button',label,'btn');b.type='button';b.onclick=async()=>{if(busy)return;try{await fn();}catch(error){message.textContent='未完成：'+error.message;}};parent.append(b);return b;}
  async function mutate(action,extra={}){
   if(busy||!data)return;if(pending&&pending.action!==action){message.textContent='請先重試未確認的操作，再進行其他動作。';return;}busy=true;for(const b of host.querySelectorAll('button'))b.disabled=true;
   const input=pending?.action===action?pending.input:{revision:data.revision,requestKey:key(),...(action==='start'?extra:{sessionId:active()?.id,...extra})};pending={action,input};retry.hidden=false;
   try{
    const result=await api('/focus/'+action,input);if(disposed)return;data=result;lastReceived=now();pending=null;retry.hidden=true;
    if(action==='start'){owned=result.operationSessionId||result.activeId;notified=false;draftGoal='';draftLink=null;}message.textContent=action==='end'?'本輪計時已保存；有選定來源時可核對快照。AI 整理需另行確認。':action==='cancel'?'已取消本輪，計時紀錄保留。':'專注狀態已同步。';drawKey=null;render();
   }catch(error){if(!disposed){if(['FOCUS_REVISION_CONFLICT','FOCUS_ALREADY_ACTIVE','FOCUS_INPUT_INVALID','FOCUS_SOURCE_INVALID','FOCUS_STATE_CONFLICT','FOCUS_CLOCK_CHANGED'].includes(error.code)){pending=null;retry.hidden=true;}message.textContent='操作未完成：'+error.message+(pending?'。請重試未確認操作。':'。請重新核對狀態。');}}
   finally{busy=false;if(!disposed)for(const b of host.querySelectorAll('button'))b.disabled=false;}
  }
  function render(){
   const s=active(),latest=data.sessions.at(-1),nextKey=s?s.id+':'+s.status:'idle:'+latest?.id+':'+latest?.materials?.afterStatus+':'+latest?.materials?.afterSha256;if(nextKey===drawKey){tick();return;}if(drawKey?.startsWith('idle:')){draftGoal=goal?.value||'';draftMinutes=minutes?.value||'15';}drawKey=nextKey;body.replaceChildren();materialsPanel.replaceChildren();display=null;organizationLine=null;organizationSessionId=null;
   if(s){
    display=el('p','','mentor-focus-clock');display.setAttribute('role','timer');display.setAttribute('aria-live','off');note=el('p','','mentor-caption');controls=el('div',undefined,'mentor-actions');body.append(display,note,controls);if(s.taskId)body.append(el('p','關聯任務：'+s.taskId+'；結束專注不代表任務完成。','mentor-caption'));if(s.materials)body.append(el('p','已選來源：'+s.materials.sourcePath+'；切換筆記不改變本輪範圍。','mentor-caption'));
    button(controls,s.status==='paused'?'繼續專注':'暫停',()=>mutate(s.status==='paused'?'resume':'pause'));button(controls,'結束這一輪',async()=>{const extra=options.captureEnd&&s.materials&&!pending?{sourceAfter:await options.captureEnd(s.materials.sourcePath)}:{};await mutate('end',extra);});button(controls,'取消這一輪',()=>mutate('cancel'));tick();
   }else{
    const startBox=el(latest?'details':'div');if(latest){startBox.append(el('summary','開始下一輪專注'));if(draftLink)startBox.open=true;}body.append(startBox);if(draftLink){startBox.append(el('p','關聯任務：'+draftLink.title+'（'+draftLink.taskId+'）；僅記錄關聯，不更動任務進度。','mentor-caption'));button(startBox,'移除任務關聯',async()=>{draftGoal=goal?.value||draftGoal;draftMinutes=minutes?.value||draftMinutes;draftLink=null;drawKey=null;render();});}
    const label=el('label','本輪想完成什麼（選填）');goal=el('input');goal.type='text';goal.value=draftGoal;goal.maxLength=1000;goal.setAttribute('aria-label','本輪想完成什麼');goal.placeholder='例如：整理三個設計取捨';label.append(goal);startBox.append(label);
    const duration=el('div',undefined,'mentor-actions');minutes=el('input');minutes.type='number';minutes.min='1';minutes.max='180';minutes.step='1';minutes.value=draftMinutes;minutes.setAttribute('aria-label','專注分鐘數');
    for(const value of [10,15,30]){const b=button(duration,value+' 分鐘',async()=>{minutes.value=String(value);for(const control of duration.querySelectorAll('button'))control.setAttribute('aria-pressed',String(control===b));});b.setAttribute('aria-pressed',String(value===Number(minutes.value)));}
    minutes.oninput=()=>{for(const b of duration.querySelectorAll('button'))b.setAttribute('aria-pressed',String(Number(minutes.value)===Number(b.textContent.split(' ')[0])));};
    const custom=el('label','自訂分鐘：');custom.append(minutes);const hint=el('p','1–180 分鐘；到時只提醒，計時繼續。計時不呼叫 AI。','mentor-caption');startBox.append(duration,custom,hint);
    const soundLabel=el('label'),toggle=el('input');toggle.type='checkbox';toggle.checked=sound;toggle.onchange=()=>sound=toggle.checked;soundLabel.append(toggle,doc.createTextNode('到時播放提示音（需開始這輪的畫面仍開啟；睡眠時不保證響鈴）'));startBox.append(soundLabel);
    button(startBox,'開始專注',async()=>{
     const targetMinutes=Number(minutes.value);if(!Number.isInteger(targetMinutes)||targetMinutes<1||targetMinutes>180){message.textContent='請填入 1–180 的整數分鐘。';return;}
     if(sound&&!audio){try{const Audio=options.AudioContext||(typeof window!=='undefined'&&(window.AudioContext||window.webkitAudioContext));if(Audio){audio=new Audio();await audio.resume();}}catch{audio=null;}}
     const source=options.captureStart&&!pending?await options.captureStart():{};if(source===null)return;await mutate('start',{targetMinutes,goal:goal.value,...(draftLink?{taskId:draftLink.taskId}:{}),...source});
    });
    if(latest){body.append(el('p',`上一輪：${latest.status==='ended'?'已結束':'已取消'} · ${latest.goal||'目標未填'} · 計時 ${format(latest.elapsedMs)}。`,'mentor-caption'));
     if(latest.materials){organizationLine=el('p','','mentor-caption');organizationSessionId=latest.id;body.append(organizationLine);button(body,'查看 AI 整理與保存版本',()=>showOrganization(latest));button(body,'核對本輪材料與變更',()=>showMaterials(latest));if(latest.status==='ended'&&['unavailable','not_captured'].includes(latest.materials.afterStatus)&&options.captureEnd)button(body,'補記目前來源內容（較晚快照）',async()=>{const sourceAfter=await options.captureEnd(latest.materials.sourcePath);if(sourceAfter.status==='unavailable')throw Error('仍無法讀取來源，沒有補記。');await mutate('capture',{sessionId:latest.id,sourceAfter});});}
    }
   }
   const previous=data.sessions.slice(0,-1);if(previous.length){const history=el('details');history.append(el('summary',`先前專注與整理（${previous.length}）`));for(const session of [...previous].reverse()){const row=el('div');row.append(el('p',session.goal||'目標未填'));if(session.materials)button(row,'核對這輪材料',()=>showMaterials(session));if(session.organizationRuns?.length)button(row,'查看這輪整理',()=>showOrganization(session));history.append(row);}body.append(history);}
   tick();
  }
  async function showMaterials(session){
   const {comparison:c}=await api('/focus/materials?sessionId='+encodeURIComponent(session.id));if(disposed)return;
   materialsPanel.replaceChildren();materialsPanel.append(el('h4','本輪保存材料（送出前可選片段）'),el('p',c.note,'mentor-caption'));
   if(!c.before)return;materialsPanel.append(el('p',c.before.path),el('p','開始 SHA-256：'+c.before.sha256,'mentor-caption'));
   if(c.index?.lateCapture)materialsPanel.append(el('p','結束材料是較晚補記，不代表結束當時的內容。','mentor-caption'));
   const original=el('details');original.append(el('summary','閱讀開始快照'),el('pre',c.before.content,'mentor-source'));materialsPanel.append(original);
   if(c.after?.status==='present'){materialsPanel.append(el('p','結束 SHA-256：'+c.after.sha256,'mentor-caption'));const end=el('details');end.append(el('summary','閱讀結束快照'),el('pre',c.after.content,'mentor-source'));materialsPanel.append(end);}
   else materialsPanel.append(el('p',c.after?.status==='missing'?'原來源路徑目前找不到筆記；可能已搬移或刪除。':'未取得結束快照，不推論沒有產出。','mentor-caption'));
   if(c.region){materialsPanel.append(el('h4',c.status==='unchanged'?'內容沒有變更':'整段變更範圍（不是最小逐行差異）'));if(c.status!=='unchanged')materialsPanel.append(el('p','開始時'),el('pre',c.region.before.join('\n'),'mentor-source'),el('p','結束時'),el('pre',c.region.after.join('\n'),'mentor-source'));}
   if(c.after&&c.after.status!=='unavailable'&&session.status==='ended')organizationForm(session,c);
  }
  function organizationForm(session,c){
   const form=el('section'),review=el('section');form.append(el('h4','選擇送給 AI 的來源片段'),el('p','來源合計最多 6,000 字，需保留快照中的連續片段；自己的新想法放在補充。超過上限請自行縮小，不自動截斷。','mentor-caption'));
   const field=(label,value,max)=>{const host=el('label',label),input=el('textarea');input.setAttribute('aria-label',label);input.value=value;input.maxLength=max;input.rows=5;host.append(input);form.append(host);return input;};
   const before=field('開始快照片段',c.status==='unchanged'?'':c.region?.before.join('\n')||'',6000),after=field('結束快照片段',c.status==='unchanged'?c.after.content:c.region?.after.join('\n')||'',6000),reflection=field('自己的補充（選填）','',1000);
   let submission=null;
   button(form,'預覽送給 AI 的內容與模型',async()=>{
    const input={revision:data.revision,sessionId:session.id,beforeText:before.value,afterText:after.value,reflection:reflection.value};const {plan}=await api('/focus/prepare-organization',input);if(disposed)return;review.replaceChildren();
    review.append(el('h4','確認這次 AI 整理'),el('p','模型指派：'+agentLabel(plan.agent)),el('p',`${plan.metrics.characters} 字元／${plan.metrics.utf8Bytes} bytes；Token 與費用未知。`,'mentor-caption'),el('p',plan.note,'mentor-caption'));
    const prompt=el('details');prompt.append(el('summary','閱讀這次完整 Prompt'),el('pre',plan.prompt,'mentor-source'));review.append(prompt);
    button(review,'確認這份材料，呼叫 AI 整理',async()=>{
     if(submission&&submission.planId!==plan.id)throw Error('先核對上一次未確認的整理要求。');
     submission||={...input,planId:plan.id,requestKey:key()};
     const result=await api('/focus/organize',submission);submission=null;message.textContent='AI 整理已啟動；尚未保存為成果。';await refresh();await showOrganization(session,result.jobId);
    });
    button(review,'暫不呼叫 AI',async()=>{review.replaceChildren();});
   });form.append(review);materialsPanel.append(form);
  }
  async function showOrganization(session,jobId){
   const response=await api('/focus/organization?sessionId='+encodeURIComponent(session.id)+(jobId?'&jobId='+encodeURIComponent(jobId):''));if(disposed)return;
   materialsPanel.replaceChildren();materialsPanel.append(el('h4','本輪 AI 整理（不等於任務驗收）'));
   const job=response.job;if(!job){materialsPanel.append(el('p','尚未啟動 AI；請先核對材料，再預覽這次要送出的片段。'));button(materialsPanel,'核對本輪材料',()=>showMaterials(session));return;}
   materialsPanel.append(el('p',`狀態：${organizationLabels[job.status]||'未知'} · 模型指派：${agentLabel(job.agent)}`,'mentor-caption'));
   if(job.simulated)materialsPanel.append(el('p','示範／模擬回覆，未呼叫真實 CLI，不作為實際 AI 產出或驗收證據。','notice'));
   if(job.responseSaved===false)materialsPanel.append(el('p','回覆不是有效文字或超過保存上限，未保存全文；保留的 hash 與大小可在執行紀錄核對。','mentor-caption'));
   if(job.error)materialsPanel.append(el('p',job.error,'notice'));
   if(job.usage){const usage=el('details');usage.append(el('summary','查看 CLI 回報用量（不是帳單）'),el('pre',JSON.stringify(job.usage,null,2),'mentor-source'));materialsPanel.append(usage);}else materialsPanel.append(el('p','Token 與費用未取得，不當成零。','mentor-caption'));
   const provenance=el('details');provenance.append(el('summary','來源、Prompt 與原始回覆'),el('pre',JSON.stringify({sources:job.sources,runtime:job.runtime,prompt:job.prompt,response:job.response||null,responseSaved:job.responseSaved,responseSha256:job.responseSha256,responseCharacters:job.responseCharacters},null,2),'mentor-source'));materialsPanel.append(provenance);
   button(materialsPanel,'重新讀取這份整理',()=>showOrganization(session,job.id));
   if(['running','stopping'].includes(job.status)){
    let stop=null;button(materialsPanel,'停止這次 AI 整理',async()=>{stop||={revision:response.revision,sessionId:session.id,jobId:job.id,requestKey:key()};await api('/focus/stop-organization',stop);message.textContent='停止要求已送出，尚待確認。';await refresh();await showOrganization(session,job.id);});
   }
   if(job.status==='unknown'){
    const label=el('label'),confirmed=el('input');confirmed.type='checkbox';label.append(confirmed,doc.createTextNode('我已核對並確認原 CLI 已停止；不把舊結果當成完成。'));materialsPanel.append(label);
    button(materialsPanel,'確認已停止，解除未知狀態',async()=>{if(!confirmed.checked)throw Error('請先實際核對原 CLI，再勾選確認。');await api('/focus/reconcile-organization',{revision:response.revision,sessionId:session.id,jobId:job.id,requestKey:key(),confirmStopped:true});await refresh();await showOrganization(session,job.id);});
   }
   if(['draft','saved'].includes(job.status)){
    const label=el('label','核對並修改整理草稿'),draft=el('textarea');draft.setAttribute('aria-label','核對並修改整理草稿');draft.rows=14;draft.maxLength=20000;draft.value=editedDrafts.get(job.id)??job.publications.at(-1)?.content??job.draft;draft.oninput=()=>editedDrafts.set(job.id,draft.value);label.append(draft);materialsPanel.append(label,el('p','只保存你核對的版本；保留來源索引，不修改原筆記、不建立任務，也不自動驗收。','mentor-caption'));
    let saveRequest=null;button(materialsPanel,'保存這份整理到 Mentor',async()=>{
     if(saveRequest&&saveRequest.content!==draft.value)throw Error('上次保存尚未確認，先重試原內容，再修改。');
     editedDrafts.set(job.id,draft.value);saveRequest||={revision:response.revision,sessionId:session.id,jobId:job.id,draftRevision:job.draftRevision,content:draft.value,requestKey:key()};
     await api('/focus/save-organization',saveRequest);saveRequest=null;editedDrafts.delete(job.id);message.textContent='這份整理已保存到 Mentor；原筆記與任務驗收未改動。';await refresh();await showOrganization(session,job.id);
    });
   }
   for(const publication of job.publications||[]){
    const row=el('div');row.append(el('p','已保存版本：'+publication.id,'mentor-caption'));
    if(options.exportMarkdown)button(row,options.exportLabel||'匯出這個保存版本',async()=>{const output=await api('/focus/export?sessionId='+encodeURIComponent(session.id)+'&jobId='+encodeURIComponent(job.id)+'&publicationId='+encodeURIComponent(publication.id));await options.exportMarkdown(output);});materialsPanel.append(row);
   }
   if(response.jobs.length>1){const older=el('details');older.append(el('summary','先前整理執行（保留失敗與原始回覆）'));for(const other of response.jobs.filter(other=>other.id!==job.id))button(older,(organizationLabels[other.status]||'未知')+' · '+other.id.slice(0,8),()=>showOrganization(session,other.id));materialsPanel.append(older);}
  }
  async function refresh(){if(disposed||busy)return;try{const result=await api('/focus');if(disposed||busy||result.revision<(data?.revision||0))return;data=result;lastReceived=now();render();return true;}catch(error){if(!disposed)message.textContent='專注狀態未同步：'+error.message;return false;}}
  const retry=button(host,'重試未確認操作',()=>pending&&mutate(pending.action));retry.hidden=true;button(host,'重新核對專注狀態',refresh);const tickTimer=every(tick,1000),pollTimer=every(refresh,5000);void refresh();
  async function prepareTask(context){
   if(disposed||busy||pending)throw Error('請先完成目前未確認的專注操作。');
   if(!context||!/^TASK-[a-zA-Z0-9-]+$/.test(context.taskId)||typeof context.title!=='string'||typeof context.goal!=='string'||context.goal.length>1000)throw Error('任務關聯或目標格式不正確。');
   if(!await refresh())throw Error('請先核對專注狀態，再準備任務計時。');
   if(active())throw Error('已有進行中的專注；請先結束或取消，不會替換原任務。');
   const current=goal?.value||draftGoal;if(current&&draftLink?.taskId!==context.taskId)throw Error('專注目標已有未開始的草稿；請先清空目標或完成該輪，再切換任務。');
   draftMinutes=minutes?.value||draftMinutes;draftLink={taskId:context.taskId,title:context.title};draftGoal=current||context.goal;drawKey=null;render();message.textContent='已帶入任務目標，請核對時間後按開始；尚未開始計時。';
  }
  return {refresh,prepareTask,destroy(){disposed=true;clear(tickTimer);clear(pollTimer);if(audio)void audio.close().catch(()=>{});host.replaceChildren();}};
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={mountFocus,format};else window.MentorFocus={mountFocus,format};
})();
