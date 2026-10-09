// 與任務、專案歷程使用同一份本機資料；原文延後展開，先看影響與下一步。
var conversationState = { taskId: null, pane: 'overview', data: null, seq: 0, drafts: {} };
var conversationProviders = { claude: 'Claude Code', codex: 'Codex', copilot: 'GitHub Copilot', unknown: 'AI 未記錄' };
var conversationKinds = { alignment: '交辦對齊', correction: '修正與返工', handoff: '換 AI／換基準', exploration: '必要探索', verification: '驗證與收尾' };

function showConversations(id) {
  conversationState.taskId = id;
  conversationState.pane = 'overview';
  if ($('#task-dialog').open) $('#task-dialog').close();
  go('conversations');
}

function conversationRefs(data, refs) {
  const box = element('div', undefined, 'buttons');
  for (const ref of refs || []) {
    const round = data.rounds.find(r => r.id === ref.roundId);
    if (!round) continue;
    const b = element('button', `第 ${round.no} 輪 · ${conversationProviders[ref.provider]} L${ref.line}`, 'btn subtle');
    b.onclick = () => { conversationState.pane = 'rounds'; renderConversationPanes(data, ref.roundId); };
    box.append(b);
  }
  return box;
}

function conversationExport(data) {
  return [`# ${data.title}：每輪對話`, `來源整理時間：${data.importedAt || 'Mentor即時紀錄'}`, data.summary || '', ...((data.sources || []).map(s => `來源檔：${s.sourceId} · ${s.provider} · SHA ${s.sha256}`)),
    '## 閱讀範圍', ...(data.limits || []).map(s => `- ${s}`),
    '## 原因與改善', ...(data.lessons || []).map(l => `### ${l.title}\n\n${l.observed}\n\n原因（${l.certainty}）：${l.cause}\n\n下次：${l.prevention}\n\n來源：${l.refs.map(r => `${r.provider} L${r.line}`).join('、')}`),
    '## 下次交辦草稿', data.nextPrompt,
    '## 每輪紀錄', ...data.rounds.map(r => `### 第 ${r.no} 輪 · ${when(r.at)} · ${conversationProviders[r.provider] || r.provider}\n\n需求／操作：\n${r.input || '當時未分開保存使用者輸入；請看實際 prompt。'}\n\n${r.replies.map(a => `AI（${a.model || r.agent || '模型未知'} · ${a.effort || '推理強度未記錄'} · ${a.at || '時間未記錄'}${a.ref ? ` · L${a.ref.line} · SHA ${a.ref.textSha}` : ''}）：\n${a.text}`).join('\n\n') || '未看到完整回覆。'}\n\n來源：${r.sourceId}${r.inputRef ? ` L${r.inputRef.line}` : ` · ${r.stage} · revision ${r.beforeRevision}→${r.afterRevision || '未完成'}`}\n\n${r.learning ? `學習建議：${JSON.stringify(r.learning)}` : ''}\n\n實際 prompt／原始輸入：\n${r.rawInput || ''}`)
  ].join('\n\n');
}

async function renderConversations() {
  const seq = ++conversationState.seq, box = $('#conversation-content');
  const choices = tasks.filter(t => !t.error);
  if (!choices.length) { box.replaceChildren(element('p', '還沒有任務。建立任務後，每次 AI 執行都會出現在這裡。', 'muted')); return; }
  if (!choices.some(t => t.id === conversationState.taskId)) conversationState.taskId = choices[0].id;
  const picker = $('#conversation-task');
  options(picker, choices.map(t => [t.id, t.title])); picker.value = conversationState.taskId;
  picker.onchange = () => { conversationState.taskId = picker.value; conversationState.pane = 'overview'; renderConversations(); };
  box.replaceChildren(element('p', '正在整理這個任務的每輪紀錄…', 'muted'));
  try {
    const data = await request(`/api/tasks/${conversationState.taskId}/conversation`);
    if (seq !== conversationState.seq) return;
    conversationState.data = data;
    renderConversationPanes(data);
  } catch (error) { if (seq === conversationState.seq) box.replaceChildren(element('p', `對話紀錄未載入：${error.message}`, 'notice')); }
}

function renderConversationPanes(data, selectedRound) {
  const box = $('#conversation-content'); box.replaceChildren();
  const tabs = element('div', undefined, 'history-tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', '對話紀錄閱讀方式');
  for (const [id, label] of [['overview', '先看重點'], ['rounds', '每輪問答'], ['improve', '下次怎麼少來回']]) {
    const b = element('button', label, 'btn'); b.setAttribute('aria-pressed', String(conversationState.pane === id));
    b.onclick = () => { conversationState.pane = id; renderConversationPanes(data); }; tabs.append(b);
  }
  box.append(tabs);
  const task = tasks.find(t => t.id === data.taskId), pane = element('section');
  pane.setAttribute('aria-label', conversationState.pane === 'overview' ? '對話重點' : conversationState.pane === 'rounds' ? '每輪問答' : '改善與交辦草稿');
  box.append(pane);
  if (conversationState.pane === 'overview') {
    const top = element('article', undefined, 'card');
    top.append(element('span', `${data.rounds.length} 輪 · ${new Set(data.rounds.map(r => r.provider)).size} 個 AI · 保留來源`, 'badge blue'), element('h2', data.title), element('p', data.summary || '每次需求、操作與 AI 回覆都留在同一個任務，不需要到各個 AI 重找背景。'));
    const grid = element('div', undefined, 'history-grid');
    const fields = [['這次要達成什麼', task?.goal || '依目前任務卡'], ['目前到哪裡', data.latest ? `${data.latest.claimedVersion} 已在來源回報；任務摘要尚未同步，成果仍需核對。` : data.current.summary], ['下一步先看什麼', data.cautions?.[0] || task?.nextAction?.label || '查看最新一輪的成果與未完成項目。']];
    for (const [label, value] of fields) { const item = element('div'); item.append(element('h3', label), element('p', value, 'small')); grid.append(item); }
    top.append(grid);
    const next = element('button', '看每輪問答', 'btn primary'); next.onclick = () => { conversationState.pane = 'rounds'; renderConversationPanes(data); };
    top.append(next); pane.append(top);
    if (data.cautions?.length) { const alert = element('details', undefined, 'history-note'); alert.append(element('summary', `目前仍有 ${data.cautions.length} 項要核對`)); for (const c of data.cautions) alert.append(element('p', c, 'small')); if (data.latest) alert.append(conversationRefs(data, [data.latest.ref])); pane.append(alert); }
    const lessons = section('這些來回告訴我們什麼');
    for (const l of data.lessons || []) { const row = element('article', undefined, 'history-recap'); row.append(element('span', conversationKinds[l.kind], 'badge gray'), element('h3', l.title), element('p', l.prevention, 'small')); const b = element('button', '看原因與證據', 'btn subtle'); b.onclick = () => { conversationState.pane = 'improve'; renderConversationPanes(data); document.getElementById(`conversation-lesson-${l.id}`).open = true; document.getElementById(`conversation-lesson-${l.id}`).scrollIntoView({ block: 'start' }); }; row.append(b); lessons.append(row); }
    if (!data.lessons?.length) lessons.append(element('p', '這個任務尚未整理跨輪原因。每輪的 AI 學習建議在「每輪問答」保留，沒有分析時會明寫。', 'muted'));
    pane.append(lessons);
  } else if (conversationState.pane === 'rounds') {
    pane.append(element('h2', '沿著每一輪，看需求怎麼改變'), element('p', '先看提問與回覆前段；展開即可核對完整原文、模型與來源。操作／自動接續會分開標示，歷史 AI 回報不等於已驗收。', 'small muted'));
    const toolbar = element('div', undefined, 'journey-tools'), search = element('input'), provider = element('select');
    search.type = 'search'; search.id = 'conversation-search'; search.placeholder = '例如：人次、先討論、v13、蝦皮';
    options(provider, [['all', '所有 AI'], ...[...new Set(data.rounds.map(r => r.provider))].map(id => [id, conversationProviders[id] || id])]);
    provider.id = 'conversation-provider';
    for (const [label, node, hint] of [['搜尋內容', search, '同時搜尋需求、回覆與學習建議。'], ['來源 AI', provider, '依實際來源篩選，不使用目前角色設定代替歷史模型。']]) { const field = element('label', undefined, 'field'); field.append(element('span', label), node, element('small', hint)); toolbar.append(field); }
    const count = element('p', '', 'small muted'); count.id = 'conversation-count'; count.setAttribute('aria-live', 'polite');
    const list = element('div'), more = element('button', '再顯示 12 輪', 'btn');
    pane.append(toolbar, count, list, more);
    let limit = selectedRound ? Math.max(12, data.rounds.findIndex(r => r.id === selectedRound) + 1) : 12;
    const render = () => {
      const q = search.value.trim().toLowerCase();
      const matches = data.rounds.filter(r => (provider.value === 'all' || r.provider === provider.value) && (!q || JSON.stringify(r).toLowerCase().includes(q)));
      count.textContent = `找到 ${matches.length} 輪，顯示 ${Math.min(limit, matches.length)} 輪`; list.replaceChildren();
      for (const r of matches.slice(0, limit)) {
        const row = element('details', undefined, 'history-round'); row.id = `conversation-round-${r.no}`;
        const summary = element('summary'), first = (r.input || '當時只保存實際 prompt，原始使用者輸入未分開紀錄').split('\n').map(t => t.trim()).find(t => t && !/^@"|^file:|^<|^\//.test(t)) || r.input || '接續執行';
        summary.append(element('span', `第 ${r.no} 輪 · ${when(r.at)}`, 'small muted'), providerMark(r.provider, conversationProviders[r.provider]), element('strong', first.slice(0, 100)));
        row.append(summary);
        const labels = { user: '使用者需求', action: '你啟動的操作', automatic: '系統接續', unrecorded: '早期輸入未分開保存' };
        row.append(element('h4', labels[r.inputKind] || '需求'), element('p', r.input || '請展開下面的實際 prompt。', 'history-input'));
        if (r.error) row.append(element('p', r.error, 'notice'));
        const last = r.replies.at(-1);
        row.append(element('h4', 'AI 回覆前段（原文預覽）'), element('p', last ? `${last.text.slice(0, 480)}${last.text.length > 480 ? '…' : ''}` : r.status === 'running' ? 'AI 還在執行。' : '沒有完整可配對的回覆。', 'history-preview'));
        if (r.learning) {
          const learn = element('div', undefined, 'coach-note'); learn.append(element('h4', '這輪的學習建議'));
          if (r.learningStatus === 'pending') learn.append(element('p', 'AI 尚未提供完整分析；以下只列已提供的內容。', 'small muted'));
          for (const [key, label] of [['change','調整'],['reason','原因'],['evidence','依據'],['lesson','判斷原則'],['nextPrompt','下次可以這樣問'],['question','先自己回答']]) if (r.learning[key]) learn.append(element('h4', label), element('p', r.learning[key]));
          if (r.origin === 'workspace') { const reflect = element('button', '回到任務保存回想', 'btn'); reflect.onclick = () => { go('overview'); openTask(data.taskId); const entry = [...document.querySelectorAll('[data-turn]')].find(e => e.dataset.turn === r.id); if (entry) { entry.open = true; entry.closest('.turn-history').open = true; entry.scrollIntoView({block:'start'}); } }; learn.append(reflect); }
          row.append(learn);
        }
        const linked = (data.lessons || []).filter(l => l.refs.some(ref => ref.roundId === r.id));
        if (!r.learning && !linked.length) row.append(element('p', r.status === 'running' ? '等待回覆後才能整理這輪學習。' : '這輪尚未整理學習分析；保留原文，不補造原因。', 'small muted'));
        for (const l of linked) row.append(element('h4', '跨輪觀察'), element('p', `${l.title}：${l.prevention}`));
        if (r.outputs?.length) { const ul = element('ul'); for (const out of r.outputs) ul.append(element('li', `${out.file} · SHA ${out.sha}`, 'small')); row.append(element('h4', '這輪的成果檔'), ul); }
        const raw = element('details', undefined, 'history-raw'); raw.append(element('summary', '完整原文、模型與來源'));
        raw.append(element('p', `${r.origin === 'imported' ? '來源對話' : 'Mentor執行'}：${r.sourceId}${r.inputRef ? ` · L${r.inputRef.line} · 內容 SHA ${r.inputRef.textSha}` : ` · ${r.stage} · revision ${r.beforeRevision} → ${r.afterRevision || '未完成'}`}`, 'small muted'), element('h4', r.origin === 'imported' ? '原始輸入' : '實際送入 CLI 的 prompt'), element('pre', r.rawInput, 'source-text'));
        for (const reply of r.replies) raw.append(element('h4', `${reply.model || r.agent || '模型未記錄'} · ${reply.effort || '推理強度未記錄'} · ${when(reply.at)}`), element('p', reply.ref ? `來源 L${reply.ref.line} · 內容 SHA ${reply.ref.textSha}` : 'Mentor保存的回覆', 'small muted'), element('pre', reply.text, 'source-text'));
        row.append(raw); list.append(row);
        if (r.id === selectedRound) row.open = true;
      }
      more.hidden = matches.length <= limit;
      if (!matches.length) list.append(element('p', '沒有符合的紀錄，試著換關鍵字或來源。', 'muted'));
    };
    search.oninput = provider.onchange = () => { limit = 12; render(); }; more.onclick = () => { limit += 12; render(); }; render();
    if (selectedRound) { const r = data.rounds.find(r => r.id === selectedRound); document.getElementById(`conversation-round-${r.no}`)?.scrollIntoView({ block: 'start' }); }
  } else {
    pane.append(element('h2', '省掉重講，保留必要討論'), element('p', '已知資料、已確認限制與同一版的基準可以一起帶入。方向改變、業務真相與新風險仍要確認；目前沒有足夠資料估算省了幾輪。', 'small muted'));
    const draft = element('article', undefined, 'card'); draft.append(element('h3', '下次一次說清楚的交辦草稿'));
    const label = element('label', undefined, 'field'), area = element('textarea'); area.id = 'conversation-next-prompt'; area.maxLength = 6000; area.value = conversationState.drafts[data.taskId] ?? data.nextPrompt;
    area.oninput = () => { conversationState.drafts[data.taskId] = area.value; };
    label.append(element('span', '可修改的交辦內容'), area, element('small', '請先核對最新來源與未決項目；這是草稿，尚未執行，無法保證一次完成。')); draft.append(label);
    const buttons = element('div', undefined, 'buttons'), copy = element('button', '複製交辦', 'btn'), use = element('button', '帶入同專案新任務草稿', 'btn primary');
    copy.onclick = async () => { try { await navigator.clipboard.writeText(area.value); tell('已複製交辦草稿。'); } catch { area.focus(); area.select(); tell('請從欄位手動複製交辦草稿。'); } };
    use.onclick = () => { if (!area.value.trim()) return tell('請先寫下交辦內容。'); $('#new-task').click(); $('#draft-form').elements.request.value = area.value; $('#draft-form').elements.project.value = task.project; $('#draft-project').textContent = `同一專案：${task.project}，沿用已保留規則。素材請放進新任務的產出資料夾；確認並建立後才會呼叫 AI。`; $('#draft-project').hidden = false; };
    buttons.append(copy, use); draft.append(buttons); pane.append(draft);
    for (const l of data.lessons || []) {
      const row = element('details', undefined, 'history-round'); row.id = `conversation-lesson-${l.id}`;
      row.append(element('summary', l.title), element('h4', '來源中發生了什麼'), element('p', l.observed), element('h4', `為什麼要來回 · ${l.certainty}`), element('p', l.cause), element('h4', '下次的做法'), element('p', l.prevention), element('h4', '提問範例'), element('p', l.nextPrompt), conversationRefs(data, l.refs));
      const keep = element('button', '保留成同專案規則', 'btn'); keep.onclick = busy(keep, async () => { const result = await request(`/api/tasks/${data.taskId}/conversation-rule`, { lessonId: l.id }); learningMemory = result.memory; renderRules(); renderRecall(true); keep.dataset.completed = 'true'; keep.disabled = true; keep.textContent = '已保留 · 下個同專案任務沿用'; tell(result.added ? '已保留原則；不代表這份簡報已驗收。' : '原則已存在，沒有重複新增。'); }); row.append(keep); pane.append(row);
    }
    if (!data.lessons?.length) pane.append(element('p', '目前沒有已整理的跨輪原因。請先看各輪學習建議，不補造返工診斷。', 'muted'));
  }
  const source = element('details', undefined, 'history-note'); source.append(element('summary', '來源範圍與匯出紀錄'));
  for (const text of data.limits || []) source.append(element('p', text, 'small'));
  for (const s of data.sources || []) source.append(element('p', `${conversationProviders[s.provider]} · ${s.sourceId} · 原始檔 SHA ${s.sha256}`, 'small muted'));
  for (const f of data.snapshots || []) source.append(element('p', `${f.file.split('/').pop()} · ${f.exists ? `匯入時存在，${when(f.modifiedAt)} 修改` : '匯入時未找到'} · 存在不代表已驗收`, 'small'));
  const exportButton = element('button', '下載全部輪次 Markdown', 'btn'); exportButton.onclick = () => download(`${data.taskId}-對話歷程.md`, conversationExport(data)); source.append(exportButton); box.append(source);
}
