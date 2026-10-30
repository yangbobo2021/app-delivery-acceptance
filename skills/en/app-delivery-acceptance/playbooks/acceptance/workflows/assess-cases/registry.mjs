import {readonlyAgentRegistry} from '../shared/readonly-agent.mjs';
import {prepare,finalize,fail} from './stage.mjs';

export default readonlyAgentRegistry({id:'acceptance-assess-cases',role:'evaluator',advisory:true,
  intent:'Describe the design contribution, gaps and redundancy of the current scene case group; do not select, run or repair tests or judge the product.',prepare,finalize,fail});
