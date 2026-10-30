import {commandRegistry} from '../shared/command.mjs';
import {generateReport} from './stage.mjs';
export default commandRegistry({id:'acceptance-report',intent:'Export a readable frozen report and only its linked evidence for an explicitly selected AT, without changing the execution pointer or running tests.',successState:'reported',operation:generateReport});
