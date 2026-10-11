import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, mkdtemp, rm, mkdir, writeFile, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requestApp, fakeAgent } from './fixtures/request.js';
import { TaskStore } from '../src/tasks.js';
import { Attachments, MAX_ATTACHMENT_BYTES, attachmentContext } from '../src/attachments.js';

const ui = await readFile(new URL('../web/assets/upload.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.value = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
}
const document = { createElement: tag => new Node(tag), createTextNode: text => ({ textContent: text }) };
const browserFile = (name, bytes) => ({ name, size: bytes.length, arrayBuffer: async () => bytes });
async function fixture(t, runAgent = fakeAgent) {
  const dir = await mkdtemp(path.join(tmpdir(), 'mentor-upload-'));
  const app = await requestApp(dir, runAgent);
  t.after(async () => { await app.settle(); await rm(dir, { recursive: true, force: true }); });
  const home = await app.fetch('/');
  const cookie = home.headers.get('set-cookie').split(';')[0];
  const csrf = (await (await app.fetch('/api/session')).json()).csrfToken;
  const headers = { cookie, 'x-csrf-token': csrf };
  return { ...app, dir, headers };
}

for (const entry of ['change', 'drop']) test(`new task ${entry}: real UI submission, staging, task folder, download and first AI prompt`, async t => {
  const prompts = [];
  const app = await fixture(t, async options => { prompts.push(options.prompt); return fakeAgent(options); });
  const host = new Node('div'), form = new Node('form'); form.querySelector = () => new Node('button'); form.reset = () => {};
  const initialInput = new Node('input');
  host.querySelector = selector => selector === 'input[type="file"]' ? initialInput : null;
  const detail = new Node('section'); let submitted; let busyRun;
  const request = async (url, data, extra = {}, raw = false) => {
    const response = await app.fetch(url, data ? { method: 'POST', headers: { ...app.headers, ...extra }, body: raw ? data : JSON.stringify(data) } : { headers: app.headers });
    const result = await response.json(); if (!response.ok) throw new Error(result.message); if (url === '/api/tasks' && data) submitted = result.task;
    return result;
  };
  const context = vm.createContext({ document, request, state: {}, tasks: [], $: selector => selector === '#draft-form' ? form : selector === '#draft-attachments' ? host : { close() {} }, FormData: class { *[Symbol.iterator]() { yield ['request', '請整理附件資料']; yield ['profile', 'quick']; } }, busy: (_button, action) => () => { busyRun = action(); return busyRun; }, renderOverview() {}, ensurePolling() {}, openTask() {}, tell() {}, agentOf: () => '模擬 AI', agentOfTask: () => '模擬 AI' });
  vm.runInContext(ui, context);
  const wiring = html.slice(html.indexOf('const draftAttachments='), html.indexOf("$('#settings').onsubmit="));
  vm.runInContext(wiring, context);
  assert.equal(host.children[1], initialInput, '沿用 HTML 的可見檔案選擇器並接上事件');
  const bytes = Buffer.from('本次指定內容：每月追蹤客訴。\r\n第二行');
  const file = browserFile('資料.TXT', bytes);
  if (entry === 'change') { host.children[1].files = [file]; host.children[1].listeners.change(); }
  else { let prevented = false; host.listeners.dragover({ preventDefault() { prevented = true; } }); assert.equal(prevented, true); host.listeners.drop({ preventDefault() {}, dataTransfer: { files: [file] } }); }
  form.onsubmit({ preventDefault() {}, currentTarget: form }); await busyRun;
  await app.settle();
  const stored = (await new TaskStore(path.join(app.dir, 'vault')).get(submitted.id)).task;
  assert.equal(stored.attachments.length, 1);
  const attachment = stored.attachments[0];
  assert.equal(stored.allowedRoots[0], path.join(await realpath(app.dir), 'outputs', stored.id));
  assert.deepEqual(await readFile(path.join(stored.allowedRoots[0], attachment.file)), bytes);
  const download = await app.fetch(`/api/tasks/${stored.id}/attachment?id=${attachment.id}`, { headers: app.headers });
  assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  assert.match(download.headers.get('content-disposition'), /attachment;/);
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.match(prompts[0], /本次指定內容：每月追蹤客訴/);
  assert.ok(prompts[0].includes(attachment.id)); assert.ok(prompts[0].includes('資料.TXT'));
  vm.runInContext('rendered = attachmentList(tasks[0])', Object.assign(context, { tasks: [stored] }));
  const link = context.rendered.children[1].children[0].children[0]; // section > ul > li > a
  assert.equal(link.textContent, '資料.TXT'); assert.match(link.href, new RegExp(stored.id));
  assert.equal(host.children[2].children.length, 0, '成功後清除已暫存清單');
  assert.match(html, /t\.attachments\?\.length\)detail\.append\(attachmentList\(t\)\)/);
});

test('new task serves a visible attachment section and the shared upload script without listening', async t => {
  const app = await fixture(t);
  const response = await app.fetch('/');
  assert.equal(response.status, 200);
  const page = await response.text();
  const form = page.match(/<form id="draft-form">([\s\S]*?)<\/form>/)[1];
  const section = form.match(/<section id="draft-attachments"([\s\S]*?)<\/section>/)[0];
  assert.match(section, /加入附件（選填）/);
  assert.doesNotMatch(section, /\bhidden\b/);
  assert.ok(form.indexOf('name="request"') < form.indexOf('id="draft-attachments"'));
  assert.ok(form.indexOf('id="draft-attachments"') < form.indexOf('id="profile-picker"'));
  assert.match(page, /\.attach\{border:1\.5px dashed/);
  assert.match(page, /\.attach\.is-over\{/, '拖進來時整塊會亮起來');
  assert.match(page, /<script src="\/assets\/upload.js"><\/script>/);
  const script = await app.fetch('/assets/upload.js');
  assert.equal(script.status, 200);
  const code = await script.clone().text();
  assert.match(code, /📎 加入檔案/, '有明顯的加入檔案按鈕');
  assert.match(code, /或把檔案拖到這裡/);
  assert.match(code, /input\.className = 'visually-hidden'/, '原生欄位藏起來，由按鈕觸發');
  assert.match(script.headers.get('content-type'), /javascript/);
  assert.equal(await script.text(), ui);
});

test('picker validates each file, partial success, first ten order, and preserves staged state after submit failure', async () => {
  const host = new Node('div'), calls = [];
  const context = vm.createContext({ document }); vm.runInContext(ui, context);
  const picker = context.attachmentPicker(host, async file => { calls.push(file.name); if (file.name === 'failed.txt') throw new Error('磁碟不可寫'); return { attachment: { id: file.name } }; }, async names => ({ id: 'batch', results: names.map((name, index) => ({ name, index })) }));
  host.children[1].files = [browserFile('good.txt', Buffer.from('ok')), { name: 'large.txt', size: 20_000_001 }, { name: 'bad.exe', size: 1 }, { name: 'failed.txt', size: 1 }];
  host.children[1].listeners.change(); assert.deepEqual(Array.from(await picker.ids()), ['good.txt']);
  const labels = host.children[2].children.map(row => row.textContent).join('\n');
  assert.match(labels, /20,000,000 bytes/); assert.match(labels, /只支援 PDF/); assert.match(labels, /磁碟不可寫/);
  assert.deepEqual(Array.from(await picker.ids()), ['good.txt'], '建立失敗時不清除暫存識別');
  picker.clear(); calls.length = 0;
  const files = Array.from({ length: 12 }, (_, n) => ({ name: `${n}.txt`, size: 0 }));
  host.listeners.drop({ preventDefault() {}, dataTransfer: { files } });
  assert.equal((await picker.ids()).length, 10); assert.deepEqual(calls, files.slice(0, 10).map(file => file.name));
  assert.match(host.children[2].children[10].textContent, /超出每批 10 個限制/);
  picker.lock(true); host.listeners.drop({ preventDefault() {}, dataTransfer: { files } }); assert.equal((await picker.ids()).length, 10);
});

test('backend validates actual bytes, 20 MB inclusive, names, CSRF, unique storage, custom folder and task ownership', async t => {
  const app = await fixture(t);
  const stage = (name, bytes, headers = app.headers) => app.fetch(`/api/uploads?name=${encodeURIComponent(name)}`, { method: 'POST', headers, body: bytes });
  assert.equal((await stage('valid.txt', Buffer.from('ok'), {})).status, 403);
  assert.equal((await stage('../escape.txt', Buffer.from('ok'))).status, 415);
  assert.equal((await stage('bad.exe', Buffer.from('ok'))).status, 415);
  assert.equal((await stage('large.txt', Buffer.alloc(MAX_ATTACHMENT_BYTES + 1))).status, 413);
  const boundary = await stage('boundary.TXT', Buffer.alloc(MAX_ATTACHMENT_BYTES, 65));
  assert.equal(boundary.status, 201); assert.equal((await boundary.json()).attachment.size, MAX_ATTACHMENT_BYTES);
  const valid = [];
  for (const value of ['first', 'second']) valid.push((await (await stage('same.txt', Buffer.from(value))).json()).attachment.id);
  const out = path.join(app.dir, 'custom'); await mkdir(out); await writeFile(path.join(out, 'same.txt'), 'existing');
  const create = ids => app.fetch('/api/tasks', { method: 'POST', headers: app.headers, body: JSON.stringify({ request: '請整理資料附件', outputDir: out, attachmentIds: ids }) });
  assert.equal((await create(Array(11).fill(valid[0]))).status, 400);
  assert.equal((await create(['unknown'])).status, 404);
  const task = (await (await create(valid)).json()).task; await app.settle();
  assert.notEqual(task.attachments[0].file, task.attachments[1].file);
  assert.equal(await readFile(path.join(out, 'same.txt'), 'utf8'), 'existing');
  const url = `/api/tasks/${task.id}/attachment?id=${valid[0]}`;
  assert.equal((await app.fetch(url)).status, 403);
  assert.equal((await app.fetch(url, { headers: { ...app.headers, origin: 'https://evil.invalid' } })).status, 403);
  const download = await app.fetch(url, { headers: app.headers }); assert.equal(await download.text(), 'first');
  const other = (await (await create([])).json()).task; await app.settle();
  assert.equal((await app.fetch(`/api/tasks/${other.id}/attachment?id=${valid[0]}`, { headers: app.headers })).status, 404);
  await rm(path.join(out, task.attachments[0].file));
  await writeFile(path.join(app.dir, 'outside.txt'), 'secret');
  await symlink(path.join(app.dir, 'outside.txt'), path.join(out, task.attachments[0].file));
  assert.equal((await app.fetch(url, { headers: app.headers })).status, 403);
});

test('invalid UTF-8 stays downloadable and reports AI reading failure', async t => {
  const prompts = []; const app = await fixture(t, async options => { prompts.push(options.prompt); return fakeAgent(options); });
  const bytes = Buffer.from([0xff, 0xfe]);
  const staged = (await (await app.fetch('/api/uploads?name=broken.txt', { method: 'POST', headers: app.headers, body: bytes })).json()).attachment;
  const task = (await (await app.fetch('/api/tasks', { method: 'POST', headers: app.headers, body: JSON.stringify({ request: '請讀取這份附件', attachmentIds: [staged.id] }) })).json()).task;
  await app.settle(); assert.match(task.attachments[0].readError, /UTF-8/); assert.match(prompts[0], /讀取失敗/);
  const response = await app.fetch(`/api/tasks/${task.id}/attachment?id=${staged.id}`, { headers: app.headers });
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  await rm(path.join(task.allowedRoots[0], task.attachments[0].file));
  assert.match((await attachmentContext(task)).text, /附件檔已不存在/);
});

test('all eight extensions are case insensitive in backend and picker; size validation is inclusive', async t => {
  const { validateAttachment, ATTACHMENT_EXTENSIONS } = await import('../src/attachments.js');
  const app = await fixture(t), host = new Node('div');
  const context = vm.createContext({ document }); vm.runInContext(ui, context);
  const names = ATTACHMENT_EXTENSIONS.map(ext => `資料${ext.toUpperCase()}`);
  const picker = context.attachmentPicker(host, async file => {
    const response = await app.fetch(`/api/uploads?name=${encodeURIComponent(file.name)}&size=0`, { method: 'POST', headers: { ...app.headers, 'x-file-size': '0' }, body: Buffer.from('content') });
    assert.equal(response.status, 201); return response.json();
  }, async names => ({ id: 'test', results: names.map((name, index) => ({ name, index })) }));
  host.children[1].files = names.map(name => browserFile(name, Buffer.from('content')));
  host.children[1].listeners.change(); assert.equal((await picker.ids()).length, 8);
  for (const ext of ATTACHMENT_EXTENSIONS) {
    assert.equal(validateAttachment(`ok${ext.toUpperCase()}`, 20_000_000), null);
    assert.match(validateAttachment(`ok${ext}`, 20_000_001), /20,000,000/);
    assert.match(validateAttachment(`ok${ext}`, -1), /大小不正確/);
  }
  const exact = await app.fetch('/api/uploads?name=exact.JPG&size=1', { method: 'POST', headers: { ...app.headers, 'x-file-size': '1' }, body: Buffer.alloc(20_000_000) });
  assert.equal(exact.status, 201); assert.equal((await exact.json()).attachment.size, 20_000_000);
  const excess = await app.fetch('/api/uploads?name=excess.PDF&size=1', { method: 'POST', headers: { ...app.headers, 'x-file-size': '1' }, body: Buffer.alloc(20_000_001) });
  assert.equal(excess.status, 413);
});

test('backend batch registration reports every excess file and keeps valid files among first ten', async t => {
  const app = await fixture(t);
  const names = ['good.PDF', 'bad.exe', '../bad.txt', 'large.txt', ...Array.from({ length: 9 }, (_, i) => `${i}.MD`)];
  const post = (url, data) => app.fetch(url, { method: 'POST', headers: app.headers, body: JSON.stringify(data) });
  assert.equal((await app.fetch('/api/uploads/batches', { method: 'POST', headers: { ...app.headers, 'x-csrf-token': 'wrong' }, body: JSON.stringify({ names }) })).status, 403);
  const batch = await (await post('/api/uploads/batches', { names })).json();
  assert.equal(batch.results.length, 13);
  for (const result of batch.results.slice(10)) assert.match(result.reason, /超出每批 10 個/);
  assert.match(batch.results[1].reason, /只支援/); assert.match(batch.results[2].reason, /檔名/);
  const ids = [];
  for (const [index, name] of names.entries()) {
    const response = await app.fetch(`/api/uploads?name=${encodeURIComponent(name)}&batch=${batch.id}&index=${index}`, { method: 'POST', headers: app.headers, body: index === 3 ? Buffer.alloc(20_000_001) : Buffer.from('ok') });
    if (index === 3) { assert.equal(response.status, 413); assert.match((await response.json()).message, /20,000,000/); }
    else if (batch.results[index].reason) {
      assert.equal(response.status, 415); assert.equal((await response.json()).message, batch.results[index].reason);
    } else { assert.equal(response.status, 201); ids.push((await response.json()).attachment.id); }
  }
  assert.equal(ids.length, 7);
  const task = (await (await post('/api/tasks', { request: '批次保存合規檔案', attachmentIds: ids })).json()).task;
  await app.settle(); assert.equal(task.attachments.length, 7);
  for (const item of task.attachments) {
    assert.equal(item.taskId, task.id); assert.equal(await readFile(path.join(task.allowedRoots[0], item.file), 'utf8'), 'ok');
  }
  assert.equal((await post('/api/uploads/batches', { names: 'bad' })).status, 400);
  assert.equal((await post('/api/uploads/batches', { names: [] })).status, 400);
  assert.equal((await post('/api/uploads/batches', { names: ['x'.repeat(40_000)] })).status, 400, '原有 JSON 上限保留');
});

test('picker and backend support multiple batches beyond ten total, retry and idempotent raw transfer', async t => {
  const app = await fixture(t), host = new Node('div'); let fail = true;
  const context = vm.createContext({ document }); vm.runInContext(ui, context);
  const picker = context.attachmentPicker(host, async (file, batch, index) => {
    if (fail && file.name === '0.txt') { fail = false; throw new Error('暫時傳輸失敗'); }
    const response = await app.fetch(`/api/uploads?name=${file.name}&batch=${batch}&index=${index}`, { method: 'POST', headers: app.headers, body: await file.arrayBuffer() });
    assert.equal(response.status, 201); return response.json();
  }, async names => (await app.fetch('/api/uploads/batches', { method: 'POST', headers: app.headers, body: JSON.stringify({ names }) })).json());
  const files = Array.from({ length: 10 }, (_, i) => browserFile(`${i}.txt`, Buffer.from('ok')));
  host.listeners.drop({ preventDefault() {}, dataTransfer: { files } });
  assert.equal((await picker.ids()).length, 9); assert.equal(host.children[3].hidden, false);
  host.children[3].listeners.click(); assert.equal((await picker.ids()).length, 10);
  assert.equal(host.children[3].hidden, true);
  host.children[1].files = [browserFile('next.txt', Buffer.from('next'))]; host.children[1].listeners.change();
  const ids = Array.from(await picker.ids()); assert.equal(ids.length, 11);
  const create = ids => app.fetch('/api/tasks', { method: 'POST', headers: app.headers, body: JSON.stringify({ request: '多批次保存附件資料', attachmentIds: ids }) });
  const task = (await (await create(ids)).json()).task; await app.settle(); assert.equal(task.attachments.length, 11);
  const denied = await create([ids[0]]); assert.equal(denied.status, 409); assert.equal((await denied.json()).code, 'UPLOAD_ALREADY_ASSIGNED');
  const batch = await (await app.fetch('/api/uploads/batches', { method: 'POST', headers: app.headers, body: JSON.stringify({ names: ['retry.txt'] }) })).json();
  const send = bytes => app.fetch(`/api/uploads?name=retry.txt&batch=${batch.id}&index=0`, { method: 'POST', headers: app.headers, body: bytes });
  const first = (await (await send('ok')).json()).attachment;
  const retry = (await (await send('ok')).json()).attachment;
  assert.equal(first.id, retry.id);
  assert.equal((await send('changed')).status, 409);
  const wrong = await app.fetch(`/api/uploads?name=other.txt&batch=${batch.id}&index=0`, { method: 'POST', headers: app.headers, body: 'ok' });
  assert.equal(wrong.status, 404);
});

test('archive failure rolls back new files and reservations; task persistence failure is retryable', async t => {
  const app = await fixture(t);
  const ids = [];
  for (const text of ['first', 'second']) ids.push((await (await app.fetch('/api/uploads?name=same.txt', { method: 'POST', headers: app.headers, body: text })).json()).attachment.id);
  const out = path.join(app.dir, 'retry-folder'); await mkdir(out); await writeFile(path.join(out, 'same.txt'), 'existing');
  const save = app.coach.store.create.bind(app.coach.store); let fail = true;
  app.coach.store.create = async task => { if (fail) { fail = false; throw new Error('模擬任務登記失敗'); } return save(task); };
  const create = () => app.fetch('/api/tasks', { method: 'POST', headers: app.headers, body: JSON.stringify({ request: '驗證建立失敗重試', outputDir: out, attachmentIds: ids }) });
  assert.equal((await create()).status, 400);
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(out), ['same.txt']);
  const response = await create(); assert.equal(response.status, 202);
  const task = (await response.json()).task; await app.settle();
  assert.equal(task.attachments.length, 2); assert.equal(await readFile(path.join(out, 'same.txt'), 'utf8'), 'existing');
  assert.equal(await readFile(path.join(out, task.attachments[0].file), 'utf8'), 'first');
  assert.equal(await readFile(path.join(out, task.attachments[1].file), 'utf8'), 'second');
});

test('tampered staging and symlinks are rejected; failed archive can retry without orphan files', async t => {
  const app = await fixture(t);
  const stage = async name => (await (await app.fetch(`/api/uploads?name=${name}`, { method: 'POST', headers: app.headers, body: 'original' })).json()).attachment;
  const a = await stage('first.txt'), b = await stage('second.txt');
  const root = path.join(app.dir, 'safe'); await mkdir(root);
  const stagedPath = path.join(app.dir, 'vault', 'uploads', b.id);
  await writeFile(stagedPath, 'tampered');
  const archive = () => app.coach.attachments.archive([a.id, b.id], root, 'task-safe', async () => {});
  await assert.rejects(archive, { code: 'UPLOAD_CONTENT_CHANGED' });
  const { readdir } = await import('node:fs/promises'); assert.deepEqual(await readdir(root), []);
  await rm(stagedPath); const outside = path.join(app.dir, 'outside.txt'); await writeFile(outside, 'original'); await symlink(outside, stagedPath);
  await assert.rejects(archive, { code: 'ATTACHMENT_OUTSIDE_TASK' }); assert.deepEqual(await readdir(root), []);
  await rm(stagedPath); await writeFile(stagedPath, 'original');
  const archived = await archive(); assert.equal(archived.length, 2);
  const { readAttachment } = await import('../src/attachments.js');
  await assert.rejects(() => readAttachment({ id: 'other', allowedRoots: [root], attachments: archived }, a.id), { code: 'ATTACHMENT_WRONG_TASK' });
  const traversal = { ...archived[0], taskId: 'task-safe', file: '../outside.txt' };
  await assert.rejects(() => readAttachment({ id: 'task-safe', allowedRoots: [root], attachments: [traversal] }, a.id), { code: 'ATTACHMENT_OUTSIDE_TASK' });
  await rm(path.join(root, archived[0].file)); await symlink(outside, path.join(root, archived[0].file));
  await assert.rejects(() => readAttachment({ id: 'task-safe', allowedRoots: [root], attachments: archived }, a.id), { code: 'ATTACHMENT_OUTSIDE_TASK' });
});

test('staging directory symlink is blocked and batch slot remains retryable', async t => {
  const app = await fixture(t), outside = path.join(app.dir, 'outside'); await mkdir(outside);
  const uploads = path.join(app.dir, 'vault', 'uploads'); await symlink(outside, uploads, 'dir');
  const batch = app.coach.attachments.batch(['safe.txt']);
  const send = () => app.fetch(`/api/uploads?name=safe.txt&batch=${batch.id}&index=0`, { method: 'POST', headers: app.headers, body: 'ok' });
  assert.equal((await send()).status, 403);
  const { readdir } = await import('node:fs/promises'); assert.deepEqual(await readdir(outside), []);
  await rm(uploads); assert.equal((await send()).status, 201);
});

test('concurrent archives cannot claim the same attachment', async t => {
  const app = await fixture(t);
  const staged = (await (await app.fetch('/api/uploads?name=once.txt', { method: 'POST', headers: app.headers, body: 'once' })).json()).attachment;
  const one = path.join(app.dir, 'one'), two = path.join(app.dir, 'two'); await mkdir(one); await mkdir(two);
  let release; const gate = new Promise(resolve => { release = resolve; });
  const first = app.coach.attachments.archive([staged.id], one, 'one', async () => gate);
  await assert.rejects(() => app.coach.attachments.archive([staged.id], two, 'two', async () => {}), { code: 'UPLOAD_ALREADY_ASSIGNED' });
  release(); assert.equal((await first)[0].taskId, 'one');
  const { readdir } = await import('node:fs/promises'); assert.deepEqual(await readdir(two), []);
});

test('picker size and name limits match backend and failed batch registration can retry', async () => {
  const host = new Node('div'); let failed = true; const calls = [];
  const context = vm.createContext({ document }); vm.runInContext(ui, context);
  const picker = context.attachmentPicker(host, async file => { calls.push(file.name); return { attachment: { id: file.name } }; }, async names => {
    if (failed) { failed = false; throw new Error('批次連線中斷'); }
    return { id: 'retry-batch', results: names.map((name, index) => ({ name, index })) };
  });
  host.children[1].files = [{ name: 'exact.PNG', size: 20_000_000 }, { name: 'excess.XLSX', size: 20_000_001 }, { name: '../path.TXT', size: 1 }, { name: 'negative.csv', size: -1 }];
  host.children[1].listeners.change(); assert.equal((await picker.ids()).length, 0);
  let labels = host.children[2].children.map(row => row.textContent).join('\n');
  assert.match(labels, /批次連線中斷/); assert.match(labels, /20,000,000/); assert.match(labels, /檔名格式/); assert.match(labels, /大小不正確/);
  host.children[3].listeners.click(); assert.deepEqual(Array.from(await picker.ids()), ['exact.PNG']);
  assert.deepEqual(calls, ['exact.PNG']);
});

test('replaced output folder symlink is rejected before writing and reservation is retryable', async t => {
  const { rename, readdir } = await import('node:fs/promises');
  const app = await fixture(t), root = path.join(app.dir, 'output'), outside = path.join(app.dir, 'other');
  await mkdir(root); await mkdir(outside);
  const item = (await (await app.fetch('/api/uploads?name=keep.txt', { method: 'POST', headers: app.headers, body: 'keep' })).json()).attachment;
  const original = root + '-original'; await rename(root, original); await symlink(outside, root, 'dir');
  await assert.rejects(() => app.coach.attachments.archive([item.id], root, 'task', async () => {}), { code: 'ATTACHMENT_OUTSIDE_TASK' });
  assert.deepEqual(await readdir(outside), []);
  await rm(root); await rename(original, root);
  assert.equal((await app.coach.attachments.archive([item.id], root, 'task', async () => {})).length, 1);
});
