// 直接送入正式 request listener，不啟動 server、不監聽埠。
import { Readable } from 'node:stream';
import { createApplication } from '../../src/server.js';

export async function application(home, port = 4317) {
  const app = await createApplication(home, port);
  const address = `http://127.0.0.1:${port}`;
  const handler = app.listeners('request')[0];
  const fetch = async (url, options = {}) => {
    const target = new URL(url, address);
    const headers = Object.fromEntries(new Headers(options.headers));
    headers.host ??= target.host;
    const req = Readable.from(options.body ? [Buffer.from(options.body)] : []);
    Object.assign(req, { method: options.method || 'GET', url: target.pathname + target.search, headers });
    let status;
    let responseHeaders = {};
    const chunks = [];
    let finish;
    const ended = new Promise(resolve => { finish = resolve; });
    const res = {
      setHeader(name, value) { responseHeaders[name] = value; },
      writeHead(code, values) { status = code; responseHeaders = { ...responseHeaders, ...values }; },
      end(content) { if (content !== undefined) chunks.push(Buffer.from(content)); finish(); }
    };
    await handler(req, res);
    await ended;
    return new Response(Buffer.concat(chunks), { status, headers: responseHeaders });
  };
  return { address, fetch, stop: () => app.stopAgents() };
}
