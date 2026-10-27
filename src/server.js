import { FocusSessions } from './focus-sessions.js';
import { ObsidianBridge } from './obsidian-bridge.js';
import { workCards } from './work-cards.js';
import { planPreview } from './plan-preview.js';
import { compactHandoff } from './compact-handoff.js';
import { probePreview, localPreviewUrl } from './review-settings.js';
import http from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath, readdir, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { renameReplace, killTree } from './platform.js';
import { providers, resolveModel, stages, defaultStageSettings, profiles, recommendationPlans } from './models.js';
import { Memory } from './memory.js';
import { Trash } from './trash.js';
import { Conversations } from './conversations.js';
import { Projects } from './projects.js';
import { Coach } from './coach.js';
import { gitHead, itemDiff, itemChanges } from './git-diff.js';
import { artifactPath, validateArtifactName } from './artifact-path.js';
import { diagnose } from './agents.js';
import { TaskStore, TaskError, buildBrief, sha256 } from './tasks.js';
import { summarize, MOMENTS } from './feedback.js';
import { writeHandoff, previewHandoff } from './handoffs.js';
import { readAttachment } from './attachments.js';

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const webDir = path.join(appDir, 'web');
// 使用者資料（vault、outputs、設定）放在 MENTOR_HOME，預設是 repo 根目錄。
const flag = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const root = path.resolve(flag('home') || process.env.MENTOR_HOME || appDir);
const textPreviewExtensions = ['.txt', '.log', '.csv', '.json', '.js', '.mjs', '.cjs', '.ts', '.css', '.yml', '.yaml', '.sh', '.py'];
const previewTypes = { '.html': ['text/html; charset=utf-8', 5 * 1024 * 1024], '.md': ['text/plain; charset=utf-8', 5 * 1024 * 1024], '.png': ['image/png', 20 * 1024 * 1024], '.jpg': ['image/jpeg', 20 * 1024 * 1024], '.jpeg': ['image/jpeg', 20 * 1024 * 1024], '.webp': ['image/webp', 20 * 1024 * 1024] };
for (const ext of textPreviewExtensions) previewTypes[ext] = ['text/plain; charset=utf-8', 2 * 1024 * 1024];


export async function previewArtifact(tasks, projectRoot, id, file) {
  validateArtifactName(file);
  const { task } = await tasks.get(id);
  if (!task.planning?.workItems?.some(item => item.outputs?.some(output => output.file === file))) throw new TaskError(404, 'PREVIEW_NOT_REGISTERED', '這份成果尚未登記在任務中。');
  const type = previewTypes[path.extname(file).toLowerCase()];
  if (!type) throw new TaskError(415, 'PREVIEW_TYPE_UNSUPPORTED', '目前只支援 HTML、Markdown、指定文字檔、PNG、JPEG 與 WebP。');
  const resolved = await artifactPath(task.allowedRoots[0], file);
  const info = await stat(resolved);
  if (!info.isFile()) throw new TaskError(415, 'PREVIEW_TYPE_UNSUPPORTED', '只能預覽一般檔案。');
  if (info.size > type[1]) throw new TaskError(413, 'PREVIEW_TOO_LARGE', '成果檔超過預覽大小上限。');
  return previewArtifactBytes(file,await readFile(resolved));
}

function previewArtifactBytes(file,content){
  const type=previewTypes[path.extname(file).toLowerCase()];if(!type)throw new TaskError(415,'PREVIEW_TYPE_UNSUPPORTED','此成果版本的格式尚未提供預覽。');
  if (content.length > type[1]) throw new TaskError(413, 'PREVIEW_TOO_LARGE', '成果檔超過預覽大小上限。');
  const ext = path.extname(file).toLowerCase();
  if (['.html', '.md', ...textPreviewExtensions].includes(ext)) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(content); }
    catch { throw new TaskError(415, 'PREVIEW_TYPE_UNSUPPORTED', '文字檔不是有效的 UTF-8。'); }
  }
  if ((ext === '.png' && !content.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) ||
      (['.jpg', '.jpeg'].includes(ext) && !content.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) ||
      (ext === '.webp' && !(content.toString('ascii', 0, 4) === 'RIFF' && content.toString('ascii', 8, 12) === 'WEBP'))) throw new TaskError(415, 'PREVIEW_TYPE_UNSUPPORTED', '圖片內容與檔案格式不符。');
  if (ext === '.md') {
    const escaped = content.toString('utf8').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return { content: Buffer.from(`<meta charset="utf-8"><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit">${escaped}</pre>`), mime: 'text/html; charset=utf-8', html: false };
  }
  return { content, mime: type[0], html: ext === '.html' };
}

// 每個階段要嘛是可解析的 provider＋模型，要嘛（只有 F）沿用 D。
function resolveStageInput(stageId, input) {
  if (stageId === 'F' && input?.provider === 'same-as-D') return { provider: 'same-as-D', modelId: null, effort: null };
  const model = resolveModel(input?.provider, input?.modelKey || 'default');
  const provider = providers.find(p => p.id === model.provider);
  const mode = stages.find(s => s.id === stageId).mode;
  if (!provider.runnable || !provider.modes?.includes(mode)) throw new Error(`${provider.name} 不能負責 ${stageId} 階段：這一階段需要${{ chat: '只對話', read: '唯讀資料夾', write: '寫產出資料夾' }[mode]}，這個 AI 沒有可呼叫的 CLI。`);
  return model;
}


async function atomicWrite(file, content) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { flag: 'wx' });
  await renameReplace(temporary, file);
}

export function handoffMarkdown(input, id) {
  const model = resolveModel(input.provider, input.modelKey);
  for (const field of ['goal', 'scope', 'acceptance', 'next']) {
    if (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > 6000) {
      throw new Error(`INVALID_${field.toUpperCase()}`);
    }
  }
  const yaml = value => JSON.stringify(value);
  return `---
type: handoff
schema_version: 1
handoff_id: ${yaml(id)}
provider: ${yaml(model.provider)}
model_id: ${yaml(model.modelId)}
reasoning_effort: ${yaml(model.effort)}
status: prepared
created_at: ${yaml(new Date().toISOString())}
---

# ${input.goal.replace(/[\r\n]+/g, ' ')}

## 目標
${input.goal}

## 允許範圍
${input.scope}

## 驗收條件
${input.acceptance}

## 唯一下一步
${input.next}

## 限制與未知
此文件是人工交接草稿。尚未核對原執行停止、工作區版本、來源與成果。
接手前必須核對；資訊不足時回報 NEEDS_INPUT，不自行擴大範圍。
模型選項尚未驗證帳號可用性。建立此文件不代表執行已啟動。

## 接手回報
包含 handoff ID、DONE／BLOCKED／NEEDS_INPUT、完成事項、證據、未完成事項與下一步。
DONE 僅為回報，仍須核對驗收證據。
`;
}

async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 40000) throw new Error('BODY_TOO_LARGE');
  }
  return JSON.parse(text);
}

export async function createRequestHandler({ root = appDir, port = 4317, runAgent, previewProbeOptions, executeFile } = {}) {
  root = path.resolve(root);
  const memory = path.join(root, 'vault');
  const token = randomBytes(32).toString('hex');
  const obsidian = new ObsidianBridge();
  const taskCreations = new Map();
  let settings = { revision: 1, stages: defaultStageSettings() };
  const diagnosis = {};
  let queue = Promise.resolve();
  await mkdir(memory, { recursive: true });
  const canonicalRoot = await realpath(root);
  if (!((await realpath(memory)).startsWith(`${canonicalRoot}${path.sep}`))) {
    throw new Error('工作記憶 symlink 指向工作區之外，拒絕啟動');
  }
  const settingsPath = path.join(root, '.settings.json');
  const diagnosisPath = path.join(root, '.diagnosis.json');
  try { const saved = JSON.parse(await readFile(diagnosisPath, 'utf8')); for (const id of ['codex','claude','copilot']) if (typeof saved[id]?.ok === 'boolean') diagnosis[id] = saved[id]; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const tasks = new TaskStore(memory);
  const focus = new FocusSessions(memory);
  try {
    const saved = JSON.parse(await readFile(settingsPath, 'utf8'));
    if (!Number.isInteger(saved.revision) || saved.revision < 1 || !saved.stages) throw new Error('INVALID_SETTINGS');
    for (const stage of stages) {
      const value = saved.stages[stage.id];
      if (!(stage.id === 'F' && value?.provider === 'same-as-D')) {
        const key = providers.find(p => p.id === value?.provider)?.models.find(m => m.modelId === value.modelId && m.effort === value.effort)?.key || 'default';
        const resolved = resolveModel(value.provider, key);
        if (resolved.modelId !== value.modelId || resolved.effort !== value.effort) throw new Error('INVALID_SETTINGS');
      }
    }
    settings = saved;
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('設定檔格式不支援，改用預設角色設定：', error.message);
  }
  const memoryStore = new Memory(path.join(memory, 'memory'));
  const conversations = new Conversations(path.join(memory, 'conversations'));
  const projects = new Projects(path.join(memory, 'projects'));
  const coach = new Coach(tasks, () => settings, root, memoryStore, runAgent, executeFile);
  await coach.recover();
  const trash = new Trash(memory, tasks, coach);
  const handler = async (req, res) => {
    const requestPort = typeof port === 'function' ? port() : port;
    const origin = `http://127.0.0.1:${requestPort}`;
    const send = (status, data) => {
      if (data?.task && !data.task.error) data = { ...data, task: { ...data.task, workCards: workCards(data.task).slice(-3) } };
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    // 用 localhost 開啟首頁時導到 127.0.0.1，cookie 與 CSRF 只綁一個來源。
    if (req.method === 'GET' && req.url === '/' && req.headers.host === `localhost:${requestPort}`) {
      res.writeHead(302, { Location: `${origin}/` });
      return res.end();
    }
    // 從其他 App 點連結打開首頁是跨站導覽；首頁只回 HTML，可以放行。API 仍拒絕跨站。
    const pageNavigation = req.method === 'GET' && req.url === '/' && req.headers['sec-fetch-mode'] === 'navigate';
    if (req.headers.host !== new URL(origin).host ||
      (req.headers.origin && req.headers.origin !== origin) ||
      (req.headers['sec-fetch-site'] === 'cross-site' && !pageNavigation)) {
      return send(403, { code: 'FORBIDDEN_ORIGIN', message: `請用 ${origin} 開啟工作台。` });
    }
    let bridgeClient = null;
    try {
      if (req.method === 'POST' && req.url === '/api/obsidian/connect') {
        const input = await body(req);
        return send(200, obsidian.exchange(input.code));
      }
      if (req.url.startsWith('/api/obsidian/') && !['/api/obsidian/pairing', '/api/obsidian/connections', '/api/obsidian/revoke'].includes(req.url)) {
        const access = obsidian.authorize(req);
        bridgeClient = access.client;
        req.url = access.route;
        // Only allowlisted bridge routes can use the internal session credentials.
        req.headers = { ...req.headers, cookie: `awc=${token}`, 'x-csrf-token': token };
      }
      if (req.method === 'GET' && req.url === '/api/obsidian/connections') {
        if (!req.headers.cookie?.split('; ').includes(`awc=${token}`)) return send(403, { code: 'SESSION_REQUIRED' });
        return send(200, { clients: obsidian.list() });
      }
      if (req.method === 'GET' && req.url === '/') {
        const html = await readFile(path.join(webDir, 'index.html'), 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; frame-src 'self' blob: http://localhost:* http://127.0.0.1:* https://localhost:* https://127.0.0.1:*; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
          'Set-Cookie': `awc=${token}; HttpOnly; SameSite=Strict; Path=/`
        });
        return res.end(html);
      }
      if (req.method === 'GET' && /^\/assets\/(mentor\.svg|openai\.svg|claude\.svg|copilot\.svg|conversation\.js|project\.js|control\.js|auto\.js|feedback\.js|item-names\.js|upload\.js)$/.test(req.url)) {
        res.writeHead(200, { 'Content-Type': req.url.endsWith('.js') ? 'application/javascript; charset=utf-8' : req.url.endsWith('.svg') ? 'image/svg+xml' : 'image/png', 'Cache-Control': req.url.endsWith('.js') ? 'no-store' : 'max-age=86400' });
        return res.end(await readFile(path.join(webDir, 'assets', path.basename(req.url))));
      }
      // 同源頁面在服務重啟或 cookie 過期後可更新驗證，不需要丟掉表單內容。
      if (req.method === 'GET' && req.url === '/api/session') {
        res.setHeader('Set-Cookie', `awc=${token}; HttpOnly; SameSite=Strict; Path=/`);
        return send(200, { csrfToken: token });
      }
      if (req.method === 'GET' && req.url === '/api/health') {
        return send(200, { status: 'ok', execution: 'controlled-cli-and-manual-handoff', memory });
      }
      if(req.method==='GET'&&req.url==='/api/focus'){if(!req.headers.cookie?.split('; ').includes(`awc=${token}`))return send(403,{code:'SESSION_REQUIRED'});return send(200,await focus.list());}
      const taskRoute = req.url.match(/^\/api\/tasks(?:\/(TASK-[a-zA-Z0-9-]+)(?:\/([a-z-]+))?)?(?:\?(.*))?$/);
      const projectRoute = req.url.match(/^\/api\/projects(?:\/([^/]+)(?:\/(save|summary|trash|stop-all))?)?$/);
      const trashRoute = req.url.match(/^\/api\/trash(?:\/(T-[0-9]{8}-[a-f0-9]{8})\/(restore|purge))?$/);
      if (req.method === 'GET' && trashRoute && !trashRoute[1]) {
        if (!req.headers.cookie?.split('; ').includes(`awc=${token}`)) return send(403, { code: 'SESSION_REQUIRED' });
        return send(200, { items: await trash.list() });
      }
      if (req.method === 'GET' && projectRoute) {
        if (!req.headers.cookie?.split('; ').includes(`awc=${token}`)) return send(403, { code: 'SESSION_REQUIRED' });
        if (!projectRoute[1]) return send(200, { projects: await projects.list() });
        const project = await projects.read(decodeURIComponent(projectRoute[1]));
        if (projectRoute[2] === 'summary') return send(200, await trash.projectSummary(decodeURIComponent(projectRoute[1])));
        return send(200, { project });
      }
      if (req.method === 'GET' && req.url === '/api/feedback') {
        if (!req.headers.cookie?.split('; ').includes(`awc=${token}`)) return send(403, { code: 'SESSION_REQUIRED' });
        const all = (await tasks.list()).filter(t => !t.error && !t.trashed);
        return send(200, { summary: summarize(all), moments: MOMENTS });
      }
      if (req.method === 'GET' && req.url === '/api/memory') {
        if (!req.headers.cookie?.split('; ').includes(`awc=${token}`)) return send(403, { code: 'SESSION_REQUIRED' });
        return send(200, await memoryStore.list());
      }
      if (req.method === 'GET' && taskRoute) {
        if (!req.headers.cookie?.split('; ').includes(`awc=${token}`)) return send(403, { code: 'SESSION_REQUIRED' });
        const [, id, action, query] = taskRoute;
        if (!id && !action) return send(200, { tasks: await Promise.all((await tasks.list()).map(async task => ({ ...task, workCards: workCards(task).slice(-3), gitAvailable: !task.error && Boolean(await gitHead(task.allowedRoots?.[0])) }))) });
        if (id && ['work-cards', 'plan', 'handoff-summary'].includes(action)) {
          const task = (await tasks.list()).find(t => t.id === id && !t.error);
          if (!task) throw new TaskError(404, 'TASK_NOT_FOUND', '找不到任務。');
          if (action === 'work-cards') return send(200, { cards: workCards(task), revision: task.revision });
          if (action === 'plan') return send(200, { plan: planPreview(task) });
          const receiver = new URLSearchParams(query || '').get('for') || 'unassigned';
          if (!['codex', 'claude', 'copilot', 'unassigned'].includes(receiver)) return send(400, { code: 'UNKNOWN_RECEIVER' });
          return send(200, compactHandoff(task, receiver));
        }
        if (id && action === 'events') return send(200, { events: await coach.events(id) });
        if (id && action === 'conversation') return send(200, await conversations.read((await tasks.get(id)).task));
        if (id && action === 'preview-check') {
          const { task } = await tasks.get(id);
          if (!task.preview?.url) throw new TaskError(400, 'PREVIEW_URL_REQUIRED', '請先保存預覽網址。');
          const target = new URLSearchParams(query || '').get('path');
          const url = target === null ? localPreviewUrl(task.preview.url) : localPreviewUrl(target, localPreviewUrl(task.preview.url));
          return send(200, { ...await probePreview(url, previewProbeOptions), command: task.preview.command || '' });
        }
        if (id && action === 'review-changes') {
          const { task } = await tasks.get(id);
          return send(200, await itemChanges(task, new URLSearchParams(query || '').get('item')));
        }
        if (id && action === 'diff') {
          const { task } = await tasks.get(id);
          return send(200, await itemDiff(task, new URLSearchParams(query || '').get('item')));
        }
        if (id && action === 'attachment') {
          const { task } = await tasks.get(id);
          const { attachment, content } = await readAttachment(task, new URLSearchParams(query || '').get('id'));
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `attachment; filename=attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}` });
          return res.end(content);
        }
        if (id && ['preview', 'handoff-preview','artifact-version'].includes(action)) {
          const params=new URLSearchParams(query||'');let file=params.get('file'),versionPreview=null,versionSha=null;
          if(action==='artifact-version'){
            const {task}=await tasks.get(id);if(task.trashed)throw new TaskError(409,'TASK_TRASHED','請先還原任務，再閱讀成果版本。');
            const version=params.get('version'),reference=(task.planning?.learningTurns||[]).flatMap(turn=>Object.values(turn.artifactHistory||{})).find(ref=>ref?.id===version);
            if(!reference)throw new TaskError(404,'ARTIFACT_HISTORY_NOT_REFERENCED','這份版本沒有登記在此任務的回合中。');
            const manifest=await coach.artifactHistory.manifest(id,version);if(manifest.digest!==reference.digest)throw new TaskError(409,'ARTIFACT_HISTORY_CORRUPT','成果版本清單已變更，不當成原版本。');
            if(!params.has('index'))return send(200,{version:manifest});
            const rawIndex=params.get('index');if(!/^(?:0|[1-9][0-9]*)$/.test(rawIndex))throw new TaskError(400,'ARTIFACT_HISTORY_FILE','成果版本檔案識別不正確。');
            const saved=await coach.artifactHistory.read(id,version,Number(rawIndex));if(saved.manifest.digest!==reference.digest)throw new TaskError(409,'ARTIFACT_HISTORY_CORRUPT','成果版本清單已變更，不當成原版本。');if(file!==saved.file.file)throw new TaskError(400,'ARTIFACT_HISTORY_FILE','成果版本檔名與登記不一致。');
            versionPreview=previewArtifactBytes(file,saved.content);versionSha=saved.file.sha;
          }
          const preview = versionPreview || (action === 'handoff-preview'
            ? await previewHandoff(root, (await tasks.get(id)).task, file)
            : await previewArtifact(tasks, root, id, file));
          if(versionSha)res.setHeader('X-Mentor-Artifact-SHA256',versionSha);
          res.writeHead(200, { 'Content-Type': preview.mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'Content-Security-Policy': preview.html ? "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'" : "default-src 'none'; style-src 'unsafe-inline'; sandbox; frame-ancestors 'self'" });
          return res.end(preview.content);
        }
        if (id && action === 'brief') {
          const { task } = await tasks.get(id);
          const receiver = new URLSearchParams(query || '').get('for') || 'unassigned';
          if (!['codex', 'claude', 'copilot', 'unassigned'].includes(receiver)) return send(400, { code: 'UNKNOWN_RECEIVER' });
          return send(200, buildBrief(task, receiver));
        }
        return send(404, { code: 'NOT_FOUND' });
      }
      if (req.method === 'GET' && req.url === '/api/settings') {
        if (!req.headers.cookie?.split('; ').includes(`awc=${token}`)) return send(403, { code: 'SESSION_REQUIRED' });
        return send(200, { settings, providers, stages, profiles, recommendationPlans, diagnosis, csrfToken: token });
      }
      if (req.method === 'GET' && ['/api/sessions', '/api/handoffs'].includes(req.url)) {
        if (!req.headers.cookie?.split('; ').includes(`awc=${token}`)) return send(403, { code: 'SESSION_REQUIRED' });
        if (req.url === '/api/sessions') {
          try {
            return send(200, { sessions: JSON.parse(await readFile(path.join(root, 'imported-sessions.json'), 'utf8')) });
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            return send(200, { sessions: [] });
          }
        }
        if (await realpath(memory) !== path.join(canonicalRoot, 'vault')) throw new Error('MEMORY_PATH_CHANGED');
        const handoffs = [];
        for (const file of (await readdir(memory)).filter(name => /^HANDOFF-[a-zA-Z0-9-]+\.md$/.test(name))) {
          const resolved = await realpath(path.join(memory, file));
          if (path.dirname(resolved) !== path.join(canonicalRoot, 'vault')) throw new Error('HANDOFF_PATH_OUTSIDE_MEMORY');
          const info = await stat(resolved);
          if (!info.isFile() || info.size > 200000) throw new Error('HANDOFF_FILE_UNSUPPORTED');
          handoffs.push({ file, content: await readFile(resolved, 'utf8'), modifiedAt: info.mtime.toISOString() });
        }
        return send(200, { handoffs: handoffs.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)) });
      }
      if (req.method !== 'POST') return send(404, { code: 'NOT_FOUND' });
      if (!req.headers.cookie?.split('; ').includes(`awc=${token}`) || req.headers['x-csrf-token'] !== token) {
        return send(403, { code: 'CSRF_FAILED' });
      }
      if (req.url.startsWith('/api/uploads?')) {
        const params = new URLSearchParams(req.url.split('?')[1]);
        return send(201, { attachment: await coach.attachments.stage(params.get('name'), req, params.has('batch') ? params.get('batch') : undefined, params.has('index') ? Number(params.get('index')) : undefined) });
      }
      const input = await body(req);
      const focusAction=req.url.match(/^\/api\/focus\/(start|pause|resume|end|cancel)$/)?.[1];
      if(focusAction){
        if(focusAction==='start'&&input.taskId){const {task}=await tasks.get(input.taskId);if(task.trashed)throw new TaskError(409,'TASK_TRASHED','請先還原任務。');if(input.workItemId&&!task.planning?.workItems?.some(item=>item.id===input.workItemId))throw new TaskError(400,'FOCUS_LINK_INVALID','找不到關聯的工作項目。');}
        return send(200,await focus.change(focusAction,input));
      }
      if (req.url === '/api/obsidian/pairing') return send(200, obsidian.prepare());
      if (req.url === '/api/obsidian/revoke') { obsidian.revoke(input.id); return send(200, { revoked: true }); }
      if (bridgeClient && taskRoute && !taskRoute[1]) {
        if (Object.keys(input).some(key => !['request', 'project', 'profile', 'agent'].includes(key))) throw new TaskError(403, 'BRIDGE_SCOPE', '插件不能指定產出路徑、附件或自動模式。');
      }
      if (bridgeClient && taskRoute?.[2] === 'approve' && typeof input.proposalId !== 'string') throw new TaskError(400, 'PLAN_PREVIEW_REQUIRED', '請先預覽計畫，核准時須提供方案識別。');
      if (taskRoute?.[1] && taskRoute[2] === 'handoff-prompt') {
        const { task } = await tasks.get(taskRoute[1]);
        if (input.revision !== task.revision) throw new TaskError(409, 'REVISION_CONFLICT', '任務版本已更新。', { revision: task.revision });
        return send(200, await writeHandoff(root, task));
      }
      if (req.url === '/api/uploads/batches') {
        if (input.taskId != null) await coach.latest(input.taskId);
        return send(201, coach.attachments.batch(input.names, input.taskId));
      }
      if (projectRoute) {
        if (!projectRoute[1]) return send(201, { project: await projects.create(input) });
        if (projectRoute[2] === 'save') return send(200, await projects.save(decodeURIComponent(projectRoute[1]), input));
        if (projectRoute[2] === 'trash') return send(200, await trash.trashProject(decodeURIComponent(projectRoute[1]), input));
        if (projectRoute[2] === 'stop-all') {
          const summary = await trash.projectSummary(decodeURIComponent(projectRoute[1]));
          for (const t of summary.tasks.filter(t => t.running)) await coach.stop(t.id).catch(error => { if (error.code !== 'NOTHING_RUNNING') throw error; });
          return send(202, await trash.projectSummary(decodeURIComponent(projectRoute[1])));
        }
      }
      if (trashRoute?.[1]) {
        if (trashRoute[2] === 'restore') return send(200, await trash.restore(trashRoute[1]));
        return send(200, await trash.purge(trashRoute[1], input));
      }
      if (taskRoute?.[1] && taskRoute[2] === 'conversation-rule') {
        const task = (await tasks.get(taskRoute[1])).task;
        const history = await conversations.read(task);
        const lesson = history.lessons?.find(l => l.id === input.lessonId);
        if (!lesson) return send(404, { code: 'LESSON_NOT_FOUND', message: '找不到學習重點。' });
        const result = await memoryStore.append('project', task.project, '取捨', lesson.prevention, `對話歷程 ${task.id} · ${lesson.id} · ${lesson.refs.map(r => `${r.provider} L${r.line}`).join('、')}`);
        return send(200, { ...result, memory: await memoryStore.list() });
      }
      if (req.url === '/api/settings') {
        const update = queue.then(async () => {
          if (input.revision !== settings.revision) return send(409, { code: 'REVISION_CONFLICT', revision: settings.revision });
          const next = { revision: settings.revision + 1, stages: {} };
          for (const stage of stages) next.stages[stage.id] = resolveStageInput(stage.id, input.stages?.[stage.id]);
          await atomicWrite(settingsPath, JSON.stringify(next, null, 2));
          settings = next;
          send(200, { settings });
        });
        queue = update.catch(() => {});
        return await update;
      }
      if (req.url === '/api/agents/diagnose') {
        const provider = input.provider;
        if (!['codex', 'claude', 'copilot'].includes(provider)) return send(400, { code: 'UNKNOWN_PROVIDER' });
        const stage = stages.map(s => settings.stages[s.id]).find(v => v?.provider === provider) || { modelId: null, effort: null };
        diagnosis[provider] = { ...(await diagnose(provider, { modelId: stage.modelId, effort: stage.effort })), model: stage.modelId, at: new Date().toISOString() };
        await atomicWrite(diagnosisPath, JSON.stringify(diagnosis, null, 2));
        return send(200, { diagnosis });
      }
      if (req.url === '/api/memory/recall') {
        const result = await memoryStore.recordRecall(input);
        return send(200, { ...result, memory: await memoryStore.list() });
      }
      if (req.url === '/api/memory/promote') {
        if (typeof input.text !== 'string' || !input.text.trim()) return send(400, { code: 'TEXT_REQUIRED' });
        const result = await memoryStore.append('team', null, input.heading || '詮釋', input.text, `從專案「${String(input.project || '未分類').slice(0, 40)}」升級 · ${new Date().toISOString().slice(0, 10)}`);
        return send(200, { ...result, memory: await memoryStore.list() });
      }
      if (taskRoute && !taskRoute[1] && !taskRoute[2]) {
        const key = req.headers['idempotency-key'];
        if (key !== undefined && (typeof key !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(key))) throw new TaskError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key 格式不正確。');
        const fingerprint = sha256(JSON.stringify(input));
        const cached = key && taskCreations.get(key);
        if (cached && cached.fingerprint !== fingerprint) throw new TaskError(409, 'IDEMPOTENCY_KEY_REUSED', '相同操作識別不能套用不同任務內容。');
        if (!cached && key && taskCreations.size >= 500) throw new TaskError(429, 'CREATION_LIMIT', '這個服務階段已保存 500 次建立操作，請先確認現有任務；重新啟動會清除連線與操作快取。');
        const run = cached?.run || coach.create(input);
        if (key && !cached) { taskCreations.set(key, { fingerprint, run }); run.catch(() => taskCreations.delete(key)); }
        const result = await run;
        return send(202, { task: result.task });
      }
      const coachActions = {
        ask: (id,key) => coach.discuss(id,input.revision,key,input),
        card: (id, key) => coach.saveCard(id, input.revision, key, input),
        retry: (id, key) => coach.retry(id, input.revision, key, input.provider || null),
        answer: (id, key) => coach.answer(id, input.revision, key, input),
        outline: id => coach.draftOutline(id, input.feedback),
        learn: (id, key) => coach.keepLearnings(id, input.revision, key, input),
        reflect: (id, key) => coach.reflect(id, input.revision, key, input),
        approve: (id, key) => coach.approveOutline(id, input.revision, key, input.proposalId ?? null),
        execute: id => coach.execute(id, input.itemId),
        review: id => coach.review(id, input.itemId),
        fix: id => coach.fix(id, input.itemId),
        'change-check': (id, key) => coach.checkChange(id, input.revision, key, input),
        confirm: (id, key) => coach.confirm(id, input.revision, key, input),
        cancel: id => coach.stop(id),
        stop: id => coach.stop(id),
        instruct: (id, key) => coach.instruct(id, input.revision, key, input),
        resume: (id, key) => coach.resume(id, input.revision, key, input),
        trash: id => trash.trashTask(id, input),
        autopilot: (id, key) => coach.setAutopilot(id, input.revision, key, input),
        feedback: (id, key) => coach.feedback(id, input.revision, key, input),
        agents: (id, key) => coach.setAgents(id, input.revision, key, input),
        'confirm-all': (id, key) => coach.confirmAll(id, input.revision, key)
      };
      if (taskRoute?.[1] && coachActions[taskRoute[2]]) {
        const [, id, action] = taskRoute;
        const key = req.headers['idempotency-key'];
        const result = await coachActions[action](id, key);
        if (action === 'instruct' && input.dryRun) return send(200, result);
        // 開著「一路做到完」時，你做完任何一步，AI 會自己接著往下。
        // 評分只是記錄，不推動流程；否則停下時評分會讓 AI 重新判斷又停一次。
        if (!['ask', 'stop', 'cancel', 'trash', 'autopilot', 'feedback', 'agents', 'change-check'].includes(action)) coach.resumeAuto(id);
        if (action === 'cancel' || action === 'stop') return send(202, { stopping: true, task: (await tasks.list()).find(t => t.id === id) || result.task });
        if (action === 'trash') return send(200, result);
        // answer 先寫入回答再啟動 B；回傳時 B 已在背景跑。
        const latest = result.task ? result : await tasks.get(id).then(r => ({ task: r.task }));
        const { done, task: _task, ...extra } = result;
        return send(done ? 202 : 200, { ...extra, task: (await tasks.list()).find(t => t.id === id) || latest.task });
      }
      if (taskRoute?.[1] && taskRoute[2]) {
        const [, id, action] = taskRoute;
        const key = req.headers['idempotency-key'];
        if (typeof key !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(key)) return send(400, { code: 'IDEMPOTENCY_KEY_REQUIRED', message: '缺少 Idempotency-Key。' });
        const handlers = {
          decide: () => tasks.decide(id, input.revision, key, input),
          check: () => tasks.markCheck(id, input.revision, key, input),
          run: () => tasks.runCheck(id, input.revision, key, input),
          report: () => tasks.report(id, input.revision, key, input),
          accept: () => tasks.accept(id, input.revision, key),
          reject: () => tasks.reject(id, input.revision, key, input)
        };
        if (!handlers[action]) return send(404, { code: 'NOT_FOUND' });
        return send(200, await handlers[action]());
      }
      if (req.url === '/api/handoffs') {
        const id = `HANDOFF-${randomUUID()}`;
        const content = handoffMarkdown(input, id);
        if (await realpath(memory) !== path.join(canonicalRoot, 'vault')) throw new Error('MEMORY_PATH_CHANGED');
        const file = `${id}.md`;
        await writeFile(path.join(memory, file), content, { flag: 'wx' });
        return send(201, { id, file, content, status: 'prepared' });
      }
      send(404, { code: 'NOT_FOUND' });
    } catch (error) {
      if (error instanceof TaskError) {
        return send(error.status, { code: error.code, message: error.message, ...error.extra, nextStep: error.status === 409 ? '重新整理，比對最新內容後再操作。' : undefined });
      }
      console.error(error);
      send(400, { code: 'REQUEST_FAILED', message: error.message, nextStep: '檢查輸入；保存失敗時查看終端錯誤。' });
    }
  };
  return { handler, coach };
}

// 測試用：不監聽埠，回傳可直接呼叫 request listener 的 server。
export async function createApplication(home = root, port = 4317) {
  const app = await createRequestHandler({ root: home, port });
  const server = http.createServer(app.handler);
  const { coach } = app;
  server.stopAgents = () => { for (const child of coach.children.values()) killTree(child, 'SIGTERM'); return coach.children.size; };
  return server;
}

export async function startServer(port = Number(flag('port') || process.env.PORT || 4317)) {
  let server;
  const app = await createRequestHandler({ root: flag('home') || process.env.MENTOR_HOME || appDir, port: () => server.address().port });
  server = http.createServer(app.handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  // 服務結束時一併停掉它啟動的 CLI，不留在背景繼續跑、繼續寫檔。
  const { coach } = app;
  server.stopAgents = () => { for (const child of coach.children.values()) killTree(child, 'SIGTERM'); return coach.children.size; };
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().then(server => {
    console.log(`Mentor: http://127.0.0.1:${server.address().port}`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      const stopped = server.stopAgents();
      if (stopped) console.log(`已停止 ${stopped} 個執行中的 AI。下次啟動時這些步驟會標成結果未知。`);
      server.close();
      setTimeout(() => process.exit(0), 300).unref();
    });
  }).catch(error => {
    console.error(error.code === 'EADDRINUSE' ? '連接埠已使用。請執行 PORT=4318 npm start。' : error);
    process.exitCode = 1;
  });
}
