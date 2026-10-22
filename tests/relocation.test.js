import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),organization={exports:{}},relocation={exports:{}};
vm.runInNewContext(await readFile(new URL('../obsidian/mentor-work-center/organization.js',import.meta.url),'utf8'),{module:organization,require});
const coverageModule={exports:{}};
vm.runInNewContext(await readFile(new URL('../obsidian/mentor-work-center/reference-coverage.js',import.meta.url),'utf8'),{module:coverageModule});
vm.runInNewContext(await readFile(new URL('../obsidian/mentor-work-center/relocation.js',import.meta.url),'utf8'),{module:relocation,require:name=>name==='./reference-coverage'?coverageModule.exports:name==='./organization'?organization.exports:require(name)});
const {compileRelocation}=relocation.exports;
function note(path,content,refs=[]){return {path,content,references:refs.map(([original,link,target])=>({start:content.indexOf(original),end:content.indexOf(original)+original.length,original,link,target}))};}
test('relocation preview preserves wiki aliases, embeds, Markdown labels and anchors in incoming and outgoing links',()=>{
 const from='研究/A.md',to='知識庫/新名字.md';
 const notes=[note(from,'[[B#段落|相關]] ![圖](image.png) [[#本頁]]',[['[[B#段落|相關]]','B#段落','研究/B.md'],['![圖](image.png)','image.png','研究/image.png'],['[[#本頁]]','#本頁',from]]),note('研究/B.md','[[A#標題|顯示]] ![[A#^block]] [參考](A.md#section)',[['[[A#標題|顯示]]','A#標題',from],['![[A#^block]]','A#^block',from],['[參考](A.md#section)','A.md#section',from]])];
 const before=JSON.stringify(notes),p=compileRelocation(notes,from,to);assert.equal(JSON.stringify(notes),before,'compiler never mutates inputs');assert.equal(p.blockers.length,0);assert.equal(p.application,'NOT_IMPLEMENTED');assert.equal(p.sources.length,2);
 assert.match(p.changes[0].after,/\[\[研究\/B#段落\|相關\]\]/);assert.match(p.changes[0].after,/!\[圖\]\(<\.\.\/%E7%A0%94%E7%A9%B6\/image.png>\)/);assert.match(p.changes[0].after,/\[\[#本頁\]\]/);
 assert.match(p.changes[1].after,/\[\[知識庫\/新名字#標題\|顯示\]\]/);assert.match(p.changes[1].after,/!\[\[知識庫\/新名字#\^block\]\]/);assert.match(p.changes[1].after,/<\.\.\/%E7%9F%A5%E8%AD%98%E5%BA%AB\/%E6%96%B0%E5%90%8D%E5%AD%97.md#section>/);
});
test('relocation blocks stale indexes, unknown source links, protected backlinks and unsupported link forms',()=>{
 const from='A.md',notes=[note(from,'[失效](unknown.md)',[['[失效](unknown.md)','unknown.md',null]]),note('Core/policy.md','[[A]]',[['[[A]]','A',from]]),note('B.md','[有標題](A.md "標題")',[['[有標題](A.md "標題")','A.md',from]]),{path:'C.md',content:'[[A]]',references:null}];
 const p=compileRelocation(notes,from,'新/A.md');assert.equal(p.blockers.length,4);assert.ok(p.blockers.some(b=>b.path==='Core/policy.md'));
 const stale=note('B.md','[[A]]',[['[[A]]','A',from]]);stale.references[0].start=1;assert.match(compileRelocation([note(from,'原文'),stale],from,'新/A.md').blockers[0].reason,/索引位置/);
});
test('relocation rejects collisions, duplicate basenames, hidden paths and task records without silently changing scope',()=>{
 const notes=[note('A.md','original')];for(const to of ['A.md','a.md','../A.md','.obsidian/A.md','Core/A.md','Mentor 整理/A.md'])assert.throws(()=>compileRelocation(notes,'A.md',to));
 assert.throws(()=>compileRelocation(notes,'A.md','新.md',['A.md','新.md']),/已存在/);
 assert.throws(()=>compileRelocation([...notes,note('其他/A.md','other')],'A.md','新.md'),/同名/);
 assert.ok(compileRelocation([note('A.md','<!-- awc:begin -->')],'A.md','新.md').blockers.length);
});

test('relocation refuses omitted references and non-Markdown reference stores; supported coverage stays explicitly scoped',()=>{
 const from='A.md';assert.throws(()=>compileRelocation([note(from,'原文')],from,'新.md',[from,'漏掃.md']),/未完整提供/);const missing=compileRelocation([note(from,'原文'),note('B.md','[[A]]',[])],from,'新.md');assert.equal(missing.indexCoverage,'BLOCKED');assert.match(missing.blockers[0].reason,/連結數/);
 const valid=compileRelocation([note(from,'原文'),note('B.md','[[A]]',[['[[A]]','A',from]])],from,'新.md');assert.equal(valid.indexCoverage,'VERIFIED_SUPPORTED_MARKDOWN');assert.equal(valid.application,'NOT_IMPLEMENTED');assert.equal(valid.scannedReferences,1);
 for(const file of ['圖.canvas','資料.base','索引.json','參照.txt','圖片.svg']){const blocked=compileRelocation([note(from,'原文')],from,'新.md',[from,file]);assert.equal(blocked.indexCoverage,'BLOCKED');assert.equal(blocked.blockers[0].path,file);}
 const history='Mentor 整理/復原紀錄/12345678-1234-1234-1234-123456789abc.json';assert.equal(compileRelocation([note(from,'原文')],from,'新.md',[from,history]).indexCoverage,'VERIFIED_SUPPORTED_MARKDOWN','immutable audit journals are not editable link stores');
});
