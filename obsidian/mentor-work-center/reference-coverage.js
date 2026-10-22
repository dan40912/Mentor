/* MIT. Conservative scanner: unsupported Markdown blocks relocation rather than guessing. */
function scanReferences(content){
 const references=[];let i=0;
 const stop=message=>{throw new Error(message+'（位置 '+i+'）');};
 try{
  if(typeof content!=='string')stop('筆記內容不是文字');if(content.length>200000)stop('筆記超過 200,000 字');
  if(content.startsWith('---\n')||content.startsWith('---\r\n')){
   const close=/^(?:---|\.\.\.)\r?$/gm;close.lastIndex=content.indexOf('\n')+1;const match=close.exec(content);if(!match)stop('Properties 尚未結束');
   const yaml=content.slice(0,match.index).replace(/^(?:cssclasses|tags):[ \t]*\[[\p{L}\p{N}_\/#, \t-]*\][ \t]*\r?$/gmu,'');if(/\[|\]|<|obsidian:|file:/i.test(yaml))stop('Properties 含需另外解析的參照或集合');i=match.index+match[0].length;
  }
  while(i<content.length){
   const tail=content.slice(i),lineStart=i===0||content[i-1]==='\n';
   if(lineStart){
    const line=tail.split('\n',1)[0],fence=line.match(/^ {0,3}(`{3,}|~{3,})(.*)\r?$/);
    if(fence){
     if(/^(?:dataview(?:js)?|templater|tasks|query)(?:\s|$)/i.test(fence[2].trim()))stop('動態查詢或外掛程式區塊尚未支援');
     if(fence[1][0]==='`'&&fence[2].includes('`'))stop('程式圍欄格式未支援');
     const close=new RegExp('^ {0,3}'+fence[1][0]+'{'+fence[1].length+',}[ \\t]*\\r?$','gm');close.lastIndex=i+line.length+1;const match=close.exec(content);if(!match)stop('程式圍欄尚未結束');i=match.index+match[0].length;continue;
    }
    if(/^\s*(?:>|[-+*]\s|\d+[.)]\s)/.test(line)&&/(?:`{3,}|~{3,})/.test(line))stop('巢狀程式圍欄尚未支援');
    if(/^(?: {4}|\t).*\[/.test(line))stop('縮排內容中的連結語意需另行核對');
    if(/^ {0,3}\[[^\]]+\]:/.test(line))stop('參考式 Markdown 連結尚未支援');
   }
   if(tail.startsWith('<!--')||tail.startsWith('%%')){
    const opening=tail.startsWith('<!--')?'<!--':'%%',closing=opening==='<!--'?'-->':'%%',end=content.indexOf(closing,i+opening.length);if(end<0)stop('註解尚未結束');i=end+closing.length;continue;
   }
   if(content[i]==='\\'){i+=2;continue;}
   if(content[i]==='`'){
    const run=tail.match(/^`+/)[0],close=/`+/g;close.lastIndex=i+run.length;let end=null,match;
    while((match=close.exec(content)))if(match[0].length===run.length){end=match.index+run.length;break;}
    if(end===null)stop('行內程式碼尚未結束');i=end;continue;
   }
   if(content[i]==='$')stop('數學或美元符號語意尚未支援');
   if(content[i]==='<'&&/^<(?:[A-Za-z/!]|\?)/.test(tail))stop('HTML 或自動連結語法尚未支援');
   if(content[i]==='['||tail.startsWith('![')){
    const prefix=content.slice(content.lastIndexOf('\n',i-1)+1,i);
    const checkbox=tail.match(/^\[(?: |x|X)\]/);if(checkbox&&/^\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+$/.test(prefix)){i+=checkbox[0].length;continue;}
    const callout=tail.match(/^\[![A-Za-z0-9_-]+\][+-]?/);if(callout&&/^\s*(?:>\s*)+$/.test(prefix)){i+=callout[0].length;continue;}
    const wiki=tail.match(/^!?\[\[([^\]\n]+)\]\]/),markdown=wiki?null:tail.match(/^!?\[([^\]\n]*)\]\((<[^>\n]*>|[^\s()]+)\)/);
    if(!wiki&&!markdown)stop('括號可能是未支援的連結，需先人工核對');
    const original=(wiki||markdown)[0],link=wiki?wiki[1].split('|',1)[0].trim():markdown[2].replace(/^<|>$/g,'');
    if(!link||/^(?:obsidian|file|data|javascript):/i.test(link))stop('內部 URI 或空連結尚未支援');
    references.push({start:i,end:i+original.length,original,link});i+=original.length;continue;
   }
   i++;
  }
  return {references,blockers:[]};
 }catch(error){return {references,blockers:[error.message]};}
}
function noteCoverage(note){
 const scanned=scanReferences(note.content);if(scanned.blockers.length)return {...scanned,verified:false};
 if(!Array.isArray(note.references))return {...scanned,verified:false,blockers:['尚無可核對的連結索引。']};
 const expected=[...scanned.references].sort((a,b)=>a.start-b.start),actual=[...note.references].sort((a,b)=>a.start-b.start);
 if(expected.length!==actual.length)return {...scanned,verified:false,blockers:['目前原文的連結數與索引不同，可能有遺漏或過期參照。']};
 for(let i=0;i<expected.length;i++)for(const key of ['start','end','original','link'])if(expected[i][key]!==actual[i][key])return {...scanned,verified:false,blockers:['連結索引位置或內容與獨立掃描不一致，請等待重新索引。']};
 return {...scanned,verified:true};
}
module.exports={scanReferences,noteCoverage};
