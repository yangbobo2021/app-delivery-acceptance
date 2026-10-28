import {commandRegistry} from '../shared/command.mjs';
import {prepareCoverage} from './stage.mjs';
export default commandRegistry({rolePolicies:{coverage_preparer:{fileWrite:'allow',shellExecute:'allow',networkAccess:'allow'}},roles:["coverage_preparer"],id:'acceptance-coverage-prepare',successState:'done',
  intent:'Prepare or repair the project coverage collector using an independent official CLI role; verify fresh probes, preserve prior evidence and stop before business tests.',operation:prepareCoverage});
