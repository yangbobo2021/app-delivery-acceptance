import { readonlyAgentRegistry } from '../shared/readonly-agent.mjs';
import {prepare,finalize,fail} from './stage.mjs';

export default readonlyAgentRegistry({id:'acceptance-analyze',role:'analyst',
  intent:'Analyze all admitted original requirements into a goal, scope and context groups, and stop before scenario generation or testing.',prepare,finalize,fail});
