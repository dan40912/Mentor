import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
const server=await readFile(new URL('../src/server.js',import.meta.url),'utf8');

test('work panel shows readable per-run status, dependency, actions and detailed records',()=>{
  for(const label of ['排隊中','工作中','等你回覆','完成待你看','已確認','未完成','已停止','不確定是否完成'])assert.ok(html.includes(label),label);
  for(const label of ['只看需要我處理的','查看成果','停止這項工作','換 AI 接手','查看詳細紀錄','接手摘要會包含目標'])assert.ok(html.includes(label),label);
  assert.match(html,/等「\$\{names\.join\('、'\)\}」完成後開始/);
  assert.ok(server.includes('(stop|retry|reassign)'));
});

test('run status refresh pauses when the page is hidden and active work polls every three seconds',()=>{
  assert.match(html,/document\.addEventListener\?\.\('visibilitychange'/);
  assert.match(html,/if\(document\.hidden\).*pollTimer=null/s);
  assert.match(html,/setInterval\(pollRuns,3000\)/);
  assert.match(html,/encodeURIComponent\(task\.id\)\}\/runs/);
  assert.doesNotMatch(html,/run-progress|run-percent|預估剩餘時間/);
});

test('conversation and work panel share AI actions with confirmation before execution',()=>{
  assert.match(html,/request\('\/api\/workspace-chat',\{question:text,taskId:task\.id\}\)/);
  assert.match(html,/function previewWorkspaceAction\(reply,task,action\)/);
  assert.match(html,/element\('button','確認','btn primary'\)/);
  assert.match(html,/runAction\(task,run,'stop'\)/);
  assert.match(html,/runAction\(task,run,'reassign'/);
  assert.match(html,/dryRun:true/);
  assert.doesNotMatch(html,/const target=resolveRunTarget\(task,text\)/);
});

test('inline browser scripts remain syntactically valid',()=>{
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
  assert.ok(scripts.length);
  for(const script of scripts)new Function(script);
});
