/* Shared native/Web focus control. Timer ticks never call a model or write state. */
(function(){
 const format=ms=>{const seconds=Math.floor(Math.max(0,ms)/1000);return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');};
 function mountFocus(host,options){
  const doc=host.ownerDocument,api=options.api,now=options.now||Date.now,every=options.setInterval||setInterval,clear=options.clearInterval||clearInterval,key=options.requestKey||(()=>crypto.randomUUID());
  let data=null,drawKey=null,busy=false,disposed=false,pending=null,goal,minutes,display,note,controls,sound=true,audio=null,owned=null,notified=false,lastReceived=0,draftGoal='',draftMinutes='15';
  const el=(tag,text,cls)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  host.classList.add('mentor-focus');host.replaceChildren();const heading=el('h3','專注一輪'),body=el('div'),materialsPanel=el('section'),message=el('p','','mentor-caption');message.setAttribute('role','status');host.append(heading,body,materialsPanel,message);
  const active=()=>data?.sessions.find(session=>session.id===data.activeId);
  function tick(){
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
    if(action==='start'){owned=result.operationSessionId||result.activeId;notified=false;}message.textContent=action==='end'?'本輪計時已保存。可核對已保存材料；AI 整理尚未接上，原筆記未修改。':action==='cancel'?'已取消本輪，計時紀錄保留。':'專注狀態已同步。';drawKey=null;render();
   }catch(error){if(!disposed){if(['FOCUS_REVISION_CONFLICT','FOCUS_ALREADY_ACTIVE','FOCUS_INPUT_INVALID','FOCUS_SOURCE_INVALID','FOCUS_STATE_CONFLICT','FOCUS_CLOCK_CHANGED'].includes(error.code)){pending=null;retry.hidden=true;}message.textContent='操作未完成：'+error.message+(pending?'。請重試未確認操作。':'。請重新核對狀態。');}}
   finally{busy=false;if(!disposed)for(const b of host.querySelectorAll('button'))b.disabled=false;}
  }
  function render(){
   const s=active(),latest=data.sessions.at(-1),nextKey=s?s.id+':'+s.status:'idle:'+latest?.id+':'+latest?.materials?.afterStatus+':'+latest?.materials?.afterSha256;if(nextKey===drawKey){tick();return;}if(drawKey?.startsWith('idle:')){draftGoal=goal?.value||'';draftMinutes=minutes?.value||'15';}drawKey=nextKey;body.replaceChildren();materialsPanel.replaceChildren();display=null;
   if(s){
    display=el('p','','mentor-focus-clock');display.setAttribute('role','timer');display.setAttribute('aria-live','off');note=el('p','','mentor-caption');controls=el('div',undefined,'mentor-actions');body.append(display,note,controls);if(s.materials)body.append(el('p','已選來源：'+s.materials.sourcePath+'；切換筆記不改變本輪範圍。','mentor-caption'));
    button(controls,s.status==='paused'?'繼續專注':'暫停',()=>mutate(s.status==='paused'?'resume':'pause'));button(controls,'結束這一輪',async()=>{const extra=options.captureEnd&&s.materials&&!pending?{sourceAfter:await options.captureEnd(s.materials.sourcePath)}:{};await mutate('end',extra);});button(controls,'取消這一輪',()=>mutate('cancel'));tick();
   }else{
    const label=el('label','本輪想完成什麼（選填）');goal=el('input');goal.type='text';goal.value=draftGoal;goal.maxLength=1000;goal.setAttribute('aria-label','本輪想完成什麼');goal.placeholder='例如：整理三個設計取捨';label.append(goal);body.append(label);
    const duration=el('div',undefined,'mentor-actions');minutes=el('input');minutes.type='number';minutes.min='1';minutes.max='180';minutes.step='1';minutes.value=draftMinutes;minutes.setAttribute('aria-label','專注分鐘數');
    for(const value of [10,15,30]){const b=button(duration,value+' 分鐘',async()=>{minutes.value=String(value);for(const control of duration.querySelectorAll('button'))control.setAttribute('aria-pressed',String(control===b));});b.setAttribute('aria-pressed',String(value===Number(minutes.value)));}
    minutes.oninput=()=>{for(const b of duration.querySelectorAll('button'))b.setAttribute('aria-pressed',String(Number(minutes.value)===Number(b.textContent.split(' ')[0])));};
    const custom=el('label','自訂分鐘：');custom.append(minutes);const hint=el('p','1–180 分鐘；到時只提醒，計時繼續。計時不呼叫 AI。','mentor-caption');body.append(duration,custom,hint);
    const soundLabel=el('label'),toggle=el('input');toggle.type='checkbox';toggle.checked=sound;toggle.onchange=()=>sound=toggle.checked;soundLabel.append(toggle,doc.createTextNode('到時播放提示音（需開始這輪的畫面仍開啟；睡眠時不保證響鈴）'));body.append(soundLabel);
    button(body,'開始專注',async()=>{
     const targetMinutes=Number(minutes.value);if(!Number.isInteger(targetMinutes)||targetMinutes<1||targetMinutes>180){message.textContent='請填入 1–180 的整數分鐘。';return;}
     if(sound&&!audio){try{const Audio=options.AudioContext||(typeof window!=='undefined'&&(window.AudioContext||window.webkitAudioContext));if(Audio){audio=new Audio();await audio.resume();}}catch{audio=null;}}
     const source=options.captureStart&&!pending?await options.captureStart():{};if(source===null)return;await mutate('start',{targetMinutes,goal:goal.value,...source});
    });
    if(latest){body.append(el('p',`上一輪：${latest.status==='ended'?'已結束':'已取消'} · ${latest.goal||'目標未填'} · 計時 ${format(latest.elapsedMs)}。尚未產生 AI 整理。`,'mentor-caption'));
     if(latest.materials){button(body,'核對本輪材料與變更',()=>showMaterials(latest));if(latest.status==='ended'&&['unavailable','not_captured'].includes(latest.materials.afterStatus)&&options.captureEnd)button(body,'補記目前來源內容（較晚快照）',async()=>{const sourceAfter=await options.captureEnd(latest.materials.sourcePath);if(sourceAfter.status==='unavailable')throw Error('仍無法讀取來源，沒有補記。');await mutate('capture',{sessionId:latest.id,sourceAfter});});}
    }
   }
  }
  async function showMaterials(session){
   const {comparison:c}=await api('/focus/materials?sessionId='+encodeURIComponent(session.id));if(disposed)return;
   materialsPanel.replaceChildren();materialsPanel.append(el('h4','本輪材料（尚未交給 AI）'),el('p',c.note,'mentor-caption'));
   if(!c.before)return;materialsPanel.append(el('p',c.before.path),el('p','開始 SHA-256：'+c.before.sha256,'mentor-caption'));
   if(c.index?.lateCapture)materialsPanel.append(el('p','結束材料是較晚補記，不代表結束當時的內容。','mentor-caption'));
   const original=el('details');original.append(el('summary','閱讀開始快照'),el('pre',c.before.content,'mentor-source'));materialsPanel.append(original);
   if(c.after?.status==='present'){materialsPanel.append(el('p','結束 SHA-256：'+c.after.sha256,'mentor-caption'));const end=el('details');end.append(el('summary','閱讀結束快照'),el('pre',c.after.content,'mentor-source'));materialsPanel.append(end);}
   else materialsPanel.append(el('p',c.after?.status==='missing'?'原來源路徑目前找不到筆記；可能已搬移或刪除。':'未取得結束快照，不推論沒有產出。','mentor-caption'));
   if(c.region){materialsPanel.append(el('h4',c.status==='unchanged'?'內容沒有變更':'整段變更範圍（不是最小逐行差異）'));if(c.status!=='unchanged')materialsPanel.append(el('p','開始時'),el('pre',c.region.before.join('\n'),'mentor-source'),el('p','結束時'),el('pre',c.region.after.join('\n'),'mentor-source'));}
  }
  async function refresh(){if(disposed||busy)return;try{const result=await api('/focus');if(disposed||busy||result.revision<(data?.revision||0))return;data=result;lastReceived=now();render();}catch(error){if(!disposed)message.textContent='專注狀態未同步：'+error.message;}}
  const retry=button(host,'重試未確認操作',()=>pending&&mutate(pending.action));retry.hidden=true;button(host,'重新核對專注狀態',refresh);const tickTimer=every(tick,1000),pollTimer=every(refresh,5000);void refresh();
  return {refresh,destroy(){disposed=true;clear(tickTimer);clear(pollTimer);if(audio)void audio.close().catch(()=>{});host.replaceChildren();}};
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={mountFocus,format};else window.MentorFocus={mountFocus,format};
})();
