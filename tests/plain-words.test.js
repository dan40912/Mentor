import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../web/assets/plain-words.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const context = vm.createContext({window:{}});
vm.runInContext(source, context);
const {terms,status} = context.window.plainWords;

test('plain language glossary maps engineering labels to user-facing wording', () => {
  assert.deepEqual({...terms}, {
    'A 任務卡':'了解需求','B 追問':'確認細節','C 計畫':'擬計畫','D 執行':'製作','E 審閱':'檢查','F 修改':'修改',
    revision:'第 N 版',workItem:'工作項目',sensor:'自動檢查',PASS:'通過',FAIL:'未通過',NOT_RUN:'尚未檢查',
    provider:'AI 助手',model:'模型',effort:'思考深度',token:'用量',CLI:'AI 助手程式','exit code':'詳細紀錄',stdout:'詳細紀錄',stderr:'詳細紀錄'
  });
});

test('project status labels do not leak internal status codes', () => {
  assert.equal(status({status:'AWAITING_ACCEPTANCE'}),'等你確認');
  assert.equal(status({status:'INTERRUPTED'}),'執行中斷');
  assert.equal(status({error:'bad task'}),'需要檢查任務資料');
});

test('static interface copy avoids engineering terms from the glossary', () => {
  const shell = html.slice(html.indexOf('<div class="shell">'),html.indexOf('<main id="content"'));
  const mainHeader = html.slice(html.indexOf('<header class="topbar"'),html.indexOf('<main id="content"'));
  const workPanel = html.slice(html.indexOf('<aside id="work-panel"'),html.indexOf('</aside>',html.indexOf('<aside id="work-panel"')));
  const chatPanel = html.slice(html.indexOf('<aside id="pc-chat"'),html.indexOf('</aside>',html.indexOf('<aside id="pc-chat"')));
  const visible = (shell+mainHeader+workPanel+chatPanel).replace(/<[^>]*>/g,' ');
  const banned = /\b(?:revision|workItem|sensor|PASS|FAIL|NOT_RUN|provider|effort|token|CLI|exit code|stdout|stderr)\b|A[–-]F|階段 [A-F]/i;
  assert.doesNotMatch(visible,banned);
  assert.doesNotMatch(Object.values(terms).join(' '),banned);
});

test('task details, plan preview, work cards, and work panel copy are scanned',()=>{
  const slices=[
    html.slice(html.indexOf('function renderPlanning('),html.indexOf('// 使用者正在輸入或展開行內表單時')),
    html.slice(html.indexOf('function renderRunCard('),html.indexOf('function renderWorkspacePanels(')),
    html.slice(html.indexOf('async function previewPlan('),html.indexOf('function renderHandoffTaskPicker(')),
    html.slice(html.indexOf('function openTask('),html.indexOf('function renderSessions('))
  ];
  const visibleLiterals=slices.flatMap(slice=>[...slice.matchAll(/element\(\s*['"][^'"]+['"]\s*,\s*(['"])([^'"\\]*(?:\\.[^'"\\]*)*)\1/g)].map(match=>match[2]));
  const visible=visibleLiterals.join(' ');
  const banned=/\b(?:revision|workItem|sensor|PASS|FAIL|NOT_RUN|provider|effort|token|CLI|exit code|stdout|stderr|UTF-8 bytes|SHA-256)\b|階段 [A-F]/i;
  assert.doesNotMatch(visible,banned,visible);
  assert.ok(slices.length===4);
});

test('server serves the language glossary to the chat page', async () => {
  const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.ok(server.includes('plain-words\\.js'));
});
