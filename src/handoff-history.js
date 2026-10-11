import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { TaskError } from './tasks.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = location => { throw new TaskError(422, 'HANDOFF_SOURCE_INVALID', `交接來源格式損壞：${location}`); };
const rows = (value, location) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(row => !object(row))) fail(location);
  return value;
};

// 只讀已保存的公開欄位；不將 prompt、rawInput 或任意巢狀物件序列化。
export async function readHandoffSources(root, task) {
  const eventPath = path.join(root, 'vault/events', `${task.id}.jsonl`);
  const archivePath = path.join(root, 'vault/conversations', `${task.id}.json`);
  const optional = async file => {
    try { return await readFile(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const eventText = await optional(eventPath);
  const events = (eventText ?? '').split('\n').flatMap((line, index) => {
    if (!line.trim()) return [];
    let record;
    try { record = JSON.parse(line); } catch { fail(`${eventPath}:${index + 1}`); }
    if (!object(record) || typeof record.type !== 'string') fail(`${eventPath}:${index + 1}`);
    return [{ record, location: `${eventPath}:${index + 1}` }];
  });
  let archive = {};
  const archiveText = await optional(archivePath);
  if (archiveText !== null) {
    try { archive = JSON.parse(archiveText); } catch { fail(archivePath); }
    if (!object(archive) || (archive.taskId && archive.taskId !== task.id)) fail(archivePath);
    for (const field of ['rounds', 'unpaired', 'lessons']) rows(archive[field], `${archivePath}#${field}`);
    for (const [i, round] of (archive.rounds || []).entries()) rows(round.replies, `${archivePath}#rounds[${i}].replies`);
  }
  return { events, archive, archivePath, taskPath: path.join(root, 'vault', `${task.id}.md`) };
}

const hidden = record => ['analysis', 'thinking'].includes(record.channel) || ['analysis', 'thinking', 'tool', 'system', 'developer'].includes(record.role) || ['thinking', 'analysis', 'tool_use', 'tool_result', 'function_call', 'function_call_output'].includes(record.type);
const publicText = value => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter(part => object(part) && !hidden(part) && ['text', 'input_text', 'output_text'].includes(part.type)).map(part => typeof part.text === 'string' ? part.text : '').join('\n');
  return '';
};
const eventFields = {
  TASK_CREATED: ['request'], HUMAN_REPLY: ['text'], INSTRUCTION: ['text', 'reason'],
  CHANGES_REQUESTED: ['text'], ITEM_CONFIRMED: ['text'], ITEM_RETURNED: ['text'],
  ITEMS_CONFIRMED: [], GATE_APPROVED: [], GATE_AUTO_APPROVED: ['note'],
  STAGE_STARTED: [], STAGE_COMPLETED: [], STAGE_FAILED: ['message'], STAGE_STOPPED: ['message'],
  STOP_REQUESTED: [], STOP_UNCONFIRMED: [], TURN_REFLECTION: ['answer'],
  LEARNING_KEPT: ['added'], FEEDBACK: ['reason'], AUTOPILOT_ON: [], AUTOPILOT_OFF: [],
  AUTOPILOT_PARKED: ['label'], AUTOPILOT_ENDED: ['note'], AGENTS_SET: []
};

export function handoffHistory(task, { events = [], archive = {}, archivePath = '匯入對話', taskPath = '任務檔' } = {}) {
  const records = [], gaps = [], seen = new Map();
  const add = (record, kind, text, at, location, source, id) => {
    if (hidden(record)) return;
    if (text !== undefined && text !== null && typeof text !== 'string' && !Array.isArray(text)) fail(location);
    if (Array.isArray(text) && text.some(part => !object(part))) fail(location);
    const content = publicText(text);
    if (!content.trim()) gaps.push(`${location}：缺少公開內容（${kind}），未以內部 prompt 補寫。`);
    const timestamp = typeof at === 'string' ? Date.parse(at) : NaN;
    if (!Number.isFinite(timestamp)) gaps.push(`${location}：${at ? '時間無法解析' : '缺少時間'}（${kind}）。`);
    // 同一輪的輸入與回覆是不同訊息；共用 turnId 不代表同一筆。
    if (id !== undefined && id !== null && typeof id !== 'string') fail(location);
    const key = id || null;
    if (key && seen.has(key)) {
      const existing = seen.get(key);
      if (existing.text !== content) gaps.push(`${location}：相同識別碼 ${id} 的內容不一致，保留第一筆並附來源。`);
      existing.locations.push(location);
      return;
    }
    const entry = { kind, text: content || '［缺少公開內容］', at, timestamp, source, order: records.length, locations: [location], stage: record.stage };
    records.push(entry);
    if (key) seen.set(key, entry);
  };
  const p = task.planning || {};
  if (p.request !== undefined) add({}, '使用者需求', p.request, p.createdAt, `${taskPath}#planning.request`, 0);
  for (const [i, message] of rows(p.messages, `${taskPath}#planning.messages`).entries()) {
    if (!['user', 'ai', 'assistant'].includes(message.role)) continue;
    const text = [publicText(message.text), publicText(message.reason), publicText(message.coaching), ...rows(message.questions, `${taskPath}#planning.messages[${i}].questions`).map(q => publicText(q.q))].filter(Boolean).join('\n');
    add(message, message.role === 'user' ? '使用者回答' : 'AI 回覆', text, message.at, `${taskPath}#planning.messages[${i}]`, 0, message.id);
  }
  for (const [i, turn] of rows(p.learningTurns, `${taskPath}#planning.learningTurns`).entries()) {
    const loc = `${taskPath}#planning.learningTurns[${i}]`;
    add(turn, turn.inputKind === 'user' ? '使用者回答' : '階段接續要求', turn.userInput, turn.startedAt, `${loc}.userInput`, 0, turn.inputRef?.recordId);
    if (turn.response !== undefined || turn.status === 'completed') add(turn, 'AI 回覆', turn.response, turn.completedAt, `${loc}.response`, 0, turn.responseRef?.recordId || (turn.id ? `${turn.id}:response` : null));
    if (turn.reflection) add({}, '人的回想', turn.reflection.answer, turn.reflection.at, `${loc}.reflection`, 0);
  }
  for (const [i, decision] of (task.decisions || []).entries()) {
    const history = decision.history?.length ? rows(decision.history, `${taskPath}#decisions[${i}].history`) : decision.choice ? [{ choice: decision.choice, note: decision.note, at: decision.decidedAt }] : [];
    for (const [j, h] of history.entries()) add(h, '人的決策', `${decision.question} → ${(decision.options || []).find(o => o.id === h.choice)?.label || h.choice}${h.note ? `\n原因：${h.note}` : ''}`, h.at, decision.history?.length ? `${taskPath}#decisions[${i}].history[${j}]` : `${taskPath}#decisions[${i}]`, 0, h.id);
  }
  for (const [i, check] of (task.checks || []).entries()) if (check.checkedAt || check.note) add(check, '驗收紀錄', `${check.label}：${check.result}\n${check.note || '未記錄原因'}`, check.checkedAt, `${taskPath}#checks[${i}]`, 0);
  for (const [i, item] of (p.workItems || []).entries()) {
    for (const [j, instruction] of rows(item.instructions, `${taskPath}#planning.workItems[${i}].instructions`).entries()) add(instruction, '使用者補充指示', instruction.text, instruction.at, `${taskPath}#planning.workItems[${i}].instructions[${j}]`, 0, instruction.id);
    for (const [j, log] of rows(item.log, `${taskPath}#planning.workItems[${i}].log`).entries()) add(log, 'AI 階段紀錄', log.text, log.at, `${taskPath}#planning.workItems[${i}].log[${j}]`, 0, log.id);
    if (item.review) {
      const loc = `${taskPath}#planning.workItems[${i}].review`;
      const text = [publicText(item.review.coaching), publicText(item.review.raw), ...rows(item.review.results, `${loc}.results`).map(r => `${publicText(r.criterion)}：${publicText(r.result)}｜${publicText(r.evidence)}`)].filter(Boolean).join('\n');
      add(item.review, 'AI 驗收結果', text, item.review.at, loc, 0);
    }
    if (item.doneAt || item.humanNote) add(item, '人的確認', `${item.id} ${item.title || ''}\n${item.humanNote || '未記錄原因'}`, item.doneAt, `${taskPath}#planning.workItems[${i}].humanNote`, 0);
    for (const [j, fix] of (item.fixes || []).entries()) add({}, '退回原因', fix, null, `${taskPath}#planning.workItems[${i}].fixes[${j}]`, 0);
  }
  for (const { record, location } of events) {
    const fields = eventFields[record.type];
    if (!fields || hidden(record)) continue;
    const content = fields.map(field => publicText(record[field])).filter(Boolean).join('\n');
    add(record, record.type === 'HUMAN_REPLY' ? '使用者回答' : record.type === 'TASK_CREATED' ? '使用者需求' : record.type, fields.length ? content : `業務事件：${record.type}${record.itemId ? `（${record.itemId}）` : ''}`, record.at, location, 1, record.recordId || record.id);
  }
  const refLocation = (loc, ref) => ref ? `${loc}（原始來源 ${ref.sourceId || '未記錄'}:${ref.line ?? '未記錄'}；recordId ${ref.recordId || '未記錄'}）` : loc;
  for (const [i, round] of rows(archive.rounds, `${archivePath}#rounds`).entries()) {
    const loc = `${archivePath}#rounds[${i}]`;
    add(round, '使用者需求', round.input, round.at, refLocation(`${loc}.input`, round.inputRef), 2, round.inputRef?.recordId || round.id);
    for (const [j, reply] of rows(round.replies, `${loc}.replies`).entries()) add(reply, 'AI 回覆', reply.text, reply.at, refLocation(`${loc}.replies[${j}]`, reply.ref), 2, reply.ref?.recordId || reply.id);
  }
  for (const [i, reply] of rows(archive.unpaired, `${archivePath}#unpaired`).entries()) add(reply, 'AI 未配對回覆', reply.text, reply.at, refLocation(`${archivePath}#unpaired[${i}]`, reply.ref), 2, reply.ref?.recordId || reply.id);
  const render = entry => `### ${entry.at || '時間未記錄'}｜${entry.kind}${entry.stage ? `｜階段 ${entry.stage}` : ''}\n來源：${entry.locations.join('；')}\n\n${entry.text}`;
  const dated = records.filter(r => Number.isFinite(r.timestamp)).sort((a, b) => a.timestamp - b.timestamp || a.source - b.source || a.order - b.order);
  const undated = records.filter(r => !Number.isFinite(r.timestamp));
  return [dated.map(render).join('\n\n') || '未記錄有時間的公開對話。', '### 無時間／時間無法解析的紀錄（無法納入時間排序）', undated.map(render).join('\n\n') || '無', '### 資料缺口', gaps.map(g => `- ${g}`).join('\n') || '- 無'].join('\n\n');
}
