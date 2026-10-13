import test from 'node:test';
import assert from 'node:assert/strict';
import { client, reply } from './fixtures/session-client.js';

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
