import assert from 'node:assert/strict';
import { mkdir, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { demoTask } from './demo-task.js';
import { TaskStore, serializeTask } from '../../src/tasks.js';
import { previewArtifact } from '../../src/server.js';

const baseTask = () => demoTask('TASK-base');
const id = 'TASK-preview-test';

export async function verifyPreviewBoundaries(t) {
  const fixtureRoot = path.join(await realpath(tmpdir()), `mentor-preview-${randomUUID()}`);
  const taskDir = path.join(fixtureRoot, 'outputs', id);
  const otherDir = path.join(fixtureRoot, 'outputs', 'TASK-other');
  await mkdir(taskDir, { recursive: true }); await mkdir(otherDir, { recursive: true });
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const source = baseTask();
  const task = { ...source, id, allowedRoots: [taskDir], workspace: { label: id, root: taskDir } };
  const files = ['good.html', 'good.md', 'good.png', 'good.jpg', 'good.webp', 'missing.md', 'large.md', 'large.png', 'bad.png', 'escape.md', 'cross.md', 'directory.md', 'secret.svg'];
  task.planning.workItems[0].outputs = files.map(file => ({ file }));
  for (const item of task.planning.workItems.slice(1)) item.outputs = [];
  await mkdir(path.join(fixtureRoot, 'vault'));
  await writeFile(path.join(fixtureRoot, 'vault', `${id}.md`), serializeTask(task));
  await writeFile(path.join(taskDir, 'good.html'), '<input id="q"><script>document.querySelector("#q").oninput=()=>document.title="searched"</script>');
  await writeFile(path.join(taskDir, 'good.md'), '# 中文 & <script>parent.alert(1)</script>');
  await writeFile(path.join(taskDir, 'good.png'), Buffer.from('89504e470d0a1a0a0000', 'hex'));
  await writeFile(path.join(taskDir, 'good.jpg'), Buffer.from('ffd8ff00', 'hex'));
  await writeFile(path.join(taskDir, 'good.webp'), Buffer.from('RIFF1234WEBP'));
  await writeFile(path.join(taskDir, 'large.md'), Buffer.alloc(5 * 1024 * 1024 + 1));
  await writeFile(path.join(taskDir, 'large.png'), Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(20 * 1024 * 1024)]));
  await writeFile(path.join(taskDir, 'bad.png'), '<script>alert(1)</script>');
  await writeFile(path.join(otherDir, 'cross.md'), 'other task');
  await writeFile(path.join(fixtureRoot, 'outside.md'), 'outside');
  await mkdir(path.join(taskDir, 'directory.md'));
  await symlink(path.join(fixtureRoot, 'outside.md'), path.join(taskDir, 'escape.md'));
  await symlink(path.join(otherDir, 'cross.md'), path.join(taskDir, 'cross.md'));
  const store = new TaskStore(path.join(fixtureRoot, 'vault'));
  for (const [file, mime] of [['good.html', 'text/html'], ['good.md', 'text/html'], ['good.png', 'image/png'], ['good.jpg', 'image/jpeg'], ['good.webp', 'image/webp']]) {
    assert.match((await previewArtifact(store, fixtureRoot, id, file)).mime, new RegExp(mime));
  }
  const markdown = await previewArtifact(store, fixtureRoot, id, 'good.md');
  assert.match(markdown.content.toString(), /<pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit"># 中文 &amp; &lt;script&gt;parent\.alert\(1\)&lt;\/script&gt;<\/pre>/);
  assert.doesNotMatch(markdown.content.toString(), /<script>/);
  for (const [file, code] of [['unlisted.md','PREVIEW_NOT_REGISTERED'],['missing.md','PREVIEW_MISSING'],['escape.md','PREVIEW_OUTSIDE_TASK'],['cross.md','PREVIEW_OUTSIDE_TASK'],['large.md','PREVIEW_TOO_LARGE'],['large.png','PREVIEW_TOO_LARGE'],['bad.png','PREVIEW_TYPE_UNSUPPORTED'],['directory.md','PREVIEW_TYPE_UNSUPPORTED'],['secret.svg','PREVIEW_TYPE_UNSUPPORTED'],['../outside.md','PREVIEW_NAME_INVALID'],['..\\outside.md','PREVIEW_NAME_INVALID']]) {
    await assert.rejects(previewArtifact(store, fixtureRoot, id, file), { code });
  }
  await assert.rejects(previewArtifact(store, fixtureRoot, 'TASK-other', 'good.md'), { code: 'TASK_NOT_FOUND' });
  const rootId = 'TASK-root-preview';
  const rootDir = path.join(fixtureRoot, 'outputs', rootId);
  await mkdir(rootDir);
  await writeFile(path.join(rootDir, 'nested.md'), 'root relative preview');
  const registered = `outputs/${rootId}/nested.md`;
  const rootTask = { ...source, id: rootId, allowedRoots: [fixtureRoot], workspace: { label: rootId, root: fixtureRoot } };
  rootTask.planning.workItems[0].outputs = [{ file: registered }];
  for (const item of rootTask.planning.workItems.slice(1)) item.outputs = [];
  await writeFile(path.join(fixtureRoot, 'vault', `${rootId}.md`), serializeTask(rootTask));
  assert.match((await previewArtifact(store, fixtureRoot, rootId, registered)).content.toString(), /root relative preview/);
  await assert.rejects(previewArtifact(store, fixtureRoot, rootId, 'nested.md'), { code: 'PREVIEW_NOT_REGISTERED' });
  await assert.rejects(previewArtifact(store, fixtureRoot, id, registered), { code: 'PREVIEW_NOT_REGISTERED' });
  return { fixtureRoot, id, rootId, registered };
}
