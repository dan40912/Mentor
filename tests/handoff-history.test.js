import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { demoTask } from './fixtures/demo-task.js';
import { writeHandoff } from '../src/handoffs.js';

async function fixture(t) {
  // 測試檔也限定建立於目前工作目錄。
  const root = await mkdtemp(path.join(process.cwd(), '.handoff-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'vault/events'), { recursive: true });
  await mkdir(path.join(root, 'vault/conversations'), { recursive: true });
  const task = demoTask('TASK-history', root);
  const eventsFile = path.join(root, 'vault/events/TASK-history.jsonl');
  const archiveFile = path.join(root, 'vault/conversations/TASK-history.json');
  const events = records => writeFile(eventsFile, records.map(r => JSON.stringify(r)).join('\n'));
  const archive = value => writeFile(archiveFile, JSON.stringify(value));
  const markdown = async () => readFile((await writeHandoff(root, task)).path, 'utf8');
  return { root, task, eventsFile, archiveFile, events, archive, markdown };
}
const at = n => `2026-01-01T00:00:0${n}.000Z`;
const count = (text, marker) => text.split(marker).length - 1;

test('交接知識所有章節、來源與產出絕對路徑；回報格式在末段', async t => {
  const { root, task, archive, markdown } = await fixture(t);
  task.scope = { allowed: ['可修改'], locked: [{ text: '鎖定標題', source: '需求第 2 段' }], forbidden: ['禁止發布'] };
  task.decisions = [{ id: 'D1', question: '確認方案', status: 'DECIDED', choice: 'a', options: [{ id: 'a', label: '方案甲' }], note: '已確認原因' }, { id: 'D2', question: '待決方案', status: 'OPEN', options: [] }];
  task.facts = [{ label: '期間', value: '2026 年第 1 季', source: 'source.md:3', verified: false }];
  task.checks = [{ label: '內容驗收', result: 'PASS', note: '檢查證據' }];
  task.learnings = [{ mistake: '漏寫來源', nextTime: '逐項附位置' }];
  task.planning.card.success = ['成功條件'];
  task.planning.card.unknowns = ['未核對數量'];
  task.planning.workItems[0].outputs = [{ file: 'result.md', sha: 'demo' }];
  task.planning.workItems[0].acceptance = ['項目驗收'];
  task.planning.workItems[0].review = { at: at(1), results: [{ criterion: '檢查項目', result: 'PASS', evidence: '驗收來源:5' }], coaching: '驗收建議' };
  await archive({ lessons: [{ title: '匯入教訓', observed: '少了背景', cause: '未問讀者', prevention: '先確認讀者' }] });
  const md = await markdown();
  for (const marker of ['## 任務目標', '示範目標', '### 可以', '可修改', '### 鎖定', '鎖定標題', '### 禁止', '禁止發布', '## 已確認決策', '方案甲', '## 待決策事項', '待決方案', '## 事實與口徑', '2026 年第 1 季', 'source.md:3', '## 驗收清單', '成功條件', '項目驗收', '驗收來源:5', '驗收建議', '## 唯一下一步', '## 產出檔清單', path.join(root, 'result.md'), '## 過去的教訓', '逐項附位置', '匯入教訓', '## 回報格式', '指定改動：', '取捨：', '驗證證據：', '未完成事項：']) assert.ok(md.includes(marker), marker);
  assert.match(md, /來源：.*TASK-history.md#facts\[0\]/);
  assert.ok(md.lastIndexOf('## 回報格式') > md.lastIndexOf('## 完整對話過程'));
});

test('三來源依每筆時間排序，同時間任務→事件→匯入、各來源保留原順序與定位', async t => {
  const { task, events, archive, markdown, eventsFile, archiveFile } = await fixture(t);
  task.planning.messages = [{ id: 'm1', role: 'user', text: 'TASK-TIE-1', at: at(2) }, { id: 'm2', role: 'user', text: 'TASK-TIE-2', at: at(2) }];
  task.planning.learningTurns = ['A', 'B', 'C', 'D', 'E', 'F'].map((stage, i) => ({ id: `turn-${stage}`, stage, userInput: `階段要求-${stage}`, startedAt: at(3), response: `AI-STAGE-${stage}`, completedAt: at(4) }));
  task.decisions = [{ question: '人做的決定', options: [{ id: 'a', label: '採用方案' }], history: [{ choice: 'a', note: '決策原因', at: at(5) }] }];
  await events([{ type: 'ITEM_RETURNED', text: '退回原因', at: at(6) }, { type: 'TASK_CREATED', request: 'FIRST-REQUEST', at: at(0) }, { type: 'HUMAN_REPLY', text: 'EVENT-TIE-1', at: at(2) }, { type: 'HUMAN_REPLY', text: 'EVENT-TIE-2', at: at(2) }, { type: 'ITEM_CONFIRMED', text: '確認原因', at: at(7) }]);
  await archive({ rounds: [{ id: 'r1', input: 'IMPORT-TIE-1', at: at(2), replies: [{ text: 'EARLY-REPLY', at: at(1), ref: { sourceId: 'original', line: 4, recordId: 'reply' } }] }, { id: 'r2', input: 'IMPORT-TIE-2', at: at(2), replies: [] }], unpaired: [{ text: '未配對回覆', at: at(5) }] });
  const md = await markdown();
  const ordered = ['FIRST-REQUEST', 'EARLY-REPLY', 'TASK-TIE-1', 'TASK-TIE-2', 'EVENT-TIE-1', 'EVENT-TIE-2', 'IMPORT-TIE-1', 'IMPORT-TIE-2', 'AI-STAGE-A', 'AI-STAGE-B', 'AI-STAGE-C', 'AI-STAGE-D', 'AI-STAGE-E', 'AI-STAGE-F', '決策原因', '未配對回覆', '退回原因', '確認原因'];
  for (let i = 1; i < ordered.length; i++) assert.ok(md.indexOf(ordered[i - 1]) < md.indexOf(ordered[i]), `${ordered[i - 1]} → ${ordered[i]}`);
  assert.ok(md.includes(`${eventsFile}:2`));assert.ok(md.includes(`${archiveFile}#rounds[0].replies[0]`));
  assert.match(md, /原始來源 original:4/);
  assert.match(md, /TASK-history.md#planning.learningTurns\[5\].response/);
  for (const entry of md.split('\n### ').filter(s => s.includes('｜'))) assert.match(entry, /來源：/);
});

test('公開對話超過 8000 字仍保留尾段；欄位及內容類型白名單排除敏感資料', async t => {
  const { task, events, archive, markdown } = await fixture(t);
  const secret = 'SECRET-';
  task.planning.rules = secret + 'rules';
  task.planning.messages = [{ role: 'system', text: secret + 'system', at: at(0) }, { role: 'assistant', channel: 'analysis', text: secret + 'analysis', at: at(0) }];
  task.planning.learningTurns = [{ id: 'long', stage: 'D', userInput: '公開要求', startedAt: at(0), completedAt: at(1), response: '公開長文'.repeat(2500) + 'LONG-TAIL', prompt: secret + 'prompt', thinking: secret + 'thinking', toolOutput: secret + 'tool-output' }];
  await events([{ type: 'STAGE_STARTED', stage: 'D', at: at(0), prompt: secret + 'event-prompt', arguments: secret + 'arguments' }, { type: 'TOOL_OUTPUT', text: secret + 'event-tool', at: at(0) }]);
  await archive({ rounds: [{ id: 'r', input: '匯入公開要求', rawInput: secret + 'rawInput', at: at(0), replies: [{ at: at(1), text: [{ type: 'text', text: 'PUBLIC-TEXT' }, { type: 'thinking', text: secret + 'content-thinking' }, { type: 'tool_result', text: secret + 'content-tool' }, { type: 'text', channel: 'analysis', text: secret + 'content-analysis' }] }, { channel: 'analysis', text: secret + 'reply-analysis' }] }], unpaired: [{ role: 'tool', text: secret + 'unpaired-tool' }] });
  const md = await markdown();
  assert.ok(md.length > 8000); assert.ok(md.includes('LONG-TAIL')); assert.ok(md.includes('PUBLIC-TEXT'));
  assert.ok(!md.includes(secret));
});

test('缺少可選檔可產檔，時間及內容缺口明示；只依相同明確識別碼去重', async t => {
  const { task, events, archive, markdown } = await fixture(t);
  assert.match(await markdown(), /完整對話過程/);
  task.planning.messages = [{ id: 'same', role: 'user', text: 'DEDUP-MARKER', at: at(0) }, { id: 'different', role: 'user', text: 'DEDUP-MARKER', at: at(0) }, { role: 'user', text: 'NO-ID-MARKER' }, { role: 'user', text: 'NO-ID-MARKER' }, { role: 'ai', at: at(1) }];
  await events([{ id: 'same', type: 'HUMAN_REPLY', text: 'DEDUP-MARKER', at: at(0) }, { type: 'HUMAN_REPLY', text: 'BAD-TIME', at: 'invalid' }]);
  await archive({ rounds: [{ inputRef: { recordId: 'same' }, input: 'DEDUP-MARKER', at: at(0), replies: [] }], unpaired: [{ id: 'empty-reply', at: at(2) }] });
  const md = await markdown();
  assert.equal(count(md, 'DEDUP-MARKER'), 2);assert.equal(count(md, 'NO-ID-MARKER'), 2);
  assert.match(md, /無時間／時間無法解析的紀錄/);assert.match(md, /缺少時間/);assert.match(md, /缺少公開內容/);assert.match(md, /時間無法解析/);
  assert.match(md, /來源：.*planning.messages\[0\].*events.*:1.*conversations.*rounds\[0\]/);
});

test('JSONL / JSON 格式與集合結構損壞會明確失敗，既有交接檔保持完整', async t => {
  const { root, task, eventsFile, archiveFile, markdown } = await fixture(t);
  const previous = await markdown();
  const file = path.join(root, 'vault/handoffs/TASK-history-r1-handoff.md');
  for (const value of ['{oops}', 'null', '{}']) {
    await writeFile(eventsFile, value);
    await assert.rejects(markdown(), error => error.code === 'HANDOFF_SOURCE_INVALID' && error.message.includes(`${eventsFile}:1`));
    assert.equal(await readFile(file, 'utf8'), previous);
  }
  await writeFile(eventsFile, '');
  for (const value of ['{oops}', 'null', '{"rounds":{}}', '{"rounds":[{"replies":{}}]}', '{"unpaired":[null]}', '{"rounds":[{"input":123}]}', '{"taskId":"TASK-other"}']) {
    await writeFile(archiveFile, value);
    await assert.rejects(markdown(), error => error.code === 'HANDOFF_SOURCE_INVALID' && error.message.includes(archiveFile));
    assert.equal(await readFile(file, 'utf8'), previous);
  }
  await rm(archiveFile);
  task.planning.messages = {};
  await assert.rejects(markdown(), { code: 'HANDOFF_SOURCE_INVALID' });
});
