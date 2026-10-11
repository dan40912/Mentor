import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';

const root = path.dirname(fileURLToPath(import.meta.url));
import { client } from './fixtures/session-client.js';

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

