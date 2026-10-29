import {commandRegistry} from '../shared/command.mjs';
import {prepareCoverage} from './stage.mjs';
import {parseJson} from '../shared/json.mjs';
export default commandRegistry({rolePolicies:{coverage_preparer:{fileWrite:'allow',shellExecute:'allow',networkAccess:'allow'}},roles:["coverage_preparer"],id:'acceptance-coverage-prepare',successState:'done',
  intent:'Prepare and repair a project coverage execution environment autonomously from the project or current directory; discover necessary inputs, verify the collector, or explain why it cannot be supported. Stop before business tests.',
  parseInput:value=>String(value).trim()?parseJson(value):{},operation:prepareCoverage});
