import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const module={exports:{}};
vm.runInNewContext(await readFile(new URL('../obsidian/mentor-work-center/reference-coverage.js',import.meta.url),'utf8'),{module});
const {scanReferences,noteCoverage}=module.exports;
test('coverage scanner distinguishes links from code, comments, escaped punctuation, checkboxes and callout markers',()=>{
 const content=['---','title: plain','---','> [!note] 說明 [[A#標題|別名]]','- [ ] ![圖片](<圖 片.png>)','`[[程式]]` <!-- [[註解]] --> %% [[備註]] %%','\\[普通文字]','~~~md','[[範例]]','~~~','```js','const link="[[不是連結]]"','```','😀 [標籤](A.md#part)'].join('\n');
 const result=scanReferences(content);assert.equal(result.blockers.length,0);assert.equal(result.references.length,3);assert.deepEqual(Array.from(result.references,r=>r.link),['A#標題','圖 片.png','A.md#part']);
 for(const ref of result.references)assert.equal(content.slice(ref.start,ref.end),ref.original,'offsets use UTF-16 like the host API');
 assert.equal(noteCoverage({content,references:result.references}).verified,true);
});
test('coverage detects missing or stale cached links instead of trusting otherwise valid positions',()=>{
 const content='[[A]] [參考](B.md)',scanned=scanReferences(content);
 assert.equal(noteCoverage({content,references:[scanned.references[0]]}).verified,false,'new second link cannot be omitted');
 assert.equal(noteCoverage({content,references:[]}).verified,false);
 const wrong=scanned.references.map(r=>({...r}));wrong[1].link='C.md';assert.equal(noteCoverage({content,references:wrong}).verified,false);
 const stale=scanned.references.map(r=>({...r}));stale[1].start++;assert.equal(noteCoverage({content,references:stale}).verified,false);
 assert.equal(noteCoverage({content:'no links',references:null}).verified,false,'an unavailable index is not an empty one');
});
test('unsupported grammar and unclosed contexts block coverage rather than silently skipping possible references',()=>{
 for(const content of ['[name][ref]\n[ref]: A.md','[shortcut]','[title](A.md "label")','---\nrelated: "[[A]]"\n---','<a href="A.md">link</a>','[deep [label]](A.md)','> ```md\n> [[A]]\n> ```','    [[A]]','`unterminated [[A]]','```md\n[[A]]','<!-- [[A]]','%% [[A]]','$x$ [[A]]','[open](obsidian://open?file=A)','```dataview\nLIST FROM "A"\n```'])assert.ok(scanReferences(content).blockers.length,content);
 assert.equal(scanReferences('no links').blockers.length,0);
});
