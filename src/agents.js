import { codexUsage, claudeResult } from './cli-usage.js';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnPlan, killTree, wasTerminationRequested } from './platform.js';

// 呼叫已登入的 CLI。只用 argv 與 stdin，不經 shell；不使用任何 bypass 權限旗標。
// mode：chat 不給工具；read 只能讀產出資料夾；write 只能在產出資料夾內寫檔。
export class AgentError extends Error {
  constructor(code, message, detail = '') {
    super(message);
    Object.assign(this, { code, detail, status: 502 });
  }
}

const bin = provider => ({ codex: process.env.AWC_CODEX_BIN || 'codex', claude: process.env.AWC_CLAUDE_BIN || 'claude', copilot: process.env.AWC_COPILOT_BIN || 'copilot' })[provider];

// Copilot 的全部內建工具；對話模式全部排除，讀檔會被擋下（已實測）
const COPILOT_TOOLS = 'view,create,edit,glob,grep,bash,read_bash,write_bash,stop_bash,list_bash,web_fetch,fetch_copilot_cli_documentation,search_code_subagent,skill,run_dynamic_workflow,dynamic_workflows_manage,sql,session_store_sql,read_agent,list_agents,write_agent,task';

export function buildArgs({ provider, modelId, effort, mode, cwd, outputFile, images = [] }) {
  if (provider === 'codex') {
    const args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '-s', mode === 'write' ? 'workspace-write' : 'read-only', '-C', cwd, '-o', outputFile];
    if (modelId) args.push('-m', modelId);
    if (effort) args.push('-c', `model_reasoning_effort=${effort}`);
    // 用 = 寫法：--image 可接多個值，分開寫會把後面的 '-' 當成圖片。
    for (const image of images) args.push(`--image=${image}`);
    return [...args, '-'];
  }
  if (provider === 'claude') {
    const tools = { chat: '', read: 'Read,Glob,Grep', write: 'Read,Write,Edit,Glob,Grep' }[mode];
    const args = ['-p', '--no-session-persistence', '--output-format', 'json', '--tools', tools];
    if (mode === 'write') args.push('--permission-mode', 'acceptEdits');
    if (mode === 'read') args.push('--permission-mode', 'dontAsk', '--allowedTools', 'Read', 'Glob', 'Grep');
    if (modelId) args.push('--model', modelId);
    if (effort) args.push('--effort', effort);
    return args;
  }
  if (provider === 'copilot') {
    // 使用者已接受風險：read／write 只開檔案工具（不含 shell），路徑限制靠 CLI 預設的 cwd 驗證，沒有額外沙箱。
    const open = { chat: [], read: ['view', 'glob', 'grep'], write: ['view', 'create', 'edit', 'glob', 'grep'] }[mode];
    const args = ['-s', '--no-custom-instructions', '--disable-builtin-mcps', `--excluded-tools=${COPILOT_TOOLS.split(',').filter(tool => !open.includes(tool)).join(',')}`];
    if (mode !== 'chat') args.push('--allow-tool=read');
    if (mode === 'write') args.push('--allow-tool=write');
    if (modelId) args.push('--model', modelId);
    if (effort) args.push('--reasoning-effort', effort);
    return args;
  }
  throw new AgentError('AGENT_NOT_RUNNABLE', '這個 provider 沒有可呼叫的 CLI，只能手動交接。');
}

export function classify(output) {
  if (/rate.?limit|usage limit|session limit|quota|insufficient_quota|429/i.test(output)) return ['AGENT_QUOTA', '這個 AI 的額度用完或被限流。可以在設定把此階段換給另一個 AI。'];
  if (/not logged in|please run \/login|\bunauthorized\b|\b401\s+Unauthorized\b|\b(?:status|HTTP)\s*[:=]?\s*401\b/i.test(output)) return ['AGENT_NOT_LOGGED_IN', 'CLI 尚未登入。請在終端機執行該 CLI 並完成登入。'];
  if (/content filtering/i.test(output)) return ['AGENT_FILTERED', 'AI 回覆被內容過濾擋下，沒有收到可用結果。可以重試，或在角色與設定選擇另一個 AI。'];
  if (/\bmodel\b[^\r\n]*\b(?:at capacity|overloaded)\b|\bmodel_capacity_exceeded\b/i.test(output)) return ['AGENT_MODEL_CAPACITY', '這個模型目前滿載，可以稍後重試或換一個模型'];
  if (/model .*not supported|unknown model|invalid model|model_not_found|is not available/i.test(output)) return ['AGENT_MODEL_UNSUPPORTED', '這個帳號不支援所選模型，請在設定換一個模型。'];
  return ['AGENT_FAILED', 'AI 執行失敗，原因未能辨識。'];
}

// 時間上限依工作性質：寫檔可能要讀大量資料，給 30 分鐘；唯讀驗收 15 分鐘；純對話 10 分鐘
export const TIMEOUTS = { chat: 600000, read: 900000, write: 1800000 };

export async function runAgent({ provider, modelId = null, effort = null, mode = 'chat', cwd, prompt, images = [], timeoutMs = TIMEOUTS[mode] || 600000, onSpawn }) {
  const startedAt = Date.now();
  const scratch = await mkdtemp(path.join(tmpdir(), 'awc-agent-'));
  const outputFile = path.join(scratch, 'last.txt');
  const workdir = mode === 'chat' ? scratch : cwd;
  const args = buildArgs({ provider, modelId, effort, mode, cwd: workdir, outputFile, images });
  try {
    const { code, signal, stdout, stderr, interrupted } = await new Promise((resolve, reject) => {
      const plan = spawnPlan(bin(provider), args);
      const child = spawn(plan.command, plan.args, { ...plan.options, cwd: workdir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, NO_COLOR: '1' } });
      onSpawn?.(child);
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { killTree(child, 'SIGTERM'); reject(new AgentError('AGENT_TIMEOUT', `AI 超過 ${Math.round(timeoutMs / 60000)} 分鐘沒有完成，已停止。`)); }, timeoutMs);
      child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000); });
      child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 200_000) stderr = stderr.slice(-100_000); });
      child.on('error', error => { clearTimeout(timer); reject(error.code === 'ENOENT' || error.code === 'EINVAL' ? new AgentError('AGENT_NOT_INSTALLED', `找不到 ${bin(provider)} 指令。`) : error); });
      child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, interrupted: wasTerminationRequested(child) }); });
      child.stdin.end(prompt);
    });
    if (signal || interrupted) throw new AgentError('AGENT_INTERRUPTED', 'CLI 被訊號中斷，結果未知。請核對產出後再接續。', signal);
    let text = stdout.trim();
    if (provider === 'codex') text = (await readFile(outputFile, 'utf8').catch(() => '')).trim();
    let usage = provider === 'codex' ? codexUsage(stdout) : null;
    let resultError = false;
    if (provider === 'claude') {
      const result = claudeResult(stdout);
      if (result) { text = result.text; usage = result.usage; resultError = result.isError; }
      else if (code === 0) throw new AgentError('AGENT_RESPONSE_INVALID', 'CLI 未回傳可解析的結構化結果，請核對 CLI 版本與輸出。');
    }
    const filtered = /^The model returned no content because the response was blocked by content filtering\.?$/i.test(text);
    if (code !== 0 || resultError || !text || filtered) {
      const [errorCode, message] = classify(`${text}\n${stdout}\n${stderr}`);
      throw new AgentError(errorCode, message, (filtered ? text : `${stderr || stdout}`).slice(-1500));
    }
    return { text, provider, modelId, effort, usage, elapsedMs: Date.now() - startedAt };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

// 從回覆取出最後一個 JSON 物件；取不到就回傳 null，由呼叫端保留原文。
export function extractJson(text) {
  const fenced = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/g)].map(match => match[1]);
  const candidates = fenced.length ? fenced.reverse() : [text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)];
  for (const candidate of candidates) {
    const value = parseLoose(candidate);
    if (value) return value;
  }
  return null;
}

// 模型常把巢狀物件多關一個 }，讓根物件提早結束、後面還接著 ,"learning":{…}。
// 只修這一種形狀：前段與後段各自是合法物件時合併；其他錯誤照樣當成解析失敗。
function parseLoose(candidate, depthLimit = 3) {
  try { const value = JSON.parse(candidate); return value && typeof value === 'object' ? value : null; } catch {}
  if (!depthLimit) return null;
  let depth = 0, inString = false, end = -1;
  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) { if (ch === '\\') i++; else if (ch === '"') inString = false; continue; }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  const rest = end < 0 ? '' : candidate.slice(end + 1).trim();
  if (!rest.startsWith(',')) return null;
  let head;
  try { head = JSON.parse(candidate.slice(0, end + 1)); } catch { return null; }
  const tail = parseLoose(`{${rest.slice(1)}`, depthLimit - 1);
  return head && typeof head === 'object' && !Array.isArray(head) && tail ? { ...head, ...tail } : null;
}

export async function diagnose(provider, model) {
  const started = Date.now();
  try {
    const result = await runAgent({ ...model, provider, mode: 'chat', prompt: '只回覆兩個字：可用', timeoutMs: 90000 });
    return { provider, ok: true, ms: Date.now() - started, reply: result.text.slice(0, 40) };
  } catch (error) {
    return { provider, ok: false, code: error.code || 'AGENT_FAILED', message: error.message, ms: Date.now() - started };
  }
}
