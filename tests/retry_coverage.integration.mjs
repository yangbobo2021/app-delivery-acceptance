// Real same-AT repair of a preserved failed coverage preparation. The role sees
// the actual prior failure, not a proposed fix or an expected implementation.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {prepareCoverage} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/coverage/stage.mjs';
import {harness,read,sha,skill,snapshot} from './official_workflow_harness.mjs';
const h=harness('retry-coverage',[['acceptance-coverage-prepare','coverage']]),args=process.argv.slice(2),index=args.indexOf('--from');
assert.ok(index>=0,'--from FIRST-EVIDENCE required');const priorEvidence=path.resolve(args[index+1]),input=read(path.join(priorEvidence,'live-input.json'));
const original=args.includes('--prior')?path.resolve(args[args.indexOf('--prior')+1]):path.join(input.project_root,'.acceptance-local',input.acceptance_id,'workflows/coverage',input.request_id,'preparation');
const attempt=args.includes('--request-id')?args[args.indexOf('--request-id')+1]:'live-repair-1';
const request={...input,request_id:attempt,basis:args.includes('--basis')?args[args.indexOf('--basis')+1]:'修复此前真实覆盖率准备失败；只读核对前次失败收据与已冻结适配器，复用当前运行环境并执行本次新探针。不运行业务测试。',prior_attempts:[original]};
const old=snapshot(original);h.save('repair-input.json',request);let result;
h.test('REPAIR-COVERAGE-01','同一 AT 的官方 CLI 独立角色检查原失败并修复采集链，重新核对零/非零探针',()=>{
  const cli=h.cli('acceptance-coverage-prepare',request,'repair-coverage',input.project_root,{timeout:1000000,env:{...process.env,ACCEPTANCE_AGENT:'codex',ACCEPTANCE_MODEL:'gpt-6.1-sol',SPEX_HOME:path.join(h.temporary,'spex')}});h.settled(cli,'acceptance-coverage-prepare','done');
  result=read(path.join(input.project_root,'.acceptance-local',input.acceptance_id,'workflows/coverage',attempt,'result.json'));assert.equal(result.status,'ready');
  const runtime=read(input.runtime_manifest);assert.equal(fs.existsSync(path.join(runtime.workspace,'BUSINESS_TEST_WAS_RUN')),false);
  assert.deepEqual(snapshot(original),old);h.save('repair-result.json',result);return {result,original_failure_preserved:true};
});
let error;try{if(result){const before=snapshot(path.dirname(result.receipt_path)),again=await prepareCoverage(request);assert.equal(again.status,'ready');assert.equal(again.current_binding_verified,true);assert.deepEqual(snapshot(path.dirname(result.receipt_path)),before);}else throw Error('No verified preparation; no cache claim');}catch(e){error=e;}
h.test('REPAIR-COVERAGE-02','相同修复请求只核验资料，不重复调用角色或探针',()=>{if(error)throw error;});
h.finish(['workflows/coverage/stage.mjs','workflows/coverage/roles/preparer.mjs','tests/retry_coverage.integration.mjs']);
