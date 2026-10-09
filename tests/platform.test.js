import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnPlan, resolveBin, quoteForCmd, UnsafeArgError } from '../src/platform.js';

const win = { platform: 'win32', env: { PATH: 'C:\\npm;C:\\bin', PATHEXT: '.COM;.EXE;.CMD' } };

test('windows: bare command resolves through PATH and PATHEXT', () => {
  const exists = f => f === 'C:\\npm\\codex.CMD';
  assert.equal(resolveBin('codex', { ...win, exists }), 'C:\\npm\\codex.CMD');
  assert.equal(resolveBin('missing', { ...win, exists: () => false }), 'missing');
});

test('windows: a .cmd shim runs through cmd.exe with verbatim, quoted arguments', () => {
  const plan = spawnPlan('codex', ['exec', '-C', 'C:\\My Work', '-'], { ...win, exists: f => f.endsWith('codex.CMD') });
  assert.equal(plan.args[0], '/d');
  assert.equal(plan.options.windowsVerbatimArguments, true);
  assert.match(plan.args.at(-1), /^"C:\\npm\\codex\.CMD exec -C "C:\\My Work" -"$/);
});

test('windows: a native .exe is spawned directly without a shell', () => {
  const plan = spawnPlan('claude', ['-p'], { ...win, exists: f => f === 'C:\\bin\\claude.EXE' });
  assert.deepEqual([plan.command, plan.args], ['C:\\bin\\claude.EXE', ['-p']]);
});

test('windows: arguments with cmd metacharacters are refused, never escaped', () => {
  for (const bad of ['a&b', 'x|y', '%PATH%', 'a"b', 'a^b', '!x']) assert.throws(() => quoteForCmd(bad), UnsafeArgError);
  assert.equal(quoteForCmd(''), '""');
});

test('non-windows and script bins are untouched or run with node', () => {
  assert.deepEqual(spawnPlan('codex', ['x'], { platform: 'linux' }), { command: 'codex', args: ['x'], options: {} });
  const plan = spawnPlan('/t/fake-cli.mjs', ['x'], { platform: 'win32' });
  assert.equal(plan.command, process.execPath);
  assert.deepEqual(plan.args, ['/t/fake-cli.mjs', 'x']);
});
