import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/agents.js';

test('explicit model capacity messages return the exact capacity hint', () => {
  for (const output of [
    'Selected model is at capacity',
    'The selected model is currently at capacity. Please try again later.',
    'MODEL "gpt-6.1-sol" IS AT CAPACITY',
    'The model is overloaded. Please retry.',
    'Error: model_capacity_exceeded',
    'Selected model is at capacity and is not available right now.',
  ]) {
    assert.deepEqual(classify(output), [
      'AGENT_MODEL_CAPACITY',
      '這個模型目前滿載，可以稍後重試或換一個模型',
    ], output);
  }
});

test('existing error classifications retain their codes and priority', () => {
  const cases = [
    ["You've hit your session limit · resets 3:50am", 'AGENT_QUOTA'],
    ['Error: insufficient_quota (429)', 'AGENT_QUOTA'],
    ['Rate limit exceeded', 'AGENT_QUOTA'],
    ['Not logged in · Please run /login', 'AGENT_NOT_LOGGED_IN'],
    ['HTTP 401 Unauthorized', 'AGENT_NOT_LOGGED_IN'],
    ['The model returned no content because the response was blocked by content filtering.', 'AGENT_FILTERED'],
    ["The 'gpt-6.1-sol' model is not supported", 'AGENT_MODEL_UNSUPPORTED'],
    ['Error: Model "x" from --model flag is not available.', 'AGENT_MODEL_UNSUPPORTED'],
    ['unknown model', 'AGENT_MODEL_UNSUPPORTED'],
    ['model_not_found', 'AGENT_MODEL_UNSUPPORTED'],
  ];
  for (const [output, code] of cases) {
    assert.equal(classify(output)[0], code, output);
    assert.equal(classify(`${output}\nSelected model is at capacity`)[0], code === 'AGENT_MODEL_UNSUPPORTED' ? 'AGENT_MODEL_CAPACITY' : code, output);
  }
});

test('ambiguous capacity text does not imply model capacity', () => {
  for (const output of ['Server is at capacity', 'Disk capacity exceeded', 'Selected model failed', 'Model capacity is 100 requests']) {
    assert.equal(classify(output)[0], 'AGENT_FAILED', output);
  }
});
