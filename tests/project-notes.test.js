import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectNotes, projectNoteSlug, renderProjectNote } from '../src/project-notes.js';

const task = (extra = {}) => ({
  id: 'TASK-20261114-12345678', title: '虛構簡報', project: '年度簡報', goal: '讓團隊看懂虛構指標', status: 'READY', createdAt: '2026-11-14T01:00:00Z', updatedAt: '2026-11-14T02:00:00Z', file: 'TASK-20261114-12345678.md',
  current: { summary: '尚待製作' }, decisions: [], checks: [], reports: [], learnings: [], planning: { phase: 'execute', workItems: [{ title: '整理資料', owner: 'ai', status: 'TODO', acceptance: ['數字附來源'] }], diary: [{ status: 'candidate', text: '未確認學習不可寫入' }], learningTurns: [{ status: 'completed', learning: { lesson: 'AI 候選不可當成已學會' } }] },
  ...extra
});

test('slug handles invalid chars, Windows reserved names, and stable task collision suffixes', () => {
  assert.equal(projectNoteSlug('a/b:*?'), 'a-b---.md');
  assert.match(projectNoteSlug('CON'), /^專案-CON\.md$/);
  assert.equal(projectNoteSlug('同名', 'TASK-12345678'), '同名-12345678.md');
  assert.notEqual(projectNoteSlug('same/name', 'TASK-12345678'), projectNoteSlug('same:name', 'TASK-87654321'));
});

test('generated note reflects confirmed facts only and does not call an AI provider', () => {
  const rendered = renderProjectNote([task()]).body;
  assert.match(rendered, /尚未驗證/);
  assert.match(rendered, /尚無使用者確認的學習內容/);
  assert.doesNotMatch(rendered, /未確認學習不可寫入/);
  assert.doesNotMatch(rendered, /AI 候選不可當成已學會/);
  assert.match(rendered, /數字附來源/);
});

test('progress uses plain words and review fallback only appears without confirmed questions',()=>{
  const base=task({planning:{phase:'execute',workItems:[{title:'虛構工作',owner:'ai',status:'REVIEWED',acceptance:[]}],diary:[],learningTurns:[{status:'completed'}]}});
  const empty=renderProjectNote([base]).body;assert.match(empty,/待你確認/);assert.doesNotMatch(empty,/REVIEWED|TODO|DONE/);assert.match(empty,/尚無使用者確認的回顧問題/);
  const confirmed=renderProjectNote([{...base,planning:{...base.planning,learningTurns:[{status:'completed',confirmedQuestion:['要先確認哪個條件？']}]}}]).body;
  assert.match(confirmed,/要先確認哪個條件/);assert.doesNotMatch(confirmed,/尚無使用者確認的回顧問題/);
});

test('project notes preserve manual text and retain edits made inside generated block as conflict', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mentor-project-note-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'vault'));
  const notes = new ProjectNotes(root), fixture = task();
  const first = await notes.sync(fixture);
  let content = await readFile(path.join(root, 'vault', 'notes', first.filename), 'utf8');
  content += '\n\n手寫補充：沿用虛構資料。\n';
  await writeFile(path.join(root, 'vault', 'notes', first.filename), content);
  await notes.sync({ ...fixture, revision: 2, current: { summary: '更新的進度' } });
  content = await readFile(path.join(root, 'vault', 'notes', first.filename), 'utf8');
  assert.match(content, /手寫補充：沿用虛構資料/);
  const damaged = content.replace('數字附來源', '人工改過系統結論');
  await writeFile(path.join(root, 'vault', 'notes', first.filename), damaged);
  const result = await notes.sync({ ...fixture, revision: 3 });
  content = await readFile(path.join(root, 'vault', 'notes', first.filename), 'utf8');
  assert.equal(result.conflict, true);
  assert.match(content, /系統區塊修改衝突/);
  assert.match(content, /人工改過系統結論/);
});
