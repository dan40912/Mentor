import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorGuidance, GUIDANCE_CODES } from '../src/error-guidance.js';
import { diagnose } from '../src/agents.js';

const root = path.dirname(fileURLToPath(import.meta.url));

test('user facing error guidance says what happened, what is preserved and the next action', () => {
  for (const code of ['AGENT_QUOTA','AGENT_NOT_LOGGED_IN','AGENT_TIMEOUT','AGENT_RESPONSE_INVALID','BODY_TOO_LARGE','PREVIEW_TOO_LARGE','REVISION_CONFLICT','SESSION_REQUIRED']) {
    const help = errorGuidance(code);
    assert.ok(help.summary && help.preserved && help.nextStep && help.actionLabel, code);
  }
  assert.ok(GUIDANCE_CODES.includes('AGENT_NOT_INSTALLED'));
  assert.equal(errorGuidance('NOT_A_REAL_CODE'), null);
});

test('first run onboarding has three states, explicit live checks, official links and a simulated demo action', async () => {
  const html = await readFile(path.join(root, '..', 'web', 'index.html'), 'utf8');
  assert.match(html, /尚未安裝/);
  assert.match(html, /已安裝，尚未登入/);
  assert.match(html, /已安裝並可用/);
  assert.match(html, /每次檢查都會實際呼叫一次/);
  assert.match(html, /learn\.chatgpt\.com\/docs\/codex\/cli/);
  assert.match(html, /docs\.anthropic\.com\/en\/docs\/claude-code\/getting-started/);
  assert.match(html, /docs\.github\.com\/en\/copilot/);
  assert.match(html, /onboarding-demo/);
  assert.match(html, /mentor-onboarding-v1/);
  assert.match(html, /onboardingAutoCheckStarted/);
  assert.match(html, /state\.diagnosis=result\.diagnosis;renderDiagnosis\(\)/);
  assert.match(html, /data-example=/);
  assert.match(html, /第一次開啟會逐一檢查/);
});

test('fake CLI diagnosis distinguishes available, signed out and missing tools', async t => {
  const previous = { bin: process.env.AWC_CODEX_BIN, mode: process.env.FAKE_MODE };
  t.after(() => {
    if (previous.bin === undefined) delete process.env.AWC_CODEX_BIN; else process.env.AWC_CODEX_BIN = previous.bin;
    if (previous.mode === undefined) delete process.env.FAKE_MODE; else process.env.FAKE_MODE = previous.mode;
  });
  process.env.AWC_CODEX_BIN = path.join(root, 'fixtures', 'fake-cli.mjs');
  process.env.FAKE_MODE = 'ok';
  assert.equal((await diagnose('codex')).ok, true);
  process.env.FAKE_MODE = 'login';
  assert.equal((await diagnose('codex')).code, 'AGENT_NOT_LOGGED_IN');
  process.env.AWC_CODEX_BIN = path.join(root, 'fixtures', 'missing-fake-cli');
  const missing = await diagnose('codex');
  assert.equal(missing.code, 'AGENT_NOT_INSTALLED');
});

test('demo uses disposable temp data and the fake CLI; launchers explain missing or old Node', async () => {
  const demo = await readFile(path.join(root, '..', 'scripts', 'demo.mjs'), 'utf8');
  assert.match(demo, /mkdtemp\(path\.join\(tmpdir\(\), 'mentor-demo-'/);
  assert.match(demo, /tests', 'fixtures', 'fake-cli\.mjs/);
  assert.match(demo, /FAKE_MODE: 'ok'/);
  assert.doesNotMatch(demo, /\.demo-home/);
  const win = await readFile(path.join(root, '..', 'start.cmd'), 'utf8');
  const unix = await readFile(path.join(root, '..', 'start.sh'), 'utf8');
  assert.match(win, /Node\.js 20 or later/);
  assert.match(unix, /Node\.js 20 or later/);
  assert.match(win, /nodejs\.org/);
  assert.match(unix, /nodejs\.org/);
  const english = await readFile(path.join(root, '..', 'README.md'), 'utf8');
  const chinese = await readFile(path.join(root, '..', 'README.zh-TW.md'), 'utf8');
  assert.match(english, /first-time, nontechnical user/i);
  assert.match(chinese, /非工程背景/);
});
