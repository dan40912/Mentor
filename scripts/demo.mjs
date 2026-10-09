// 建立一份虛構的示範資料並啟動 Mentor：npm run demo
// 資料放在 .demo-home/，不會碰到你自己的 vault。
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeTask, sha256 } from '../src/tasks.js';
import { Projects } from '../src/projects.js';
import { Memory } from '../src/memory.js';

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const home = path.join(appDir, '.demo-home');
const vault = path.join(home, 'vault');
await rm(home, { recursive: true, force: true });
await mkdir(vault, { recursive: true });

const base = (id, dir) => ({
  id, revision: 1, updatedAt: new Date().toISOString(), prelude: '\n', notes: '\n\n## 人工筆記\n這一段是你自己的筆記，Mentor 不會覆寫。\n',
  workspace: { label: 'demo', root: dir }, allowedRoots: [dir],
  scope: { allowed: ['在產出資料夾另存新版本'], locked: [], forbidden: ['對外發布或寄送'] },
  decisions: [], checks: [], facts: [], learnings: [], parked: [], reports: [],
});

// 1. 等你決策：Claude 額度用完前停在一個只有人能回答的問題
const d1 = path.join(home, 'outputs', 'TASK-demo-0001'); await mkdir(d1, { recursive: true });
const report = path.join(d1, 'q3-report-v2.md'); await writeFile(report, '# Q3 營運報告 v2\n\n（示範內容）\n');
await writeFile(path.join(vault, 'TASK-demo-0001.md'), serializeTask({
  ...base('TASK-demo-0001', d1), status: 'BLOCKED', title: 'Q3 營運報告', project: 'Demo 專案', goal: '讓主管 5 分鐘內看懂 Q3 重點',
  scope: { allowed: ['另存 v3'], locked: [{ text: '第 1 頁結論不改', source: '主管意見' }], forbidden: ['對外發布'] },
  current: { summary: 'Claude 做到 v2，第 4 頁的指標口徑有兩種寫法，需要你選。', artifact: report, sources: [{ provider: 'Claude', sessionId: 'demo-session', locator: 'L120' }] },
  decisions: [{ id: 'D1', status: 'OPEN', question: '「活躍使用者」要用 7 日還是 30 日口徑？', recommendation: 'a', basis: '主管上次簡報用 30 日', options: [{ id: 'a', label: '30 日活躍', cost: '與上季可比，但看不到近期波動' }, { id: 'b', label: '7 日活躍', cost: '更敏感，需要重做第 4、6 頁' }], unknown: '主管是否要和競品比較' }],
  checks: [{ id: 'C1', kind: 'artifact', label: '最新成果檔', path: report, baselineSha: sha256('# Q3 營運報告 v2\n\n（示範內容）\n'), result: 'NOT_RUN', note: '' }, { id: 'C2', kind: 'human', label: '數字與來源一致', result: 'NOT_RUN', note: '' }],
  facts: [{ label: '資料期間', value: '2026-07-01 ~ 2026-09-30', source: 'dashboard', verified: true }],
  next: '你選定口徑後，把接手包交給 Codex 做 v3',
}));

// 2. 已完成，等你驗收
const d2 = path.join(home, 'outputs', 'TASK-demo-0002'); await mkdir(d2, { recursive: true });
const guide = path.join(d2, 'onboarding.md'); await writeFile(guide, '# 新人上手指南\n\n（示範內容）\n');
await writeFile(path.join(vault, 'TASK-demo-0002.md'), serializeTask({
  ...base('TASK-demo-0002', d2), status: 'READY', title: '新人上手指南', project: 'Demo 專案', goal: '新人第一天能自己跑起專案',
  current: { summary: 'Codex 回報完成，成果檔已綁定。等你照清單驗收。', artifact: guide, sources: [{ provider: 'Codex', sessionId: 'demo-session-2', locator: 'L88' }] },
  checks: [{ id: 'C1', kind: 'artifact', label: '成果檔', path: guide, baselineSha: sha256('# 新人上手指南\n\n（示範內容）\n'), result: 'PASS', note: '' }, { id: 'C2', kind: 'human', label: '照著做能跑起來', result: 'NOT_RUN', note: '' }],
  learnings: [{ mistake: '一開始沒寫讀者是誰', signal: 'AI 先問了「給誰看」', nextTime: '交辦時先寫讀者與要做的決定' }],
  next: '照清單做人工驗收',
}));

// 3. 交給 AI
const d3 = path.join(home, 'outputs', 'TASK-demo-0003'); await mkdir(d3, { recursive: true });
await writeFile(path.join(vault, 'TASK-demo-0003.md'), serializeTask({
  ...base('TASK-demo-0003', d3), status: 'READY', title: '競品功能比較表', project: 'Demo 專案', goal: '整理三家競品的差異',
  current: { summary: '範圍與口徑都已確認，可以交給 AI。', sources: [] },
  checks: [{ id: 'C1', kind: 'human', label: '來源連結可開啟', result: 'NOT_RUN', note: '' }],
  next: '用接手包交給 Claude 或 Codex',
}));

await new Projects(path.join(vault, 'projects')).create({ name: 'Demo 專案' });
await new Memory(path.join(vault, 'memory')).append('project', 'Demo 專案', '取捨', '交辦前先寫讀者與他要做的決定，AI 的第一版就會準很多。', '示範規則');

const port = process.env.PORT || '4317';
console.log(`\nMentor demo 資料已建立在 ${home}\n開啟 http://127.0.0.1:${port}\n`);
const child = spawn(process.execPath, [path.join(appDir, 'src', 'server.js')], { stdio: 'inherit', env: { ...process.env, PORT: port, MENTOR_HOME: home } });
child.on('exit', code => process.exit(code ?? 0));
