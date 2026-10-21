// Allowlisted CLI telemetry only. Missing/invalid fields remain unknown, never zero.
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const cost = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export function codexUsage(stdout) {
  const turns=[];
  for(const line of stdout.split('\n')) {
    let event;try{event=JSON.parse(line);}catch{continue;}
    if(event?.type==='turn.completed')turns.push(event.usage);
  }
  if(!turns.length)return null;
  const sum=key=>{const values=turns.map(u=>count(u?.[key]));const total=values.reduce((a,b)=>a+(b??0),0);return values.includes(null)||!Number.isSafeInteger(total)?null:total;};
  return {source:'codex.exec.turn.completed',turns:turns.length,inputTokens:sum('input_tokens'),cachedInputTokens:sum('cached_input_tokens'),outputTokens:sum('output_tokens'),reasoningOutputTokens:sum('reasoning_output_tokens'),cacheCreationInputTokens:null,costEstimateUsd:null};
}
export function claudeResult(stdout) {
  let result;try{result=JSON.parse(stdout);}catch{return null;}
  if(result?.type!=='result'||typeof result.result!=='string')return null;
  const u=result.usage;
  return {text:result.result,isError:result.is_error===true,usage:u&&typeof u==='object'?{source:'claude.print.result',inputTokens:count(u.input_tokens),cachedInputTokens:count(u.cache_read_input_tokens),cacheCreationInputTokens:count(u.cache_creation_input_tokens),outputTokens:count(u.output_tokens),reasoningOutputTokens:null,costEstimateUsd:cost(result.total_cost_usd)}:null};
}
export function usageLabel(usage) {
  if(!usage)return 'Token 與費用：未取得 CLI 用量。';
  const n=value=>count(value)===null?'未知':String(value);
  return `CLI 回報 Token：輸入 ${n(usage.inputTokens)}、輸出 ${n(usage.outputTokens)}、快取讀取 ${n(usage.cachedInputTokens)}、快取建立 ${n(usage.cacheCreationInputTokens)}。來源：${usage.source}。費用估算：${cost(usage.costEstimateUsd)===null?'未知':`USD ${usage.costEstimateUsd}（CLI 端估算，非帳單）`}。各 provider 的快取／輸入定義不同，請勿直接相加比較。`;
}
