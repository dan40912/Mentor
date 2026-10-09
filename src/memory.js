import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';

// 規則分兩層：team.md 跨任務，projects/<專案>.md 只給同一個專案。兩層一起帶進提示，不互相覆蓋。
// 規則在任務開始時讀一次並存進任務；中途保存的學習只影響下一個任務。
export const HEADINGS = { interpretations: '詮釋', deviations: '偏離', tradeoffs: '取捨' };
export const slug = name => {
  const project = String(name || '未分類').trim();
  return project.replace(/[\\/:*?"<>|.\s]+/g, '-').slice(0, 40) || '未分類';
};

export class Memory {
  constructor(dir) {
    this.dir = dir;
    this.queue = Promise.resolve();
  }

  file(scope, project) {
    return scope === 'team' ? path.join(this.dir, 'team.md') : path.join(this.dir, 'projects', `${slug(project)}.md`);
  }

  async read(scope, project) {
    try { return await readFile(this.file(scope, project), 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  }

  async rules(project) {
    const [team, own] = await Promise.all([this.read('team'), this.read('project', project)]);
    return [team.trim() && `【團隊規則】\n${team.trim()}`, own.trim() && `【專案規則：${project}】\n${own.trim()}`].filter(Boolean).join('\n\n');
  }

  // 依標題附加一行；完全相同的內容不重複寫入。人手改過的其他內容原樣保留。
  append(scope, project, heading, text, source) {
    const run = this.queue.then(async () => {
      const target = this.file(scope, project);
      await mkdir(path.dirname(target), { recursive: true });
      let content = await this.read(scope, project);
      const line = `- ${text.trim().replace(/\s+/g, ' ')}`;
      if (content.split('\n').some(existing => existing.startsWith(line))) return { added: false };
      if (!content) content = `# ${scope === 'team' ? '團隊規則' : `專案規則：${project}`}\n\n> Mentor從學習迴圈寫入；可以直接手改。\n`;
      const title = `## ${heading}`;
      const entry = `${line}（${source}）`;
      if (content.includes(`\n${title}\n`)) {
        const start = content.indexOf(`\n${title}\n`) + title.length + 2;
        const next = content.indexOf('\n## ', start);
        const at = next < 0 ? content.length : next;
        content = `${content.slice(0, at).replace(/\n*$/, '\n')}${entry}\n${content.slice(at)}`;
      } else {
        content = `${content.replace(/\n*$/, '\n')}\n${title}\n${entry}\n`;
      }
      const temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, content, { flag: 'wx' });
      await rename(temporary, target);
      return { added: true };
    });
    this.queue = run.catch(() => {});
    return run;
  }

  async list() {
    const projects = {};
    try {
      for (const name of (await readdir(path.join(this.dir, 'projects'))).filter(n => n.endsWith('.md'))) {
        projects[name.replace(/\.md$/, '')] = await readFile(path.join(this.dir, 'projects', name), 'utf8');
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const team = await this.read('team');
    let reviews = {};
    try { reviews = JSON.parse(await readFile(path.join(this.dir, 'recall.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const cards = [];
    for (const [scope, content] of [['團隊', team], ...Object.entries(projects)]) {
      let heading = '';
      for (const line of content.split('\n')) {
        if (line.startsWith('## ')) heading = line.slice(3);
        if (!line.startsWith('- ')) continue;
        const text = line.slice(2).replace(/（[^）]*）$/, '');
        const id = createHash('sha256').update(`${scope}\n${heading}\n${text}`).digest('hex').slice(0, 24);
        if (cards.some(card => card.id === id)) continue;
        cards.push({ id, scope, heading, text, source: scope === '團隊' ? 'memory/team.md' : `memory/projects/${scope}.md`, ...(reviews[id] || {}) });
      }
    }
    return { team, projects, cards };
  }

  recordRecall({ id, answer, rating }) {
    const run = this.queue.then(async () => {
      if (!['again', 'uncertain', 'remembered'].includes(rating) || typeof answer !== 'string' || !answer.trim() || answer.length > 2000) {
        throw Object.assign(new Error('請先寫下回想，再選擇記憶程度。'), { status: 400, code: 'RECALL_INVALID' });
      }
      const { cards } = await this.list();
      const card = cards.find(card => card.id === id);
      if (!card) throw Object.assign(new Error('規則已更新，請重新載入回想卡。'), { status: 409, code: 'RECALL_STALE' });
      const box = rating === 'remembered' ? Math.min((card.box || 0) + 1, 5) : rating === 'uncertain' ? 1 : 0;
      const days = [1, 1, 3, 7, 14, 30][box];
      const now = new Date();
      const record = { box, attempts: (card.attempts || 0) + 1, answer: answer.trim(), rating, reviewedAt: now.toISOString(), nextAt: new Date(now.getTime() + days * 86400000).toISOString() };
      const reviews = Object.fromEntries(cards.filter(card => card.reviewedAt).map(card => [card.id, Object.fromEntries(['box', 'attempts', 'answer', 'rating', 'reviewedAt', 'nextAt'].map(key => [key, card[key]]))]));
      reviews[id] = record;
      await mkdir(this.dir, { recursive: true });
      const target = path.join(this.dir, 'recall.json');
      const temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(reviews, null, 2), { flag: 'wx' });
      await rename(temporary, target);
      return { card: { ...card, ...record } };
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
