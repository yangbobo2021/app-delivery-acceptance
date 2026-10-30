import {commandRegistry} from '../shared/command.mjs';
import {prepareCases} from './stage.mjs';
// Existing-only selection also runs the bound debug entry and writes isolated
// observations. Its source/test immutability is enforced by the host policy gate.
export default commandRegistry({rolePolicies:{finder:{mode:'bypass'},implementer:{mode:'bypass'},evaluator:{fileWrite:'deny',shellExecute:'allow',networkAccess:'deny'}},roles:["finder", "implementer", "evaluator"],id:'acceptance-cases',successState:'done',intent:'Find, reuse, extend or implement real cases for one frozen scene, perform bounded local debugging and independent advisory design evaluation, then stop before formal execution.',operation:prepareCases});
