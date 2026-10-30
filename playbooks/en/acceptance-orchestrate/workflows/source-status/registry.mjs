import {commandRegistry} from '../shared/command.mjs';
import {recordSourceStatus} from './stage.mjs';
export default commandRegistry({id:'acceptance-source-status',intent:'Record an actual external-source read failure or explicitly confirmed deletion without removing frozen obligations or rewriting historical source text.',successState:'recorded',operation:recordSourceStatus});
