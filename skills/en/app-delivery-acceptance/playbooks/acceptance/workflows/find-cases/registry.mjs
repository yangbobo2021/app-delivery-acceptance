import {readonlyAgentRegistry} from '../shared/readonly-agent.mjs';
import {prepare,finalize,fail} from './stage.mjs';
export default readonlyAgentRegistry({id:'acceptance-find-cases',role:'finder',intent:'Statically associate actual existing tests with the current scene; the host verifies citations and applies only permanent identity comments, without test execution.',prepare,finalize,fail});
