// 回饋表單：在確認成果、自動停下、任務完成三個時刻，用 1–5 分與標籤收集你的觀感。
// 彙整後變成兩樣東西：給你看的趨勢，以及下一個任務開工時 AI 要照做的方向。

export const MOMENTS = {
  confirm: {
    question: '這次的成果符合你的預期嗎？',
    scale: ['差很多', '有落差', '可以用', '不錯', '超出預期'],
    tags: ['符合需求', '品質好', '不符需求', '品質粗糙', '漏做', '做太多', '我還得重講背景']
  },
  park: {
    question: '這次停下來等你，合理嗎？',
    scale: ['完全不該停', '不太該停', '還好', '該停', '停得剛好'],
    tags: ['原因看得懂', '真的需要我', '原因看不懂', '不知道要我做什麼', 'AI 應該自己決定']
  },
  done: {
    question: '整個任務下來，你花在溝通上的力氣多不多？',
    scale: ['很累，一直要管', '偏多', '普通', '不多', '幾乎不用管'],
    tags: ['一次到位', '成果超出預期', '停太多次', '問了已回答的事', '說明看不懂', '等太久']
  }
};

// 負面標籤對應到 AI 下次要改的做法。正面標籤只計數，不產生方向。
const DIRECTIONS = {
  '不符需求': '開工前用一句話複述讀者與成功標準，對齊任務卡再做。',
  '品質粗糙': '交付前自己跑一次檢查並修到通過，回報檢查了什麼。',
  '漏做': '回報時逐條對照驗收條件，沒做到的寫進「未完成」。',
  '做太多': '只做這一項要求的範圍，額外想法寫成建議，不要直接做。',
  '我還得重講背景': '先讀任務卡、專案說明與產出資料夾的檔案，已寫過的不要再問。',
  '原因看不懂': '停下時用一句話寫清楚卡在哪、為什麼自己無法處理。',
  '不知道要我做什麼': '停下時寫出使用者要做的一個具體動作。',
  'AI 應該自己決定': '樣式與細節直接選合理預設值並記成假設，不要為此停下來問。',
  '停太多次': '能自己驗證的就自己驗證，只在業務決策或權限不足時停下。',
  '問了已回答的事': '已回答或已寫在任務卡的事不要再問。',
  '說明看不懂': '回報先寫結論，再寫證據，少用內部術語。',
  '等太久': '先交最小可用的版本，再補細節。'
};

import { randomUUID } from 'node:crypto';

const now = () => new Date().toISOString();
const newId = () => randomUUID().slice(0, 8);

// 現在該問哪一題。一次只問一題，順序：剛確認的成果、自動停下、任務總評。
// feedbackSince 之前完成的項目不補問，舊任務升級後不會一次跳出一堆表單。
export function pendingFeedback(task) {
  const p = task.planning;
  if (!p || !Array.isArray(p.feedback) || p.running) return null;
  const answered = ref => p.feedback.some(f => f.ref === ref);
  const covered = new Set(p.feedback.filter(f => f.moment === 'confirm').flatMap(f => f.items || []));
  const since = p.feedbackSince || '';
  const fresh = (p.workItems || []).filter(i => i.owner === 'ai' && i.status === 'DONE' && i.doneAt && i.doneAt >= since && !covered.has(i.id));
  if (fresh.length) return { moment: 'confirm', ref: `confirm:${fresh.map(i => `${i.id}@${i.doneAt}`).join(',')}`, items: fresh.map(i => i.id), about: fresh.map(i => `${i.id}「${i.title}」`).join('、'), ...MOMENTS.confirm };
  const wait = p.autopilot?.waitingFor;
  if (wait?.at && wait.kind !== 'wait') {
    const ref = `park:${wait.at}`;
    if (!answered(ref)) return { moment: 'park', ref, about: wait.label, ...MOMENTS.park };
  }
  if (p.phase === 'done' && !p.feedback.some(f => f.moment === 'done')) return { moment: 'done', ref: 'done', about: task.title, ...MOMENTS.done };
  return null;
}

export function validateFeedback(task, input) {
  const pending = pendingFeedback(task);
  if (!pending) return { error: '目前沒有要你評分的事。' };
  if (input.ref !== pending.ref) return { error: '要評分的內容已經變了，請重新整理後再填。' };
  const def = MOMENTS[pending.moment];
  if (input.skipped) return { entry: { id: newId(), at: now(), moment: pending.moment, ref: pending.ref, items: pending.items, about: pending.about, skipped: true } };
  const score = Number(input.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) return { error: '請選 1 到 5 分。' };
  const tags = Array.isArray(input.tags) ? [...new Set(input.tags)] : [];
  if (tags.some(tag => !def.tags.includes(tag))) return { error: '標籤不在選項裡。' };
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (note.length > 500) return { error: '補充最多 500 字。' };
  return { entry: { id: newId(), at: now(), moment: pending.moment, ref: pending.ref, items: pending.items, about: pending.about, score, tags, note } };
}

// 彙整多個任務的回饋。只算有評分的，略過的不算。
export function summarize(tasks) {
  const entries = tasks.flatMap(t => (t.planning?.feedback || []).filter(f => !f.skipped).map(f => ({ ...f, task: t.id, title: t.title, project: t.project })));
  const byMoment = Object.fromEntries(Object.keys(MOMENTS).map(m => {
    const scores = entries.filter(e => e.moment === m).map(e => e.score);
    return [m, { n: scores.length, avg: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10 : null }];
  }));
  const counts = new Map();
  for (const tag of entries.flatMap(e => e.tags || [])) counts.set(tag, (counts.get(tag) || 0) + 1);
  const tags = [...counts].sort((a, b) => b[1] - a[1]);
  const directions = tags.filter(([tag]) => DIRECTIONS[tag]).slice(0, 4).map(([tag, n]) => ({ tag, n, text: DIRECTIONS[tag] }));
  const quotes = entries.filter(e => e.note && e.score <= 3).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3).map(e => ({ note: e.note, score: e.score, moment: e.moment, title: e.title }));
  return { count: entries.length, byMoment, tags, directions, quotes, recent: entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8) };
}

// 給 AI 的方向：同專案的回饋優先，不足 3 筆時用全部任務。
export function feedbackBrief(tasks, project) {
  const own = summarize(tasks.filter(t => t.project === project));
  const s = own.count >= 3 ? own : summarize(tasks);
  if (!s.count || (!s.directions.length && !s.quotes.length)) return '';
  const avg = ['confirm', 'park', 'done'].filter(m => s.byMoment[m].n).map(m => `${{ confirm: '成果', park: '停下合理度', done: '溝通省力度' }[m]} ${s.byMoment[m].avg}/5`).join('、');
  return [`使用者過去的回饋（${s.count} 筆${s === own ? `，專案「${project}」` : '，所有任務'}；${avg}）。照這些方向調整做法：`,
    ...s.directions.map(d => `- ${d.text}（「${d.tag}」${d.n} 次）`),
    ...s.quotes.map(q => `- 使用者原話（${q.score} 分）：「${q.note}」`)].join('\n');
}
