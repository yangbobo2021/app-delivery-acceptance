import {readFileSync} from 'node:fs';
import {xstate,runtime} from '../runtime-path.mjs';
const {createXStatePlaybookRuntime,snapshotJsonValue}=runtime;
const {setup,fromPromise,assign}=xstate;
const meta=(id,description,role)=>({id,description,meta:{playbook:{stateId:id,description,...(role?{role}:{})}}});
const accepted=(source,target)=>({type:'playbook.acceptedOutcome',params:{source,target,acceptedOutcome:'submitted'}});
const submitted={submitted:'The candidate artifact was submitted. The repository remains unchanged.'};
const gate=(c,name)=>{try{return JSON.parse(readFileSync(c.folder+'/'+name+'-gate.json','utf8'))}catch{return {status:'invalid'}}};
const machine=setup({actors:{player:fromPromise(async()=>{throw Error('runner provides player')}),script:fromPromise(async()=>{throw Error('runner provides script')})},
 actions:{remember:assign(({event})=>({bossTask:event.task})),nextAttempt:assign(({context})=>({attempt:context.attempt+1})),
  'playbook.acceptedOutcome':()=>{},rememberError:assign(({event})=>({lastError:String(event.error?.message??event.error)}))},
 guards:{submitted:({event})=>event.output?.guard==='submitted',passed:({event})=>event.output?.guard==='passed',
  approved:({context})=>gate(context,'review').status==='passed',bug:({context})=>gate(context,'review').status==='product_bug',
  repair:({context})=>gate(context,'review').status==='repair_required',withinRepair:({context})=>context.attempt<context.maxAttempts,
  scenarioRepair:({context})=>gate(context,'review').repair_target==='scenario',
  caseRepair:({context})=>['case_design','case_code'].includes(gate(context,'review').repair_target),
  evidenceRepair:({context})=>gate(context,'review').repair_target==='evidence',
}}).createMachine({id:'scenario-cases',initial:'ready',context:({input})=>({...input,bossTask:'',attempt:input.initialAttempt??1}),states:{
 ready:{...meta('ready','等待单场景用例任务'),tags:'playbook.parked',on:{BOSS_TASK:[
  {guard:({context})=>context.resumeFromExecution===true,target:'review',actions:'remember'},
  {guard:({context})=>context.resumeFromReview===true,target:'reviewGate',actions:'remember'},
  {target:'design',actions:'remember'}]}},
 design:{...meta('design','设计用例与复用路径','designer'),tags:'playbook.busy',invoke:{src:'player',input:({context})=>({stateId:'design',sourceItem:'DESIGN',role:'designer',prompt:JSON.stringify({phase:'design',attempt:context.attempt}),result:submitted}),onDone:[{guard:'submitted',target:'planGate',actions:accepted('design','planGate')},{target:'blocked'}],onError:{target:'blocked',actions:'rememberError'}}},
 planGate:{...meta('planGate','检查场景绑定和用例计划'),tags:'playbook.busy',invoke:{src:'script',input:({context})=>({stateId:'planGate',sourceItem:'PLAN-GATE',command:context.commandPrefix+' plan '+context.attempt,result:{passed:'Case plan structurally valid.',failed:'Inspect plan-gate.json.'}}),onDone:[{guard:'passed',target:'caseImplementation'},{guard:({context})=>context.attempt<2,target:'design',actions:'nextAttempt'},{target:'blocked'}],onError:{target:'blocked',actions:'rememberError'}}},
 caseImplementation:{...meta('caseImplementation','等待用例代码或手工执行准备并核查版本'),tags:'playbook.parked',on:{BOSS_TASK:{target:'execute',actions:'remember'}}},
 execute:{...meta('execute','执行逐用例并冻结证据'),tags:'playbook.busy',invoke:{src:'script',input:({context})=>({stateId:'execute',sourceItem:'EXECUTE',command:context.commandPrefix+' execute '+context.attempt,result:{passed:'Cases executed and evidence frozen.',failed:'Inspect execute-gate.json.'}}),onDone:[{guard:'passed',target:'review'},{guard:({context})=>gate(context,'execute').status==='needs_implementation',target:'caseImplementation'},{target:'blocked'}],onError:{target:'blocked',actions:'rememberError'}}},
 review:{...meta('review','独立核验设计、执行和证据','reviewer'),tags:'playbook.busy',invoke:{src:'player',input:({context})=>({stateId:'review',sourceItem:'REVIEW',role:'reviewer',prompt:JSON.stringify({phase:'review',attempt:context.attempt}),result:submitted}),onDone:[{guard:'submitted',target:'reviewGate',actions:accepted('review','reviewGate')},{target:'blocked'}],onError:{target:'blocked',actions:'rememberError'}}},
 reviewGate:{...meta('reviewGate','核对审查绑定与终态'),tags:'playbook.busy',invoke:{src:'script',input:({context})=>({stateId:'reviewGate',sourceItem:'REVIEW-GATE',command:context.commandPrefix+' review '+context.attempt,result:{passed:'Independent assessment structurally valid.',failed:'Inspect review-gate.json.'}}),onDone:[{guard:'approved',target:'passed'},{guard:'bug',target:'product_bug'},{guard:'repair',target:'repair_required'},{target:'blocked'}],onError:{target:'blocked',actions:'rememberError'}}},
 repair_required:{...meta('repair_required','保留审查问题，等待修正同场景本轮尝试'),tags:'playbook.parked',on:{BOSS_TASK:[
  {guard:({context})=>context.attempt<context.maxAttempts&&gate(context,'review').repair_target==='scenario',target:'reviseScene',actions:['remember','nextAttempt']},
  {guard:({context})=>context.attempt<context.maxAttempts&&gate(context,'review').repair_target==='case_design',target:'design',actions:['remember','nextAttempt']},
  {guard:({context})=>context.attempt<context.maxAttempts&&gate(context,'review').repair_target==='case_code',target:'caseImplementation',actions:['remember','nextAttempt']},
  {guard:({context})=>context.attempt<context.maxAttempts&&gate(context,'review').repair_target==='evidence',target:'execute',actions:['remember','nextAttempt']},
  {target:'blocked'}]}},
 reviseScene:{...meta('reviseScene','按审查问题修正场景描述并版本化','designer'),tags:'playbook.busy',invoke:{src:'player',input:({context})=>({stateId:'reviseScene',sourceItem:'REVISE-SCENE',role:'designer',prompt:JSON.stringify({phase:'scene_repair',attempt:context.attempt}),result:submitted}),onDone:[{guard:'submitted',target:'sceneGate',actions:accepted('reviseScene','sceneGate')},{target:'blocked'}],onError:{target:'blocked',actions:'rememberError'}}},
 sceneGate:{...meta('sceneGate','校验场景修订与版本绑定'),tags:'playbook.busy',invoke:{src:'script',input:({context})=>({stateId:'sceneGate',sourceItem:'SCENE-GATE',command:context.commandPrefix+' scene '+context.attempt,result:{passed:'Scenario revision saved and prior execution invalidated.',failed:'Inspect scene-gate.json.'}}),onDone:[{guard:'passed',target:'design'},{target:'blocked'}],onError:{target:'blocked',actions:'rememberError'}}},
 passed:{...meta('passed','场景证据经独立审查通过'),type:'final'},
 product_bug:{...meta('product_bug','确认产品BUG，保留证据'),type:'final'},
 blocked:{...meta('blocked','保留未解决问题'),tags:'playbook.parked'}
}});
export default createXStatePlaybookRuntime(machine,{label:'SCENARIO-CASES-ISOLATED',compat:{artifactSchema:3,runtimeAbi:1},
 snapshotOptions:x=>snapshotJsonValue(x,'scenario-case options'),machineInput:x=>x,
 entryEvent:{type:'BOSS_TASK',textField:'task',contextField:'bossTask'},
 roleStates:{design:{role:'designer',label:'设计用例与复用路径'},reviseScene:{role:'designer',label:'按审查问题修正场景描述并版本化'},review:{role:'reviewer',label:'独立核验设计、执行和证据'}},
 outcomeAuthority:{governedPlayerStates:{design:{submitted:{fields:{},repositoryDisposition:'unchanged'}},reviseScene:{submitted:{fields:{},repositoryDisposition:'unchanged'}},review:{submitted:{fields:{},repositoryDisposition:'unchanged'}}}},
 scriptCwd:x=>x.cwd,controlContextFields:[]});
