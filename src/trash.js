import { mkdir, readdir, readFile, rename, rm, writeFile, lstat, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { TaskError } from './tasks.js';
import { slug } from './memory.js';
import { ArtifactHistory } from './artifact-history.js';

// 回收桶：只搬動Mentor的紀錄（任務檔、事件、對話、專案說明、專案規則），產出資料夾與來源 session 一律不動。
// 沒有自動清空期限；永久刪除要輸入完整名稱，只刪除清單上列出的紀錄。
const exists = async file => { try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const now = () => new Date().toISOString();
const safeTrashId = id => typeof id === 'string' && /^T-[0-9]{8}-[a-f0-9]{8}$/.test(id);

export class Trash {
  constructor(memoryDir, store, coach) {
    Object.assign(this, { memoryDir, store, coach, dir: path.join(memoryDir, 'trash') });
  }

  // 與任務單一寫入器共用佇列，避免搬檔時剛好有寫入。
  serial(work) {
    const run = this.store.queue.then(work);
    this.store.queue = run.catch(() => {});
    return run;
  }

  async list() {
    let names = [];
    try { names = await readdir(this.dir); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const items = [];
    for (const name of names.filter(safeTrashId)) {
      try { items.push(JSON.parse(await readFile(path.join(this.dir, name, 'manifest.json'), 'utf8'))); } catch {}
    }
    return items.sort((a, b) => b.at.localeCompare(a.at));
  }

  async manifest(trashId) {
    if (!safeTrashId(trashId)) throw new TaskError(404, 'TRASH_NOT_FOUND', '回收桶裡找不到這筆紀錄。');
    try { return JSON.parse(await readFile(path.join(this.dir, trashId, 'manifest.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw new TaskError(404, 'TRASH_NOT_FOUND', '回收桶裡找不到這筆紀錄。'); throw error; }
  }

  // 任務在Mentor內的紀錄（相對於工作記憶）。
  async taskFiles(id) {
    await new ArtifactHistory(this.memoryDir).taskDir(id);
    const candidates = [`${id}.md`, `events/${id}.jsonl`, `conversations/${id}.json`, `conversations/${id}.md`, `artifact-history/${id}`];
    const found = [];
    for (const rel of candidates) if (await exists(path.join(this.memoryDir, rel))) found.push(rel);
    return found;
  }

  busy(task) {
    return Boolean(task.planning?.running || this.coach.pending.has(task.id));
  }

  async projectTasks(projectId) {
    return (await this.store.list()).filter(t => t.project && slug(t.project) === projectId);
  }

  async projectSummary(projectId) {
    const tasks = await this.projectTasks(projectId);
    const running = tasks.filter(t => this.busy(t));
    return { projectId, total: tasks.length, running: running.length, tasks: tasks.map(t => ({ id: t.id, title: t.title, running: this.busy(t), stopping: Boolean(t.planning?.running?.stopping) })) };
  }

  async move(trashId, rels) {
    const base = path.join(this.dir, trashId, 'files');
    for (const rel of rels) {
      const target = path.join(base, rel);
      await mkdir(path.dirname(target), { recursive: true });
      await rename(path.join(this.memoryDir, rel), target);
    }
  }

  async write(trashId, manifest) {
    await mkdir(path.join(this.dir, trashId), { recursive: true });
    await writeFile(path.join(this.dir, trashId, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  }

  newId() {
    return `T-${now().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 8)}`;
  }

  trashTask(id, { reason = '' } = {}) {
    return this.serial(async () => {
      const { task } = await this.store.get(id);
      if (this.busy(task)) throw new TaskError(409, task.planning?.running?.stopping ? 'TASK_STOPPING' : 'TASK_RUNNING', task.planning?.running?.stopping ? '還在確認停止，確認結束後才能移到回收桶。' : 'AI 還在執行。先停止這次執行，確認停止後再移到回收桶。');
      const dependents = (await this.store.list()).filter(t => t.id !== id && (t.dependsOnTasks || []).includes(id));
      if (dependents.length) throw new TaskError(409, 'TASK_DEPENDED', `${dependents.map(t => t.title || t.id).join('、')} 仍依賴這個任務。先解除依賴，或一起移除。`, { dependents: dependents.map(t => ({ id: t.id, title: t.title })) });
      const trashId = this.newId();
      const files = await this.taskFiles(id);
      const manifest = { id: trashId, kind: 'task', name: task.title || id, taskIds: [id], project: task.project, at: now(), reason: String(reason).trim().slice(0, 500), files, outputs: task.allowedRoots || [], stopped: Boolean(task.planning?.stopped) };
      // 先寫事件再搬檔，事件紀錄跟著任務進回收桶。
      await this.coach.audit(id, 'TASK_TRASHED', { trashId, reason: manifest.reason });
      if (!files.includes(`events/${id}.jsonl`)) files.push(`events/${id}.jsonl`);
      await this.write(trashId, manifest);
      await this.move(trashId, files);
      return { trashed: manifest };
    });
  }

  trashProject(projectId, { name = '', reason = '' } = {}) {
    if (typeof projectId !== 'string' || !projectId || projectId === '未分類' || projectId.length > 40 || /[\\/]/.test(projectId)) return Promise.reject(new TaskError(400, 'PROJECT_INVALID', '這個專案不能移到回收桶。'));
    return this.serial(async () => {
      const tasks = await this.projectTasks(projectId);
      const running = tasks.filter(t => this.busy(t));
      if (running.length) throw new TaskError(409, 'PROJECT_RUNNING', `${tasks.length} 個任務，其中 ${running.length} 個執行中。先停止全部執行，確認結束後再移到回收桶。`, { total: tasks.length, running: running.length });
      const files = [];
      if (await exists(path.join(this.memoryDir, 'projects', projectId))) files.push(`projects/${projectId}`);
      if (await exists(path.join(this.memoryDir, 'memory', 'projects', `${projectId}.md`))) files.push(`memory/projects/${projectId}.md`);
      for (const t of tasks) files.push(...await this.taskFiles(t.id));
      if (!files.length) throw new TaskError(404, 'PROJECT_NOT_FOUND', '找不到這個專案的紀錄。');
      let display = name || tasks[0]?.project || projectId;
      try { display = JSON.parse(await readFile(path.join(this.memoryDir, 'projects', projectId, 'brief.json'), 'utf8')).name || display; } catch {}
      const trashId = this.newId();
      const manifest = { id: trashId, kind: 'project', name: display, projectId, taskIds: tasks.map(t => t.id), tasks: tasks.map(t => ({ id: t.id, title: t.title })), at: now(), reason: String(reason).trim().slice(0, 500), files, outputs: [...new Set(tasks.flatMap(t => t.allowedRoots || []))], rulesPaused: files.includes(`memory/projects/${projectId}.md`) };
      for (const t of tasks) {
        await this.coach.audit(t.id, 'TASK_TRASHED', { trashId, project: projectId });
        if (!files.includes(`events/${t.id}.jsonl`)) files.push(`events/${t.id}.jsonl`);
      }
      await this.write(trashId, manifest);
      await this.move(trashId, files);
      return { trashed: manifest };
    });
  }

  restore(trashId) {
    return this.serial(async () => {
      const manifest = await this.manifest(trashId);
      for(const id of manifest.taskIds)await new ArtifactHistory(this.memoryDir).taskDir(id);
      const conflicts = [];
      for (const rel of manifest.files) if (await exists(path.join(this.memoryDir, rel))) conflicts.push(rel);
      if (conflicts.length) throw new TaskError(409, 'RESTORE_CONFLICT', `原位置已有同名紀錄：${conflicts.join('、')}。請先處理後再還原。`, { conflicts });
      const base = path.join(this.dir, trashId, 'files');
      for (const rel of manifest.files) {
        const target = path.join(this.memoryDir, rel);
        await mkdir(path.dirname(target), { recursive: true });
        await rename(path.join(base, rel), target);
      }
      await rm(path.join(this.dir, trashId), { recursive: true, force: true });
      for (const id of manifest.taskIds) await this.coach.audit(id, 'TASK_RESTORED', { trashId }).catch(() => {});
      return { restored: manifest };
    });
  }

  purge(trashId, { confirm = '' } = {}) {
    return this.serial(async () => {
      const manifest = await this.manifest(trashId);
      if (typeof confirm !== 'string' || confirm.trim() !== manifest.name) throw new TaskError(400, 'CONFIRM_MISMATCH', '名稱不符，沒有刪除。請輸入完整名稱。');
      const target = await realpath(path.join(this.dir, trashId));
      if (path.dirname(target) !== await realpath(this.dir)) throw new TaskError(500, 'TRASH_PATH_CHANGED', '回收桶路徑異常，停止刪除。');
      await rm(target, { recursive: true, force: true });
      return { purged: { id: manifest.id, kind: manifest.kind, name: manifest.name, files: manifest.files, outputs: manifest.outputs } };
    });
  }
}
