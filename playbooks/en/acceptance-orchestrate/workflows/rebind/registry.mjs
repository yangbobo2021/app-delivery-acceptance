import {commandRegistry} from '../shared/command.mjs';
import {rebindWorkspace} from './stage.mjs';
export default commandRegistry({id:'acceptance-rebind',intent:'Preserve old evidence and candidate test bytes, switch the isolated workspace to an explicitly selected immutable product revision without force, and rebind unchanged permanent tests; require fresh runtime/coverage preparation.',successState:'rebound',operation:rebindWorkspace});
