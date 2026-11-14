import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prompts } from '../src/coach.js';
import { outputSensors } from '../src/sensors.js';

function task(format){return{project:'虛構專案',planning:{request:'完成虛構成果',profile:'quick',card:{title:'測試',goal:'測試',audience:'主管',deliverable:format,success:[],constraints:[],unknowns:[]},proposal:{format},outline:{storyline:'',logic:[],sections:[],imageTotal:0},messages:[]}};}
const item={title:'製作成果',detail:'完成成果',acceptance:['格式正確'],outputs:[],skeleton:false};

test('D prompts require parseable slide sections and decision JSON for those deliverables',()=>{
  const slidePrompt=prompts.D(task('簡報'),item,[]);
  assert.match(slidePrompt,/<section class="slide">/);assert.match(slidePrompt,/<h1>/);
  const decisionPrompt=prompts.D(task('決策建議'),item,[]);
  assert.match(decisionPrompt,/mentor-decision/);assert.match(decisionPrompt,/"benefits"/);assert.match(decisionPrompt,/"costs"/);
});

test('automatic format checks pass valid fake artifacts and explain missing formats',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'mentor-format-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const slides='<section class="slide"><h1>虛構封面</h1></section><section class="slide"><h2>虛構結論</h2></section>';
  await writeFile(path.join(root,'slides.html'),slides);
  const slideItem={...item,outputs:[{file:'slides.html'}]};
  const goodSlides=await outputSensors(root,slideItem,task('簡報').planning.outline,'簡報');
  assert.equal(goodSlides.find(sensor=>sensor.id==='slide-format').result,'PASS');
  const badSlides=await outputSensors(root,{...item,outputs:[{file:'plain.html'}]},task('簡報').planning.outline,'簡報');
  assert.equal(badSlides.find(sensor=>sensor.id==='slide-format').result,'FAIL');assert.match(badSlides.find(sensor=>sensor.id==='slide-format').detail,/單一 HTML/);
  const decision='```mentor-decision\n{"question":"虛構選擇？","options":[{"label":"A","benefits":[],"costs":[]}]}\n```';
  await writeFile(path.join(root,'decision.md'),decision);
  const goodDecision=await outputSensors(root,{...item,outputs:[{file:'decision.md'}]},task('決策建議').planning.outline,'決策建議');
  assert.equal(goodDecision.find(sensor=>sensor.id==='decision-format').result,'PASS');
  const badDecision=await outputSensors(root,{...item,outputs:[{file:'slides.html'}]},task('決策建議').planning.outline,'決策建議');
  assert.equal(badDecision.find(sensor=>sensor.id==='decision-format').result,'FAIL');assert.match(badDecision.find(sensor=>sensor.id==='decision-format').detail,/找不到/);
});
