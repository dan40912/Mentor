// 實驗台：用真的 CLI 把 examples/lab/ 的案例從頭跑到尾，量測人要介入幾次、卡在哪裡。
// node scripts/lab.mjs [案例檔...] [--port 4319] [--home .lab-home] [--max-touches 10] [--timeout-min 150]
// 腳本扮演「人」：每次 Mentor 停下來等人，就照固定規則代答，並把這次介入記成一筆溝通成本。
// 資料放在 --home（預設 .lab-home/，已加入 .gitignore），不會碰到你自己的 vault。
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile, readdir, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv.splice(i, 2)[1] : fallback; };
const port = Number(flag('port', '4319'));
const home = path.resolve(flag('home', path.join(appDir, '.lab-home')));
const maxTouches = Number(flag('max-touches', '10'));
const timeoutMs = Number(flag('timeout-min', '150')) * 60000;
const caseFiles = argv.length ? argv.map(f => path.resolve(f)) : (await readdir(path.join(appDir, 'examples', 'lab'))).filter(f => f.endsWith('.md')).sort().map(f => path.join(appDir, 'examples', 'lab', f));
const origin = `http://127.0.0.1:${port}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const stamp = () => new Date().toISOString();
// Ctrl+C 或 kill 時不直接結束：讓每個案例收尾、停掉 AI、寫出報告。
let aborted = false;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { if (aborted) process.exit(130); aborted = true; console.log('收到中斷，收尾並寫報告…'); });

// 代答規則固定，報告會逐字列出。這些都是真人本來要做的事。
const POLICY = {
  answer: '以上問題請直接採用你推薦的預設值，寫進 constraints 並標成假設，不要再問我。資訊已足夠，請判定可以擬定大綱。',
  needsInfo: '缺的資訊請用合理預設值完成，把你的假設寫進 RETRO.md 的「我自己決定的事」，不要再停下來問我。',
  human: '（實驗腳本代為結案）這一項沒有真人可做，請 AI 在後續項目以合理預設值處理。'
};

function parseCase(text, file) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file} 缺少 --- 開頭的設定區`);
  const meta = Object.fromEntries(m[1].split('\n').map(l => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map(x => [x[1], x[2].trim()]));
  return { file, slug: path.basename(file, '.md'), title: meta.title || path.basename(file), profile: meta.profile || 'standard', project: meta.project || '實驗台', materials: (meta.materials || '').split(',').map(s => s.trim()).filter(Boolean), request: m[2].trim() };
}

let cookie = '', csrf = '';
async function api(url, data) {
  const headers = { Cookie: cookie };
  if (data) Object.assign(headers, { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Idempotency-Key': randomUUID() });
  const res = await fetch(origin + url, { method: data ? 'POST' : 'GET', headers, body: data ? JSON.stringify(data) : undefined });
  const json = await res.json().catch(() => ({}));
  if (res.status >= 400) throw Object.assign(new Error(`${url} → ${res.status} ${json.code || ''} ${json.message || ''}`), { status: res.status, body: json });
  return json;
}

async function startServer() {
  await mkdir(home, { recursive: true });
  const child = spawn(process.execPath, [path.join(appDir, 'src', 'server.js'), '--home', home, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const log = [];
  child.stdout.on('data', d => log.push(String(d))); child.stderr.on('data', d => log.push(String(d)));
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${origin}/`);
      cookie = (res.headers.get('set-cookie') || '').split(';')[0];
      csrf = (await api('/api/session')).csrfToken;
      return { child, log };
    } catch { await sleep(200); }
  }
  child.kill();
  throw new Error(`Mentor 沒有在 ${origin} 啟動：\n${log.join('')}`);
}

const getTask = async id => (await api('/api/tasks')).tasks.find(t => t.id === id);

async function runCase(c) {
  const out = path.join(home, 'outputs', `lab-${c.slug}-${Date.now()}`);
  await mkdir(out, { recursive: true });
  for (const m of c.materials) await copyFile(path.join(appDir, m), path.join(out, path.basename(m)));
  const started = Date.now();
  const touches = [];
  const log = (...a) => console.log(`[${c.slug}]`, ...a);
  const created = await api('/api/tasks', { request: c.request, profile: c.profile, project: c.project, autopilot: true, full: true, outputDir: out });
  const id = created.task.id;
  log('建立', id);
  let end = null, lastPark = '', repeats = 0, lastKind = '';
  while (!end) {
    await sleep(5000);
    if (aborted) { end = { kind: 'aborted', label: '實驗被中斷' }; break; }
    const t = await getTask(id);
    const p = t.planning;
    if (Date.now() - started > timeoutMs) { end = { kind: 'timeout', label: `超過 ${timeoutMs / 60000} 分鐘` }; break; }
    if (p.running || (p.autopilot && !p.autopilot.waitingFor)) continue;
    if (p.phase === 'done') { end = { kind: 'done' }; break; }
    const wait = p.autopilot?.waitingFor || { kind: p.stopped ? 'stopped' : 'autopilot-off', label: t.nextAction?.label || '自動模式已關閉' };
    const sig = `${wait.kind}|${wait.label}|${t.revision}`;
    if (sig === lastPark) continue;
    lastPark = sig;
    // 同一個卡點連續出現 3 次，代答沒有用，再跑只是燒額度。
    const kindLabel = `${wait.kind}|${wait.label}`;
    repeats = kindLabel === lastKind ? repeats + 1 : 1;
    lastKind = kindLabel;
    if (repeats >= 3) { end = { kind: 'loop', label: `同一個卡點連續 ${repeats} 次：${wait.label}` }; break; }
    if (touches.length >= maxTouches) { end = { kind: 'touch-limit', label: `人工介入超過 ${maxTouches} 次`, last: wait }; break; }
    const touch = { at: stamp(), minute: Math.round((Date.now() - started) / 6000) / 10, kind: wait.kind, label: wait.label, code: wait.code, stage: wait.stage };
    log('停下等人：', wait.kind, wait.label);
    try {
      if (wait.kind === 'answer') {
        const last = p.messages.filter(m => m.role === 'ai' && m.stage === 'B').at(-1);
        touch.aiAsked = (last?.questions || []).map(q => ({ q: q.q, why: q.why }));
        touch.reply = POLICY.answer;
        await api(`/api/tasks/${id}/answer`, { revision: t.revision, message: POLICY.answer });
      } else if (wait.kind === 'confirm') {
        touch.reply = '全部確認（腳本未實際開啟成果檢查）';
        touch.items = p.workItems.filter(i => i.status === 'REVIEWED').map(i => i.id);
        await api(`/api/tasks/${id}/confirm-all`, { revision: t.revision });
      } else if (wait.kind === 'needs-info') {
        const item = p.workItems.find(i => i.id === wait.itemId);
        touch.aiSaid = item?.log?.at(-1)?.text?.slice(-1200) || '';
        touch.reply = POLICY.needsInfo;
        await api(`/api/tasks/${id}/instruct`, { revision: t.revision, text: POLICY.needsInfo, scope: wait.itemId, confirmImpact: true });
      } else if (wait.kind === 'human') {
        touch.reply = POLICY.human;
        await api(`/api/tasks/${id}/confirm`, { revision: t.revision, itemId: wait.itemId, accept: true, note: POLICY.human });
      } else if (wait.kind === 'error' && !touches.some(x => x.kind === 'error' && x.code === wait.code)) {
        touch.reply = '同一種錯誤第一次出現：重新開啟自動模式重試一次';
        await api(`/api/tasks/${id}/autopilot`, { revision: t.revision, on: true, full: true });
      } else {
        touches.push({ ...touch, reply: '腳本沒有規則可以代答，停止' });
        end = { kind: wait.kind, label: wait.label }; break;
      }
    } catch (error) {
      touch.error = error.message;
      touches.push(touch);
      end = { kind: 'driver-error', label: error.message }; break;
    }
    touches.push(touch);
  }
  // 結束時若還在跑就停掉，避免留下背景程序。
  let final = await getTask(id);
  if (final.planning.running) {
    await api(`/api/tasks/${id}/stop`, {}).catch(() => {});
    for (let i = 0; i < 30 && final.planning.running; i++) { await sleep(1000); final = await getTask(id); }
  }
  const events = (await api(`/api/tasks/${id}/events`)).events;
  log('結束：', end.kind, end.label || '');
  return { case: c, id, out, end, touches, minutes: Math.round((Date.now() - started) / 6000) / 10, task: final, events };
}

async function filesIn(dir) {
  const rows = [];
  for (const name of await readdir(dir).catch(() => [])) {
    const s = await stat(path.join(dir, name));
    if (s.isFile()) rows.push(`${name}（${Math.round(s.size / 102.4) / 10} KB）`);
  }
  return rows;
}

const dur = t => t.completedAt ? Math.round((Date.parse(t.completedAt) - Date.parse(t.startedAt)) / 6000) / 10 : null;
const cell = s => String(s ?? '').replace(/\|/g, '｜').replace(/\n+/g, ' ').slice(0, 220);

async function report(r) {
  const p = r.task.planning;
  const turns = p.learningTurns || [];
  const items = p.workItems || [];
  const asked = r.touches.flatMap(t => t.aiAsked || []);
  const lines = [
    `# 實驗紀錄：${r.case.title}`, '',
    `- 任務：\`${r.id}\`；流程：${r.case.profile}；完全自動：是`,
    `- 結果：**${r.end.kind}**${r.end.label ? `（${cell(r.end.label)}）` : ''}；總時間 ${r.minutes} 分鐘`,
    `- 人工介入：**${r.touches.length} 次**；AI 提問 ${asked.length} 題；AI 執行 ${turns.length} 次，失敗 ${turns.filter(t => t.status === 'failed').length} 次`,
    `- 產出資料夾：\`${r.out}\``, `- 檔案：${(await filesIn(r.out)).join('、') || '無'}`, '',
    '## 人工介入（溝通成本）', '',
    '| # | 第幾分鐘 | 停下原因 | Mentor 的說明 | 代答 |', '|---|---|---|---|---|',
    ...r.touches.map((t, i) => `| ${i + 1} | ${t.minute} | ${t.kind}${t.code ? ` ${t.code}` : ''} | ${cell(t.label)} | ${cell(t.reply)}${t.error ? `；失敗：${cell(t.error)}` : ''} |`), '',
    ...(asked.length ? ['## AI 的提問（prompt 已回答仍被問到的，代表 prompt 或 Grill 規則需要改）', '', ...asked.map(q => `- ${q.q}（理由：${q.why || '無'}）`), ''] : []),
    '## 每次 AI 執行', '',
    '| 階段 | 項目 | AI | 分鐘 | 結果 | 錯誤 |', '|---|---|---|---|---|---|',
    ...turns.map(t => `| ${t.stage} | ${t.workItemId || ''} | ${cell(t.agent)} | ${dur(t) ?? ''} | ${t.status} | ${cell(t.errorCode ? `${t.errorCode} ${t.error}` : '')} |`), '',
    '## 工作項目與驗收', ''
  ];
  for (const i of items) {
    lines.push(`### ${i.id} ${i.title}（${i.owner}，${i.status}，執行 ${i.attempts} 次）`);
    for (const s of i.sensors || []) lines.push(`- 感測器 ${s.result}｜${s.name}：${cell(s.detail)}`);
    for (const x of i.review?.results || []) lines.push(`- 驗收 ${x.result}｜${cell(x.criterion)}：${cell(x.evidence)}`);
    if (i.fixes?.length) lines.push(`- 修正意見：${i.fixes.map(cell).join('；')}`);
    lines.push('');
  }
  const diary = (p.diary || []).filter(d => ['deviations', 'openQuestions'].includes(d.heading));
  if (diary.length) lines.push('## AI 日記：偏離與未決問題', '', ...diary.map(d => `- ${d.stage}｜${d.heading}｜${cell(d.text)}`), '');
  try { lines.push('## AI 自己寫的 RETRO.md', '', (await readFile(path.join(r.out, 'RETRO.md'), 'utf8')).trim(), ''); } catch { lines.push('## AI 自己寫的 RETRO.md', '', '沒有產出。', ''); }
  return lines.join('\n');
}

const cases = await Promise.all(caseFiles.map(async f => parseCase(await readFile(f, 'utf8'), f)));
const runDir = path.join(home, 'runs', stamp().replace(/[:.]/g, '-'));
await mkdir(runDir, { recursive: true });
const { child } = await startServer();
console.log(`Mentor 實驗台：${origin}，資料在 ${home}`);
try {
  const results = await Promise.all(cases.map(c => runCase(c).catch(error => ({ case: c, error: error.message }))));
  const summary = ['# 實驗台總表', '', `執行時間：${stamp()}`, '', '| 案例 | 結果 | 分鐘 | 人工介入 | AI 執行 | 失敗 |', '|---|---|---|---|---|---|'];
  for (const r of results) {
    if (r.error) { summary.push(`| ${r.case.title} | 腳本錯誤：${cell(r.error)} | | | | |`); continue; }
    const turns = r.task.planning.learningTurns || [];
    summary.push(`| [${r.case.title}](${r.case.slug}.md) | ${r.end.kind} | ${r.minutes} | ${r.touches.length}（${r.touches.map(t => t.kind).join('、') || '無'}） | ${turns.length} | ${turns.filter(t => t.status === 'failed').length} |`);
    await writeFile(path.join(runDir, `${r.case.slug}.md`), await report(r));
    await writeFile(path.join(runDir, `${r.case.slug}.json`), JSON.stringify(r, null, 2));
  }
  await writeFile(path.join(runDir, 'README.md'), `${summary.join('\n')}\n`);
  console.log(`報告：${runDir}`);
} finally { child.kill(); }
