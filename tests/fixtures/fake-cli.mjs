#!/usr/bin/env node
// 測試用假 CLI：依提示中的角色回傳固定內容，不消耗真實額度。
import { writeFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
const out = args.includes('-o') ? args[args.indexOf('-o') + 1] : null;
// 瀏覽器驗收時用 FAKE_MODE_FILE 切換模式，不必重啟服務。
const fromFile = () => { try { return readFileSync(process.env.FAKE_MODE_FILE, 'utf8').trim(); } catch { return ''; } };
const [mode, hangMs] = ((process.env.FAKE_MODE_FILE && fromFile()) || process.env.FAKE_MODE || 'ok').split(':');
// slow：先寫一半的檔案再等很久，用來測停止；hang：忽略 SIGTERM，且讓孫程序握住輸出，模擬無法確認結束。
if (mode === 'slow' || mode === 'hang') {
  if (prompt.includes('「執行」')) writeFileSync('partial.html', '<h1>寫到一半');
  if (mode === 'hang') {
    process.on('SIGTERM', () => {});
    const { spawn } = await import('node:child_process');
    spawn(process.execPath, ['-e', `setTimeout(() => {}, ${Number(hangMs || process.env.FAKE_HANG_MS || 1500)})`], { stdio: ['ignore', 'inherit', 'inherit'] });
  }
  await new Promise(resolve => setTimeout(resolve, 60000));
}
if (mode === 'login') { process.stderr.write('Not logged in · Please run /login\n'); process.exit(1); }
const diary = prompt.includes('diary') ? { diary: { interpretations: ['把「新品」解讀成年度新品'], deviations: [], tradeoffs: ['選 HTML 不選 PPT，因為要可互動'], openQuestions: ['預算上限未知'] } } : {};
const learning = mode === 'no-learning' ? {} : { learning: { change: '補上明確的成功標準', reason: '原需求缺少可檢查的結果', evidence: '這次需求對話', lesson: '先說清楚讀者要做什麼決定，再安排內容。', nextPrompt: '請做十頁簡報，讓主管當場決定新品是否立案，逐項附資料來源。', question: '為什麼要先說主管要做的決定？' } };
const json = value => '```json\n' + JSON.stringify({ ...value, ...diary, ...learning }) + '\n```';
let reply;
if (prompt.includes('「任務制定」')) reply = json({ card: { title: '新品簡報', project: prompt.includes('Alpha') ? 'Alpha' : undefined, goal: '說服主管核准新品', audience: '主管', deliverable: 'HTML 簡報', success: ['主管當場決定'], constraints: [], unknowns: ['頁數'] }, coaching: '原需求沒寫讀者。' });
else if (prompt.includes('「Grill me」')) reply = json(prompt.includes('十頁') ? { questions: [], coaching: '回答很具體。', card: { title: '新品簡報', goal: '說服主管核准新品', audience: '主管', deliverable: 'HTML 簡報 10 頁', success: ['主管當場決定'], constraints: ['10 頁'], unknowns: [] }, ready: true, readyReason: '讀者與篇幅都清楚了' } : { questions: [{ q: '要幾頁？', why: '決定密度' }], coaching: '先講讀者要做的決定。', card: { title: '新品簡報' }, ready: false });
else if (prompt.includes('「擬定大綱」')) reply = json({ outline: { storyline: prompt.includes('修改意見') ? '新品值得做（改版）' : '新品值得做', logic: ['痛點', '方案', '決策'], sections: [{ no: 1, title: '痛點', point: '客訴多', evidence: '客服數據', visual: { type: 'chart', count: 1 } }, { no: 2, title: '方案', point: '新品', evidence: '無依據', visual: { type: 'none', count: 0 } }], imageTotal: 1 }, workItems: [{ id: 'W1', title: '產出 HTML', detail: '單檔', owner: 'ai', acceptance: ['有 deck.html'], dependsOn: [] }, { id: 'W2', title: '提供數據', detail: '', owner: 'human', acceptance: ['數據到位'], dependsOn: [] }], coaching: '先看主線。' });
else if (prompt.includes('「執行」') && mode === 'nofiles') reply = '我描述了要做什麼。\nSTATUS: DONE\nFILES: 無\n證據：見回覆\n未完成：無';
else if (prompt.includes('「執行」') && mode === 'verification-only') { writeFileSync('verification.md', '已更新驗證紀錄'); reply = 'STATUS: DONE\nFILES: verification.md\n證據：verification.md\n未完成：無\n' + json({}); }
else if (prompt.includes('「執行」')) { writeFileSync('deck.html', '<h1>痛點</h1><svg></svg>'); reply = '完成。\nSTATUS: DONE\nFILES: deck.html, ../escape.txt\n證據：deck.html 第 1 行\n未完成：無\n' + json({}); }
else if (prompt.includes('「驗收」')) reply = json(mode === 'review-fail' ? { results: [{ criterion: '有 deck.html', result: 'FAIL', evidence: '缺標題' }], verdict: 'FAIL', fixes: ['補標題'], coaching: '打開 deck.html' } : { results: [{ criterion: '有 deck.html', result: 'PASS', evidence: 'deck.html 存在' }], verdict: 'PASS', fixes: [], coaching: '打開 deck.html 看第一頁' });
else reply = '可用';
if (mode === 'malformed' && prompt.includes('「擬定大綱」')) reply = '這份回覆沒有 JSON。';
if (mode === 'filter-zero') reply = 'The model returned no content because the response was blocked by content filtering.';
if (mode === 'malformed-a' && prompt.includes('「任務制定」')) reply = '我無法提供任務卡。';
if (mode === 'empty-b' && prompt.includes('「Grill me」')) reply = json({ ready: false, questions: [] });
if (mode === 'quote-filter') reply = json({ explanation: 'The model returned no content because the response was blocked by content filtering.' });
if (out) writeFileSync(out, reply); else process.stdout.write(reply);
