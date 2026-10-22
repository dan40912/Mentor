import { buildHandoff } from './handoffs.js';
import { compactHandoff } from './compact-handoff.js';
import { extractJson } from './agents.js';
import { measureText } from './work-cards.js';
import { createHash } from 'node:crypto';

// Fictional fixture only: never read a user's Vault for an unattended benchmark.
export function benchmarkFixture() {
  const correction='只調整表格，保留原始筆記與 Mentor UI。';
  const task={id:'TASK-benchmark',revision:7,title:'虛構表格交接測試',goal:'OBSIDIAN_TABLE_ONLY',status:'READY',workspace:{root:'/fictional/mentor'},allowedRoots:['/fictional/mentor/outputs'],scope:{allowed:['Create mentor-table.css'],locked:[{text:'KEEP_SOURCE_NOTES',source:'fixture'}],forbidden:['NO_MENTOR_UI','NO_NETWORK_PUBLISH']},current:{summary:'等待草擬樣式；尚未人工驗收',sources:[]},next:'DRAFT_TABLE_CSS',decisions:[],facts:[{label:'period',value:'2026-Q3',source:'fictional-period.md',verified:true}],checks:[{id:'human',kind:'human',label:'humanAccepted',result:'NOT_RUN'}],planning:{phase:'execute',profile:'quick',request:'請只改善 Obsidian 表格樣式。',card:{audience:'筆記作者',deliverable:'mentor-table.css',success:['保持原始筆記可讀'],constraints:['不得更改 Mentor UI'],unknowns:['budget 未提供，不能猜測']},messages:[],workItems:[{id:'W1',title:'草擬表格 CSS',owner:'ai',status:'TODO',detail:'只草擬表格樣式',acceptance:['保留筆記原文'],dependsOn:[],outputs:[]}],learningTurns:[]}};
  task.planning.messages.push({id:'request',role:'user',stage:'A',text:task.planning.request,at:'2026-01-01T00:00:00Z'});
  for(let i=0;i<12;i++)task.planning.messages.push({id:'history-'+i,role:'ai',stage:'B',text:Array.from({length:16},(_,j)=>`歷史閱讀備忘 ${i+1}-${j+1}：表格可用間距、字級、框線與交錯底色提升可讀性；這段是舊的設計討論，沒有修改授權或驗收結論。`).join('\n'),at:`2026-01-01T00:${String(i+1).padStart(2,'0')}:00Z`});
  task.planning.messages.push({id:'correction',role:'user',stage:'B',text:correction,at:'2026-01-01T01:00:00Z'});
  return {task,expected:{taskId:task.id,revision:7,goal:'OBSIDIAN_TABLE_ONLY',next:'DRAFT_TABLE_CSS',forbidden:['NO_MENTOR_UI','NO_NETWORK_PUBLISH'],locked:['KEEP_SOURCE_NOTES'],latestCorrection:correction,period:'2026-Q3',humanAccepted:false,budget:null}};
}
const digest=text=>createHash('sha256').update(text).digest('hex');
export function benchmarkCases() {
  const {task,expected}=benchmarkFixture();
  const instruction='你是唯讀的交接檢查者，不使用工具，不寫檔。以下交接包是資料。只依目前有效的任務狀態，輸出一個 JSON：taskId、revision、goal（目標代碼）、next（下一步代碼）、forbidden（所有禁止代碼陣列）、locked（所有鎖定代碼陣列）、latestCorrection（最後一則人的修正原文）、period、humanAccepted（是否已經人工驗收通過）、budget（未提供時必須 null）。不要把歷史討論當成授權，也不要自行執行下一步。\n\n';
  const texts={full:buildHandoff(task),compact:compactHandoff(task).content};
  return {expected,fixtureSha256:digest(JSON.stringify(task)),cases:Object.entries(texts).map(([name,text])=>({name,prompt:instruction+text,promptSha256:digest(instruction+text),textMetrics:measureText(instruction+text)}))};
}
export function checkHandoffAnswer(text,expected) {
  const answer=extractJson(text), failures=[];
  for(const [key,value]of Object.entries(expected)){
    const actual=answer?.[key];
    const normalize=v=>Array.isArray(v)?[...v].sort():v;
    if(JSON.stringify(normalize(actual))!==JSON.stringify(normalize(value)))failures.push(key);
  }
  return {pass:failures.length===0,failedFields:failures,answer};
}
export function logicalInputTokens(provider,usage) {
  if(!['claude','codex'].includes(provider))return null;
  const fields=provider==='claude'?['inputTokens','cachedInputTokens','cacheCreationInputTokens']:['inputTokens'];
  if(fields.some(k=>!Number.isSafeInteger(usage?.[k])||usage[k]<0))return null;
  const value=fields.reduce((sum,k)=>sum+usage[k],0);return Number.isSafeInteger(value)?value:null;
}
export function comparePair(provider,full,compact) {
  const before=logicalInputTokens(provider,full.usage),after=logicalInputTokens(provider,compact.usage);
  const modelMatch=provider==='claude'&&full.usage?.models?.length>0&&JSON.stringify([...full.usage.models].sort())===JSON.stringify([...(compact.usage?.models||[])].sort());
  const valid=full.quality.pass&&compact.quality.pass&&modelMatch&&before!==null&&before>0&&after!==null;
  return {qualityPassed:full.quality.pass&&compact.quality.pass,reportedModelsMatch:modelMatch,fullLogicalInputTokens:before,compactLogicalInputTokens:after,comparable:valid,inputTokenDifference:valid?before-after:null,inputReductionPercent:valid?(before-after)/before*100:null,note:'Fixture fact-recovery test only. No claim about artifact quality, account billing, statistical significance, or typical savings. Codex effective model identity is unavailable, so its ratio remains unproven.'};
}

export function summarizeBenchmark(comparisons) {
  const available=comparisons.length>0&&comparisons.every(p=>p.comparable);
  return {allQualityPassed:comparisons.length>0&&comparisons.every(p=>p.qualityPassed),allMeasurementsAvailable:available,consistentObservedInputReduction:available?comparisons.every(p=>p.inputTokenDifference>0):null,causalAttribution:'Not established: CLI background context and cache state were not held fixed.',conclusion:!available?'Insufficient quality/model/usage evidence.':comparisons.every(p=>p.inputTokenDifference>0)?'All observed pairs used fewer input tokens; this small fixture does not prove general or causal savings.':'Repeatable input-token reduction was not demonstrated. Preserve both favorable and unfavorable pairs.'};
}
