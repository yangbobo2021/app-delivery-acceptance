import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {harness,read,sha} from './official_workflow_harness.mjs';
import {AcceptanceView} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/view/data.mjs';
import {createViewServer} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/view/server.mjs';
const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];assert.ok(args.includes('--from')&&args.includes('--ui-evidence')&&args.includes('--live-cli'));
const h=harness('acceptance-archive-resume',[['acceptance-cleanup','cleanup']]),source=path.resolve(option('--from')),f=read(path.join(path.resolve(option('--ui-evidence')),'fixture.json')),archived=read(path.join(source,'archive-result.json'));
const root=f.root,at=f.at;assert.ok(root.includes('/acceptance-ui-execution-test-'));assert.equal(read(path.join(source,'finish-result.json')).status,'finished');
const pointer=path.join(root,'.acceptance-local/current.json'),pointerHash=sha(pointer);assert.equal(read(pointer).acceptance_id,'AT-other');
const metrics=path.join(root,'.acceptance-local',at,'workflows/execute/real-browser/review/metrics.json');
if(fs.existsSync(metrics))fs.copyFileSync(metrics,path.join(h.output,'original-review-metrics.json'));
const server=createViewServer(root,{selected:at});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const {chromium}=await import(f.playwright),browser=await chromium.launch({headless:true,executablePath:f.browserExecutable});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?acceptance_id='+at);
 await page.getByRole('button',{name:'点击后清楚显示完成结果',exact:true}).waitFor();
 await page.screenshot({path:path.join(h.output,'01-original-finished-at.png'),fullPage:true});
 await page.getByLabel('验收测试 ID',{exact:true}).selectOption('AT-other');
 await page.waitForFunction(()=>document.querySelector('#acceptanceWarning').textContent.includes('缺少完整冻结清单'));
 await page.screenshot({path:path.join(h.output,'02-empty-selected-at.png'),fullPage:true});
 h.test('VIEW-RESUME-01','切换到仅创建的空 AT 后显示正常未冻结状态、清空上一 AT 的关系，指针字节不变',()=>{
  assert.equal(sha(pointer),pointerHash);assert.deepEqual(errors,[]);const value=new AcceptanceView(root).snapshot('AT-other');assert.equal(value.statistics.total,0);assert.equal(value.denominator_complete,false);
 });
 const input={project_root:root,acceptance_id:at,request_id:'cleanup-owned-ui-fixture-resumed',basis:'Continue the preserved owned-fixture lifecycle after correcting empty-container viewing. Verify durable candidates and archive, clean only the finished old AT, retain the active AT-other.',assets:['workspace','workflows'],archive_record:archived.record,candidate_test_roots:['tests'],missing_attachment_limits:['Only final reviewed evidence is shared; raw model sessions and runtime install observations are intentionally retired. Coverage was explicitly off.']};
 const cli=h.cli('acceptance-cleanup',input,'actual-cleanup-after-view-fix',root);h.settled(cli,'acceptance-cleanup','cleaned');
 h.test('CLEANUP-RESUME-01','官方 CLI 实际清理已结束 AT 的指定资产，保留候选备份、归档及另一活动 AT',()=>{
  assert.equal(fs.existsSync(f.workspace),false);assert.equal(sha(pointer),pointerHash);assert.ok(fs.existsSync(archived.record));
 });
 const offline=new AcceptanceView(root).snapshot(at);h.save('archived-only-snapshot.json',offline);
 h.test('ARCHIVE-RESUME-01','移除原工作树后从真实归档保留已执行和独立通过事实，并明确源码不可用',()=>{
  assert.equal(offline.statistics.executed,1);assert.equal(offline.statistics.passed,1);assert.equal(offline.project_state.traces[0].case_presentations.S1.cases[0].source.verification,'unavailable');assert.equal(sha(pointer),pointerHash);
 });
 await page.getByLabel('验收测试 ID',{exact:true}).selectOption(at);await page.getByRole('button',{name:'点击后清楚显示完成结果',exact:true}).waitFor();
 await page.screenshot({path:path.join(h.output,'03-archived-only-at.png'),fullPage:true});assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
h.finish(['workflows/view/data.mjs','workflows/cleanup/stage.mjs','tests/acceptance_archive_resume.integration.mjs']);
