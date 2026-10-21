import {readFileSync} from 'node:fs';
import {xstate,runtime} from '../runtime-path.mjs';
const {setup,assign,fromPromise}=xstate;
const {createXStatePlaybookRuntime,snapshotJsonValue}=runtime;
const meta=(stateId,description,role)=>({id:stateId,description,meta:{playbook:{stateId,description,...(role?{role}:{})}}});
const submitted={submitted:'The candidate artifact was submitted. The repository remains unchanged.'};
const accepted=(source,target)=>({type:'playbook.acceptedOutcome',params:{source,target,acceptedOutcome:'submitted'}});
const gateReport=(c,stage)=>{try{return JSON.parse(readFileSync(c.folder+'/'+stage+'-gate.json','utf8'))}catch{return {status:'invalid'}}};
const machine=setup({actors:{player:fromPromise(async()=>{throw Error('provided by runner')}),script:fromPromise(async()=>{throw Error('provided by runner')})},
 actions:{remember:assign(({event})=>({bossTask:event.task})),advance:assign(({context})=>({round:context.round+1})),
  advanceReview:assign(({context})=>({reviewAttempts:context.reviewAttempts+1})),
  'playbook.acceptedOutcome':()=>{},rememberError:assign(({event})=>({lastError:{name:'Error',message:String(event.error?.message??event.error)}}))},
 guards:{submitted:({event})=>event.output?.guard==='submitted',passed:({event})=>event.output?.guard==='passed',
  feedback:({context})=>context.initialFeedback,initial:({context})=>context.initialDraft,canDraftRepair:({context})=>context.round<context.maxRounds,
  canReviewRetry:({context})=>gateReport(context,'review').status==='invalid'&&context.reviewAttempts<context.maxReviewAttempts,
  canRepair:({context})=>gateReport(context,'review').status==='changes_required'&&context.round<context.maxRounds},
}).createMachine({id:'requirement-scenarios',initial:'ready',context:({input})=>({...input,bossTask:'',round:input.initialDraft||input.initialFeedback?1:0,reviewAttempts:0}),states:{
 ready:{...meta('ready','等待单需求场景设计任务'),tags:'playbook.parked',on:{BOSS_TASK:[{guard:'feedback',target:'generate',actions:'remember'},{guard:'initial',target:'review',actions:'remember'},{target:'generate',actions:'remember'}]}},
 generate:{...meta('generate','生成或修正目标需求的场景','analyst'),tags:'playbook.busy',entry:'advance',invoke:{src:'player',input:({context})=>({stateId:'generate',sourceItem:'GENERATE',role:'analyst',prompt:JSON.stringify({phase:'generate',round:context.round}),result:submitted}),onDone:[{guard:'submitted',target:'draftGate',actions:accepted('generate','draftGate')},{target:'blocked'}],onError:{target:'blocked',actions:'rememberError'}}},
 draftGate:{...meta('draftGate','校验并保存场景草案'),tags:'playbook.busy',invoke:{src:'script',input:({context})=>({stateId:'draftGate',sourceItem:'DRAFT-GATE',command:context.commandPrefix+' draft '+context.round,result:{passed:'Draft structurally valid.',failed:'Inspect draft-gate.json.'}}),onDone:[{guard:'passed',target:'review'},{guard:'canDraftRepair',target:'generate'},{target:'blocked'}],onError:{target:'blocked',actions:'rememberError'}}},
 review:{...meta('review','独立审查评级、覆盖与关联范围','reviewer'),tags:'playbook.busy',entry:'advanceReview',invoke:{src:'player',input:({context})=>({stateId:'review',sourceItem:'REVIEW',role:'reviewer',prompt:JSON.stringify({phase:'review',round:context.round}),result:submitted}),onDone:[{guard:'submitted',target:'reviewGate',actions:accepted('review','reviewGate')},{target:'blocked'}],onError:{target:'blocked',actions:'rememberError'}}},
 reviewGate:{...meta('reviewGate','核对审查绑定及结论一致性'),tags:'playbook.busy',invoke:{src:'script',input:({context})=>({stateId:'reviewGate',sourceItem:'REVIEW-GATE',command:context.commandPrefix+' review '+context.round,result:{passed:'Independent review approved with consistent bindings.',failed:'Read reviewer findings and gate report.'}}),onDone:[{guard:'passed',target:'done'},{guard:'canReviewRetry',target:'review'},{guard:'canRepair',target:'generate'},{target:'blocked'}],onError:{target:'blocked',actions:'rememberError'}}},
 done:{...meta('done','场景设计通过独立审查'),type:'final'},
 blocked:{...meta('blocked','保留未解决的审查或调用问题'),tags:'playbook.parked'},
}});
export default createXStatePlaybookRuntime(machine,{
 label:'REQUIREMENT-SCENARIOS-PROTOTYPE',compat:{artifactSchema:3,runtimeAbi:1},snapshotOptions:x=>snapshotJsonValue(x,'scenario options'),machineInput:x=>x,
 entryEvent:{type:'BOSS_TASK',textField:'task',contextField:'bossTask'},
 roleStates:{generate:{role:'analyst',label:'生成或修正目标需求的场景'},review:{role:'reviewer',label:'独立审查评级、覆盖与关联范围'}},
 outcomeAuthority:{governedPlayerStates:{generate:{submitted:{fields:{},repositoryDisposition:'unchanged'}},review:{submitted:{fields:{},repositoryDisposition:'unchanged'}}}},
 scriptCwd:x=>x.cwd,controlContextFields:[],
});
