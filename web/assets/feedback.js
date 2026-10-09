// 回饋表單：確認成果、自動停下、任務完成時，用 1–5 分與標籤問你一題。
// 總覽的「AI 從回饋學到的方向」就是下一個任務開工時帶進 prompt 的內容。
function feedbackCard(t){
 const f=t.feedbackPrompt;if(!f)return null;
 const card=focusKey(element('section',undefined,'feedback-card'),'feedback');card.setAttribute('aria-label','回饋表單');
 const head=element('div');head.append(element('div',{confirm:'回饋 · 確認成果',park:'回饋 · 這次停下',done:'回饋 · 任務總評'}[f.moment]+' · 約 20 秒','eyebrow'),element('strong',f.question),element('p',f.about,'small muted'));card.append(head);
 const scale=element('fieldset',undefined,'fb-scale');scale.append(element('legend','評分（1 最差，5 最好）','visually-hidden'));
 const send=focusKey(element('button','送出回饋','btn primary'),'feedback-send');
 f.scale.forEach((label,i)=>{const l=element('label'),r=element('input');r.type='radio';r.name=`fb-${t.id}`;r.value=String(i+1);const s=element('span');s.append(element('b',String(i+1)),element('small',label));l.append(r,s);scale.append(l);});
 const tags=element('fieldset',undefined,'fb-tags');tags.append(element('legend','哪些描述符合？可複選','small muted'));
 for(const tag of f.tags){const l=element('label'),c=element('input');c.type='checkbox';c.name=`fb-tag-${t.id}`;c.value=tag;l.append(c,element('span',tag));tags.append(l);}
 const note=element('textarea');note.maxLength=500;note.rows=2;note.placeholder='補一句（選填）：下次希望怎麼做？';note.setAttribute('aria-label','補充說明');
 const skip=focusKey(element('button','這次不評','btn subtle'),'feedback-skip');
 // 狀態從畫面讀：背景更新重繪後，restoreForm 只放回勾選，不會觸發 change。
 send.onclick=busy(send,async()=>{const score=Number(card.querySelector('.fb-scale input:checked')?.value||0);if(!score){tell('先選 1 到 5 分。');return;}const picked=[...card.querySelectorAll('.fb-tags input:checked')].map(c=>c.value);await coachAct(t,'feedback',{ref:f.ref,score,tags:picked,note:note.value});tell(score<=3?'已記下。下一個任務開工時，AI 會先看到這個方向。':'已記下，謝謝。');feedbackTrendKey='';});
 skip.onclick=busy(skip,async()=>{await coachAct(t,'feedback',{ref:f.ref,skipped:true});tell('這次略過，不會再問同一題。');});
 const actions=element('div',undefined,'buttons');actions.append(send,skip);
 card.append(scale,tags,note,actions);
 return card;
}

// 總覽：平均分數、常見標籤，以及 AI 會照做的方向。回饋有變動才重新讀取。
let feedbackTrendKey='';
async function renderFeedbackTrend(){
 const box=$('#feedback-trend');if(!box)return;
 const key=tasks.map(t=>`${t.id}:${t.planning?.feedback?.length||0}`).join('|');if(key===feedbackTrendKey)return;feedbackTrendKey=key;
 let summary;try{({summary}=await request('/api/feedback'));}catch{return;}
 const body=$('#feedback-body');body.replaceChildren();
 if(!summary.count){body.append(element('p','還沒有回饋。確認成果、自動停下或任務完成時，會請你打 1–5 分。','small muted'));return;}
 const stats=element('div',undefined,'fb-stats');
 for(const [m,label] of [['confirm','成果符合預期'],['park','停下來合理'],['done','溝通省力']]){const s=summary.byMoment[m],tile=element('div',undefined,'stat');tile.append(element('span',label),element('strong',s.n?`${s.avg}`:'–'),element('small',s.n?`滿分 5 · ${s.n} 筆`:'還沒有評分'));stats.append(tile);}
 body.append(stats);
 if(summary.directions.length){const h=element('h3','AI 從你的回饋學到的方向','fb-sub');const list=element('ul',undefined,'fb-directions');for(const d of summary.directions){const li=element('li');li.append(element('span',d.text),element('small',`「${d.tag}」${d.n} 次`,'muted'));list.append(li);}body.append(h,list,element('p','下一個任務開工時，這些方向和你的原話會一起帶進 AI 的指示。','small muted'));}
 else body.append(element('p','目前的回饋都是正面的，AI 沒有需要調整的方向。','small muted'));
 if(summary.quotes.length){const q=element('ul',undefined,'fb-quotes');for(const x of summary.quotes)q.append(element('li',`「${x.note}」 · ${x.title} · ${x.score} 分`));body.append(element('h3','你最近的原話','fb-sub'),q);}
}
