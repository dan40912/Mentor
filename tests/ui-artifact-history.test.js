import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
test('before-history UI reads saved versions and explains missing or changed pre-run content',async()=>{
 const rows=[],requests=[],previews=[];let closed=false;
 const ctx={encodeURIComponent,element:(tag,text)=>({tag,text}),workDialog:()=>({append:(...v)=>rows.push(...v),close:()=>{closed=true;}}),busy:(_,fn)=>fn,request:async url=>{requests.push(url);return {version:{id:'version',files:[{file:'old.md',index:0,status:'saved',sha:'sha',matchesRecorded:false},{file:'gone.md',index:1,status:'missing'}]}};},openPreview:async(...args)=>previews.push(args)};
 vm.runInNewContext(html.slice(html.indexOf('async function showArtifactBefore('),html.indexOf('async function previewPlan(')),ctx);
 await ctx.showArtifactBefore('TASK-test',{id:'version'});assert.equal(requests.length,1);assert.match(requests[0],/artifact-version\?version=version/);
 assert.ok(rows.some(row=>row.text.includes('當時檔案已缺失')));assert.ok(rows.some(row=>row.text.includes('不同於先前登記版本')));
 const buttons=rows.filter(row=>row.tag==='button');assert.equal(buttons.length,1);await buttons[0].onclick();assert.equal(closed,true);assert.equal(previews[0][1],'old.md');assert.equal(previews[0][6].id,'version');assert.equal(previews[0][6].index,0);
});
