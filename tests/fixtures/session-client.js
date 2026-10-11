import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../../web/index.html', import.meta.url), 'utf8');
const clientCode = html.slice(html.indexOf('let sessionRefresh;'), html.indexOf('async function submit('));
export function client(fetch) {
  const context = vm.createContext({ fetch, state: { csrfToken: 'old-token' }, offline: () => new Error('offline') });
  vm.runInContext(clientCode, context);
  return context;
}
export const reply = (status, data) => ({ status, ok: status < 400, json: async () => data });

