import { realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { TaskError } from './tasks.js';

export function validateArtifactName(file) {
  if (typeof file !== 'string' || !file || file.includes('\0') || path.isAbsolute(file) || file.split(/[\\/]/).includes('..') || file.includes('\\')) throw new TaskError(400, 'PREVIEW_NAME_INVALID', '成果檔名格式不正確。');
}

export async function artifactPath(root, file, allowDeleted = false) {
  validateArtifactName(file);
  const canonical = await realpath(root), target = path.join(canonical, file);
  let candidate = target;
  for (;;) {
    try {
      const resolved = await realpath(candidate);
      if (resolved !== canonical && !resolved.startsWith(`${canonical}${path.sep}`) || candidate === target && resolved === canonical) throw new TaskError(403, 'PREVIEW_OUTSIDE_TASK', '成果檔超出此任務的產出範圍。');
      return candidate === target ? resolved : target;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!allowDeleted) throw new TaskError(404, 'PREVIEW_MISSING', '成果檔已不存在，請回任務核對檔名與產出。');
      // 缺檔可比較刪除差異，但不能把失效 symlink 當成安全的已刪除檔。
      try { await lstat(candidate); throw new TaskError(403, 'PREVIEW_OUTSIDE_TASK', '成果路徑包含失效的 symlink。'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      candidate = path.dirname(candidate);
    }
  }
}
