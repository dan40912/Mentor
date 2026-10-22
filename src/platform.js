import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import path from 'node:path';

// Windows 上 npm 安裝的 CLI 是 .cmd 捷徑：直接 spawn('codex') 會 ENOENT，
// Node 18.20.2 之後 spawn .cmd 又必須走 shell。這裡集中處理，其他程式碼不用管平台。

export class UnsafeArgError extends Error {
  constructor(arg) { super(`參數含有 cmd.exe 會誤判的字元，已拒絕執行：${arg}`); this.code = 'AGENT_ARG_UNSAFE'; }
}

const isFile = file => { try { return statSync(file).isFile(); } catch { return false; } };

// 在 Windows 依 PATH 與 PATHEXT 找出真正的檔案；其他平台原樣回傳。
export function resolveBin(name, { platform = process.platform, env = process.env, exists = isFile } = {}) {
  if (platform !== 'win32') return name;
  const exts = path.extname(name) ? [''] : (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const dirs = path.win32.isAbsolute(name) || /[\\/]/.test(name) ? [''] : (env.PATH || env.Path || '').split(';').filter(Boolean);
  for (const dir of dirs) for (const ext of exts) {
    const candidate = dir ? path.win32.join(dir, name + ext) : name + ext;
    if (exists(candidate)) return candidate;
  }
  return name;
}

// cmd.exe 的引號規則：含空白或空字串才加引號；有 shell 特殊字元就直接拒絕，不嘗試跳脫。
const CMD_META = /["%^&|<>!\r\n`]/;
export const quoteForCmd = arg => {
  if (CMD_META.test(arg)) throw new UnsafeArgError(arg);
  return arg === '' || /\s/.test(arg) ? `"${arg}"` : arg;
};

// 回傳 spawn 需要的 command、args 與 options。platform 可注入，方便在任何系統上測試 Windows 路徑。
export function spawnPlan(bin, args, { platform = process.platform, env = process.env, exists } = {}) {
  if (/\.(mjs|cjs|js)$/i.test(bin)) return { command: process.execPath, args: [bin, ...args], options: {} };
  const resolved = resolveBin(bin, { platform, env, exists });
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
    const line = [resolved, ...args].map(quoteForCmd).join(' ');
    return { command: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], options: { windowsVerbatimArguments: true } };
  }
  return { command: resolved, args, options: {} };
}

const terminationRequests = new WeakSet();
export const wasTerminationRequested = child => terminationRequests.has(child);

// Windows 的 child.kill() 只會停掉外層 cmd.exe，要用 taskkill 連同子程序一起停。
export function killTree(child, signal = 'SIGTERM', { platform = process.platform } = {}) {
  if (!child?.pid) return;
  terminationRequests.add(child);
  if (platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => child.kill()); }
    catch { child.kill(); }
    return;
  }
  child.kill(signal);
}

// 暫存檔改名覆蓋正本。Windows 上防毒軟體或索引器偶爾會短暫鎖住檔案，改名會回 EPERM／EBUSY，重試幾次即可。
export async function renameReplace(from, to, { attempts = 5, delayMs = 40 } = {}) {
  for (let i = 1; ; i++) {
    try { return await rename(from, to); }
    catch (error) {
      if (i >= attempts || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs * i));
    }
  }
}
