import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Projects} from '../src/projects.js';

test('project folders start with five editable pages, preserve reasons and reject stale saves',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'awc-brief-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new Projects(dir);
 const p=await store.create({name:'新專案'});assert.equal(p.slides.length,5);assert.equal((await store.list()).length,1);
 await assert.rejects(store.read('../escape'),{code:'PROJECT_INVALID'});
 await assert.rejects(store.create({name:'新專案'}),{code:'PROJECT_EXISTS'});
 const input={revision:1,slideId:'why',point:'讓 PM 看懂',detail:'先講這次要解決的問題。',reason:'原本沒有說明使用者'};
 const saved=await store.save(p.id,input);assert.equal(saved.project.revision,2);assert.equal(saved.project.edits[0].reason,input.reason);
 assert.equal(saved.project.edits[0].before.point,p.slides[0].point);
 assert.match(await readFile(path.join(dir,p.id,'README.md'),'utf8'),/原本沒有說明使用者/);
 await assert.rejects(store.save(p.id,input),{code:'REVISION_CONFLICT'});
 assert.equal((await store.save(p.id,{...input,revision:2})).unchanged,true);
 assert.equal((await store.read(p.id)).revision,2);
 await assert.rejects(store.save(p.id,{...input,revision:2,reason:''}),{code:'TEXT_REQUIRED'});
 for(const s of saved.project.slides){s.point='字'.repeat(140);s.detail='文'.repeat(700);}await store.write(saved.project);
 const context=await store.context(p.name);assert.ok(context.length<2400);assert.doesNotMatch(context,/修改前|原本沒有說明使用者/);
 assert.equal(await store.context('未建立的專案'),'');
});

