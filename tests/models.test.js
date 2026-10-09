import test from 'node:test';
import assert from 'node:assert/strict';
import { providers, resolveModel, recommendationPlans, stages } from '../src/models.js';
import { handoffMarkdown } from '../src/server.js';

test('Copilot models preserve model IDs and reasoning effort', () => {
  assert.ok(providers.find(p => p.id === 'copilot').models.length >= 4);
  assert.deepEqual(resolveModel('copilot', 'opus55-high'), { provider: 'copilot', modelId: 'claude-opus-5.5', effort: 'high' });
  for (const [key, modelId, effort] of [
    ['sol-low', 'gpt-6.1-sol', 'low'],
    ['sol-med', 'gpt-6.1-sol', 'medium'],
    ['sol-high', 'gpt-6.1-sol', 'high'],
    ['luna-high', 'gpt-6-luna', 'high']
  ]) assert.deepEqual(resolveModel('copilot', key), { provider: 'copilot', modelId, effort });
  assert.throws(() => resolveModel('copilot', 'invented'));
  assert.throws(() => resolveModel('unknown'));
});

test('Handoff stays prepared and preserves scope', () => {
  const input = { provider: 'copilot', modelKey: 'sol-med', goal: '工作', scope: '僅修改測試', acceptance: '測試通過', next: '核對來源' };
  const markdown = handoffMarkdown(input, 'HANDOFF-test');
  assert.match(markdown, /status: prepared/);
  assert.match(markdown, /reasoning_effort: "medium"/);
  assert.match(markdown, /僅修改測試/);
  assert.match(markdown, /尚未核對/);
  assert.throws(() => handoffMarkdown({ ...input, scope: '' }, 'test'));
});

test('recommendations respect stage permissions and the subscribed Codex model', () => {
  assert.equal(stages.find(s => s.id === 'C').mode, 'read');
  assert.ok(!providers.find(p => p.id === 'codex').models.some(m => m.key === 'gpt-6-astra-high'));
  for (const plan of recommendationPlans) for (const [id, [provider, key]] of Object.entries(plan.choices)) {
    if (provider === 'same-as-D') continue;
    const p = providers.find(p => p.id === provider);
    assert.ok(p.modes.includes(stages.find(s => s.id === id).mode));
    if (provider === 'codex') assert.equal(key, 'gpt-6-sol-medium');
    else assert.doesNotThrow(() => resolveModel(provider, key));
  }
});
