import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renameReplace } from './platform.js';

const BEGIN = /^<!-- mentor:begin sha256=([a-f0-9]{64}) -->$/m;
const END = '<!-- mentor:end -->';
const digest = value => createHash('sha256').update(value).digest('hex');

export function projectNoteSlug(title, taskId = '') {
  let name = String(title || '未分類專案').normalize('NFKC')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/[. ]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) name = `專案-${name || '未命名'}`;
  return `${name.slice(0, 100)}${taskId ? `-${taskId.slice(-8)}` : ''}.md`;
}

const safe = value => String(value || '').replace(/[\r\n|]/g, ' ').trim() || '未記錄';
const date = value => value ? String(value).slice(0, 10) : '未記錄';
const statusName = task => ({ RUNNING: '製作中', READY: '製作中', BLOCKED: '待處理', AWAITING_ACCEPTANCE: '待驗收', COMPLETED: '已完成', PAUSED: '已暫停' }[task.planning ? (task.planning.phase === 'done' ? 'COMPLETED' : task.planning.running || task.planning.runs?.some(r => r.status === 'running') ? 'RUNNING' : task.planning.workItems?.some(i => i.status === 'REVIEWED') ? 'AWAITING_ACCEPTANCE' : task.planning.stopped ? 'BLOCKED' : 'READY') : task.status] || '製作中');

export function renderProjectNote(tasks, { updatedAt = new Date().toISOString() } = {}) {
  const first = tasks[0] || {};
  const project = first.project || first.title || '未分類專案';
  const ids = tasks.map(t => t.id).filter(Boolean);
  const body = [
    `# ${project}`, '',
    `> ${tasks.every(t => statusName(t) === '已完成') ? safe(first.current?.summary || first.goal) : '尚未完成'}`, '',
    '## 目標', ...tasks.map(t => `- **${t.title || t.id}**：${safe(t.goal || t.planning?.request)}`), '',
    '## 進度', '| 部分 | 負責 AI | 狀態 | 成果 |', '| --- | --- | --- | --- |',
    ...tasks.flatMap(t => (t.planning?.workItems || []).map(item => `| ${safe(item.title)} | ${safe(item.owner === 'human' ? '你' : item.agent || '尚未指派')} | ${safe(item.status)} | ${safe((item.outputs || []).map(o => o.file).join(', '))} |`)),
    ...(tasks.some(t => !t.planning?.workItems?.length) ? tasks.filter(t => !t.planning?.workItems?.length).map(t => `| ${safe(t.title)} | ${safe(t.planning?.runs?.map(r => r.provider).filter(Boolean).join(', ') || '尚未指派')} | ${statusName(t)} | ${safe(t.current?.summary)} |`) : []), '',
    '## 我們怎麼做', ...tasks.map(t => `- ${t.id}：${safe(t.planning?.outline?.summary || t.planning?.request || t.current?.summary)}`), '',
    '## 關鍵決策', '| 決策 | 選擇 | 理由 | 誰決定 | 日期 |', '| --- | --- | --- | --- | --- |',
    ...tasks.flatMap(t => (t.decisions || []).map(d => `| ${safe(d.question)} | ${safe(d.choice ? d.options?.find(o => o.id === d.choice)?.label : d.status)} | ${safe(d.note || d.basis)} | ${d.status === 'DECIDED' ? '使用者' : '尚未決定'} | ${date(d.decidedAt)} |`)), '',
    '## 結論與成果', ...tasks.map(t => `- ${t.id}：${safe(t.current?.summary || t.reports?.at(-1)?.summary || '尚無結論')} ${(t.planning?.workItems || []).flatMap(i => i.outputs || []).map(o => `\`${o.file}\``).join(' ')}`), '',
    '## 驗收狀態', ...tasks.flatMap(t => [
      ...(t.checks || []).map(c => `- ${c.kind === 'human' ? '使用者驗收' : '自動檢查'}：${safe(c.label)}（${c.result === 'PASS' ? '自動檢查通過' : c.result === 'FAIL' ? '未通過' : '尚未驗證'}）`),
      ...(t.planning?.workItems || []).flatMap(i => (i.acceptance || []).map(a => `- ${safe(i.title)}：${i.status === 'DONE' ? '已由你確認' : i.status === 'REVIEWED' ? '自動檢查通過，尚待你確認' : '尚未驗證'} — ${safe(a)}`))
    ]), ...(tasks.some(t => !t.checks?.length && !t.planning?.workItems?.some(i => i.acceptance?.length)) ? ['- 沒有保存驗收證據；尚未驗證。'] : []), '',
    '## 我學到的', ...tasks.flatMap(t => (t.planning?.diary || []).filter(d => d.status === 'kept').map(d => `- ${safe(d.text)}`)),
    ...(tasks.some(t => t.planning?.diary?.some(d => d.status === 'kept')) ? [] : ['- 尚無使用者確認的學習內容。']), '',
    '## 回顧問題', ...tasks.flatMap(t => (t.planning?.learningTurns || []).map(turn => turn.confirmedQuestion).filter(Boolean).map(q => `- ${safe(q)}`)),
    '- 尚無使用者確認的回顧問題。', '',
    '## 過程紀錄', ...tasks.flatMap(t => [
      `- ${date(t.createdAt)} 建立任務 ${t.id}。`,
      ...(t.planning?.learningTurns || []).filter(turn => turn.status === 'completed').map(turn => `- ${date(turn.endedAt || turn.startedAt)} ${safe(turn.agent || turn.stage)} 完成一輪；${safe(turn.outcome || turn.learning?.change)}`),
      ...(t.events || []).slice(-8).map(e => `- ${date(e.at)} ${safe(e.label || e.type)}`),
      `- 任務紀錄：\`vault/${t.file || `${t.id}.md`}\``
    ])
  ].join('\n');
  return { project, ids, status: tasks.every(t => statusName(t) === '已完成') ? '已完成' : tasks.some(t => statusName(t) === '待驗收') ? '待驗收' : '製作中', updatedAt, body };
}

function replaceSystemBlock(existing, generated) {
  const match = existing.match(BEGIN);
  if (!match) {
    const block = `<!-- mentor:begin sha256=${digest(generated)} -->\n${generated}\n${END}`;
    return { content: `${existing.trimEnd()}${existing.trim() ? '\n\n' : ''}${block}`, conflict: false };
  }
  const start = match.index, contentStart = start + match[0].length, end = existing.indexOf(END, contentStart);
  if (end < 0) return { content: `${existing.trimEnd()}\n\n${generated}`, conflict: true };
  const oldBody = existing.slice(contentStart, end).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
  const prefix = existing.slice(0, start), suffix = existing.slice(end + END.length);
  const conflict = digest(oldBody) !== match[1];
  const warning = conflict ? `\n\n## 系統區塊修改衝突（請核對）\n\n以下是原系統區塊的人工修改，已保留供核對：\n\n${oldBody}\n` : '';
  const block = `<!-- mentor:begin sha256=${digest(generated)} -->\n${generated}\n${END}`;
  return { content: `${prefix}${block}${warning}${suffix}`, conflict };
}

export class ProjectNotes {
  constructor(root) { this.dir = path.join(root, 'vault', 'notes'); }
  async sync(task, allTasks = [task]) {
    const project = task.project || task.title || '未分類專案';
    const related = allTasks.filter(t => !t.error && (t.project || t.title || '未分類專案') === project);
    const note = renderProjectNote(related);
    try { await mkdir(this.dir); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const names = await readdir(this.dir);
    const base = projectNoteSlug(project);
    let filename = base;
    if (names.includes(base)) {
      const prior = await readFile(path.join(this.dir, base), 'utf8');
      const priorTitle = prior.match(/^title: (.+)$/m)?.[1];
      if (priorTitle !== JSON.stringify(project)) filename = projectNoteSlug(project, related[0]?.id || task.id);
    }
    const target = path.join(this.dir, filename);
    try { if ((await lstat(target)).isSymbolicLink()) throw new Error('專案筆記是 symlink，拒絕覆寫。'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let existing = '';
    try { existing = await readFile(target, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const frontmatter = `---\ntitle: ${JSON.stringify(note.project)}\ntype: 專案筆記\nmentor_task: ${JSON.stringify(note.ids[0] || task.id)}\nmentor_tasks: [${note.ids.map(id => JSON.stringify(id)).join(', ')}]\nstatus: ${note.status}\nupdated: ${note.updatedAt.slice(0, 10)}\ntags: [專案, Mentor]\n---\n\n`;
    const manual = existing.replace(/^---\n[\s\S]*?\n---\n?/, '');
    const updated = replaceSystemBlock(manual, note.body);
    const text = frontmatter + updated.content;
    const tmp = `${target}.${randomUUID()}.tmp`;
    await writeFile(tmp, text, { flag: 'wx' }); await renameReplace(tmp, target);
    return { filename, path: `vault/notes/${filename}`, content: text, conflict: updated.conflict };
  }
}
