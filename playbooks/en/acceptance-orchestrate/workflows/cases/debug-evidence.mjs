// Completed host debug observations, not nested transport-command receipts.
import fs from 'node:fs';import path from 'node:path';
import {read,ownedAbsolute} from '../shared/store.mjs';
import {filesUnder} from '../shared/recovery.mjs';
import {digest} from '../shared/definitions.mjs';
import {verifyCoverageReport} from '../shared/coverage.mjs';
export function collectDebugEvidence(directory,{verifyNative=true}={}){
 if(!fs.existsSync(directory))return {attempts:0,completed:[],incomplete:0};
 directory=fs.realpathSync(directory);
 const files=filesUnder(directory),attempts=new Set(),completed=[];
 for(const file of files){
  const parent=path.dirname(file),name=path.basename(file);
  if(['execution.json','execution-intent.json'].includes(name)&&path.basename(parent)==='execution')attempts.add(path.dirname(parent));
  if(name==='execution-intent.json'&&path.basename(parent)==='command'&&path.basename(path.dirname(parent))==='execution')attempts.add(path.dirname(path.dirname(parent)));
 }
 for(const markerFile of files.filter(file=>path.basename(file)==='debug-observation.json')){
  const attempt=path.dirname(markerFile),marker=read(markerFile),receiptFile=path.join(attempt,'execution/execution.json');attempts.add(attempt);
  if(marker.status!=='observed'||marker.product_verdict!=='not_performed'||typeof marker.receipt!=='string'||fs.realpathSync(marker.receipt)!==fs.realpathSync(receiptFile))throw Error('Debug completion marker does not bind its own execution receipt');
  ownedAbsolute(directory,receiptFile);const receipt=read(receiptFile),log=path.join(path.dirname(receiptFile),'execution.log');ownedAbsolute(directory,log);
  if(receipt.schema!=='isolated-test-execution-v1'||!receipt.end_utc||!Number.isInteger(receipt.exit_code)||marker.exit_code!==receipt.exit_code||digest(log)!==receipt.log_sha256)throw Error('Completed debug execution receipt or log changed');
  if(receipt.coverage_session_path)verifyCoverageReport(path.join(path.dirname(receiptFile),'coverage-report.json'),receiptFile,{runCheck:verifyNative});
  completed.push({observation:markerFile,receipt_path:receiptFile,receipt});
 }
 return {attempts:attempts.size,completed,incomplete:attempts.size-completed.length};
}
