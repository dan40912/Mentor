import { TaskError } from './tasks.js';

const invalid = message => new TaskError(400, 'REVIEW_SETTINGS_INVALID', message);

export function localPreviewUrl(value, base) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000 || /[\\\s\x00-\x1f]/.test(value)) throw invalid('預覽網址格式不正確。');
  // 檢查原始 authority，避免 URL 正規化將 127.1、十進位 IP 等別名放行。
  const absolute = /^[a-z][a-z\d+.-]*:/i.test(value);
  if (absolute && !/^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?(?:[/?#]|$)/i.test(value)) throw invalid('預覽只允許 HTTP／HTTPS 的 localhost 或 127.0.0.1，且不可含帳密。');
  if (!absolute && (!base || value.startsWith('//'))) throw invalid('切換路徑不可指向外部網址。');
  let url;
  try { url = new URL(value, base); } catch { throw invalid('預覽網址格式不正確。'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password) throw invalid('預覽網址超出本機範圍。');
  return url.href;
}

export function normalizePreview(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.url !== 'string' || typeof value.command !== 'string' || value.command.length > 6000 || value.command.includes('\0')) throw invalid('preview 必須包含文字 url 與 command；啟動指令僅供複製。');
  return { url: value.url.trim() ? localPreviewUrl(value.url.trim()) : '', command: value.command };
}

export function normalizeChanges(value, preview) {
  if (!Array.isArray(value) || value.length > 100) throw invalid('changes 必須是陣列，最多 100 點。');
  return value.map((change, index) => {
    if (!change || ['where', 'what', 'howToCheck'].some(k => typeof change[k] !== 'string' || !change[k].trim() || change[k].length > 6000)) throw invalid(`changes 第 ${index + 1} 點缺少有效的 where、what 或 howToCheck。`);
    const result = Object.fromEntries(['where', 'what', 'howToCheck'].map(k => [k, change[k].trim()]));
    if (change.path !== undefined) {
      if (typeof change.path !== 'string' || !change.path || change.path.length > 2000 || /[\\\s\x00-\x1f]/.test(change.path) || change.path.split('/').includes('..')) throw invalid(`changes 第 ${index + 1} 點的 path 無效。`);
      if (preview?.url || /^[a-z][a-z\d+.-]*:|^\/\//i.test(change.path)) localPreviewUrl(change.path, preview?.url);
      else if (change.path.startsWith('/')) throw invalid('檔案 path 必須是相對路徑。');
      result.path = change.path;
    }
    return result;
  });
}

export async function probePreview(value, { fetchUrl = globalThis.fetch, timeoutMs = 2000 } = {}) {
  let url = localPreviewUrl(value);
  const controller = new AbortController();
  let timer;
  const run = async () => {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const response = await fetchUrl(url, { redirect: 'manual', signal: controller.signal });
      response.body?.cancel().catch(() => {});
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) return { reachable: false, reason: 'REDIRECT_INVALID', url };
        url = localPreviewUrl(location, url);
        continue;
      }
      return { reachable: true, status: response.status, url };
    }
    return { reachable: false, reason: 'TOO_MANY_REDIRECTS', url };
  };
  try {
    return await Promise.race([run(), new Promise(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve({ reachable: false, reason: 'TIMEOUT', url }); }, timeoutMs);
    })]);
  } catch (error) {
    if (error instanceof TaskError) throw error;
    return { reachable: false, reason: 'UNREACHABLE', url };
  } finally { clearTimeout(timer); }
}
