import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { TaskError } from './tasks.js';

export const textSha = text => createHash('sha256').update(text).digest('hex');
const contentText = content => typeof content === 'string' ? content : (Array.isArray(content) ? content : []).filter(c => ['text', 'input_text', 'output_text'].includes(c.type)).map(c => c.text || '').join('\n');
const controls = /^# AGENTS\.md|^<environment_context>|^<external_codex_apps_|^<task-notification>|^<local-command-|^\[Request interrupted|^This session is being continued|^<command-name>\/model/;

export function readablePrompt(text) {
  const command = text.match(/<command-args>([\s\S]*?)<\/command-args>/);
  return (command ? command[1] : text).replace(/<\/?pasted_content\b[^>]*>/g, '').trim();
}

// 只收公開對話文字；不匯入 thinking／analysis、工具參數、圖片或工具輸出。
export function parseConversation(raw, { provider, sourceId, originalPath }) {
  const rows = raw.split('\n').flatMap((line, i) => {
    if (!line.trim()) return [];
    try { return [{ ...JSON.parse(line), line: i + 1 }]; }
    catch { throw new Error(`${path.basename(originalPath)}:${i + 1} JSON 格式錯誤，停止匯入。`); }
  });
  const parents = new Map(rows.filter(r => r.uuid).map(r => [r.uuid, r.parentUuid]));
  const human = new Map(), rounds = [], excluded = [], unpaired = [];
  let current, model = null, effort = null;
  const source = { provider, sourceId, originalPath, sha256: textSha(raw), rows: rows.length };
  const ref = (row, text) => ({ sourceId, line: row.line, recordId: row.uuid || row.payload?.id || null, textSha: textSha(text) });
  for (const row of rows) {
    if (provider === 'codex' && row.type === 'turn_context') { model = row.payload?.model || null; effort = row.payload?.effort || row.payload?.reasoning_effort || null; }
    const message = provider === 'claude' ? row.message : row.payload;
    const visible = provider === 'claude' ? ['user', 'assistant'].includes(row.type) : row.type === 'response_item' && message?.type === 'message';
    if (!visible || !message) continue;
    const role = provider === 'claude' ? row.type : message.role;
    if (!['user', 'assistant'].includes(role) || message.channel === 'analysis') continue;
    const text = contentText(message.content);
    if (!text.trim()) continue;
    if (role === 'user') {
      if (row.isMeta || row.isCompactSummary || controls.test(text.trim())) {
        excluded.push({ at: row.timestamp, reason: row.isMeta || row.isCompactSummary ? '系統／上下文' : '控制訊息', ref: ref(row, text) });
        continue;
      }
      const input = readablePrompt(text);
      current = { id: `${provider}-${sourceId}-${row.uuid || row.line}`, provider, sourceId, at: row.timestamp, input, rawInput: text, inputKind: 'user', inputRef: ref(row, text), replies: [], models: [], status: 'unanswered', origin: 'imported' };
      rounds.push(current);
      if (row.uuid) human.set(row.uuid, current);
    } else {
      let owner, ancestor = row.parentUuid;
      const seen = new Set();
      while (ancestor && !seen.has(ancestor)) {
        seen.add(ancestor);
        if (human.has(ancestor)) { owner = human.get(ancestor); break; }
        ancestor = parents.get(ancestor);
      }
      const association = owner ? 'ancestry' : 'chronological';
      owner ||= current;
      const reply = { at: row.timestamp, text, model: message.model || model, effort, ref: ref(row, text), association };
      if (!owner) { unpaired.push(reply); continue; }
      owner.replies.push(reply);
      owner.status = 'replied';
      if (reply.model && !owner.models.some(m => m.model === reply.model && m.effort === reply.effort)) owner.models.push({ model: reply.model, effort: reply.effort });
    }
  }
  return { source, rounds, excluded, unpaired };
}

export function liveRounds(task) {
  return (task.planning?.learningTurns || []).map(turn => ({
    id: turn.id, provider: turn.provider || (/copilot/i.test(turn.agent) ? 'copilot' : /claude/i.test(turn.agent) ? 'claude' : /codex/i.test(turn.agent) ? 'codex' : 'unknown'),
    sourceId: task.id, at: turn.startedAt, stage: turn.stage, origin: 'workspace',
    input: turn.userInput || '', rawInput: turn.prompt, inputKind: turn.inputKind || 'unrecorded',
    replies: turn.response ? [{ text: turn.response, at: turn.completedAt, model: turn.modelId || null, effort: turn.effort || null }] : [],
    models: turn.modelId ? [{ model: turn.modelId, effort: turn.effort || null }] : [],
    agent: turn.agent, status: turn.status, learning: turn.learning, learningStatus: turn.learningStatus,
    beforeRevision: turn.beforeRevision, afterRevision: turn.afterRevision, reflection: turn.reflection, error: turn.error,
    outputs: turn.outputs || [], workItemId: turn.workItemId || null
  }));
}

export function nextRequest(task, archive = {}) {
  const p = task.planning, card = p?.card;
  const known = (task.facts || []).map(f => `${f.label}：${f.value}（${f.verified ? '任務卡曾標記核對，仍需比對最新來源' : '待核對'}；來源 ${f.source}）`);
  return [
    `請處理「${task.title}」。`,
    `讀者：${card?.audience || task.audience || '待確認'}；目標：${String(card?.goal || task.goal).replace(/[。]+$/, '')}。`,
    `目前基準：${task.current?.artifact || task.allowedRoots?.[0] || '待提供'}。先核對現檔與來源，版本有差異請回報，不要沿用舊聊天中的檔名。`,
    `本次請先整理可讀的大綱與缺口，尚不修改正式成果。${archive.direction ? `主張：${archive.direction}。` : ''}`,
    `保留：${[...(task.scope?.locked || []).map(l => l.text), ...(card?.constraints || [])].join('；') || '使用者未要求調整的部分'}。`,
    `歷史口徑（仍需核對現檔）：\n${known.length ? known.map(t => `- ${t}`).join('\n') : '- 先讀資料夾現有素材；讀不到才回報缺口，不猜數字。'}`,
    ...(archive.cautions?.length ? [`最新來源提醒：\n${archive.cautions.map(c => `- ${c}`).join('\n')}`] : []),
    '素材必須位於新任務允許讀取的資料夾內；若基準檔在範圍外，請回報無法核對，不宣稱已讀。',
    '數字、單位、期間與資料範圍請逐項附原文及位置；尚未核對的資訊不可當成確定事實。',
    '先列「已知／待決定／待核對」。已回答的不再問；一次只問會改變方向或事實正確性的缺口，版面細節先給可調整建議。',
    '每頁先講一個重點；回答最後列這次改了什麼、理由、保持不變的內容與驗收證據。尚未驗證就明寫，不承諾一次完成。'
  ].join('\n\n');
}

export class Conversations {
  constructor(dir) { this.dir = dir; }
  async read(task) {
    if (!/^TASK-[a-zA-Z0-9-]+$/.test(task.id)) throw new TaskError(400, 'TASK_INVALID', '任務 ID 格式不正確。');
    let archive = {};
    try { archive = JSON.parse(await readFile(path.join(this.dir, `${task.id}.json`), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const rounds = [...(archive.rounds || []), ...liveRounds(task)].sort((a, b) => String(a.at).localeCompare(String(b.at)) || a.id.localeCompare(b.id));
    return { ...archive, taskId: task.id, title: task.title, rounds: rounds.map((r, i) => ({ ...r, no: i + 1 })), nextPrompt: nextRequest(task, archive), current: { summary: task.current.summary, nextAction: task.nextAction, revision: task.revision },
      limits: [...(archive.limits || []), ...(rounds.some(r => r.inputKind === 'unrecorded') ? ['部分早期Mentor執行沒有分開記錄使用者輸入；保留完整實際 prompt，不冒充原始使用者提問。'] : [])] };
  }
}
