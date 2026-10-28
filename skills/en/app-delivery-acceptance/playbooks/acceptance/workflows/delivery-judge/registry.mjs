import {readonlyAgentRegistry} from '../shared/readonly-agent.mjs';
import {prepare,finalize,fail} from './stage.mjs';
export default readonlyAgentRegistry({id:'acceptance-delivery-judge',role:'delivery_reviewer',intent:'Independently judge the complete selected requirement or PR against frozen obligations, all necessary scenes and actual same-version independent results, retaining exclusions and unresolved gaps.',prepare,finalize,fail});
