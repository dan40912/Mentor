import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

// 確定性感測器：AI 寫完產出後自動跑，結果只供參考，不擋流程。
const sensor = (id, name, result, detail) => ({ id, name, result, detail });

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
