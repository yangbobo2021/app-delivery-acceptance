import {xstate, runtime} from '../runtime-path.mjs';
const {setup, assign, fromPromise} = xstate;
const {createXStatePlaybookRuntime, snapshotJsonValue} = runtime;

// Isolated, handwritten Playbook artifact using the installed schema-3 engine.
// One Analyst invocation; no Reviewer, nested workflow, or application execution.
const meta = (stateId, description, role) => ({id:stateId, description,
  meta:{playbook:{stateId, description, ...(role?{role}:{})}}});
const machine = setup({
  actors:{player:fromPromise(async()=>{throw Error('runner supplies player')}),
    script:fromPromise(async()=>{throw Error('runner supplies script')})},
  actions:{
    remember:assign(({event})=>({bossTask:event.task})),
    rememberError:assign(({event})=>({lastError:{name:'Error',message:String(event.error?.message??event.error)}})),
    'playbook.acceptedOutcome':()=>{},
  },
  guards:{submitted:({event})=>event.output?.guard==='submitted',
    validated:({event})=>event.output?.guard==='passed'},
}).createMachine({id:'preanalysis', initial:'ready',
  context:({input})=>({...input,bossTask:''}),
  states:{
    ready:{...meta('ready','等待新建或编辑前置分析'),tags:'playbook.parked',
      on:{BOSS_TASK:{target:'analyze',actions:'remember'}}},
    analyze:{...meta('analyze','新建或编辑目标、范围与需求分组','analyst'),tags:'playbook.busy',
      invoke:{src:'player',input:({context})=>({stateId:'analyze',sourceItem:'ANALYZE',role:'analyst',
        prompt:context.prompt,result:{submitted:'Candidate analysis submitted. The repository remains unchanged.'}}),
        onDone:[{guard:'submitted',target:'validate',actions:{type:'playbook.acceptedOutcome',params:{source:'analyze',target:'validate',acceptedOutcome:'submitted'}}},
          {target:'failed'}],onError:{target:'failed',actions:'rememberError'}}},
    validate:{...meta('validate','程序校验并保存分析版本'),tags:'playbook.busy',
      invoke:{src:'script',input:({context})=>({stateId:'validate',sourceItem:'VALIDATE',command:context.validationCommand,
        result:{passed:'Analysis saved after structural validation.',failed:'Validation failed; inspect validation.json.'}}),
        onDone:[{guard:'validated',target:'done'},{target:'failed'}],onError:{target:'failed',actions:'rememberError'}}},
    done:{...meta('done','前置分析已完成'),type:'final'},
    failed:{...meta('failed','前置分析失败，保留输入与诊断'),tags:'playbook.parked'},
  }});
export default createXStatePlaybookRuntime(machine,{
  label:'PREANALYSIS-PROTOTYPE',compat:{artifactSchema:3,runtimeAbi:1},
  snapshotOptions:value=>snapshotJsonValue(value,'preanalysis options'),
  machineInput:options=>options,
  entryEvent:{type:'BOSS_TASK',textField:'task',contextField:'bossTask'},
  roleStates:{analyze:{role:'analyst',label:'新建或编辑目标、范围与需求分组'}},
  outcomeAuthority:{governedPlayerStates:{analyze:{submitted:{fields:{},repositoryDisposition:'unchanged'}}}},
  controlContextFields:[],scriptCwd:options=>options.cwd,
});
