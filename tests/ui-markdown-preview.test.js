import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { previewArtifact } from '../src/server.js';

const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const ctx = vm.createContext({ Blob });
vm.runInContext(script.slice(script.indexOf('function escapeMarkdown('), script.indexOf('let previewMarkdown=')), ctx);
const render = text => ctx.renderMarkdown(text);

test('標題、段落、粗體與相鄰區塊不需要空白行', () => {
  assert.equal(render('# 大標\n段落 **重點**\n第二行\n## 小標\n\n另一段'),
    '<h1>大標</h1><p>段落 <strong>重點</strong><br>第二行</p><h2>小標</h2><p>另一段</p>');
  assert.equal(render('###### 六級\r\n\r\n文字'), '<h6>六級</h6><p>文字</p>');
});

test('單層有序、無序清單及下一段落', () => {
  assert.equal(render('- **甲**\n+ 乙\n* 丙\n3. 三\n4) 四\n\n段落'),
    '<ul><li><strong>甲</strong></li><li>乙</li><li>丙</li></ul><ol start="3"><li>三</li><li>四</li></ol><p>段落</p>');
});

test('表格有欄名、資料列與行內轉換，無效分隔列保持文字', () => {
  assert.equal(render('| 欄位 | 值 |\n| :--- | ---: |\n| **名稱** | [文件](https://example.com) |\n\n段落'),
    '<table><thead><tr><th>欄位</th><th>值</th></tr></thead><tbody><tr><td><strong>名稱</strong></td><td><a href="https://example.com" target="_blank" rel="noopener noreferrer">文件</a></td></tr></tbody></table><p>段落</p>');
  assert.match(render('甲 | 乙\n--- | ---\n一 | 二'), /<td>一<\/td><td>二<\/td>/);
  assert.doesNotMatch(render('| 甲 | 乙 |\n| -- | --- |'), /<table>/);
});

test('程式碼區塊保留空白、換行與 Markdown 記號，跳脫 HTML', () => {
  const code = '  <script>alert("x")</script> & **粗體**\n[連結](javascript:alert)\n\n';
  assert.equal(render('```js\n'+code+'```'), '<pre><code>'+ctx.escapeMarkdown(code)+'</code></pre>');
  assert.equal(render('~~~~\n```\n# 文字\n~~~~'), '<pre><code>```\n# 文字\n</code></pre>');
  assert.equal(render('```\n未關閉'), '<pre><code>未關閉</code></pre>');
  assert.equal(render('```\n未關閉\n'), '<pre><code>未關閉\n</code></pre>');
  assert.equal(render('```\n未關閉\n\n'), '<pre><code>未關閉\n\n</code></pre>');
});

test('HTML、script、引號與實體不能生成可執行標籤或屬性', async () => {
  const raw = '<img src=x onerror="alert(1)"> <script>alert(1)</script> &lt;b&gt;';
  for (const source of [false, true]) {
    const output = ctx.markdownPreviewBody(raw, source);
    assert.match(output, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
    assert.match(output, /&lt;script&gt;/);
    assert.match(output, /&amp;lt;b&amp;gt;/);
    assert.doesNotMatch(output, /<script|<img|allow-scripts|script-src/);
    assert.doesNotMatch(output, /<iframe/);
  }
  assert.equal(render('[<b>](https://example.com/"onmouseover="x)'), '<p><a href="https://example.com/&quot;onmouseover=&quot;x" target="_blank" rel="noopener noreferrer">&lt;b&gt;</a></p>');
});

test('連結只接受明確允許的協定，拒絕危險協定與混淆寫法', () => {
  for (const url of ['https://example.com?a=1&b=2', 'HTTP://example.com', 'mailto:pm@example.com']) {
    assert.match(render(`[文件](${url})`), /<a href=/);
  }
  for (const url of ['javascript:alert', 'JaVaScRiPt:alert', 'data:text/html,evil', 'vbscript:evil', 'file:///etc/passwd', 'blob:evil', '//example.com', '/relative', 'javascript&#58;alert', 'java\tscript:alert', 'java\nscript:alert', 'java\u0000script:alert']) {
    assert.doesNotMatch(render(`[文件](${url})`), /<a\b/, url);
  }
});

test('沿用真實後端 pre 格式、精確還原原文，登記與越界檢查仍有效（免監聽）', async () => {
  const root = await mkdtemp(path.join(process.cwd(), '.markdown-preview-test.'));
  try {
    const dir = path.join(root, 'custom-worktree');await mkdir(dir, { recursive: true });
    const raw = '# 標題\r\n\r\n<script> &lt; &#39; & "原文"\r\n';
    await writeFile(path.join(dir, 'readme.md'), raw);
    await writeFile(path.join(root, 'outside.md'), '外部');
    await writeFile(path.join(dir, 'unregistered.md'), '存在但未登記');
    await symlink(path.join(root, 'outside.md'), path.join(dir, 'escape.md'));
    const tasks = { get: async () => ({ task: { allowedRoots: [dir], planning: { workItems: [{ outputs: [{file:'readme.md'}, {file:'escape.md'}] }] } } }) };
    const preview = await previewArtifact(tasks, root, 'task-1', 'readme.md');
    assert.equal(preview.html, false);
    const text = ctx.markdownPreviewText(preview.content.toString());
    assert.equal(text, raw);
    const source = ctx.markdownPreviewBody(text, true);
    assert.equal(source.split('<pre>\n')[1].split('</pre>')[0], ctx.escapeMarkdown(raw));
    assert.match(ctx.markdownPreviewBody(text, false), /<h1>標題<\/h1>/);
    await assert.rejects(previewArtifact(tasks, root, 'task-1', 'unregistered.md'), { code: 'PREVIEW_NOT_REGISTERED' });
    await assert.rejects(previewArtifact(tasks, root, 'task-1', path.join(root, 'outside.md')), { code: 'PREVIEW_NAME_INVALID' });
    await assert.rejects(previewArtifact(tasks, root, 'task-1', '../outside.md'), { code: 'PREVIEW_NAME_INVALID' });
    await assert.rejects(previewArtifact(tasks, root, 'task-1', 'escape.md'), { code: 'PREVIEW_OUTSIDE_TASK' });
    assert.throws(() => ctx.markdownPreviewText('<p>非預期格式</p>'), /格式不正確/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('原始碼保留開頭空行，補償 HTML pre 吃掉第一個換行的規則', async () => {
  for (const raw of ['\n\n# 標題\n', '\r\n# 標題\r\n', '', '一般原文']) {
    const output = ctx.markdownPreviewBody(raw, true);
    assert.equal(output.split('<pre>')[1].split('</pre>')[0], '\n'+ctx.escapeMarkdown(raw));
  }
});

test('package.json 維持零 runtime 套件與原本啟動入口，不載入外部前端資源', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(pkg.dependencies || {}, {});
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts.start, 'node src/server.js');
  assert.equal(pkg.scripts.test, 'node scripts/test.mjs');
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);
});


test('Markdown 只產生白名單標籤，連結屬性無事件或樣式注入', () => {
  const output = render('# 標題\n**重點** <svg onload="alert(1)">\n\n- [連結](https://example.com/"onclick="evil)\n\n```\n<iframe src=x>\n```');
  for (const tag of output.matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi)) {
    assert.ok(['h1','p','strong','br','ul','li','a','pre','code'].includes(tag[1]), tag[0]);
    assert.doesNotMatch(tag[0], /\s(?:on\w+|style|src)\s*=/i);
  }
  assert.match(output, /target="_blank" rel="noopener noreferrer"/);
});

test('以第一個根目錄的 realpath 為邊界：根目錄別名與內部 symlink 可讀，前綴相似的相鄰目錄拒絕（免監聽）', async t => {
  const root = await mkdtemp(path.join(process.cwd(), '.markdown-preview-test.'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'workspace'), sibling = path.join(root, 'workspace-extra'), alias = path.join(root, 'alias');
  await mkdir(path.join(dir, 'nested'), { recursive: true });await mkdir(sibling);
  await writeFile(path.join(dir, 'nested', 'readme.md'), '# 巢狀成果');
  await writeFile(path.join(sibling, 'outside.md'), '相鄰資料夾');
  await symlink(dir, alias);
  await symlink(path.join(dir, 'nested', 'readme.md'), path.join(dir, 'internal.md'));
  await symlink(path.join(sibling, 'outside.md'), path.join(dir, 'escape.md'));
  const tasks = { get: async () => ({ task: { allowedRoots: [alias, sibling], planning: { workItems: [{ outputs: ['nested/readme.md', 'internal.md', 'escape.md'].map(file => ({ file })) }] } } }) };
  for (const file of ['nested/readme.md', 'internal.md']) {
    assert.equal(ctx.markdownPreviewText((await previewArtifact(tasks, root, 'task-1', file)).content.toString()), '# 巢狀成果');
  }
  await assert.rejects(previewArtifact(tasks, root, 'task-1', 'escape.md'), { code: 'PREVIEW_OUTSIDE_TASK' });
});

test('所有 Markdown 區塊僅輸出完整白名單與允許屬性，危險連結保持文字', () => {
  const input = [
    ...Array.from({ length: 6 }, (_, i) => '#'.repeat(i + 1) + ' 標題'),
    '段落 **粗體**\n第二行 <details open ontoggle="evil()"><svg onload="evil()">',
    '- 項目\n\n2. 有序',
    '| 欄名 | 欄名 |\n| --- | --- |\n| [安全](https://example.com/"onfocus="evil) | 值 |',
    '```\n</code><script>evil()</script>\n```',
    '[HTTP](http://example.com) [HTTPS](https://example.com) [郵件](mailto:pm@example.com)',
    '[危險](javascript:evil) [資料](data:text/html,evil) [實體](javascript&#58;evil)'
  ].join('\n\n');
  const output = render(input);
  const allowed = new Set(['h1','h2','h3','h4','h5','h6','p','br','strong','ul','ol','li','table','thead','tbody','tr','th','td','pre','code','a']);
  const seen = new Set();let links = 0;
  for (const match of output.matchAll(/<(\/?)([a-z][a-z0-9]*)([^>]*)>/gi)) {
    const [, closing, tag, attributes] = match;
    assert.ok(allowed.has(tag), match[0]);seen.add(tag);
    if (closing) { assert.equal(attributes, '');continue; }
    // 先把引號內值移除，再檢查屬性名，避免把 href 內跳脫的文字誤當屬性。
    const names = [...attributes.matchAll(/\s([\w-]+)="[^"]*"/g)].map(m => m[1]);
    const rest = attributes.replace(/\s[\w-]+="[^"]*"/g, '').trim();
    assert.equal(rest, '', match[0]);
    if (tag === 'a') {
      links++;assert.deepEqual(names, ['href','target','rel']);
      assert.match(attributes, /^ href="(?:https?:\/\/|mailto:)[^"]*" target="_blank" rel="noopener noreferrer"$/);
    } else if (tag === 'ol') assert.deepEqual(names, ['start']);
    else assert.deepEqual(names, []);
    assert.ok(names.every(name => !/^on/i.test(name)));
  }
  assert.deepEqual([...seen].sort(), [...allowed].sort());assert.equal(links, 4);
});
