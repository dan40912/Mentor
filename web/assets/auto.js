// 「現在要做的一件事」：說清楚第幾步、為什麼停、只剩什麼要你做。
// 一路做到完：你按一次就是授權整條鏈；AI 只在需要你時停下來。
const autoFull=()=>{try{return localStorage.getItem('awc-full')==='1';}catch{return false;}};
function decorateOneThing(t,{one,oneText,jump}){
 const p=t.planning;if(!p||p.phase==='done'||p.running||p.stopped)return;
 const ap=p.autopilot,wait=ap?.waitingFor;
 const tr=trackOf(t),idx=Math.max(0,tr.nodes.findIndex(n=>n.state==='now')),step=`第 ${idx+1}／${tr.nodes.length} 步 · ${tr.nodes[idx]?.name||''}`;
 const eyebrow=oneText.querySelector('.eyebrow'),label=oneText.querySelector('strong');jump.remove();
 const actions=element('div',undefined,'one-actions');
 const off=()=>{const b=element('button','關閉自動','btn subtle');b.dataset.focus='auto-off';b.onclick=busy(b,async()=>{await coachAct(t,'autopilot',{on:false});tell('已關閉自動，之後每一步由你按。');});return b;};
 const runAuto=(text,primary,provider)=>{const b=focusKey(element('button',text,primary?'btn primary':'btn'),provider?`auto-${provider}`:'auto');b.onclick=busy(b,async()=>{await coachAct(t,'autopilot',{full:fullBox?.checked??Boolean(ap?.full),provider:provider||undefined});tell(provider?`已改用 ${state.providers.find(x=>x.id===provider)?.name} 繼續，角色設定沒有改變。`:'AI 開始一路做；需要你時會停下來說明。');});return b;};
 let fullBox=null;
 const fullChoice=(upgrade=false)=>{const l=element('label',undefined,'check-line'),c=element('input');c.type='checkbox';c.checked=upgrade?false:autoFull();c.dataset.focus=upgrade?'auto-full':'full';c.onchange=upgrade?busy(c,async()=>{if(!c.checked)return;try{await coachAct(t,'autopilot',{full:true});}catch(error){c.checked=false;throw error;}}):()=>{try{localStorage.setItem('awc-full',c.checked?'1':'0');}catch{}};fullBox=c;const span=element('span');span.append(element('strong',upgrade?'改成完全自動':'完全自動'),element('small','計畫不用你核准，每一項 AI 自己檢查過就做下一項。全部做完，你再一次看。'));l.append(c,span);return l;};
 if(ap&&!wait){ // 自動進行中，兩步之間
  one.classList.add('is-auto');eyebrow.textContent=`AI 自動進行中 · ${step}`;label.textContent='AI 自己在跑。需要你時會停下來叫你。';actions.append(off());one.append(actions);return;
 }
 if(ap&&wait){
  one.classList.add('is-parked');eyebrow.textContent=`需要你看一下 · ${step}`;label.textContent=wait.label;
  if(wait.kind==='error'){
   const go=focusKey(element('button',`去處理：${t.nextAction.button}`,'btn'),'jump');go.onclick=()=>jumpToNext(t);actions.append(go);
   const stage=state.stages.find(s=>s.id===wait.stage),current=p.learningTurns?.at(-1)?.provider;
   actions.append(runAuto('用同一個 AI 繼續',true));
   for(const prov of state.providers.filter(x=>x.runnable&&x.id!==current&&(!stage||x.modes.includes(stage.mode))))actions.append(runAuto(`改用 ${prov.name} 繼續這一次`,false,prov.id));
   one.append(actions,element('p','只換這一次，角色設定不會改。',"auto-note"));
  }else{
   const go=element('button',wait.kind==='approve'?'先看計畫':wait.kind==='confirm'?'先看成果':`去處理：${t.nextAction.button}`,['approve','confirm'].includes(wait.kind)?'btn':'btn primary');go.dataset.focus='jump';go.onclick=()=>jumpToNext(t);actions.append(go);
   if(wait.kind==='approve'){const approve=focusKey(element('button','核准，讓 AI 繼續跑','btn primary'),'approve');approve.onclick=busy(approve,async()=>{await coachAct(t,'approve');});actions.prepend(approve);}
   const reviewed=(p.workItems||[]).filter(i=>i.owner==='ai'&&i.status==='REVIEWED');
   if(wait.kind==='confirm'&&reviewed.length){go.className='btn';const all=focusKey(element('button','確認通過，讓 AI 繼續','btn primary'),'confirm-all');all.onclick=busy(all,async()=>{await coachAct(t,'confirm-all');tell(`已確認 ${reviewed.length} 項。AI 會接著做下一步。`);});actions.prepend(all);}
   actions.append(off());one.append(actions,element('p',{answer:'你回答後，AI 會自己接著往下做。',approve:'看過成品架構和要做的事，沒問題就按核准，AI 會一路做到驗收完。',confirm:'確認後，AI 會自己接著做剩下的項目。',human:'你完成這一項後，AI 會自己接著往下做。','fix-limit':'看過驗收意見後，可以寫修改指示，AI 會繼續。','needs-info':wait.blocked==='tool'?'AI 的環境做不到這件事。可以改驗收標準、自己完成這部分，或寫指示讓它換個方法。':'補上資訊後，AI 會繼續。',wait:'前置項目完成後會繼續。'}[wait.kind]||'','auto-note'));
  }
  if(!ap.full)one.append(fullChoice(true));
  return;
 }
 // 沒開自動：第一顆按鈕就是一路做到完
 eyebrow.textContent=`${step} · 你現在要做的一件事`;
 const aiStep=['handoff','retry'].includes(t.nextAction.kind)||holderOf(t)==='ai-ready';
 const reviewed=(p.workItems||[]).filter(i=>i.owner==='ai'&&i.status==='REVIEWED');
 if(aiStep){actions.append(runAuto('交給 AI 一路做到完',true));const go=element('button',`只做這一步：${t.nextAction.button}`,'btn subtle');go.onclick=()=>jumpToNext(t);actions.append(go);}
 else{const go=element('button',`前往：${t.nextAction.button}`,'btn primary');go.dataset.focus='jump';go.onclick=()=>jumpToNext(t);actions.append(go);
  if(reviewed.length>1){const all=focusKey(element('button',`確認全部通過（${reviewed.length} 項）`,'btn'),'confirm-all');all.onclick=busy(all,async()=>{await coachAct(t,'confirm-all');tell(`已確認 ${reviewed.length} 項。`);});actions.append(all);}
  actions.append(runAuto('這步之後交給 AI 跑完',false));}
 one.append(actions,fullChoice(),element('p','AI 會自己跑到需要你的地方才停下來，並說明為什麼停。隨時可以停止。','auto-note'));
}
function jumpToNext(t){const detail=$('#task-detail');const target=(t.nextAction.kind==='item'&&detail.querySelector(`[data-item="${t.nextAction.id}"]`))||detail.querySelector(`[data-anchor="${t.nextAction.kind}"]`)||detail.querySelector('.control-bar')||detail.querySelector('[data-anchor=handoff]');target?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});const one=detail.querySelector('.one-thing');if(['grill','outline'].includes(t.nextAction.kind)&&!t.planning?.readyForOutline||t.nextAction.kind==='stopped'){const box=detail.querySelector('.instruct textarea');if(box){box.scrollIntoView({block:'center',behavior:'auto'});box.focus({preventScroll:true});return;}}const buttons=[...detail.querySelectorAll('button:not(:disabled)')].filter(b=>!one.contains(b));(buttons.find(b=>target?.contains(b)&&b.textContent.startsWith(t.nextAction.button))||buttons.find(b=>b.textContent.startsWith(t.nextAction.button))||target?.querySelector('.btn.primary:not(:disabled)')||target?.querySelector('textarea,input,button'))?.focus({preventScroll:true});}
