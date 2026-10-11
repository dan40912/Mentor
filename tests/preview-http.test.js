import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { verifyPreviewBoundaries } from './fixtures/preview-fixture.js';

test('registered previews and security boundaries, with an isolated HTTP server', async t => {
  const { fixtureRoot, id, rootId, registered } = await verifyPreviewBoundaries(t);
  const child = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)),'..','src','server.js')], { env: { ...process.env, PORT: '0', MENTOR_HOME: fixtureRoot }, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverError = ''; child.stderr.on('data', data => serverError += data);
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } });
  const address = await new Promise((resolve, reject) => { child.once('error', reject); child.stdout.once('data', data => resolve(data.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0])); child.once('exit', code => reject(new Error(`server exited ${code}: ${serverError}`))); });
  const home = await fetch(address + '/');
  const cookie = home.headers.get('set-cookie').split(';')[0];
  const url = file => `${address}/api/tasks/${id}/preview?file=${encodeURIComponent(file)}`;
  const good = await fetch(url('good.html'), { headers: { cookie } });
  assert.equal(good.status, 200);
  assert.match(good.headers.get('content-security-policy'), /sandbox allow-scripts; default-src 'none'/);
  assert.match(good.headers.get('content-security-policy'), /connect-src 'none'; form-action 'none'; frame-src 'none'/);
  assert.equal(good.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await good.text(), /document.title="searched"/);
  const rootGood = await fetch(`${address}/api/tasks/${rootId}/preview?file=${encodeURIComponent(registered)}`, { headers: { cookie } });
  assert.equal(rootGood.status, 200);
  const md = await fetch(url('good.md'), { headers: { cookie } });
  assert.match(md.headers.get('content-type'), /text\/html/);
  assert.match(md.headers.get('content-security-policy'), /default-src 'none'; style-src 'unsafe-inline'; sandbox;/);
  assert.doesNotMatch(md.headers.get('content-security-policy'), /allow-scripts|allow-same-origin/);
  assert.match(await md.text(), /&lt;script&gt;parent\.alert/);
  for (const file of ['unlisted.md','missing.md','escape.md','cross.md','large.md','large.png','bad.png','secret.svg','../outside.md']) assert.ok((await fetch(url(file), { headers: { cookie } })).status >= 400, file);
  assert.equal((await fetch(url('good.html'))).status, 403);
  assert.equal((await fetch(url('good.html'), { headers: { cookie, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(url('good.html'), { headers: { cookie, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    http.get(url('good.html'), { headers: { cookie, Host: 'localhost:' + new URL(address).port } }, response => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await fetch(address + '/api/tasks', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
});
