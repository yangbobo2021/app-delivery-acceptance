import {commandRegistry} from '../shared/command.mjs';
import {executeScenario} from './stage.mjs';
export default commandRegistry({rolePolicies:{reviewer:{fileWrite:'deny',shellExecute:'allow',networkAccess:'deny'},repairer:{mode:'bypass'}},roles:["reviewer", "repairer"],id:'acceptance-execute',successState:'done',intent:'Execute one frozen ready case selection, freeze actual evidence, obtain independent review and perform only bounded authorized test repairs; retain all prior attempts.',operation:executeScenario});
