import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm, symlink, cp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { demoTask } from './fixtures/demo-task.js';
import { TaskStore, serializeTask } from '../src/tasks.js';
import { previewArtifact } from '../src/server.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(await realpath(tmpdir()), `mentor-preview-${randomUUID()}`);
const baseTask = () => demoTask('TASK-base');
const id = 'TASK-preview-test';
const hash = data => createHash('sha256').update(data).digest('hex');

test('registered previews and security boundaries, with an isolated HTTP server', async t => {
  const taskDir = path.join(fixtureRoot, 'outputs', id);
  const otherDir = path.join(fixtureRoot, 'outputs', 'TASK-other');
  await mkdir(taskDir, { recursive: true }); await mkdir(otherDir, { recursive: true });
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const source = baseTask();
  const task = { ...source, id, allowedRoots: [taskDir], workspace: { label: id, root: taskDir } };
  const files = ['good.html', 'good.md', 'good.png', 'good.jpg', 'good.webp', 'missing.md', 'large.md', 'large.png', 'bad.png', 'escape.md', 'cross.md', 'directory.md', 'secret.svg'];
  task.planning.workItems[0].outputs = files.map(file => ({ file }));
  for (const item of task.planning.workItems.slice(1)) item.outputs = [];
  await mkdir(path.join(fixtureRoot, 'vault'));
  await writeFile(path.join(fixtureRoot, 'vault', `${id}.md`), serializeTask(task));
  await writeFile(path.join(taskDir, 'good.html'), '<input id="q"><script>document.querySelector("#q").oninput=()=>document.title="searched"</script>');
  await writeFile(path.join(taskDir, 'good.md'), '# 中文 & <script>parent.alert(1)</script>');
  await writeFile(path.join(taskDir, 'good.png'), Buffer.from('89504e470d0a1a0a0000', 'hex'));
  await writeFile(path.join(taskDir, 'good.jpg'), Buffer.from('ffd8ff00', 'hex'));
  await writeFile(path.join(taskDir, 'good.webp'), Buffer.from('RIFF1234WEBP'));
  await writeFile(path.join(taskDir, 'large.md'), Buffer.alloc(5 * 1024 * 1024 + 1));
  await writeFile(path.join(taskDir, 'large.png'), Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(20 * 1024 * 1024)]));
  await writeFile(path.join(taskDir, 'bad.png'), '<script>alert(1)</script>');
  await writeFile(path.join(otherDir, 'cross.md'), 'other task');
  await writeFile(path.join(fixtureRoot, 'outside.md'), 'outside');
  await mkdir(path.join(taskDir, 'directory.md'));
  await symlink(path.join(fixtureRoot, 'outside.md'), path.join(taskDir, 'escape.md'));
  await symlink(path.join(otherDir, 'cross.md'), path.join(taskDir, 'cross.md'));
  const store = new TaskStore(path.join(fixtureRoot, 'vault'));
  for (const [file, mime] of [['good.html', 'text/html'], ['good.md', 'text/html'], ['good.png', 'image/png'], ['good.jpg', 'image/jpeg'], ['good.webp', 'image/webp']]) {
    assert.match((await previewArtifact(store, fixtureRoot, id, file)).mime, new RegExp(mime));
  }
  const markdown = await previewArtifact(store, fixtureRoot, id, 'good.md');
  assert.match(markdown.content.toString(), /<pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit"># 中文 &amp; &lt;script&gt;parent\.alert\(1\)&lt;\/script&gt;<\/pre>/);
  assert.doesNotMatch(markdown.content.toString(), /<script>/);
  for (const [file, code] of [['unlisted.md','PREVIEW_NOT_REGISTERED'],['missing.md','PREVIEW_MISSING'],['escape.md','PREVIEW_OUTSIDE_TASK'],['cross.md','PREVIEW_OUTSIDE_TASK'],['large.md','PREVIEW_TOO_LARGE'],['large.png','PREVIEW_TOO_LARGE'],['bad.png','PREVIEW_TYPE_UNSUPPORTED'],['directory.md','PREVIEW_TYPE_UNSUPPORTED'],['secret.svg','PREVIEW_TYPE_UNSUPPORTED'],['../outside.md','PREVIEW_NAME_INVALID'],['..\\outside.md','PREVIEW_NAME_INVALID']]) {
    await assert.rejects(previewArtifact(store, fixtureRoot, id, file), { code });
  }
  await assert.rejects(previewArtifact(store, fixtureRoot, 'TASK-other', 'good.md'), { code: 'TASK_NOT_FOUND' });
  const rootId = 'TASK-root-preview';
  const rootDir = path.join(fixtureRoot, 'outputs', rootId);
  await mkdir(rootDir);
  await writeFile(path.join(rootDir, 'nested.md'), 'root relative preview');
  const registered = `outputs/${rootId}/nested.md`;
  const rootTask = { ...source, id: rootId, allowedRoots: [fixtureRoot], workspace: { label: rootId, root: fixtureRoot } };
  rootTask.planning.workItems[0].outputs = [{ file: registered }];
  for (const item of rootTask.planning.workItems.slice(1)) item.outputs = [];
  await writeFile(path.join(fixtureRoot, 'vault', `${rootId}.md`), serializeTask(rootTask));
  assert.match((await previewArtifact(store, fixtureRoot, rootId, registered)).content.toString(), /root relative preview/);
  await assert.rejects(previewArtifact(store, fixtureRoot, rootId, 'nested.md'), { code: 'PREVIEW_NOT_REGISTERED' });
  await assert.rejects(previewArtifact(store, fixtureRoot, id, registered), { code: 'PREVIEW_NOT_REGISTERED' });
  const child = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)),'..','src','server.js')], { env: { ...process.env, PORT: '0', MENTOR_HOME: fixtureRoot }, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverError = ''; child.stderr.on('data', data => serverError += data);
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } });
  const address = await new Promise((resolve, reject) => { child.once('error', reject); child.stdout.once('data', data => resolve(data.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0])); child.once('exit', code => reject(new Error(`server exited ${code}: ${serverError}`))); }).catch(error => { if (serverError.includes('listen EPERM')) return null; throw error; });
  if (!address) { t.skip('安全邊界函式斷言已執行；HTTP 整合測試因沙箱拒絕 loopback listen EPERM 待驗。'); return; }
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

test('preview UI keeps artifact bytes out of the console DOM and preserves keyboard return path', async () => {
  const html = await readFile(path.join(root, '..', 'web', 'index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const vm = await import('node:vm');
  new vm.Script(script);
  const preview = script.slice(script.indexOf('async function openPreview('), script.indexOf('// 行內表單取代 prompt()'));
  assert.match(preview, /setAttribute\('sandbox',ext==='html'\?'allow-scripts':''\)/);
  assert.match(preview, /node\.src=url;content\.replaceChildren\(node\)/);
  assert.match(preview, /catch\(error\)\{if\(dialog\.open&&previewReturn\?\.file===file&&previewReturn\?\.taskId===taskId&&previewReturn\?\.trigger===trigger\)/);
  assert.doesNotMatch(preview, /innerHTML|srcdoc|\.textContent\s*=\s*await response\.text/);
  assert.match(html, /id="preview-dialog"/);
  assert.match(html, /preview-dialog'\)\.addEventListener\('close'/);
  assert.match(html, /\.focus\(\{preventScroll:true\}\)/);
});

test('HTML preview mode changes the iframe viewport width and remains keyboard accessible', async () => {
  const html = await readFile(path.join(root, '..', 'web', 'index.html'), 'utf8');
  assert.match(html, /#preview-content\.mobile iframe\{width:min\(390px,100%\)\}/);
  assert.match(html, /#preview-content iframe\{[^}]*border:0;/);
  assert.match(html, /id="preview-modes"[^>]*role="group"[^>]*hidden/);
  assert.match(html, /<button[^>]*data-preview-mode="desktop"[^>]*aria-pressed="true"/);
  assert.match(html, /<button[^>]*data-preview-mode="mobile"[^>]*aria-pressed="false"/);
  assert.match(html, /content\.classList\.remove\('mobile'\);modes\.hidden=true/);
  assert.match(html, /modes\.hidden=ext!=='html'/);
  assert.match(html, /classList\.toggle\('mobile',mode\.dataset\.previewMode==='mobile'\)/);
  assert.match(html, /setAttribute\('aria-pressed',String\(button===mode\)\)/);
  const handler = html.match(/\$\('#preview-modes'\)\.addEventListener\('click',event=>\{[^\n]+\}\);/)?.[0];
  assert.ok(handler);
  const buttons = ['desktop', 'mobile'].map(value => ({ dataset: { previewMode: value }, setAttribute(name, pressed) { this[name] = pressed; } }));
  let click, mobile = false;
  const modes = { addEventListener(type, fn) { assert.equal(type, 'click'); click = fn; }, querySelectorAll() { return buttons; } };
  const content = { classList: { toggle(name, enabled) { assert.equal(name, 'mobile'); mobile = enabled; } } };
  const vm = await import('node:vm');
  vm.runInNewContext(handler, { $: selector => selector === '#preview-modes' ? modes : content });
  click({ target: { closest: () => buttons[1] } });
  assert.equal(mobile, true);
  assert.deepEqual(buttons.map(button => button['aria-pressed']), ['false', 'true']);
  click({ target: { closest: () => buttons[0] } });
  assert.equal(mobile, false);
  assert.deepEqual(buttons.map(button => button['aria-pressed']), ['true', 'false']);
});
