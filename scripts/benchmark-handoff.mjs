import {benchmarkCases,checkHandoffAnswer,comparePair,summarizeBenchmark} from '../src/handoff-benchmark.js';
import {runAgent} from '../src/agents.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];
const fixture=benchmarkCases();
if(!args.includes('--run')){
 console.log(JSON.stringify({mode:'preview-only',fixtureSha256:fixture.fixtureSha256,cases:fixture.cases.map(({name,textMetrics,promptSha256})=>({name,textMetrics,promptSha256})),usage:'npm run benchmark:handoff -- --run --provider claude --model sonnet --pairs 2',warning:'Explicit --run uses real authenticated CLI quota. Only fictional data is used; no Vault is read.'},null,2));
}else{
 const provider=args.includes('--provider')?value('--provider'):null,modelId=args.includes('--model')?value('--model'):null,pairs=args.includes('--pairs')?Number(value('--pairs')):2;
 if(!['codex','claude'].includes(provider)||!modelId||modelId.startsWith('--')||!Number.isSafeInteger(pairs)||pairs<1||pairs>3)throw Error('Specify --provider codex|claude --model MODEL --pairs 1..3');
 for(const name of ['AWC_CODEX_BIN','AWC_CLAUDE_BIN'])if(process.env[name])throw Error('Live benchmark refuses CLI binary overrides');
 const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(repo,'.lab-home','handoff-benchmark-'+randomUUID().slice(0,8));await mkdir(out,{recursive:true});
 const report={version:2,at:new Date().toISOString(),nodeVersion:process.version,platform:process.platform,provider,requestedModel:modelId,requestedEffort:'low',fixtureSha256:fixture.fixtureSha256,method:'Paired full/compact fictional handoff fact recovery; alternate order per pair. Input includes provider CLI context, not only supplied text. Claude logical input = input + cache read + cache creation; Codex input includes cached input.',samples:[],comparisons:[],limitations:['Small synthetic sample, no general savings claim','Cache state/startup and output length vary','Quality gate checks fixed facts, not finished artifacts','CLI cost is an estimate, never account billing']};
 const save=()=>writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await save();console.log('Evidence directory: '+out);
 for(let pair=0;pair<pairs;pair++){
  const cases=pair%2?[...fixture.cases].reverse():fixture.cases;
  for(const candidate of cases){
   console.log(`Pair ${pair+1}/${pairs}: ${candidate.name}, real ${provider} ${modelId}`);
   try{
    const result=await runAgent({provider,modelId,effort:'low',mode:'chat',prompt:candidate.prompt,timeoutMs:120000});
    report.samples.push({pair:pair+1,name:candidate.name,promptSha256:candidate.promptSha256,textMetrics:candidate.textMetrics,usage:result.usage,elapsedMs:result.elapsedMs,quality:checkHandoffAnswer(result.text,fixture.expected)});
   }catch(error){report.failure={pair:pair+1,name:candidate.name,code:error.code||'FAILED',message:error.message};await save();throw error;}
   await save();
  }
  const samples=report.samples.filter(s=>s.pair===pair+1),comparison=comparePair(provider,samples.find(s=>s.name==='full'),samples.find(s=>s.name==='compact'));report.comparisons.push({pair:pair+1,...comparison});await save();
 }
 report.summary=summarizeBenchmark(report.comparisons);await save();
 console.log(JSON.stringify({report:path.join(out,'report.json'),comparisons:report.comparisons,summary:report.summary},null,2));
 if(report.samples.some(s=>!s.quality.pass))process.exitCode=1;
}
