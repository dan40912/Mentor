import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { requestApp, fakeAgent } from './fixtures/request.js';
import { parseExecution } from '../src/coach.js';
import { localPreviewUrl, normalizeChanges, probePreview } from '../src/review-settings.js';

const preview = { url: 'http://127.0.0.1:4330/', command: 'echo NEVER_EXECUTE > forbidden.txt' };
const changes = [{ where: '搜尋頁', what: '加入搜尋欄', howToCheck: '輸入 Mentor', path: '/search' }];
const report = data => `STATUS: DONE\nFILES: result.html\n證據：result.html\n未完成：無\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\``;

test('old reports and structured metadata have explicit validation', () => {
  const old = parseExecution('STATUS: DONE\nFILES: `result.html`\n未完成：無');
  assert.equal(old.status, 'DONE'); assert.equal(old.parsed, true);
  assert.deepEqual(old.files, ['result.html']); assert.deepEqual(old.changes, []);
  assert.equal(old.preview, undefined); assert.equal(old.metadataError, '');
  const parsed = parseExecution(report({ preview, changes }));
  assert.deepEqual(parsed.preview, preview); assert.deepEqual(parsed.changes, changes);
  assert.deepEqual(parseExecution(report({ changes }), preview).changes, changes);
  assert.deepEqual(normalizeChanges([{ where: '頁', what: '文字', howToCheck: '閱讀' }]), [{ where: '頁', what: '文字', howToCheck: '閱讀' }]);
  for (const data of [{ preview: { url: 'https://example.com', command: '' } }, { changes: {} }, { changes: [{ where: '頁' }] }, { preview, changes: [{ ...changes[0], path: '//evil.test/' }] }]) {
    const invalid = parseExecution(report(data));
    assert.ok(invalid.metadataError); assert.equal(invalid.preview, undefined); assert.deepEqual(invalid.changes, []);
  }
  assert.match(parseExecution('STATUS: DONE\n```json\n{bad}\n```').metadataError, /JSON/);
});

test('local URL and switched path boundaries reject credentials, aliases and external targets', () => {
  for (const url of ['http://localhost:4330/', 'https://127.0.0.1:443/a']) assert.equal(localPreviewUrl(url), new URL(url).href);
  assert.equal(localPreviewUrl('/search', preview.url), 'http://127.0.0.1:4330/search');
  for (const url of ['https://example.com', 'file:///tmp/a', 'ftp://localhost', 'http://user:pw@localhost/', 'http://127.1/', 'http://2130706433/', 'http://localhost.evil/', 'http://[::1]/', '//evil.test', '/\\evil.test', 'https://localhost@evil.test']) {
    assert.throws(() => localPreviewUrl(url, preview.url), { code: 'REVIEW_SETTINGS_INVALID' });
  }
  assert.throws(() => normalizeChanges([{ ...changes[0], path: '../secret' }]), { code: 'REVIEW_SETTINGS_INVALID' });
});

async function setup(t, fetchUrl, timeoutMs = 100, response = { preview, changes }) {
  const root = await mkdtemp(path.join(process.cwd(), '.review-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await requestApp(root, async input => input.mode === 'write' ? { text: report(response), provider: 'codex' } : fakeAgent(input), { previewProbeOptions: { fetchUrl, timeoutMs } });
  const session = await (await app.fetch('/api/session')).json();
  const headers = { cookie: `awc=${session.csrfToken}`, 'x-csrf-token': session.csrfToken, 'idempotency-key': 'review-settings-001' };
  const created = await app.coach.create({ request: '測試預覽設定', profile: 'quick' });
  await app.settle();
  const id = created.task.id;
  let sequence = 0;
  const post = (action, input) => app.fetch(`/api/tasks/${id}/${action}`, { method: 'POST', headers: { ...headers, 'idempotency-key': `review-settings-${++sequence}` }, body: JSON.stringify(input) });
  const get = async () => (await app.coach.store.get(id)).task;
  return { ...app, root, id, headers, post, get };
}

test('card route persists settings through reload and rejects bad input without losing settings', async t => {
  const app = await setup(t, async () => new Response('ok'));
  let task = await app.get();
  const card = { ...task.planning.card, audience: '', deliverable: '', success: [], constraints: [], unknowns: [] };
  let res = await app.post('card', { revision: task.revision, card, preview });
  assert.equal(res.status, 200); assert.deepEqual((await app.get()).preview, preview);
  task = await app.get();
  res = await app.post('card', { revision: task.revision, card, preview: { ...preview, url: 'http://evil.test' } });
  assert.equal(res.status, 400); assert.equal((await res.json()).code, 'REVIEW_SETTINGS_INVALID');
  assert.deepEqual((await app.get()).preview, preview);
  res = await app.post('card', { revision: task.revision, card });
  assert.equal(res.status, 200); assert.deepEqual((await app.get()).preview, preview);
  const reread = await requestApp(app.root);
  assert.deepEqual((await reread.coach.store.get(app.id)).task.preview, preview);
  assert.equal((await app.fetch(`/api/tasks/${app.id}/preview-check`, { headers: app.headers })).status, 200);
  assert.equal((await app.fetch(`/api/tasks/${app.id}/preview-check?path=https%3A%2F%2Fevil.test`, { headers: app.headers })).status, 400);
});

test('execution and fix save metadata, demand changes and reset stale point decisions', async t => {
  const app = await setup(t, async () => new Response('ok'));
  await app.coach.store.mutate(app.id, 'latest', null, task => {
    task.planning.phase = 'execute';
    task.planning.outline = { storyline: '驗收', logic: [], sections: [], imageTotal: 0 };
    task.planning.workItems = [{ id: 'W1', owner: 'ai', title: '搜尋', detail: '', acceptance: [], dependsOn: [], status: 'TODO', attempts: 0 }];
    return {};
  });
  await writeFile(path.join((await app.get()).allowedRoots[0], 'result.html'), '<h1>成果</h1>');
  for (const stage of ['D', 'F']) {
    if (stage === 'F') await app.coach.store.mutate(app.id, 'latest', null, task => {
      Object.assign(task.planning.workItems[0], { status: 'REVIEW_FAIL', changes: [{ ...changes[0], status: 'PASS' }], fixes: ['補搜尋'], gitChangeChecks: [{ where: 'old.txt', baseline: 'a'.repeat(40) }] }); return {};
    });
    const run = stage === 'D' ? await app.coach.execute(app.id, 'W1') : await app.coach.fix(app.id, 'W1');
    await run.done;
    const task = await app.get();
    assert.deepEqual(task.preview, preview); assert.deepEqual(task.planning.workItems[0].changes, changes);
    assert.equal(task.planning.workItems[0].status, 'AWAITING_REVIEW');
    assert.equal(task.planning.workItems[0].gitChangeChecks, undefined);
    const turn = task.planning.learningTurns.at(-1);
    assert.equal(turn.stage, stage); assert.match(turn.prompt, /changes/); assert.match(turn.prompt, /where、what、howToCheck/);
    assert.match(turn.prompt, /command 僅作文字保存/);
  }
  const reread = await requestApp(app.root);
  const restored = (await reread.coach.store.get(app.id)).task;
  assert.deepEqual(restored.preview, preview);
  assert.deepEqual(restored.planning.workItems[0].changes, changes);
  app.coach.runAgent = async () => ({ text: report({ changes: [{ where: '缺欄位' }] }), provider: 'codex' });
  await app.coach.store.mutate(app.id, 'latest', null, task => { task.planning.workItems[0].status = 'REVIEW_FAIL'; return {}; });
  await (await app.coach.fix(app.id, 'W1')).done;
  const invalid = (await app.get()).planning.workItems[0];
  assert.equal(invalid.status, 'BLOCKED'); assert.match(invalid.blocked.reason, /where、what 或 howToCheck/);
  assert.deepEqual(invalid.outputs.map(o => o.file), ['result.html']); assert.deepEqual((await app.get()).preview, preview);
  await assert.rejects(readFile(path.join((await app.get()).allowedRoots[0], 'forbidden.txt')), { code: 'ENOENT' });
});

test('probe route covers responding, refused and timed out requests using controllable transport', async t => {
  for (const [fetchUrl, expected] of [
    [async () => new Response('ok', { status: 404 }), { reachable: true, status: 404 }],
    [async () => { throw new Error('ECONNREFUSED'); }, { reachable: false, reason: 'UNREACHABLE' }],
    [() => new Promise(() => {}), { reachable: false, reason: 'TIMEOUT' }]
  ]) {
    const app = await setup(t, fetchUrl, 10);
    const page=await app.fetch('/');
    const framePolicy=page.headers.get('content-security-policy').split(';').find(p=>p.trim().startsWith('frame-src'));
    assert.equal(framePolicy.trim(),"frame-src 'self' blob: http://localhost:* http://127.0.0.1:* https://localhost:* https://127.0.0.1:*");
    await app.coach.store.mutate(app.id, 'latest', null, task => { task.preview = preview; return {}; });
    const res = await app.fetch(`/api/tasks/${app.id}/preview-check?path=%2Fsearch`, { headers: app.headers });
    assert.equal(res.status, 200);
    const data = await res.json();
    for (const [key, value] of Object.entries(expected)) assert.equal(data[key], value);
    assert.equal(data.command, preview.command); assert.equal(data.url, `${preview.url}search`);
    assert.equal((await app.fetch(`/api/tasks/${app.id}/preview-check`)).status, 403);
  }
});

test('redirects stay local, time out across the whole chain and never contact an external target', async () => {
  const visited = [];
  await assert.rejects(probePreview(preview.url, { fetchUrl: async (url, options) => {
    visited.push(url); assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'https://evil.test' } });
  } }), { code: 'REVIEW_SETTINGS_INVALID' });
  assert.deepEqual(visited, [preview.url]);
  const success = await probePreview(preview.url, { fetchUrl: async url => url.endsWith('/next') ? new Response('ok') : new Response(null, { status: 307, headers: { location: '/next' } }) });
  assert.equal(success.url, `${preview.url}next`); assert.equal(success.reachable, true);
  const loop = await probePreview(preview.url, { fetchUrl: async () => new Response(null, { status: 302, headers: { location: '/' } }) });
  assert.equal(loop.reason, 'TOO_MANY_REDIRECTS');
  let signal;
  const timed = await probePreview(preview.url, { timeoutMs: 10, fetchUrl: async (url, options) => {
    signal = options.signal;
    return url.endsWith('/next') ? new Promise(() => {}) : new Response(null, { status: 302, headers: { location: '/next' } });
  } });
  assert.equal(timed.reason, 'TIMEOUT'); assert.equal(signal.aborted, true);
});

test('card editor sends preview as text in the existing save action', async () => {
  const source = await readFile(new URL('../web/assets/upload.js', import.meta.url), 'utf8');
  new vm.Script(source);
  assert.match(source, /previewUrl','預覽網址/); assert.match(source, /previewCommand','啟動指令/);
  assert.match(source, /preview: \{ url: card.previewUrl, command: card.previewCommand \}/);
});


test('card editor restores saved values and submits the editable preview settings', async () => {
  const source = await readFile(new URL('../web/assets/upload.js', import.meta.url), 'utf8');
  const calls = [], jobs = [];
  const element = tag => ({ tag, children: [], append(...nodes) { this.children.push(...nodes); }, setAttribute() {} });
  const context = vm.createContext({ element, taskAttachmentPicker: () => ({ host: element('aside'), picker: { lock() {}, ids: async () => [], consume() {} } }),
    busy: (button, fn) => () => { const job = fn(); jobs.push(job); return job; }, coachAct: async (...args) => calls.push(args), openTask() {}, tell() {} });
  vm.runInContext(source.slice(source.indexOf('const cardDrafts')), context);
  const task = { id: 'T', preview, planning: { card: { title: '任務', goal: '驗收' } } };
  const form = context.cardEditor(task);
  const areas = form.children.filter(n => n.tag === 'label').map(n => n.children[1]);
  assert.equal(areas[7].value, preview.url); assert.equal(areas[8].value, preview.command);
  areas[7].value = 'http://localhost:4331/'; areas[8].value = 'node app.js';
  form.onsubmit({ preventDefault() {} });
  await Promise.all(jobs);
  assert.equal(calls[0][1], 'card');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][2].preview)), { url: 'http://localhost:4331/', command: 'node app.js' });
});

test('probe route rejects external redirects before contact and never executes the saved command', async t => {
  const visited = [];
  const app = await setup(t, async url => {
    visited.push(url);
    return new Response(null, { status: 302, headers: { location: 'https://evil.test/' } });
  });
  let res = await app.fetch(`/api/tasks/${app.id}/preview-check`, { headers: app.headers });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'PREVIEW_URL_REQUIRED');
  await app.coach.store.mutate(app.id, 'latest', null, task => {
    task.preview = { ...preview, command: `echo NEVER_EXECUTE > "${path.join(app.root, 'forbidden.txt')}"` };
    return {};
  });
  res = await app.fetch(`/api/tasks/${app.id}/preview-check`, { headers: app.headers });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'REVIEW_SETTINGS_INVALID');
  assert.deepEqual(visited, [preview.url]);
  res = await app.fetch(`/api/tasks/${app.id}/preview-check?path=https%3A%2F%2Fevil.test`, { headers: app.headers });
  assert.equal(res.status, 400);
  assert.deepEqual(visited, [preview.url]);
  await assert.rejects(readFile(path.join(app.root, 'forbidden.txt')), { code: 'ENOENT' });
});

test('逐點通過路由保存並還原，保留整項確認門檻，拒絕過期與執行中驗收，修正清除狀態', async t => {
  const app=await setup(t,async()=>new Response('ok'));
  await app.coach.store.mutate(app.id,'latest',null,task=>{
    task.planning.phase='execute';task.planning.outline={version:1,storyline:'驗收',logic:[],sections:[],imageTotal:0};
    task.planning.workItems=[{id:'W1',owner:'ai',title:'搜尋',status:'AWAITING_REVIEW',changes,outputs:[],acceptance:[],dependsOn:[],attempts:0,fixes:[]}];return {};
  });
  let res=await app.post('change-check',{revision:(await app.get()).revision,itemId:'W1',index:0,change:changes[0]});assert.equal(res.status,200);
  const reread=await requestApp(app.root);const item=(await reread.coach.store.get(app.id)).task.planning.workItems[0];
  assert.equal(item.changes[0].status,'PASS');assert.equal(item.status,'AWAITING_REVIEW');
  res=await app.post('confirm',{revision:(await app.get()).revision,itemId:'W1',accept:true});assert.equal(res.status,409);
  res=await app.post('change-check',{revision:(await app.get()).revision,itemId:'W1',index:0,change:{...changes[0],what:'舊版'}});assert.equal(res.status,409);
  await app.coach.store.mutate(app.id,'latest',null,task=>{task.planning.running={stage:'F'};return {};});
  res=await app.post('change-check',{revision:(await app.get()).revision,itemId:'W1',index:0,change:changes[0]});assert.equal(res.status,409);
  await app.coach.store.mutate(app.id,'latest',null,task=>{task.planning.running=null;task.planning.workItems[0].status='REVIEW_FAIL';return {};});
  await writeFile(path.join((await app.get()).allowedRoots[0],'result.html'),'<h1>更新</h1>');
  const note='在哪裡：搜尋頁\n改了什麼：加入搜尋欄\n試試看：輸入 Mentor\n問題：沒有結果';
  res=await app.post('instruct',{revision:(await app.get()).revision,scope:'W1',text:note,confirmImpact:true});assert.equal(res.status,202);
  await app.settle();
  const updated=(await app.get()).planning.workItems[0];
  assert.equal(updated.changes[0].status,undefined);assert.equal(updated.fixes.at(-1),note);assert.equal(updated.status,'AWAITING_REVIEW');
});
