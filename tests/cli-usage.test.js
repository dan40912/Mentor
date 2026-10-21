import test from 'node:test';
import assert from 'node:assert/strict';
import { codexUsage, claudeResult, usageLabel } from '../src/cli-usage.js';
import { runAgent, buildArgs } from '../src/agents.js';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('Codex usage comes only from completion events and preserves unknown counters',()=>{
 const text='noise\n'+JSON.stringify({type:'item.completed',usage:{input_tokens:999}})+'\n'+JSON.stringify({type:'turn.completed',usage:{input_tokens:10,cached_input_tokens:0,output_tokens:3,secret:'never copy'}})+'\n'+JSON.stringify({type:'turn.completed',usage:{input_tokens:20,output_tokens:2}});
 const u=codexUsage(text);assert.equal(u.inputTokens,30);assert.equal(u.outputTokens,5);assert.equal(u.cachedInputTokens,null);assert.equal(u.turns,2);assert.equal(u.secret,undefined);assert.equal(u.reasoningOutputTokens,null);
 assert.equal(codexUsage('not json'),null);
 assert.equal(codexUsage(JSON.stringify({type:'turn.completed',usage:{input_tokens:-1,output_tokens:'3'}})).inputTokens,null);
 assert.equal(codexUsage(JSON.stringify({type:'turn.completed',usage:{input_tokens:Number.MAX_SAFE_INTEGER}})+'\n'+JSON.stringify({type:'turn.completed',usage:{input_tokens:1}})).inputTokens,null);
});
test('Claude envelope separates model text, failure and estimated cost without inventing missing usage',()=>{
 const original='```json\n{"a":1}\n```';
 const r=claudeResult(JSON.stringify({type:'result',is_error:true,result:original,total_cost_usd:0,usage:{input_tokens:2,output_tokens:4,cache_read_input_tokens:8,cache_creation_input_tokens:16,secret:'no'}}));
 assert.equal(r.text,original);assert.equal(r.isError,true);assert.equal(r.usage.costEstimateUsd,0);assert.equal(r.usage.cachedInputTokens,8);assert.equal(r.usage.secret,undefined);assert.match(usageLabel(r.usage),/非帳單/);
 assert.equal(claudeResult('{broken'),null);assert.equal(claudeResult('{"a":1}'),null);
 assert.equal(claudeResult(JSON.stringify({type:'result',result:'ok'})).usage,null);
 assert.match(usageLabel(null),/未取得/);
});
test('real runner unwraps structured CLI output and persists usage without treating an error envelope as success',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'mentor-usage-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const fixture=path.join(dir,'cli.cjs');
 await writeFile(fixture,`const fs=require('node:fs');const a=process.argv.slice(2);process.stdin.resume();process.stdin.on('end',()=>{if(a.includes('-o')){fs.writeFileSync(a[a.indexOf('-o')+1],'原文');console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:12,cached_input_tokens:4,output_tokens:2}}));}else console.log(JSON.stringify({type:'result',result:process.env.MENTOR_USAGE_TEST_FAIL?'HTTP 401 Unauthorized':'原文',is_error:!!process.env.MENTOR_USAGE_TEST_FAIL,usage:{input_tokens:8,output_tokens:2}}));});`);
 for(const key of ['AWC_CODEX_BIN','AWC_CLAUDE_BIN','MENTOR_USAGE_TEST_FAIL']){const before=process.env[key];t.after(()=>{if(before===undefined)delete process.env[key];else process.env[key]=before;});}
 process.env.AWC_CODEX_BIN=fixture;process.env.AWC_CLAUDE_BIN=fixture;
 const c=await runAgent({provider:'codex',prompt:'test'});assert.equal(c.text,'原文');assert.equal(c.usage.inputTokens,12);assert.ok(c.elapsedMs>=0);
 const a=await runAgent({provider:'claude',prompt:'test'});assert.equal(a.text,'原文');assert.equal(a.usage.inputTokens,8);
 process.env.MENTOR_USAGE_TEST_FAIL='1';await assert.rejects(runAgent({provider:'claude',prompt:'test'}),{code:'AGENT_NOT_LOGGED_IN'});
 const codex=buildArgs({provider:'codex',mode:'read',cwd:dir,outputFile:'out'});assert.ok(codex.includes('--json'));
 const claude=buildArgs({provider:'claude',mode:'read'});assert.equal(claude[claude.indexOf('--output-format')+1],'json');
});
