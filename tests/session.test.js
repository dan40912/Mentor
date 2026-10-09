import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, cp, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import vm from 'node:vm';
import http from 'node:http';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = await readFile(path.join(root, '..', 'web', 'index.html'), 'utf8');
const clientCode = html.slice(html.indexOf('let sessionRefresh;'), html.indexOf('async function submit('));
function client(fetch) {
  const context = vm.createContext({ fetch, state: { csrfToken: 'old-token' }, offline: () => new Error('offline') });
  vm.runInContext(clientCode, context);
  return context;
}
const reply = (status, data) => ({ status, ok: status < 400, json: async () => data });

test('form submissions recover after server restart without duplicate tasks; session refresh stays same-origin', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'awc-session-'));
  let child;
  t.after(async () => { if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); } await rm(dir, { recursive: true, force: true }); });
  async function start(port) {
    child = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)),'..','src','server.js')], { env: { ...process.env, PORT: String(port), MENTOR_HOME: dir, AWC_CODEX_BIN: path.join(root, 'fixtures/fake-cli.mjs'), AWC_CLAUDE_BIN: path.join(root, 'fixtures/fake-cli.mjs'), AWC_COPILOT_BIN: path.join(root, 'fixtures/fake-cli.mjs') }, stdio: ['ignore','pipe','pipe'] });
    const output = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.stdout.once('data', data => resolve(data.toString()));
      child.once('exit', code => reject(new Error(`server exited: ${code}`)));
    });
    return output.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  }
  const base = await start(0);
  let cookie = '';
  const calls = [];
  const browserFetch = async (url, options = {}) => {
    const response = await fetch(base + url, { ...options, headers: { ...options.headers, cookie } });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    calls.push({ url, status: response.status, body: options.body, key: options.headers?.['Idempotency-Key'] });
    return response;
  };
  await browserFetch('/');
  const context = client(browserFetch);
  context.state.csrfToken = (await context.request('/api/settings')).csrfToken;
  const oldToken = context.state.csrfToken;
  child.kill(); await once(child, 'exit');
  await start(new URL(base).port);
  // An already-open form retains the old page token and cookie across restart.
  const input = { request: '我要做一份新品簡報給主管', project: '驗證專案', profile: 'quick' };
  const created = await context.request('/api/tasks', input, { 'Idempotency-Key': 'session-create-test' });
  assert.notEqual(context.state.csrfToken, oldToken);
  assert.equal(created.task.project, input.project);
  const posts = calls.filter(c => c.url === '/api/tasks');
  assert.deepEqual(posts.map(c => c.status), [403, 202]);
  assert.equal(posts[0].body, posts[1].body);
  assert.equal(posts[0].key, posts[1].key);
  assert.equal((await readdir(path.join(dir, 'vault'))).filter(f => /^TASK-.*\.md$/.test(f)).length, 1);
  // Another port/process can overwrite the host cookie while the page token is still current.
  cookie = 'awc=another-process';
  const list = await context.request('/api/tasks');
  assert.equal(list.tasks.length, 1);
  assert.equal(calls.filter(c => c.url === '/api/session').length, 2);
  for (const headers of [{ Origin: 'https://example.com' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const response = await fetch(base + '/api/session', { headers });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  await new Promise((resolve, reject) => {
    http.get(base + '/api/session', { headers: { Host: 'localhost:' + new URL(base).port } }, response => {
      try { assert.equal(response.statusCode, 403); assert.equal(response.headers['set-cookie'], undefined); response.resume(); resolve(); } catch (error) { reject(error); }
    }).on('error', reject);
  });
  const rejected = await fetch(base + '/api/tasks', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': oldToken }, body: JSON.stringify(input) });
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).code, 'CSRF_FAILED');
});

test('refresh is shared by concurrent requests, limited to one retry, and never retries ambiguous failures', async () => {
  let refreshes = 0;
  const attempts = new Map();
  const context = client(async (url, options) => {
    if (url === '/api/session') { refreshes++; await new Promise(resolve => setImmediate(resolve)); return reply(200, { csrfToken: 'new-token' }); }
    attempts.set(url, (attempts.get(url) || 0) + 1);
    return options.headers['X-CSRF-Token'] === 'new-token' ? reply(200, { saved: true }) : reply(403, { code: 'CSRF_FAILED' });
  });
  await Promise.all([context.request('/first', { text: '表單原文' }), context.request('/second', {})]);
  assert.equal(refreshes, 1);
  assert.equal(attempts.get('/first'), 2);
  assert.equal(attempts.get('/second'), 2);
  for (const failure of [reply(403, { code: 'FORBIDDEN_ORIGIN' }), reply(409, { code: 'REVISION_CONFLICT' }), reply(500, { code: 'REQUEST_FAILED' }), new Error('network')]) {
    let calls = 0;
    const broken = client(async () => { calls++; if (failure instanceof Error) throw failure; return failure; });
    await assert.rejects(broken.request('/api/tasks', {}));
    assert.equal(calls, 1);
  }
  let calls = 0;
  const denied = client(async url => { calls++; return url === '/api/session' ? reply(200, { csrfToken: 'new-token' }) : reply(403, { code: 'CSRF_FAILED' }); });
  await assert.rejects(denied.request('/api/tasks', {}), /連線驗證已失效/);
  assert.equal(calls, 3);
  const unavailable = client(async url => url === '/api/session' ? reply(500, {}) : reply(403, { code: 'CSRF_FAILED' }));
  await assert.rejects(unavailable.request('/api/tasks', {}), /連線驗證更新失敗/);
});
