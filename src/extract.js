import { inflateRawSync, inflateSync } from 'node:zlib';

// 附件轉文字給 AI 讀。只用 Node 內建模組，不加套件；讀不出來就回報原因，不把亂碼當成內容。
export class ExtractError extends Error {}

const MAX_UNZIPPED = 60_000_000;

// 最小 ZIP 讀取：DOCX、XLSX 都是 ZIP。只支援 stored 與 deflate，解壓總量設上限防 zip bomb。
export function unzip(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ExtractError('檔案不是有效的 Office 文件（找不到 ZIP 目錄），可能已損毀。');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16), total = 0;
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new ExtractError('Office 文件的 ZIP 目錄損毀。');
    const flags = buffer.readUInt16LE(offset + 8), method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20), size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28), extra = buffer.readUInt16LE(offset + 30), comment = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extra + comment;
    if (flags & 1) throw new ExtractError('文件有密碼保護，無法讀取內容。');
    if (buffer.readUInt32LE(local) !== 0x04034b50) throw new ExtractError('Office 文件的 ZIP 內容損毀。');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    total += size;
    if (total > MAX_UNZIPPED) throw new ExtractError('文件解壓後太大，無法讀取。');
    files.set(name, () => {
      const raw = buffer.subarray(start, start + compressed);
      if (method === 0) return raw;
      if (method === 8) return inflateRawSync(raw, { maxOutputLength: MAX_UNZIPPED });
      throw new ExtractError(`不支援的壓縮方式（${method}）。`);
    });
  }
  return files;
}

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const xmlText = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : entities[e] ?? m);
const read = (files, name) => { const get = files.get(name); return get ? get().toString('utf8') : null; };
// 有些工具（例如 .NET 的 Open XML SDK）會寫成 <x:sheet>；去掉元素前綴後再用同一套規則讀。屬性前綴（r:id）保留。
const readSheetXml = (files, name) => read(files, name)?.replace(/<(\/?)[A-Za-z][\w.-]*:/g, '<$1') ?? null;

// Office 加密檔是 OLE 容器，不是 ZIP。
const isOle = buffer => buffer.length > 8 && buffer.readUInt32LE(0) === 0xe011cfd0 && buffer.readUInt32LE(4) === 0xe11ab1a1;

export function docxText(buffer) {
  if (isOle(buffer)) throw new ExtractError('文件有密碼保護或是舊版 .doc 格式，無法讀取內容。');
  const xml = read(unzip(buffer), 'word/document.xml');
  if (xml === null) throw new ExtractError('找不到 Word 內文（word/document.xml），檔案可能不是 DOCX。');
  return xml
    .replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:tc>/g, '\t').replace(/<\/w:p>/g, '\n')
    .replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g, (m, t) => `\u0000${t}\u0001`)
    .replace(/<[^>]+>/g, '')
    .replace(/\u0000([\s\S]*?)\u0001/g, (m, t) => xmlText(t))
    .replace(/\t+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const columnIndex = ref => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const tagText = xml => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => xmlText(m[1])).join('');

export function xlsxText(buffer) {
  if (isOle(buffer)) throw new ExtractError('試算表有密碼保護或是舊版 .xls 格式，無法讀取內容。');
  const files = unzip(buffer);
  const workbook = readSheetXml(files, 'xl/workbook.xml');
  if (workbook === null) throw new ExtractError('找不到活頁簿（xl/workbook.xml），檔案可能不是 XLSX。');
  const shared = [...(readSheetXml(files, 'xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => tagText(m[1]));
  const rels = new Map([...(read(files, 'xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b[^>]*>/g)].map(m => [m[0].match(/Id="([^"]+)"/)?.[1], m[0].match(/Target="([^"]+)"/)?.[1]]));
  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = xmlText(m[0].match(/name="([^"]*)"/)?.[1] || '');
    const target = rels.get(m[0].match(/r:id="([^"]+)"/)?.[1]);
    if (!target) continue;
    const xml = readSheetXml(files, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    if (xml === null) continue;
    const rows = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = c[1].match(/r="([A-Z]+\d+)"/)?.[1], type = c[1].match(/t="(\w+)"/)?.[1], body = c[2] || '';
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const value = type === 's' ? shared[Number(v)] ?? '' : type === 'inlineStr' ? tagText(body) : type === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : xmlText(v ?? '');
        cells[ref ? columnIndex(ref) : cells.length] = value;
      }
      if (cells.some(x => x !== undefined && x !== '')) rows.push(Array.from(cells, x => x ?? '').join('\t'));
    }
    sheets.push(`## 工作表：${name}\n${rows.join('\n')}`);
  }
  if (!sheets.length) throw new ExtractError('活頁簿裡沒有可讀的工作表。');
  return sheets.join('\n\n');
}

// ---- PDF：盡力擷取文字層。支援 FlateDecode、物件串流與 ToUnicode 對照（中文 PDF 多半靠它）。掃描檔沒有文字層。
function pdfString(s, i) { // s[i] === '('
  let depth = 1, out = [];
  for (i++; i < s.length && depth; i++) {
    const ch = s[i];
    if (ch === '\\') {
      const n = s[++i];
      if (/[0-7]/.test(n)) { let oct = n; while (oct.length < 3 && /[0-7]/.test(s[i + 1])) oct += s[++i]; out.push(parseInt(oct, 8) & 255); }
      else if (n === '\r') { if (s[i + 1] === '\n') i++; }
      else if (n !== '\n') out.push(({ n: 10, r: 13, t: 9, b: 8, f: 12 })[n] ?? n.charCodeAt(0));
    } else if (ch === '(') { depth++; out.push(40); }
    else if (ch === ')') { if (--depth) out.push(41); }
    else out.push(ch.charCodeAt(0) & 255);
  }
  return [Buffer.from(out), i];
}
const hexBytes = h => { h = h.replace(/[^0-9a-f]/gi, ''); if (h.length % 2) h += '0'; return Buffer.from(h, 'hex'); };

function parseCmap(text) {
  const map = new Map(); let width = 1;
  const code = h => { width = Math.max(width, h.length / 2); return parseInt(h, 16); };
  const uni = h => { const b = hexBytes(h); let s = ''; for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b.readUInt16BE(i)); return s; };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) map.set(code(m[1]), uni(m[2]));
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) for (const m of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(<[0-9a-f]+>|\[[^\]]*\])/gi)) {
    const lo = code(m[1]), hi = parseInt(m[2], 16);
    if (hi - lo > 65_535) continue;
    if (m[3].startsWith('[')) [...m[3].matchAll(/<([0-9a-f]+)>/gi)].forEach((d, k) => map.set(lo + k, uni(d[1])));
    else { const base = uni(m[3].slice(1, -1)); for (let c = lo; c <= hi; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + c - lo)); }
  }
  return { map, width };
}

export function pdfText(buffer) {
  const raw = buffer.toString('latin1');
  if (!raw.startsWith('%PDF')) throw new ExtractError('檔案不是有效的 PDF。');
  if (/\/Encrypt\s/.test(raw)) throw new ExtractError('PDF 有加密保護，無法讀取內容。');
  // 先把所有物件（含物件串流裡的）攤平成 編號 → { dict, stream }。
  const objects = new Map();
  const decode = (dict, data) => {
    if (/\/Filter\s*\/FlateDecode|\/Filter\s*\[\s*\/FlateDecode\s*\]/.test(dict)) { try { return inflateSync(data, { maxOutputLength: MAX_UNZIPPED }); } catch { return null; } }
    return /\/Filter/.test(dict) ? null : data;
  };
  for (const m of raw.matchAll(/(\d+)\s+\d+\s+obj\b([\s\S]*?)endobj/g)) {
    const body = m[2], at = body.search(/\bstream\r?\n/);
    if (at < 0) { objects.set(Number(m[1]), { dict: body, stream: null }); continue; }
    const dict = body.slice(0, at), begin = body.indexOf('\n', at) + 1;
    const length = Number(dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/)?.[1]);
    const end = Number.isFinite(length) && length > 0 && length <= body.length - begin ? begin + length : body.lastIndexOf('endstream');
    const data = Buffer.from(body.slice(begin, end), 'latin1');
    objects.set(Number(m[1]), { dict, stream: decode(dict, data) });
  }
  for (const [, obj] of [...objects]) if (/\/Type\s*\/ObjStm/.test(obj.dict) && obj.stream) {
    const s = obj.stream.toString('latin1'), first = Number(obj.dict.match(/\/First\s+(\d+)/)?.[1]);
    const head = s.slice(0, first).trim().split(/\s+/).map(Number);
    for (let k = 0; k < head.length; k += 2) objects.set(head[k], { dict: s.slice(first + head[k + 1], k + 3 < head.length ? first + head[k + 3] : undefined), stream: null });
  }
  const ref = (dict, key) => Number(dict.match(new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`))?.[1]);
  // 字型名稱 → ToUnicode 對照。同名字型在不同頁可能不同，取第一個找到的，夠應付大多數文件。
  const fonts = new Map();
  for (const [, obj] of objects) {
    const block = obj.dict.match(/\/Font\s*<<([\s\S]*?)>>/)?.[1] ?? (/\/Font\s+(\d+)\s+\d+\s+R/.test(obj.dict) ? objects.get(ref(obj.dict, 'Font'))?.dict : null);
    if (!block) continue;
    for (const f of block.matchAll(/\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
      if (fonts.has(f[1])) continue;
      const font = objects.get(Number(f[2]));
      const cmap = font && objects.get(ref(font.dict, 'ToUnicode'))?.stream;
      fonts.set(f[1], cmap ? parseCmap(cmap.toString('latin1')) : null);
    }
  }
  const show = (bytes, font) => {
    if (!font) return bytes.toString('latin1');
    let out = '';
    for (let i = 0; i < bytes.length; i += font.width) {
      const c = font.width === 2 ? (bytes[i] << 8) | (bytes[i + 1] ?? 0) : bytes[i];
      out += font.map.get(c) ?? (font.width === 1 ? String.fromCharCode(c) : '');
    }
    return out;
  };
  const pages = [];
  for (const [, obj] of objects) {
    if (!/\/Type\s*\/Page\b/.test(obj.dict)) continue;
    const contents = obj.dict.match(/\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/)?.[1] || '';
    const streams = [...contents.matchAll(/(\d+)\s+\d+\s+R/g)].map(m => objects.get(Number(m[1]))?.stream).filter(Boolean);
    const s = Buffer.concat(streams).toString('latin1');
    // 只在垂直位置改變時換行：同一行常被拆成好幾段各自定位。
    let text = '', font = null, operands = [], y = 0, shownY = null;
    const put = str => { if (shownY !== null && Math.abs(y - shownY) > 1) text += '\n'; shownY = y; text += str; };
    for (let i = 0; i < s.length;) {
      const ch = s[i];
      if (ch === '(') { const [b, j] = pdfString(s, i); operands.push(b); i = j; continue; }
      if (ch === '<' && s[i + 1] !== '<') { const j = s.indexOf('>', i); operands.push(hexBytes(s.slice(i + 1, j))); i = j + 1; continue; }
      if (ch === '[') { operands.push('['); i++; continue; }
      if (ch === ']') { const k = operands.lastIndexOf('['); const arr = operands.splice(k); arr.shift(); operands.push(arr); i++; continue; }
      if (ch === '/') { const m = /^\/([^\s/<>\[\]()]+)/.exec(s.slice(i, i + 128)); operands.push({ name: m?.[1] }); i += (m?.[0].length || 1); continue; }
      if (/\s/.test(ch)) { i++; continue; }
      const m = /^[^\s/<>\[\]()]+/.exec(s.slice(i, i + 64));
      if (!m) { i++; continue; } // <<、>>、{ } 這類內容標記與文字無關
      const word = m[0]; i += word.length;
      if (/^[-+.\d]/.test(word)) { operands.push(Number(word)); continue; }
      if (word === 'Tf') font = fonts.get(operands.find(o => o?.name)?.name) || null;
      else if (word === 'Tj' || word === "'" || word === '"') { if (word !== 'Tj') y -= 1000; const b = operands.filter(Buffer.isBuffer).at(-1); if (b) put(show(b, font)); }
      else if (word === 'TJ') { let str = ''; for (const part of operands.at(-1) || []) { if (Buffer.isBuffer(part)) str += show(part, font); else if (part < -200) str += ' '; } put(str); }
      else if (word === 'T*') y -= 1000;
      else if (word === 'Td' || word === 'TD') y += Number(operands.at(-1)) || 0;
      else if (word === 'Tm') y = Number(operands.at(-1)) || 0;
      operands = [];
    }
    // 康熙部首與 CJK 部首補充區轉回一般漢字（PDF 字型的 ToUnicode 常對到這裡）。
    text = text.replace(/[\u2e80-\u2fdf]/g, ch => ch.normalize('NFKC'));
    pages.push(text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
  }
  const all = pages.map((p, k) => `## 第 ${k + 1} 頁\n${p}`).join('\n\n');
  const meaningful = pages.join('').replace(/[\s\x00-\x1f]/g, '');
  // 控制字元、替代字元、私用區超過 5% 就當成字型沒有對照表，讀到的是字形編號，不是文字。
  const visible = pages.join('').replace(/[\t\n\r ]/g, '');
  const garbage = (visible.match(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffd\ue000-\uf8ff]/g) || []).length;
  if (!meaningful.length || garbage / visible.length > 0.05) throw new ExtractError('PDF 沒有可擷取的文字層（可能是掃描檔或特殊字型）。原檔已保存，可讓有讀檔工具的 AI 直接開啟。');
  return all;
}

const TEXT_TYPES = ['.txt', '.md', '.csv'];
export const IMAGE_TYPES = ['.png', '.jpg'];

// 回傳 { text } 或 { image: true }；讀不出來丟 ExtractError。
export function extract(ext, buffer) {
  if (TEXT_TYPES.includes(ext)) {
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '') }; }
    catch { throw new ExtractError('文字不是有效的 UTF-8（可能是 Big5），AI 無法讀取；請另存成 UTF-8。原檔可下載。'); }
  }
  if (ext === '.docx') return { text: docxText(buffer) };
  if (ext === '.xlsx') return { text: xlsxText(buffer) };
  if (ext === '.pdf') return { text: pdfText(buffer) };
  if (IMAGE_TYPES.includes(ext)) {
    const png = buffer.length > 8 && buffer.readUInt32BE(0) === 0x89504e47, jpg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8;
    if ((ext === '.png' && !png) || (ext === '.jpg' && !jpg)) throw new ExtractError('圖片檔內容和副檔名不符，可能已損毀。');
    return { image: true };
  }
  throw new ExtractError('不支援的格式。');
}
