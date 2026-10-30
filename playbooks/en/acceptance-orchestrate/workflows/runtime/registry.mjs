import {readonlyAgentRegistry} from '../shared/readonly-agent.mjs';
import {prepare,finalize,fail} from './stage.mjs';
import {runtimePlanSchema} from './response-schema.mjs';
export default readonlyAgentRegistry({id:'acceptance-runtime',role:'preparer',intent:'Plan the project runtime in an independent role, then execute and verify installation and a repeatable nonbusiness smoke through the host; stop before coverage or case execution.',prepare,finalize,fail,resultSchema:runtimePlanSchema});
