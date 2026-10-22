import test from 'node:test';
import assert from 'node:assert/strict';
import {benchmarkFixture,benchmarkCases,checkHandoffAnswer,logicalInputTokens,comparePair,summarizeBenchmark} from '../src/handoff-benchmark.js';

test('paired prompts use one deterministic fictional task and preserve every checked value',()=>{
 const first=benchmarkCases(),second=benchmarkCases();assert.deepEqual(first,second);
 const {expected}=benchmarkFixture();
 for(const row of first.cases){assert.match(row.prompt,/NO_MENTOR_UI/);assert.match(row.prompt,/KEEP_SOURCE_NOTES/);assert.match(row.prompt,/只調整表格，保留原始筆記與 Mentor UI。/);assert.match(row.prompt,/NOT_RUN/);assert.equal(row.promptSha256.length,64);}
 assert.ok(first.cases[0].prompt.length>first.cases[1].prompt.length);
 assert.equal(checkHandoffAnswer(JSON.stringify(expected),expected).pass,true);
 const wrong={...expected,humanAccepted:true,budget:100};assert.deepEqual(checkHandoffAnswer(JSON.stringify(wrong),expected).failedFields,['humanAccepted','budget']);
 assert.equal(checkHandoffAnswer('unstructured',expected).pass,false);
});
test('comparison respects provider cache semantics and requires quality plus matching reported models',()=>{
 const usage=(input,read=0,creation=0)=>({inputTokens:input,cachedInputTokens:read,cacheCreationInputTokens:creation,models:['fixture-model']});
 assert.equal(logicalInputTokens('codex',usage(100,80)),100);assert.equal(logicalInputTokens('claude',usage(2,80,18)),100);
 assert.equal(logicalInputTokens('claude',{inputTokens:10}),null);
 const sample=u=>({usage:u,quality:{pass:true}}),full=sample(usage(2,80,18)),compact=sample(usage(2,20,28));
 assert.equal(comparePair('claude',full,compact).inputReductionPercent,50);
 assert.equal(comparePair('claude',full,{...compact,quality:{pass:false}}).inputReductionPercent,null);
 assert.equal(comparePair('claude',full,sample({...compact.usage,models:['other-model']})).comparable,false);
 assert.equal(comparePair('codex',full,compact).inputReductionPercent,null,'do not claim effective Codex model equality from requested model alone');
});

test('a favorable pair cannot hide an unfavorable pair or turn incomplete measurements into savings',()=>{
 const pair={comparable:true,qualityPassed:true,inputTokenDifference:100};
 assert.equal(summarizeBenchmark([pair,{...pair,inputTokenDifference:-10}]).consistentObservedInputReduction,false);
 assert.match(summarizeBenchmark([pair,{...pair,inputTokenDifference:-10}]).conclusion,/not demonstrated/);
 assert.equal(summarizeBenchmark([{...pair,qualityPassed:false,comparable:false}]).consistentObservedInputReduction,null);
 assert.equal(summarizeBenchmark([]).allMeasurementsAvailable,false);
});
