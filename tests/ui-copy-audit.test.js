import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { outputSensors } from '../src/sensors.js';
import { nextRequest } from '../src/conversations.js';

const oldCopy = /大綱|工作拆分|Grill 完成|送出修改/;

test('舊文案檢查：自動檢查通過與失敗的可見名稱、說明使用計畫', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ui-copy-audit-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outline = { imageTotal: 1, sections: [{ no: 1, title: '市場分析' }] };
  for (const [html, expected] of [['<h1>市場分析</h1><svg></svg>', 'PASS'], ['<h1>其他內容</h1>', 'FAIL']]) {
    await writeFile(path.join(dir, 'report.html'), html);
    const sensors = await outputSensors(dir, { outputs: [{ file: 'report.html' }] }, outline);
    for (const id of ['visual-count', 'upstream-coverage']) {
      const sensor = sensors.find(s => s.id === id);
      assert.equal(sensor.result, expected);
      assert.match(sensor.name, /計畫/);
      assert.doesNotMatch(`${sensor.name} ${sensor.detail}`, oldCopy);
    }
  }
});

test('舊文案檢查：新產生的接續 prompt 用計畫，保留使用者主張與範圍', () => {
  const prompt = nextRequest({ title: '市場報告', goal: '核准提案', allowedRoots: ['/report'],
    scope: { locked: [{ text: '保留結論' }] }, planning: { card: { audience: '主管', constraints: ['只讀素材'] } } },
  { direction: '先講市場需求' });
  assert.match(prompt, /本次請先整理可讀的計畫與缺口，尚不修改正式成果。/);
  assert.match(prompt, /主張：先講市場需求/);
  assert.match(prompt, /保留：保留結論；只讀素材/);
  assert.doesNotMatch(prompt, oldCopy);
});
