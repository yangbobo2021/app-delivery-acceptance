import {commandRegistry} from '../shared/command.mjs';
import {reviewManualExecution} from './stage.mjs';
export default commandRegistry({rolePolicies:{reviewer:{fileWrite:'deny',shellExecute:'deny',networkAccess:'deny'}},roles:["reviewer"],id:'acceptance-manual-execute',intent:'Freeze actual operator actions and black-box evidence without fabricating a command run or code coverage, then independently review the frozen text and real image pixels.',successState:'reviewed',operation:reviewManualExecution});
