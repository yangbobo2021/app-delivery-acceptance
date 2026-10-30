import {commandRegistry} from '../shared/command.mjs';
import {recoverAcceptance} from './stage.mjs';
export default commandRegistry({id:'acceptance-recover',intent:'Inspect interrupted ownership, processes and effects; adopt only verified completed work or authorize one same-session continuation without replaying unknown operations.',successState:'reconciled',operation:recoverAcceptance});
