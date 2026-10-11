import { Readable } from 'node:stream';
import { createRequestHandler } from '../../src/server.js';

export const fakeAgent = async ({ prompt }) => ({ text: JSON.stringify(prompt.includes('「任務制定」') ? { card: { title: '測試任務', goal: '核對附件', project: '驗證專案' } } : { questions: [{ q: '要幾頁？', why: '決定密度' }], ready: false }), provider: 'codex' });

// 真正的路由、驗證與 response headers；僅以記憶體 stream 取代 socket。
export async function requestApp(root, runAgent = fakeAgent) {
  const app = await createRequestHandler({ root, port: 4317, runAgent });
  // create 的 done 包含 A → B 接續；只等 pending 會漏掉兩階段之間的空窗。
  const creations = new Set();
  const create = app.coach.create.bind(app.coach);
  app.coach.create = async input => {
    const result = await create(input);
    creations.add(result.done);
    result.done.catch(() => {});
    return result;
  };
  const address = 'http://127.0.0.1:4317';
  const fetch = async (url, options = {}) => {
    const target = new URL(url, address);
    const req = Readable.from(options.body === undefined ? [] : [Buffer.from(options.body)]);
    req.method = options.method || 'GET';
    req.url = target.pathname + target.search;
    req.headers = { host: target.host, ...Object.fromEntries(new Headers(options.headers).entries()) };
    const headers = new Headers(); let status = 200; let data;
    const res = {
      setHeader(name, value) { headers.set(name, value); },
      writeHead(code, values = {}) { status = code; for (const [name, value] of Object.entries(values)) headers.set(name, value); },
      end(value) { data = value; }
    };
    await app.handler(req, res);
    return new Response(data, { status, headers });
  };
  const settle = async () => {
    await Promise.all([...creations]);
    creations.clear();
    do { await Promise.allSettled([...app.coach.pending.values()]); await new Promise(resolve => setImmediate(resolve)); } while (app.coach.pending.size);
  };
  return { ...app, fetch, address, settle };
}
