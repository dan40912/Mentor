import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, access, realpath, readdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { demoTask } from './fixtures/demo-task.js';
import { serializeTask, buildBrief } from '../src/tasks.js';
import { application } from './helpers/application.js';
import { writeHandoff } from '../src/handoffs.js';

const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf(" const hand=section('交給 AI 接手')"), html.indexOf(' if(t.reports.length)', html.indexOf(" const hand=section('交給 AI 接手')")));
const helpers = ['busy', 'options', 'focusKey'].map(name => html.split('\n').find(line => line.startsWith(`function ${name}(`))).join('\n');
const all = node => [node, ...node.children.flatMap(all)];
function element(tag, textContent = '', className = '') {
  return { tag, textContent, className, children: [], dataset: {}, style: {}, isConnected: true,
    append(...nodes) { this.children.push(...nodes); if (this.tag === 'select' && !this.value) this.value = nodes[0]?.value; },
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }, setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; }, select() { this.selected = true; }, remove() { this.removed = true; },
    querySelector(tag) { return all(this).find(n => n.tag === tag); }
  };
}
function view(task, request, clipboard, execCommand = () => false) {
  const detail = element('div'), dialog = element('dialog'), previews = [], errors = [];
  const context = vm.createContext({ t: task, request, element, section: title => element('section', title), detail, dialog,
    navigator: { clipboard: { writeText: clipboard } }, document: { execCommand },
    queueMicrotask, reportDrafts: {}, tell: text => errors.push(text), download() {}, restoreFocus: null,
    openPreview: (...args) => previews.push(args), act() {}, tasks: [task], reportText: {} });
  vm.runInContext(helpers + '\n' + source, context);
  const find = text => all(detail).find(n => n.textContent === text);
  return { detail, dialog, find, previews, errors };
}

async function setup(t) {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'mentor-handoff-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(path.join(home, 'vault'));
  const task = demoTask('TASK-handoff-test', home);
  task.scope = { allowed: ['修改示範檔'], locked: [{ text: '保留標題', source: '使用者' }], forbidden: ['對外發布'] };
  await writeFile(path.join(home, 'vault', `${task.id}.md`), serializeTask(task));
  const app = await application(home);
  const cookie = (await app.fetch('/')).headers.get('set-cookie').split(';')[0];
  const csrfToken = (await (await app.fetch('/api/settings', { headers: { cookie } })).json()).csrfToken;
  const headers = { cookie, 'x-csrf-token': csrfToken, 'content-type': 'application/json' };
  const post = input => app.fetch(`/api/tasks/${task.id}/handoff-prompt`, { method: 'POST', headers, body: JSON.stringify(input) });
  return { home, task, app, cookie, headers, post };
}

test('planning 按鈕 → 正式 POST → 絕對 MD → 受限預覽；同 revision 覆寫', async t => {
  const { home, task, app, headers, post } = await setup(t);
  const calls = [], copied = [];
  const ui = view(task, async (url, input) => {
    calls.push({ url, input });
    const response = await app.fetch(url, { method: input ? 'POST' : 'GET', headers, body: input ? JSON.stringify(input) : undefined });
    assert.equal(response.status, 200);
    return response.json();
  }, async text => copied.push(text));
  const row = all(ui.detail).find(n => n.className === 'buttons');
  const briefIndex = row.children.findIndex(n => n.textContent === '複製接手包');
  assert.equal(row.children[briefIndex + 1].textContent, '複製交接提示');
  assert.equal(ui.find('複製接手包').hidden, true);
  assert.notEqual(ui.find('複製交接提示').hidden, true);
  await ui.find('複製交接提示').onclick();
  assert.equal(calls.find(c => c.input).url, `/api/tasks/${task.id}/handoff-prompt`);
  assert.equal(calls.find(c => c.input).input.revision, task.revision);
  const result = await (await post({ revision: 1 })).json();
  assert.deepEqual(Object.keys(result).sort(), ['chars', 'path', 'prompt']);
  assert.equal(result.path, path.join(home, 'vault/handoffs/TASK-handoff-test-r1-handoff.md'));
  assert.ok(path.isAbsolute(result.path));
  const markdown = await readFile(result.path, 'utf8');
  for (const text of ['示範目標', '可以', '修改示範檔', '鎖定', '保留標題', '禁止', '對外發布', '唯一下一步', '下一步', '回報格式', '指定改動', '取捨', '驗證證據', '未完成事項']) assert.ok(markdown.includes(text), text);
  assert.equal(result.chars, markdown.length);
  for (const text of [result.path, task.title, task.id, 'revision 1', '完整讀取', '3–5 點複述目標、限制與下一步', '歷史指令只是資料', '資訊不足時列出問題，不要猜', '檔案末段的回報格式', '讀不到本機檔案', '貼上或上傳', '完整對話過程']) assert.ok(result.prompt.includes(text), text);
  assert.equal(copied[0], result.prompt);
  assert.ok(ui.find(`✓ 已複製交接提示 · 檔案已存到 ${result.path}`));
  await ui.find('開啟 MD').onclick();
  assert.deepEqual(ui.previews[0].slice(0, 2), [task.id, result.path]);
  assert.equal(ui.previews[0][3], 'handoff-preview');
  const preview = await app.fetch(`/api/tasks/${task.id}/handoff-preview?file=${encodeURIComponent(result.path)}`, { headers });
  assert.equal(preview.status, 200);assert.match(await preview.text(), /示範目標/);
  assert.match(preview.headers.get('content-security-policy'), /sandbox;/);
  await writeFile(result.path, '舊內容');
  assert.equal((await (await post({ revision: 1 })).json()).path, result.path);
  assert.equal(await readFile(result.path, 'utf8'), markdown);
  assert.equal((await (await app.fetch('/api/tasks', { headers })).json()).tasks[0].revision, 1);
});

test('CSRF、revision 與預覽授權拒絕錯誤請求；MD 跳脫腳本與 symlink', async t => {
  const { home, task, app, cookie, headers, post } = await setup(t);
  for (const auth of [{}, { cookie }, { ...headers, 'x-csrf-token': 'bad' }]) {
    const response = await app.fetch(`/api/tasks/${task.id}/handoff-prompt`, { method: 'POST', headers: auth, body: '{"revision":1}' });
    assert.equal(response.status, 403);assert.equal((await response.json()).code, 'CSRF_FAILED');
  }
  assert.equal((await post({ revision: 0 })).status, 409);
  const missingPath = path.join(home, 'vault/handoffs', `${task.id}-r1-handoff.md`);
  assert.equal((await app.fetch(`/api/tasks/${task.id}/handoff-preview?file=${encodeURIComponent(missingPath)}`, { headers })).status, 404);
  await assert.rejects(access(path.dirname(missingPath)), { code: 'ENOENT' });
  const result = await (await post({ revision: 1 })).json();
  const preview = file => app.fetch(`/api/tasks/${task.id}/handoff-preview?file=${encodeURIComponent(file)}`, { headers });
  for (const file of [path.join(home, 'vault/secret.md'), result.path.replace(task.id, 'TASK-other'), '../secret.md']) assert.equal((await preview(file)).status, 404);
  assert.equal((await app.fetch(`/api/tasks/${task.id}/handoff-preview?file=${encodeURIComponent(result.path)}`)).status, 403);
  await writeFile(result.path, '<script>secret()</script>');
  assert.match(await (await preview(result.path)).text(), /&lt;script&gt;/);
  await rm(result.path);await symlink(path.join(home, 'vault', `${task.id}.md`), result.path);
  assert.equal((await preview(result.path)).status, 403);
});

test('舊複製接手包保持 buildBrief 行為；新提示沿用剪貼簿退路', async t => {
  const { task, post } = await setup(t);
  delete task.planning;
  const copied = [];
  const ui = view(task, async (url, input) => input ? (await post(input)).json() : buildBrief(task, 'codex'), async text => copied.push(text));
  assert.notEqual(ui.find('複製接手包').hidden, true);
  await new Promise(resolve => setImmediate(resolve));
  await ui.find('複製接手包').onclick();
  assert.ok(copied[0].startsWith('# 接手包：'));assert.match(copied[0], /接手者: codex/);
  const failed = view(task, async (url, input) => input ? (await post(input)).json() : buildBrief(task, 'codex'), async () => { throw new Error('denied'); });
  await failed.find('複製交接提示').onclick();
  const fallback = all(failed.detail).find(n => n.tag === 'details' && n.children[0].textContent === '手動複製交接提示');
  assert.equal(fallback.open, true);assert.equal(fallback.hidden, false);assert.match(fallback.children[1].textContent, /完整讀取本地檔案/);
  assert.notEqual(failed.find('開啟 MD').hidden, true);
});

test('交接按鈕請求與複製期間防重按，API 失敗清除舊成功狀態並恢復按鈕', async () => {
  const result = { path: '/workspace/vault/handoffs/TASK-demo-0001-r1-handoff.md', prompt: '完整提示' };
  let resolveRequest, rejectRequest, resolveCopy, calls = 0, copies = 0;
  const ui = view(demoTask(), async (url, input) => {
    if (!input) return {};
    calls++;
    return new Promise((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject; });
  }, () => { copies++; return new Promise(resolve => { resolveCopy = resolve; }); });
  const button = ui.find('複製交接提示'), open = ui.find('開啟 MD');
  const status = all(ui.detail).find(n => n.role === 'status');
  const pending = button.onclick();
  assert.equal(button.disabled, true);
  assert.equal(button['aria-busy'], 'true');
  assert.equal(button.textContent, '處理中…');
  assert.equal(status.textContent, '正在保存交接檔與複製提示…');
  await button.onclick();
  assert.equal(calls, 1);
  resolveRequest(result);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(button.disabled, true);
  await button.onclick();
  assert.equal(calls, 1);
  resolveCopy();await pending;
  assert.equal(status.textContent, `✓ 已複製交接提示 · 檔案已存到 ${result.path}`);
  assert.equal(open.hidden, false);
  assert.equal(button.disabled, false);
  assert.equal(button['aria-busy'], undefined);
  assert.equal(button.textContent, '複製交接提示');
  const failing = button.onclick();
  assert.equal(open.hidden, true);
  assert.equal(open.onclick, null);
  rejectRequest(new Error('任務版本已更新'));
  await failing;
  assert.equal(status.textContent, '未完成：任務版本已更新');
  assert.doesNotMatch(status.textContent, /✓|已複製/);
  assert.equal(copies, 1);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, '複製交接提示');
  assert.deepEqual(ui.errors, ['未完成：任務版本已更新']);
});

test('交接提示沿用 writeClipboard：execCommand 成功或兩種方式失敗均清理暫存元素', async () => {
  const result = { path: '/workspace/vault/handoffs/TASK-demo-0001-r1-handoff.md', prompt: '完整讀取\n' + '很長的提示 & <文字>\n'.repeat(10000) };
  for (const mode of ['success', 'false', 'throw']) {
    const attempts = [];
    const ui = view(demoTask(), async (url, input) => input ? result : {}, async text => {
      attempts.push(['clipboard', text]);throw new Error('denied');
    }, command => {
      attempts.push(['execCommand', command]);
      if (mode === 'throw') throw new Error('copy unavailable');
      return mode === 'success';
    });
    await ui.find('複製交接提示').onclick();
    assert.deepEqual(attempts, [['clipboard', result.prompt], ['execCommand', 'copy']]);
    const area = ui.dialog.children.find(n => n.tag === 'textarea');
    assert.equal(area.value, result.prompt);
    assert.equal(area.selected, true);
    assert.equal(area.removed, true);
    const fallback = all(ui.detail).find(n => n.tag === 'details' && n.children[0].textContent === '手動複製交接提示');
    const status = all(ui.detail).find(n => n.role === 'status');
    assert.equal(fallback.children[1].textContent, result.prompt);
    assert.equal(fallback.hidden, mode === 'success');
    if (mode === 'success') assert.equal(status.textContent, `✓ 已複製交接提示 · 檔案已存到 ${result.path}`);
    else {
      assert.equal(fallback.open, true);
      assert.equal(status.textContent, `無法寫入剪貼簿，請從下方手動複製交接提示 · 檔案已存到 ${result.path}`);
    }
    assert.equal(ui.find('開啟 MD').hidden, false);
    assert.equal(ui.find('複製交接提示').disabled, false);
    assert.deepEqual(ui.errors, []);
  }
});

test('交接預覽拒絕另一任務已產生的檔案、越界及舊 revision，HTML 字元安全跳脫', async t => {
  const { home, task, app, headers, post } = await setup(t);
  const first = await (await post({ revision: 1 })).json();
  const other = demoTask('TASK-other', home);
  await writeFile(path.join(home, 'vault', `${other.id}.md`), serializeTask(other));
  const second = await (await app.fetch(`/api/tasks/${other.id}/handoff-prompt`, { method: 'POST', headers, body: '{"revision":1}' })).json();
  const preview = (id, file) => app.fetch(`/api/tasks/${id}/handoff-preview?file=${encodeURIComponent(file)}`, { headers });
  assert.equal((await preview(task.id, second.path)).status, 404);
  assert.equal((await preview(other.id, first.path)).status, 404);
  const outside = path.join(home, 'outside.md');
  await writeFile(outside, '不可公開');
  for (const file of [outside, '../outside.md', path.join(home, 'vault', `${task.id}.md`)]) {
    const response = await preview(task.id, file);
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /不可公開/);
  }
  await writeFile(first.path, '# & <script>alert("x")</script>');
  const response = await preview(task.id, first.path);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /&amp; &lt;script&gt;alert\("x"\)&lt;\/script&gt;/);
  assert.doesNotMatch(text, /<script>/);
  assert.doesNotMatch(response.headers.get('content-security-policy'), /allow-scripts|allow-same-origin/);
  await writeFile(path.join(home, 'vault', `${task.id}.md`), serializeTask({ ...task, revision: 2 }));
  assert.equal((await preview(task.id, first.path)).status, 404);
});

test('超大交接完整保存，預覽回傳 413 與本地路徑且不改檔案', async t => {
  const { home, task, app, headers, post } = await setup(t);
  task.goal = '超大公開內容' + 'a'.repeat(5 * 1024 * 1024) + '\n最後一行完整保留';
  await writeFile(path.join(home, 'vault', `${task.id}.md`), serializeTask(task));
  const response = await post({ revision: 1 });
  assert.equal(response.status, 200);
  const result = await response.json();
  const before = await readFile(result.path, 'utf8');
  assert.ok(before.includes(task.goal));
  assert.equal(result.chars, before.length);
  const preview = await app.fetch(`/api/tasks/${task.id}/handoff-preview?file=${encodeURIComponent(result.path)}`, { headers });
  assert.equal(preview.status, 413);
  const error = await preview.json();
  assert.equal(error.code, 'PREVIEW_TOO_LARGE');
  assert.ok(error.message.includes(result.path));
  assert.match(error.message, /超過預覽上限/);
  assert.equal(await readFile(result.path, 'utf8'), before);
});

test('交接 API 保留 revision 與任務原檔；相同 revision 以新內容原子覆寫', async t => {
  const { home, task, post } = await setup(t);
  const taskFile = path.join(home, 'vault', `${task.id}.md`);
  const before = await readFile(taskFile, 'utf8');
  const first = await (await post({ revision: 1 })).json();
  const original = await readFile(first.path, 'utf8');
  assert.equal(await readFile(taskFile, 'utf8'), before);
  await mkdir(path.join(home, 'vault/events'));
  await writeFile(path.join(home, 'vault/events', `${task.id}.jsonl`), JSON.stringify({
    type: 'HUMAN_REPLY', at: '2026-10-11T12:00:00Z', text: '新增公開回答 😀'
  }) + '\n');
  const response = await post({ revision: 1 });
  assert.equal(response.status, 200);
  const second = await response.json();
  const saved = await readFile(second.path, 'utf8');
  assert.equal(second.path, first.path);
  assert.notEqual(saved, original);
  assert.match(saved, /新增公開回答 😀/);
  assert.equal(second.chars, saved.length);
  assert.equal(await readFile(taskFile, 'utf8'), before);
  assert.deepEqual(await readdir(path.dirname(second.path)), [path.basename(second.path)]);
  for (const revision of [0, 2, '1', null, undefined]) {
    const stale = await post({ revision });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, 'REVISION_CONFLICT');
    assert.equal(await readFile(second.path, 'utf8'), saved);
  }
  await writeFile(taskFile, serializeTask({ ...task, revision: 2 }));
  const stale = await post({ revision: 1 });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).revision, 2);
  assert.equal(await readFile(second.path, 'utf8'), saved);
  await assert.rejects(access(second.path.replace('-r1-', '-r2-')), { code: 'ENOENT' });
});

test('交接 API 拒絕無效 session、CSRF、來源與非法 ID，拒絕時不建立檔案', async t => {
  const { home, task, app, headers, post } = await setup(t);
  const url = `/api/tasks/${task.id}/handoff-prompt`;
  for (const extra of [
    { cookie: '' }, { cookie: 'awc=wrong' }, { 'x-csrf-token': '' }, { 'x-csrf-token': 'wrong' },
    { origin: 'https://example.invalid' }, { host: 'example.invalid' }, { 'sec-fetch-site': 'cross-site' }
  ]) {
    const response = await app.fetch(url, { method: 'POST', headers: { ...headers, ...extra }, body: '{"revision":1}' });
    assert.equal(response.status, 403);
    await assert.rejects(access(path.join(home, 'vault/handoffs')), { code: 'ENOENT' });
  }
  for (const id of ['invalid', 'TASK-..', 'TASK-%2e%2e%2foutside', 'TASK-%2foutside', 'TASK-missing']) {
    const response = await app.fetch(`/api/tasks/${id}/handoff-prompt`, { method: 'POST', headers, body: '{"revision":1}' });
    assert.equal(response.status, 404);
    await assert.rejects(access(path.join(home, 'vault/handoffs')), { code: 'ENOENT' });
  }
  assert.equal((await post({ revision: 1 })).status, 200);
});

test('交接寫入拒絕越界目錄與 symlink（含斷鏈），保留目標內容', async t => {
  const { home, task, post } = await setup(t);
  const dir = path.join(home, 'vault/handoffs');
  const outside = path.join(home, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'sentinel.md'), '保留');
  await symlink(outside, dir);
  let response = await post({ revision: 1 });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'HANDOFF_OUTSIDE');
  assert.deepEqual(await readdir(outside), ['sentinel.md']);
  await rm(dir);
  await mkdir(dir);
  const file = path.join(dir, `${task.id}-r1-handoff.md`);
  for (const target of [path.join(outside, 'sentinel.md'), path.join(outside, 'missing.md')]) {
    await symlink(target, file);
    assert.equal((await post({ revision: 1 })).status, 403);
    assert.ok((await lstat(file)).isSymbolicLink());
    assert.equal(await readFile(path.join(outside, 'sentinel.md'), 'utf8'), '保留');
    assert.deepEqual(await readdir(dir), [path.basename(file)]);
    await rm(file);
  }
  await mkdir(file);
  assert.equal((await post({ revision: 1 })).status, 415);
  await rm(file, { recursive: true });
  await rm(dir, { recursive: true });
  for (const invalid of [{ id: '../outside' }, { revision: 0 }, { revision: Number.MAX_SAFE_INTEGER + 1 }]) {
    await assert.rejects(writeHandoff(home, { ...task, ...invalid }), { status: 400, code: 'HANDOFF_INVALID' });
  }
  await assert.rejects(access(dir), { code: 'ENOENT' });
  // vault 指向工作區內的另一個目錄也不接受，寫入位置固定為實體 vault。
  await rm(path.join(home, 'vault'), { recursive: true });
  await symlink(outside, path.join(home, 'vault'));
  await assert.rejects(writeHandoff(home, task), { status: 403, code: 'HANDOFF_OUTSIDE' });
  assert.deepEqual(await readdir(outside), ['sentinel.md']);
});
