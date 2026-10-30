import {readonlyAgentRegistry} from '../shared/readonly-agent.mjs';
import {prepare,finalize,fail} from './stage.mjs';
export default readonlyAgentRegistry({id:'acceptance-reverse',role:'analyst',intent:'Analyze the frozen complete commit/PR change with one read-only role and internal self-check; stop at rule candidates and unresolved questions.',prepare,finalize,fail});
