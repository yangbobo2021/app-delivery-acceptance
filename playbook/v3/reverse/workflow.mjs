import {xstate,runtime} from '../runtime-path.mjs';
const {setup,assign,fromPromise}=xstate;
const {createXStatePlaybookRuntime,snapshotJsonValue}=runtime;
const meta=(id,description,role)=>({id,description,meta:{playbook:{stateId:id,description,...(role?{role}:{})}}});
const accepted=(source,target)=>({type:'playbook.acceptedOutcome',params:{source,target,acceptedOutcome:'submitted'}});
const machine=setup({
 actors:{player:fromPromise(async()=>{throw Error('runner supplies player')}),script:fromPromise(async()=>{throw Error('runner supplies gate')})},
 actions:{remember:assign(({event})=>({task:event.task})),error:assign(({event})=>({lastError:String(event.error?.message??event.error)})),
  'playbook.acceptedOutcome':()=>{}},
 guards:{submitted:({event})=>event.output?.guard==='submitted',passed:({event})=>event.output?.guard==='passed',
  revision:({context})=>context.revision===true},
}).createMachine({id:'commit-reverse-rules',initial:'ready',context:({input})=>({...input,task:''}),states:{
 ready:{...meta('ready','等待冻结提交逆向任务'),tags:'playbook.parked',on:{BOSS_TASK:[
  {guard:'revision',target:'revise',actions:'remember'},{target:'analyze',actions:'remember'}]}},
 analyze:{...meta('analyze','从冻结差异及独立合同识别受影响需求和规则','analyst'),tags:'playbook.busy',
  invoke:{src:'player',input:{stateId:'analyze',sourceItem:'ANALYZE',role:'analyst',prompt:'analyze',result:{submitted:'Candidate submitted.'}},
   onDone:[{guard:'submitted',target:'draftGate',actions:accepted('analyze','draftGate')},{target:'blocked'}],onError:{target:'blocked',actions:'error'}}},
 revise:{...meta('revise','针对上轮审查缺口补证并修订逆向草案','analyst'),tags:'playbook.busy',
  invoke:{src:'player',input:{stateId:'revise',sourceItem:'REVISE',role:'analyst',prompt:'revise',result:{submitted:'Candidate submitted.'}},
   onDone:[{guard:'submitted',target:'draftGate',actions:accepted('revise','draftGate')},{target:'blocked'}],onError:{target:'blocked',actions:'error'}}},
 draftGate:{...meta('draftGate','核验逆向规则来源和变更绑定'),tags:'playbook.busy',
  invoke:{src:'script',input:({context})=>({stateId:'draftGate',sourceItem:'DRAFT-GATE',command:context.prefix+' draft',result:{passed:'Draft valid.',failed:'Draft invalid.'}}),
   onDone:[{guard:'passed',target:'review'},{target:'blocked'}],onError:{target:'blocked',actions:'error'}}},
 review:{...meta('review','独立审查规则的合同依据和变更适用性','reviewer'),tags:'playbook.busy',
  invoke:{src:'player',input:{stateId:'review',sourceItem:'REVIEW',role:'reviewer',prompt:'review',result:{submitted:'Candidate submitted.'}},
   onDone:[{guard:'submitted',target:'reviewGate',actions:accepted('review','reviewGate')},{target:'blocked'}],onError:{target:'blocked',actions:'error'}}},
 reviewGate:{...meta('reviewGate','核验独立审查与来源哈希'),tags:'playbook.busy',
  invoke:{src:'script',input:({context})=>({stateId:'reviewGate',sourceItem:'REVIEW-GATE',command:context.prefix+' review',result:{passed:'Rules approved.',failed:'Rules not approved.'}}),
   onDone:[{guard:'passed',target:'done'},{target:'blocked'}],onError:{target:'blocked',actions:'error'}}},
 done:{...meta('done','本提交逆向规则已独立审查'),type:'final'},
 blocked:{...meta('blocked','规则来源、范围或审查尚未通过'),tags:'playbook.parked'},
}});
export default createXStatePlaybookRuntime(machine,{
 label:'COMMIT-REVERSE-RULES',compat:{artifactSchema:3,runtimeAbi:1},snapshotOptions:x=>snapshotJsonValue(x,'reverse options'),machineInput:x=>x,
 entryEvent:{type:'BOSS_TASK',textField:'task',contextField:'task'},
 roleStates:{analyze:{role:'analyst',label:'从冻结差异及独立合同识别受影响需求和规则'},
  revise:{role:'analyst',label:'针对上轮审查缺口补证并修订逆向草案'},
  review:{role:'reviewer',label:'独立审查规则的合同依据和变更适用性'}},
 outcomeAuthority:{governedPlayerStates:{analyze:{submitted:{fields:{},repositoryDisposition:'unchanged'}},
  revise:{submitted:{fields:{},repositoryDisposition:'unchanged'}},review:{submitted:{fields:{},repositoryDisposition:'unchanged'}}}},
 scriptCwd:x=>x.cwd,controlContextFields:[],
});
