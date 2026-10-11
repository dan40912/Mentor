import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { TaskError } from './tasks.js';
import { artifactPath } from './artifact-path.js';

const run = promisify(execFile);
const git = (cwd, args) => run('git', args, { cwd, shell: false, timeout: 10000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_LITERAL_PATHSPECS: '1' } });
export async function isGitRoot(cwd) {
  if (!cwd) return false;
  try {
    const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).stdout.replace(/\r?\n$/, '');
    return await realpath(cwd) === await realpath(root);
  } catch { return false; }
}
export async function gitHead(cwd) {
  if (!await isGitRoot(cwd)) return null;
  try { return (await git(cwd, ['rev-parse', '--verify', 'HEAD'])).stdout.trim(); }
  catch { return null; }
}

export async function itemDiff(task, itemId) {
  const item = task.planning?.workItems?.find(item => item.id === itemId);
  if (!item) throw new TaskError(404, 'DIFF_ITEM_MISSING', '找不到這個工作項目。');
  const root = await realpath(task.allowedRoots[0]);
  if (!await isGitRoot(root)) throw new TaskError(409, 'DIFF_NOT_GIT_ROOT', '這個任務的產出資料夾不是 Git 專案，沒有差異可看');
  const baseline = task.gitBaseline || await gitHead(root);
  if (!baseline) throw new TaskError(409, 'DIFF_NO_HEAD', '產出資料夾沒有可比較的 Git HEAD。');
  if (!/^[a-f0-9]{40,64}$/.test(baseline)) throw new TaskError(400, 'DIFF_BASELINE_INVALID', 'Git 基準格式不正確。');
  const files = [...new Set((item.outputs || []).map(output => output.file))];
  for (const file of files) {
    await artifactPath(root, file, true);
    if (file.split('/').includes('.git')) throw new TaskError(403, 'PREVIEW_OUTSIDE_TASK', '不能預覽 Git 內部資料。');
    try { if (!(await stat(path.join(root, file))).isFile()) throw new TaskError(415, 'DIFF_FILE_UNSUPPORTED', '只能比較一般檔案。'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!files.length) return { baseline, files, diff: '', changedFileCount: 0 };
  try {
    let diff = (await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', baseline, '--', ...files])).stdout;
    // 禁用 rename 合併，逐一計算本項登記路徑；NUL 分隔保留特殊檔名。
    const changed = (await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', baseline, '--', ...files])).stdout.split('\0').filter(Boolean);
    let changedFileCount = new Set(changed).size;
    const untracked = (await git(root, ['ls-files', '--others', '-z', '--', ...files])).stdout.split('\0').filter(Boolean);
    const prefix = (await git(root, ['rev-parse', '--show-prefix'])).stdout.replace(/\r?\n$/, '');
    for (const file of untracked) {
      // 從 index 移除的基準檔已由 git diff 呈現，避免再列一次新增內容。
      try { await git(root, ['cat-file', '-e', `${baseline}:${prefix}${file}`]); continue; } catch (error) { if (error.code !== 1 && error.code !== 128) throw error; }
      const resolved = await artifactPath(root, file);
      if ((await stat(resolved)).size > 2 * 1024 * 1024) throw new TaskError(413, 'DIFF_TOO_LARGE', '新增檔超過差異預覽的 2 MiB 上限。');
      const content = await readFile(resolved);
      if (content.length > 2 * 1024 * 1024) throw new TaskError(413, 'DIFF_TOO_LARGE', '新增檔超過差異預覽的 2 MiB 上限。');
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(content); }
      catch { throw new TaskError(415, 'DIFF_FILE_UNSUPPORTED', '新增檔不是有效的 UTF-8。'); }
      changedFileCount++;
      const name = JSON.stringify(file), lines = text ? text.replace(/\n$/, '').split('\n') : [];
      diff += `diff --git ${JSON.stringify(`a/${file}`)} ${JSON.stringify(`b/${file}`)}\nnew file mode 100644\n--- /dev/null\n+++ ${name}\n`;
      if (lines.length) diff += `@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}`).join('\n')}\n${text.endsWith('\n') ? '' : '\\ No newline at end of file\n'}`;
    }
    if (Buffer.byteLength(diff) > 8 * 1024 * 1024) throw new TaskError(413, 'DIFF_TOO_LARGE', '差異超過 8 MiB 預覽上限。');
    return { baseline, files, diff, changedFileCount };
  } catch (error) {
    if (error instanceof TaskError) throw error;
    throw new TaskError(422, 'DIFF_FAILED', '無法讀取 Git 差異，請確認基準 commit 仍存在且差異未超過 8 MiB。');
  }
}
