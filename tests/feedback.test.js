import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaskStore } from '../src/tasks.js';
import { Coach, prompts } from '../src/coach.js';
import { defaultStageSettings } from '../src/models.js';
import { Memory } from '../src/memory.js';
import { pendingFeedback, summarize, feedbackBrief, validateFeedback } from '../src/feedback.js';

process.env.AWC_CODEX_BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-cli.mjs');

const item = (id, extra = {}) => ({ id, title: `項目 ${id}`, owner: 'ai', status: 'DONE', doneAt: '2026-10-09T10:00:00.000Z', ...extra });
const task = (planning, extra = {}) => ({ id: 'TASK-x', title: '小遊戲', project: 'Demo', planning: { phase: 'execute', feedback: [], feedbackSince: '2026-10-09T09:00:00.000Z', workItems: [], ...planning }, ...extra });

test('one question at a time: confirmed items first, then the stop, then the task review', () => {
  const t = task({ phase: 'done', autopilot: { waitingFor: { kind: 'human', label: '輪到你', at: '2026-10-09T10:05:00.000Z' } }, workItems: [item('W1'), item('W2', { doneAt: '2026-10-09T08:00:00.000Z' })] });
  const confirm = pendingFeedback(t);
  assert.deepEqual([confirm.moment, confirm.items], ['confirm', ['W1']], '升級前完成的 W2 不補問');
  assert.equal(confirm.scale.length, 5);
  t.planning.feedback.push({ moment: 'confirm', ref: confirm.ref, items: ['W1'] });
  assert.equal(pendingFeedback(t).moment, 'park');
  t.planning.feedback.push({ moment: 'park', ref: 'park:2026-10-09T10:05:00.000Z' });
  assert.equal(pendingFeedback(t).moment, 'done');
  t.planning.feedback.push({ moment: 'done', ref: 'done', skipped: true });
  assert.equal(pendingFeedback(t), null, '略過也算回答過，不再問');
  assert.equal(pendingFeedback(task({ running: { stage: 'D' }, workItems: [item('W1')] })), null, 'AI 在跑時不打擾');
  assert.equal(pendingFeedback({ planning: { phase: 'done', workItems: [item('W1')] } }), null, '升級前的任務沒有回饋陣列就不問');
});

test('answers are validated against the current question', () => {
  const t = task({ workItems: [item('W1')] });
  const ref = pendingFeedback(t).ref;
  assert.match(validateFeedback(t, { ref: 'old', score: 4 }).error, /已經變了/);
  assert.match(validateFeedback(t, { ref, score: 6 }).error, /1 到 5/);
  assert.match(validateFeedback(t, { ref, score: 4, tags: ['亂寫'] }).error, /標籤/);
  const { entry } = validateFeedback(t, { ref, score: 2, tags: ['做太多', '做太多'], note: '只要骨架' });
  assert.deepEqual([entry.moment, entry.score, entry.tags, entry.items], ['confirm', 2, ['做太多'], ['W1']]);
});

test('summary turns negative tags into directions and the brief prefers the same project', () => {
  const rated = (project, score, tags, note = '') => ({ id: `T-${Math.random()}`, title: 't', project, planning: { feedback: [{ moment: 'confirm', score, tags, note, at: new Date().toISOString() }] } });
  const all = [rated('A', 2, ['做太多'], '骨架就好'), rated('A', 3, ['做太多', '品質好']), rated('A', 5, ['品質好']), rated('B', 1, ['不符需求'])];
  const s = summarize(all);
  assert.equal(s.count, 4);
  assert.equal(s.byMoment.confirm.avg, 2.8);
  assert.deepEqual(s.directions.map(d => d.tag), ['做太多', '不符需求']);
  assert.equal(s.quotes[0].note, '骨架就好');
  const brief = feedbackBrief(all, 'A');
  assert.match(brief, /專案「A」/);
  assert.match(brief, /只做這一項要求的範圍.*「做太多」2 次/);
  assert.doesNotMatch(brief, /不符需求/, '同專案有 3 筆以上就只用同專案');
  assert.match(feedbackBrief(all, 'C'), /所有任務/);
  assert.equal(feedbackBrief([], 'A'), '');
});

test('confirming starts the form, the answer is stored and audited, and the next task carries the direction', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'awc-feedback-'));
  const store = new TaskStore(dir);
  const settings = { revision: 1, stages: defaultStageSettings() };
  const coach = new Coach(store, () => settings, dir, new Memory(path.join(dir, 'memory')));
  const created = await coach.create({ request: '我要做一份新品簡報給主管', profile: 'quick', project: 'Alpha' });
  await created.done;
  let t = (await store.get(created.task.id)).task;
  assert.deepEqual(t.planning.feedback, []);
  await (await coach.answer(t.id, t.revision, 'f-1', { message: '十頁' })).done;
  await (await coach.draftOutline(t.id)).done;
  t = (await store.get(t.id)).task;
  t = (await coach.approveOutline(t.id, t.revision, 'f-2')).task;
  await (await coach.execute(t.id, 'W1')).done;
  t = (await store.get(t.id)).task;
  await (await coach.review(t.id, 'W1')).done;
  t = (await store.get(t.id)).task;
  t = (await coach.confirm(t.id, t.revision, 'f-3', { itemId: 'W1', accept: true })).task;
  const listed = (await store.list()).find(x => x.id === t.id);
  assert.equal(listed.feedbackPrompt.moment, 'confirm');
  const result = await coach.feedback(t.id, t.revision, 'f-4', { ref: listed.feedbackPrompt.ref, score: 2, tags: ['做太多'], note: '只要第一頁' });
  assert.equal(result.task.planning.feedback.at(-1).score, 2);
  assert.equal((await coach.events(t.id)).at(-1).type, 'FEEDBACK');
  await assert.rejects(coach.feedback(t.id, result.task.revision, 'f-5', { ref: listed.feedbackPrompt.ref, score: 3 }), { code: 'FEEDBACK_INVALID' });
  const next = await coach.create({ request: '再做一份簡報給主管', profile: 'quick', project: 'Alpha' });
  await next.done;
  const nt = (await store.get(next.task.id)).task;
  assert.match(nt.planning.feedbackBrief, /只做這一項要求的範圍/);
  assert.match(prompts.A(nt), /使用者原話（2 分）：「只要第一頁」/);
});
