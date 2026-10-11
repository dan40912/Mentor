import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { previewArtifact } from '../src/server.js';

const extensions = ['txt','log','csv','json','js','mjs','cjs','ts','css','yml','yaml','sh','py'];
const raw = '\n台灣 PM & <script>alert(1)</script><img src=x onerror="evil()"> &lt;b&gt; "引號"\n';
const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

async function fixture(t) {
  const root = await mkdtemp(path.join(process.cwd(), '.text-preview-test.'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'worktree');await mkdir(dir);
  const files = [];
  const tasks = { get: async () => ({ task: { allowedRoots: [dir], planning: { workItems: [{ outputs: files.map(file => ({ file })) }] } } }) };
  const add = async (file, content) => { files.push(file);await writeFile(path.join(dir, file), content); };
  return { root, dir, tasks, files, add, preview: file => previewArtifact(tasks, root, 'task-1', file) };
}

for (const ext of extensions) {
  test(`.${ext}：真實後端到前端純文字預覽，特殊字元不成為標籤（免監聽）`, async t => {
    const f = await fixture(t);await f.add(`result.${ext}`, raw);
    const result = await f.preview(`result.${ext}`);
    assert.equal(result.mime, 'text/plain; charset=utf-8');assert.equal(result.html, false);
    assert.equal(result.content.toString(), raw);
    const button = () => ({ hidden: false, setAttribute() {}, focus() {} });
    const source = button(), desktop = button(), mobile = button();
    const modes = { querySelectorAll: () => [desktop, mobile], querySelector: selector => selector.includes('desktop') ? desktop : mobile };
    const content = { classList: { remove() {} }, replaceChildren(node) { this.node = node; } };
    const status = {}, dialog = { open: false, showModal() { this.open = true; }, querySelector: button };
    const nodes = { '#preview-dialog': dialog, '#preview-content': content, '#preview-status': status, '#preview-title': {}, '#preview-modes': modes, '#preview-source': source };
    const ctx = vm.createContext({
      $: selector => nodes[selector],
      element: (tag, _, className) => ({ tag, className,
        set innerHTML(value) { assert.fail('文字原文不可送進 HTML parser'); },
        setAttribute() {} }),
      fetch: async () => ({ ok: true, text: async () => result.content.toString() }),
      refreshSession: async () => {}, previewReturn: null, previewBlob: null,
      URL: { createObjectURL() { assert.fail('文字預覽不可建立 blob iframe'); } }
    });
    vm.runInContext(script.slice(script.indexOf('let previewMarkdown='), script.indexOf('// 行內表單取代 prompt()')), ctx);
    await ctx.openPreview('task-1', `result.${ext}`, {});
    assert.equal(status.textContent, '');assert.equal(content.node.tag, 'pre');
    assert.equal(content.node.className, 'text-preview');assert.equal(content.node.textContent, raw);
    assert.equal(content.node.tabIndex, 0);assert.equal(modes.hidden, true);assert.equal(source.hidden, true);
  });
}

test('所有文字副檔名：2 MiB 邊界接受，多 1 byte 拒絕，無效 UTF-8 拒絕（免監聽）', async t => {
  const f = await fixture(t), limit = 2 * 1024 * 1024;
  // 使用多位元 UTF-8，確認上限計算的是 bytes。
  const exact = Buffer.from('台'.repeat(Math.floor(limit / 3)) + 'aa');
  assert.equal(exact.length, limit);
  for (const ext of extensions) {
    const file = `limit.${ext}`;await f.add(file, exact);
    assert.equal((await f.preview(file)).content.length, limit);
    await writeFile(path.join(f.dir, file), Buffer.concat([exact, Buffer.from('a')]));
    await assert.rejects(f.preview(file), { code: 'PREVIEW_TOO_LARGE', status: 413 });
    for (const invalid of [Buffer.from([0xc3, 0x28]), Buffer.from([0xe5, 0x8f]), Buffer.from([0xff])]) {
      await writeFile(path.join(f.dir, file), invalid);
      await assert.rejects(f.preview(file), { code: 'PREVIEW_TYPE_UNSUPPORTED', status: 415 });
    }
  }
});

test('文字預覽仍需登記，拒絕絕對路徑、..、symlink 越界與非一般檔案（免監聽）', async t => {
  const f = await fixture(t);await f.add('good.TXT', raw);
  assert.equal((await f.preview('good.TXT')).content.toString(), raw);
  await writeFile(path.join(f.dir, 'unregistered.txt'), raw);
  await writeFile(path.join(f.root, 'outside.txt'), raw);
  await symlink(path.join(f.root, 'outside.txt'), path.join(f.dir, 'escape.txt'));f.files.push('escape.txt');
  await symlink(path.join(f.dir, 'good.TXT'), path.join(f.dir, 'internal.txt'));f.files.push('internal.txt');
  assert.equal((await f.preview('internal.txt')).content.toString(), raw);
  await mkdir(path.join(f.dir, 'directory.txt'));f.files.push('directory.txt', 'missing.txt');
  for (const file of [path.join(f.root, 'outside.txt'), '../outside.txt', 'nested/../../outside.txt', '..\\outside.txt', 'bad\0.txt', '']) {
    await assert.rejects(f.preview(file), { code: 'PREVIEW_NAME_INVALID' });
  }
  for (const [file, code] of [['unregistered.txt','PREVIEW_NOT_REGISTERED'], ['escape.txt','PREVIEW_OUTSIDE_TASK'], ['directory.txt','PREVIEW_TYPE_UNSUPPORTED'], ['missing.txt','PREVIEW_MISSING']]) {
    await assert.rejects(f.preview(file), { code });
  }
});

test('專案成果入口包含全部文字副檔名，純文字區塊可捲動', async () => {
  const project = await readFile(new URL('../web/assets/project.js', import.meta.url), 'utf8');
  const filter = project.match(/filter\(file=>(\/.*?\/i)\.test\(file\)\)/)[1];
  const accepts = vm.runInNewContext(filter);
  for (const ext of extensions) assert.ok(accepts.test(`result.${ext}`), ext);
  assert.equal(accepts.test('secret.svg'), false);
  assert.match(html, /\.text-preview\{[^}]*overflow:auto[^}]*white-space:pre-wrap/);
});
