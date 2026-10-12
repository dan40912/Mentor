import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { parseTestCommand } from './test-command.js';

// 確定性感測器：AI 寫完產出後自動跑，結果只供參考，不擋流程。
const sensor = (id, name, result, detail) => ({ id, name, result, detail });

export const TEST_TIMEOUT_MS = 600000;
export const TEST_OUTPUT_BYTES = 64 * 1024;

export async function testCommandSensor(command, outDir, { executeFile = execFile } = {}) {
  const base = { command: command ?? '', cwd: outDir, timeoutMs: TEST_TIMEOUT_MS };
  if (command === undefined || command === null || (typeof command === 'string' && !command.trim())) return { ...sensor('test-command', '任務測試', 'SKIP', '未設定測試指令，未執行測試。'), ...base, output: '', summary: '', failedTests: [] };
  let args;
  try { args = parseTestCommand(command); }
  catch (error) { return { ...sensor('test-command', '任務測試', 'FAIL', error.message), ...base, output: '', summary: '', failedTests: [], reason: error.message }; }
  let tail = Buffer.alloc(0), truncated = false;
  const failedTests = new Set();
  const streams = Object.fromEntries(['stdout', 'stderr'].map(name => [name, { decoder: new StringDecoder('utf8'), pending: '' }]));
  const scan = line => {
    const name = line.match(/^\s*(?:not ok\s+\d+\s*-?\s*|[✖×]\s+)(.+?)(?:\s+\([\d.]+\s*m?s\))?\s*$/)?.[1];
    if (name && failedTests.size < 100) failedTests.add(name.slice(0, 500));
  };
  const collect = (name, chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    truncated ||= tail.length + bytes.length > TEST_OUTPUT_BYTES;
    tail = Buffer.concat([tail, bytes.subarray(-TEST_OUTPUT_BYTES)]).subarray(-TEST_OUTPUT_BYTES);
    const stream = streams[name];
    const lines = (stream.pending + stream.decoder.write(bytes)).split('\n');
    stream.pending = lines.pop().slice(-TEST_OUTPUT_BYTES);
    for (const line of lines) scan(line.replace(/\x1b\[[0-9;]*m/g, ''));
  };
  const outcome = await new Promise(resolve => {
    try {
      // 輸出超量時只截斷保存的尾段，不讓 maxBuffer 提早終止測試。
      const child = executeFile(args[0], args.slice(1), { cwd: outDir, timeout: TEST_TIMEOUT_MS, shell: false, maxBuffer: Infinity });
      child.stdout?.on('data', chunk => collect('stdout', chunk));
      child.stderr?.on('data', chunk => collect('stderr', chunk));
      child.once('error', error => resolve({ reason: `無法啟動測試：${error.message}`, exitCode: null }));
      child.once('close', (exitCode, signal) => resolve({ exitCode, signal, reason: child.killed && signal ? '測試逾時（10 分鐘）。' : signal ? `測試被訊號 ${signal} 終止。` : exitCode ? `測試退出碼：${exitCode}` : '' }));
    } catch (error) { resolve({ reason: `無法啟動測試：${error.message}`, exitCode: null }); }
  });
  for (const stream of Object.values(streams)) scan(stream.pending + stream.decoder.end());
  let output = tail.toString('utf8');
  while (Buffer.byteLength(output) > TEST_OUTPUT_BYTES) output = output.slice(1);
  const summary = output.trimEnd().split('\n').slice(-50).join('\n');
  const passed = outcome.exitCode === 0 && !outcome.reason;
  const names = [...failedTests];
  const detail = [passed ? '測試通過。' : outcome.reason || '測試失敗。',
    !passed ? names.length ? `失敗測試：${names.join('、')}` : '失敗測試名稱：無法辨識，請核對輸出尾段。' : '',
    truncated ? '輸出已截斷，保存最後 64 KiB。' : '', summary].filter(Boolean).join('\n');
  return { ...sensor('test-command', '任務測試', passed ? 'PASS' : 'FAIL', detail), ...base, ...outcome, output, summary, failedTests: names, truncated };
}

export function outlineSensors(outline) {
  // 只把「沒寫」或以「無依據」開頭的視為缺依據；引用裡出現「待補表」之類字詞不算
  const missing = (outline.sections || []).filter(s => !String(s.evidence || '').trim() || /^(無依據|待補|不確定|-)/.test(String(s.evidence).trim()));
  const counted = (outline.sections || []).reduce((sum, s) => sum + (Number(s.visual?.count) || 0), 0);
  return [
    sensor('claim-sources', '每段都有依據', missing.length ? 'FAIL' : 'PASS',
      missing.length ? `沒有依據的段落：${missing.map(s => `${s.no}. ${s.title}`).join('、')}` : `${outline.sections?.length || 0} 段都寫了依據`),
    sensor('image-total', '圖片總數與各段加總一致', counted === Number(outline.imageTotal ?? 0) ? 'PASS' : 'FAIL',
      `各段加總 ${counted} 張，imageTotal 寫 ${outline.imageTotal ?? 0} 張`)
  ];
}

export async function outputSensors(outDir, item, outline) {
  const results = [];
  const files = [];
  for (const output of item.outputs || []) {
    try {
      const full = path.join(outDir, output.file);
      const info = await stat(full);
      files.push({ ...output, full, size: info.size });
    } catch {}
  }
  const empty = files.filter(f => f.size === 0);
  results.push(sensor('outputs-exist', '產出檔案存在且有內容', files.length && !empty.length ? 'PASS' : 'FAIL',
    !files.length ? 'AI 沒有回報任何在產出資料夾內的檔案' : empty.length ? `空檔案：${empty.map(f => f.file).join('、')}` : `${files.length} 個檔案：${files.map(f => f.file).join('、')}`));
  const html = files.filter(f => /\.html?$/i.test(f.file) && f.size < 30_000_000);
  if (html.length && outline) {
    const text = (await Promise.all(html.map(f => readFile(f.full, 'utf8')))).join('\n');
    const visuals = (text.match(/<(img|svg|canvas|figure)\b/gi) || []).length;
    const planned = Number(outline.imageTotal ?? 0);
    if (planned && !item.skeleton) results.push(sensor('visual-count', '圖片與圖表數量符合計畫', visuals >= planned ? 'PASS' : 'FAIL', `HTML 內有 ${visuals} 個圖像元素，計畫規劃 ${planned} 張`));
    const plain = text.replace(/<[^>]+>/g, ' ');
    const absent = (outline.sections || []).filter(s => s.title && !plain.includes(s.title));
    if (!item.skeleton) results.push(sensor('upstream-coverage', '計畫每段都有出現', absent.length ? 'FAIL' : 'PASS',
      absent.length ? `找不到段落標題：${absent.map(s => `${s.no}. ${s.title}`).join('、')}` : `${outline.sections?.length || 0} 段標題都在 HTML 裡`));
  }
  return results;
}
