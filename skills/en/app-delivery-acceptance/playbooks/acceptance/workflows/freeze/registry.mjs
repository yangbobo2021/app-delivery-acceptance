import { commandRegistry } from '../shared/command.mjs';
import {freezeAcceptance} from './freeze.mjs';
export {freezeAcceptance} from './freeze.mjs';
export default commandRegistry({ id: 'acceptance-freeze',
  intent: 'Freeze only the explicitly supplied requirements, rules and adopted scenarios; preserve history and stop before generation or execution.',
  successState: 'frozen', operation: freezeAcceptance });
