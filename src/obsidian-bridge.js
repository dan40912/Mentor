import { randomBytes, createHash } from 'node:crypto';
import { TaskError } from './tasks.js';

const digest = value => createHash('sha256').update(String(value)).digest('hex');
const TASK = 'TASK-[a-zA-Z0-9-]+';
const reads = new RegExp(`^/api/(?:focus(?:/(?:materials|organization|export))?|tasks(?:/${TASK}/(?:work-cards|plan|handoff-summary|events|conversation|preview|artifact-version|brief))?)$`);
const writes = new RegExp(`^/api/(?:focus/(?:start|pause|resume|end|cancel|capture|prepare-organization|organize|stop-organization|reconcile-organization|save-organization)|tasks(?:/${TASK}/(?:reconcile-publication|ask|answer|outline|approve|execute|review|fix|confirm|instruct|stop|agents|reflect|learn))?)$`);

// Session-only credentials: never write tokens to a Vault or the server's disk.
export class ObsidianBridge {
  constructor(clock = Date.now) { this.clock = clock; this.pending = null; this.clients = new Map(); this.attempts = []; }
  prepare() {
    const code = randomBytes(24).toString('base64url');
    this.pending = { hash: digest(code), expiresAt: this.clock() + 120000 };
    return { code, expiresAt: this.pending.expiresAt, scope: '本機工作區的任務閱讀、建立、執行、交接與人工驗收。不允許角色設定、匯入 session、刪除資料或指定任意產出路徑。' };
  }
  exchange(code) {
    this.attempts = this.attempts.filter(at => at > this.clock() - 60000);
    if (this.attempts.length >= 12) throw new TaskError(429, 'PAIRING_RATE_LIMIT', '配對嘗試過多，請稍後重試。');
    this.attempts.push(this.clock());
    if (typeof code !== 'string' || !this.pending || this.pending.expiresAt <= this.clock() || digest(code) !== this.pending.hash) throw new TaskError(403, 'PAIRING_INVALID', '配對碼無效或已過期，請回 Mentor 重新產生。');
    if (this.clients.size >= 8) throw new TaskError(409, 'PAIRING_LIMIT', '最多同時連接 8 個插件，請先撤銷舊連線。');
    this.pending = null;
    const token = randomBytes(32).toString('base64url'), id = randomBytes(8).toString('hex');
    const client = { id, createdAt: this.clock(), expiresAt: this.clock() + 12 * 60 * 60 * 1000 };
    this.clients.set(digest(token), client);
    return { token, ...client };
  }
  list() { this.prune(); return [...this.clients.values()]; }
  prune() { for (const [key, value] of this.clients) if (value.expiresAt <= this.clock()) this.clients.delete(key); }
  revoke(id) {
    for (const [key, value] of this.clients) if (value.id === id) { this.clients.delete(key); return; }
    throw new TaskError(404, 'PAIRING_NOT_FOUND', '找不到這個連線。');
  }
  authorize(req) {
    this.prune();
    const auth = req.headers.authorization || '';
    const client = auth.startsWith('Bearer ') && this.clients.get(digest(auth.slice(7)));
    if (!client) throw new TaskError(403, 'BRIDGE_AUTH_REQUIRED', '請先在 Mentor 配對 Obsidian。服務重啟後需重新配對。');
    const route = req.url.replace(/^\/api\/obsidian/, '/api');
    const pathname = new URL(route, 'http://127.0.0.1').pathname;
    if (!(req.method === 'GET' ? reads : req.method === 'POST' ? writes : /$a/).test(pathname)) throw new TaskError(403, 'BRIDGE_SCOPE', '這個連線不允許執行此操作。');
    return { client, route };
  }
}
