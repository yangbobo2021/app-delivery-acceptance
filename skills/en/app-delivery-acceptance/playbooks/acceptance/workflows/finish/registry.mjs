import {commandRegistry} from '../shared/command.mjs';
import {finishAcceptance} from './stage.mjs';
export default commandRegistry({id:'acceptance-finish',intent:'Save scope, relations, versions, independent conclusions and unfinished limits before clearing only the matching current pointer; finishing itself never creates a pass.',successState:'finished',operation:finishAcceptance});
