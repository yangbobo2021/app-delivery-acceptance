import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';
import {freezeAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/freeze/registry.mjs';
import {harness,read,sha,snapshot} from './official_workflow_harness.mjs';

const h=harness('acceptance-scenarios-ui',[['acceptance-scenarios','scenarios',{designer:'acceptance.ui-designer'}]]);
if(!h.live)throw Error('Pass --live-cli for this real-model UI-design test');
const root=h.project('ui-project'),at='AT-ui-design';
h.run('git-init','git',['init','-q',root]);h.run('git-initial-commit','git',['-C',root,'-c','user.name=Integration Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','fixture']);
let input;
h.test('UI-DESIGN-01','冻结真实 UI 约定及相邻需求，设计前不启动应用',()=>{
  createAcceptance({project_root:root,acceptance_id:at,request_id:'create',user_request:'先设计新增表单的验收场景，不执行。'});
  freezeAcceptance({project_root:root,acceptance_id:at,request_id:'freeze',base_definitions_sha256:null,basis:'用户明确要求先设计、不执行；以下是前向测试原始需求。',definitions:{
    context:{business_goal:'为新增表单设计业务和视觉验收点。',shared_constraints:'不得虚构品牌色、具体接口或未知的错误文案。'},
    requirements:[{id:'R-UI',text:'在桌面浏览器中打开新增表单，标签与输入框应可见、可读且无遮挡，提交按钮完整显示。用户填写标题并点击保存后显示创建成功，列表中出现对应标题；取消时不得创建记录。',origin:{kind:'user-statement',reference:'fixture:user-ui-requirement'},external_refs:[]},
      {id:'R-OTHER',text:'已保存标题可以被搜索。',origin:{kind:'user-statement',reference:'fixture:other-requirement'},external_refs:[]}]}});
  input={project_root:root,acceptance_id:at,request_id:'design-ui',target_id:'R-UI',definitions_sha256:sha(path.join(root,'.acceptance',at,'scenarios.json'))};
  h.save('input.json',input);h.save('before.json',snapshot(root));
});
h.test('UI-DESIGN-02','真实 Designer 识别 UI，并把视觉原文绑定到每个目标场景',()=>{
  const latest=path.join(root,'.acceptance',at,'scenarios.json'),before=sha(latest);
  const result=h.cli('acceptance-scenarios',input,'live-ui-design',root);h.settled(result,'acceptance-scenarios','done');
  const folder=path.join(root,'.acceptance-local',at,'workflows/scenarios/design-ui'),receipt=read(path.join(folder,'result.json'));
  const candidate=read(receipt.candidate_definitions.path),scenes=candidate.scenarios.filter(s=>s.requirement_id==='R-UI'),check=read(path.join(folder,'selfcheck.current.json'));
  assert.equal(check.ui_requirement.required,true);assert.ok(scenes.length>=2);
  assert.ok(scenes.every(s=>s.ui_acceptance?.required===true&&s.ui_acceptance.visual_expectation&&s.description.includes(s.ui_acceptance.visual_expectation)));
  assert.ok(candidate.scenarios.every(s=>s.requirement_id==='R-UI'));assert.equal(sha(latest),before);
  assert.equal(receipt.semantic_review,'not_independent');assert.equal(receipt.adopted,false);
  assert.ok(!fs.existsSync(path.join(root,'.acceptance-local',at,'workspace')));
  h.save('receipt.json',receipt);h.save('candidate.json',candidate);h.save('selfcheck.json',check);
  return {output:result.envelope,scene_ids:scenes.map(s=>s.id),note:'验证 UI 场景设计契约，不代表已经操作或验收真实界面。'};
});
h.finish(['workflows/shared/readonly-agent.mjs','workflows/scenarios/stage.mjs','tests/acceptance_scenarios_ui.integration.mjs']);
