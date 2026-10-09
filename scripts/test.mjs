// 跨平台、跨 Node 版本的測試入口：自己列出檔案，不靠 shell glob（Windows cmd 與 Node 20 都不支援）。
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests');
const files = readdirSync(dir).filter(f => f.endsWith('.test.js')).sort().map(f => path.join(dir, f));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
