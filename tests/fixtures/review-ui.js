import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { reviewTask, reviewHtml } from './review-task.js';
const html = await readFile(new URL('../../web/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
export function fixture() {
  function element(tag, textContent, className) {
    const classes = new Set(), attrs = {};
    return { tag, textContent, className, dataset: {}, children: [], hidden: false,
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
        toggle(c, force) { const on = force ?? !classes.has(c);on ? classes.add(c) : classes.delete(c);return on; } },
      append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; },
      setAttribute(k, v) { attrs[k] = v; }, getAttribute: k => attrs[k], focus() {},
      querySelector() { return this.label ??= {}; }
    };
  }
  const selectors = ['preview-dialog', 'preview-layout', 'preview-content', 'review-changes', 'preview-status', 'preview-title', 'preview-modes', 'preview-source', 'task-dialog', 'task-detail', 'task-title'];
  const nodes = Object.fromEntries(selectors.map(id => ['#' + id, element('div')]));
  const dialog = nodes['#preview-dialog'];dialog.id = 'preview-dialog';dialog.open = false;
  dialog.showModal = () => { assert.equal(dialog.open, false);dialog.open = true; };dialog.close = () => { dialog.open = false;dialog.onclose?.(); };dialog.addEventListener = (name,fn) => { if(name==='close')dialog.onclose=fn; };
  nodes['#task-detail'].querySelectorAll=()=>[];
  dialog.querySelector = () => ({ focus() {} });
  const desktop = element('button'), mobile = element('button');
  nodes['#preview-modes'].querySelector = s => s.includes('desktop') ? desktop : mobile;
  nodes['#preview-modes'].querySelectorAll = () => [desktop, mobile];
  const calls = [], blobs = [], storage = new Map(), tasks = [reviewTask(), { id: 'OTHER', planning: { workItems: [{ id: 'W1', title: '其他任務', outputs: [{ file: 'other.html' }] }] } }];
  const ctx = vm.createContext({
    $: s => nodes[s], element, tasks, previewReturn: null, previewBlob: null, Blob,
    document: { getElementById: id => nodes['#' + id] },
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    refreshSession: async () => {}, tell: message => assert.fail(message),
    navigator: { clipboard: { writeText: async text => calls.push(text) } },
    focusInstruct: (...args) => calls.push(args),
    coachAct: async (...args) => calls.push(args),
    request: async url => { calls.push(url);return ctx.probe; },
    URL: { createObjectURL(blob) { blobs.push(blob);return 'blob:review'; }, revokeObjectURL() {} },
    fetch: async url => { calls.push(url);return { ok: true, text: async () => reviewHtml }; }
  });
  vm.runInContext(script.slice(script.indexOf('function toggleDialogExpansion('), script.indexOf('// 行內表單取代 prompt()')), ctx);
  const button = ctx.reviewButton(tasks[0], tasks[0].planning.workItems[0]);
  vm.runInContext(script.split('\n').find(line=>line.startsWith("$('#preview-dialog').addEventListener('close'")),ctx);
  return { ctx, nodes, button, calls, blobs, tasks, element, dialog };
}
export const allText = node => [node.textContent, ...node.children.map(allText)].filter(Boolean).join('\n');

