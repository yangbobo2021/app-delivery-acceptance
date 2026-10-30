import {commandRegistry} from '../shared/command.mjs';
import {planChange} from './stage.mjs';
export default commandRegistry({id:'acceptance-change-plan',intent:'Select only authorized affected scenes using frozen definition differences and actual execution history; preserve unexecuted and deferred work, without running tests.',successState:'planned',operation:planChange});
