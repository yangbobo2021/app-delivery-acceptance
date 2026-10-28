import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {harness,read,sha} from './official_workflow_harness.mjs';
import {recordRisk} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/risk/stage.mjs';
import {AcceptanceView} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/view/data.mjs';
const args=process.argv.slice(2),source=path.resolve(args[args.indexOf('--from')+1]);
assert.ok(args.includes('--live-cli')&&args.includes('--from'),'Requires actual original CLI evidence');
const h=harness('acceptance-risk-resume',[['acceptance-risk','risk']]);
const commands=read(path.join(source,'commands.json')),first=commands.find(item=>item.label==='live-new-risk');
assert.ok(first&&first.exit_code===0,'The original request actually completed through the official CLI');
const input=JSON.parse(first.stdin.replace(/^\/acceptance-risk\s+/,'')),root=input.project_root,at=input.acceptance_id;
const record=path.join(root,'.acceptance',at,'records/risks',input.request_id+'.json'),before=sha(record),findingHash=sha(input.finding_reference);
h.test('RISK-REUSE-01','重复真实风险决定返回同一技术结论与摘要，原决定和产品发现字节不变',()=>{
 const result=recordRisk(input);assert.equal(result.reused,true);assert.equal(result.technical_status,'product_bug');assert.equal(result.sha256,before);
 assert.equal(sha(record),before);assert.equal(sha(input.finding_reference),findingHash);
 const view=new AcceptanceView(root,at).snapshot(at);assert.equal(view.statistics.accepted_risk,1);assert.equal(view.statistics.passed,0);assert.equal(view.statistics.product_bug,0);
 h.save('actual-risk-reuse.json',{result,original_record:record,original_sha256:before,statistics:view.statistics});
});
h.test('RISK-REUSE-02','官方 CLI 重入正常到达 recorded，仍保留独立技术发现和未通过状态',()=>{
 const invoked=h.cli('acceptance-risk',input,'repeat-fixed-risk',root);h.settled(invoked,'acceptance-risk','recorded');
 assert.equal(sha(record),before);assert.equal(sha(input.finding_reference),findingHash);
 assert.equal(new AcceptanceView(root,at).snapshot(at).statistics.passed,0);
});
h.finish(['workflows/risk/stage.mjs','tests/acceptance_risk_resume.integration.mjs']);
