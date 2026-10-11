import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateRawSync, deflateSync } from 'node:zlib';
import { extract, ExtractError } from '../src/extract.js';
import { attachmentContext, ATTACHMENT_CHARS } from '../src/attachments.js';
import { buildArgs } from '../src/agents.js';

const fixture = name => readFile(new URL(`./fixtures/attachments/${name}`, import.meta.url));
// 測試用的最小 ZIP 產生器（crc 填 0，讀取端不檢查）。
function zip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), data = deflateRawSync(raw), n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data); centrals.push(central, n); offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
const workbook = prefix => {
  const p = prefix ? 'x:' : '';
  return zip({
    'xl/workbook.xml': `<${p}workbook><${p}sheets><${p}sheet name="營收" sheetId="1" r:id="rId1"/><${p}sheet name="空白" sheetId="2" r:id="rId2"/></${p}sheets></${p}workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<${p}sst><${p}si><${p}t>季度</${p}t></${p}si><${p}si><${p}r><${p}t>營</${p}t></${p}r><${p}r><${p}t>收 &amp; 成長</${p}t></${p}r></${p}si></${p}sst>`,
    'xl/worksheets/sheet1.xml': `<${p}worksheet><${p}sheetData><${p}row r="1"><${p}c r="A1" t="s"><${p}v>0</${p}v></${p}c><${p}c r="C1" t="s"><${p}v>1</${p}v></${p}c></${p}row><${p}row r="2"><${p}c r="A2" t="inlineStr"><${p}is><${p}t>Q1</${p}t></${p}is></${p}c><${p}c r="C2"><${p}v>12.5</${p}v></${p}c></${p}row></${p}sheetData></${p}worksheet>`,
    'xl/worksheets/sheet2.xml': `<${p}worksheet><${p}sheetData/></${p}worksheet>`
  });
};

test('DOCX and PDF made by real macOS tools come back as the original text', async () => {
  assert.equal(extract('.docx', await fixture('brief.docx')).text, '新品簡報重點\n第一季營收成長 12%\nMentor 附件測試 ABC');
  assert.equal(extract('.pdf', await fixture('brief.pdf')).text, '## 第 1 頁\n新品簡報重點\n第一季營收成長 12%\nMentor 附件測試 ABC');
});

test('XLSX keeps sheet names, column positions and shared strings, with or without x: prefixes', () => {
  for (const prefix of [false, true]) assert.equal(extract('.xlsx', workbook(prefix)).text, '## 工作表：營收\n季度\t\t營收 & 成長\nQ1\t\t12.5\n\n## 工作表：空白\n', `prefix ${prefix}`);
});

test('a hand-built PDF with a compressed CID font and ToUnicode map is decoded', () => {
  const cmap = 'begincmap\n1 begincodespacerange <0000> <FFFF> endcodespacerange\n2 beginbfchar <0001> <4E2D> <0002> <6587> endbfchar\n1 beginbfrange <0010> <0012> <0041> endbfrange\nendcmap';
  const content = deflateSync(Buffer.from('BT /F1 12 Tf 1 0 0 1 72 700 Tm <00010002> Tj 0 -20 Td [<0010> -300 <00110012>] TJ ET'));
  const objs = [
    '<< /Type /Page /Resources << /Font << /F1 3 0 R >> >> /Contents 2 0 R >>',
    null,
    '<< /Type /Font /Subtype /Type0 /ToUnicode 4 0 R >>',
    null
  ];
  let pdf = '%PDF-1.7\n';
  pdf += `1 0 obj\n${objs[0]}\nendobj\n`;
  pdf += `2 0 obj\n<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n${content.toString('latin1')}\nendstream\nendobj\n`;
  pdf += `3 0 obj\n${objs[2]}\nendobj\n`;
  pdf += `4 0 obj\n<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream\nendobj\n%%EOF`;
  assert.equal(extract('.pdf', Buffer.from(pdf, 'latin1')).text, '## 第 1 頁\n中文\nA BC');
});

test('unreadable files explain why instead of passing garbage to the AI', async () => {
  const cases = [
    ['.pdf', Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page /Contents 2 0 R >>\nendobj\n2 0 obj\n<< /Length 8 >>\nstream\nq 1 0 0 1 0 0 cm Q\nendstream\nendobj\n'), /沒有可擷取的文字層/],
    ['.pdf', Buffer.from('%PDF-1.4\n/Encrypt 5 0 R'), /加密/],
    ['.pdf', Buffer.from('hello'), /不是有效的 PDF/],
    ['.docx', Buffer.from('not a zip at all, just text'), /找不到 ZIP 目錄/],
    ['.docx', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), /密碼保護/],
    ['.xlsx', zip({ 'docProps/app.xml': '<x/>' }), /找不到活頁簿/],
    ['.txt', Buffer.from([0xa4, 0xa4, 0xa4, 0xe5]), /UTF-8/],
    ['.png', Buffer.from('not really a png'), /副檔名不符/]
  ];
  for (const [ext, buffer, reason] of cases) assert.throws(() => extract(ext, buffer), error => error instanceof ExtractError && reason.test(error.message), `${ext} ${reason}`);
  assert.deepEqual(extract('.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), { image: true });
});

test('prompt context caps long attachments and routes images by provider and mode', async () => {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'awc-extract-')));
  await writeFile(path.join(dir, 'long.txt'), 'x'.repeat(ATTACHMENT_CHARS + 500));
  await writeFile(path.join(dir, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]));
  const task = { id: 'TASK-1', allowedRoots: [dir], attachments: [{ id: 'a', name: '長.txt', file: 'long.txt', taskId: 'TASK-1' }, { id: 'b', name: '圖.png', file: 'pic.png', taskId: 'TASK-1' }] };
  const codex = await attachmentContext(task, { provider: 'codex', mode: 'chat' });
  assert.match(codex.text, /已截斷：全文 40500 字/);
  assert.deepEqual(codex.images, [path.join(dir, 'pic.png')]);
  assert.match(codex.text, /圖片已直接附在這次對話中/);
  const claudeChat = await attachmentContext(task, { provider: 'claude', mode: 'chat' });
  assert.deepEqual(claudeChat.images, []);
  assert.match(claudeChat.text, /看不到圖片內容；不要猜測/);
  assert.match((await attachmentContext(task, { provider: 'claude', mode: 'read' })).text, /請用讀檔工具開啟/);
  const args = buildArgs({ provider: 'codex', mode: 'read', cwd: dir, outputFile: '/tmp/o', images: ['/a.png', '/b.jpg'] });
  assert.deepEqual(args.slice(-3), ['--image=/a.png', '--image=/b.jpg', '-'], '圖片用 = 寫法，最後仍是 stdin 的 -');
});

test('a reply whose root object closes one brace early is merged back; other broken JSON stays rejected', async () => {
  const { extractJson } = await import('../src/agents.js');
  const early = '```json\n{"card":{"title":"主管新品簡報"},"coaching":"c","diary":{"interpretations":["x"]}},"learning":{"change":"y","question":"含 } 與 \\" 的字"}}\n```';
  assert.deepEqual(extractJson(early), { card: { title: '主管新品簡報' }, coaching: 'c', diary: { interpretations: ['x'] }, learning: { change: 'y', question: '含 } 與 " 的字' } });
  assert.equal(extractJson('```json\n{"a":1}} trailing\n```'), null);
  assert.equal(extractJson('```json\n{"a":1},"b":\n```'), null);
});
