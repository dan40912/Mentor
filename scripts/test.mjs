// 跨平台、跨 Node 版本的測試入口：自己列出檔案，不靠 shell glob（Windows cmd 與 Node 20 都不支援）。
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests');
const files = readdirSync(dir).filter(f => f.endsWith('.test.js')).sort().map(f => path.join(dir, f));
// 整合測試會建立獨立工作區並啟動子程序；限制 worker 數，避免資源競爭讓背景流程超過測試生命週期。
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
