import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Memory} from '../src/memory.js';

test('recall uses preserved rules, persists progress, and rejects stale or empty answers', async () => {
 const dir=await mkdtemp(path.join(tmpdir(),'awc-recall-'));
 try {
  const memory=new Memory(dir);
  await memory.append('team',null,'取捨','驗收先核對來源，再確認完成。','任務 W1');
  const original=await readFile(path.join(dir,'team.md'),'utf8');
  const card=(await memory.list()).cards[0];
  assert.equal(card.text,'驗收先核對來源，再確認完成。');
  assert.equal(card.source,'memory/team.md');
  await assert.rejects(memory.recordRecall({id:card.id,answer:'',rating:'remembered'}),{code:'RECALL_INVALID'});
  await assert.rejects(memory.recordRecall({id:'unknown',answer:'來源重要',rating:'remembered'}),{code:'RECALL_STALE'});
  await memory.recordRecall({id:card.id,answer:'我會先查來源，AI 回報完成後仍需驗收。',rating:'remembered'});
  let fresh=(await new Memory(dir).list()).cards[0];
  assert.equal(fresh.attempts,1);
  assert.equal(fresh.box,1);
  assert.equal(Date.parse(fresh.nextAt)-Date.parse(fresh.reviewedAt),86400000);
  await memory.recordRecall({id:card.id,answer:'我记得要查來源',rating:'remembered'});
  fresh=(await memory.list()).cards[0];
  assert.equal(fresh.box,2);
  assert.equal(Date.parse(fresh.nextAt)-Date.parse(fresh.reviewedAt),3*86400000);
  await memory.recordRecall({id:card.id,answer:'我忘了',rating:'again'});
  assert.equal((await memory.list()).cards[0].box,0);
  assert.equal(await readFile(path.join(dir,'team.md'),'utf8'),original,'回想不改寫規則正本');
 }finally{await rm(dir,{recursive:true,force:true});}
});
