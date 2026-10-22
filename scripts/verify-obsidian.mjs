import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runtimeFiles,readWithoutLinks,sha256} from './obsidian-files.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function verifyObsidian(vault,sourceRepo=repo){
 const results=[];
 for(const entry of runtimeFiles){
  const expected=await readWithoutLinks(sourceRepo,entry.source);if(!expected?.length)throw new Error('Checkout is missing source: '+entry.source);
  try{const actual=await readWithoutLinks(path.resolve(vault),entry.target);results.push({path:entry.target,status:actual===null?'missing':sha256(actual)===sha256(expected)?'matched':'different',expectedSha256:sha256(expected),actualSha256:actual===null?null:sha256(actual)});}
  catch(error){results.push({path:entry.target,status:'unsafe',message:error.message});}
 }
 return {scope:'Runtime files compared with this local checkout; no note, data.json or credential is read or written.',passed:results.every(r=>r.status==='matched'),results};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--vault'){console.error('Usage: npm run verify:obsidian -- --vault /path/to/isolated-vault (read-only)');process.exitCode=2;}
 else try{const report=await verifyObsidian(args[1]);for(const item of report.results)console.log(item.status.padEnd(10)+' '+item.path+(item.message?' — '+item.message:''));console.log(report.passed?'PASS runtime files match this checkout.':'FAIL runtime mismatch; no files changed.');console.log(report.scope);process.exitCode=report.passed?0:1;}catch(error){console.error(error.message);process.exitCode=1;}
}
