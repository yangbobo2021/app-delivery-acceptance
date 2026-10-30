import {readonlyAgentRegistry} from '../shared/readonly-agent.mjs';
import {prepare,finalize,fail} from './stage.mjs';
export default readonlyAgentRegistry({id:'acceptance-assess-scenarios',role:'scenario_reviewer',intent:'When explicitly requested, independently assess the frozen selected target’s scene coverage, scope, importance and visual criteria without executing cases or editing adopted definitions.',prepare,finalize,fail});
