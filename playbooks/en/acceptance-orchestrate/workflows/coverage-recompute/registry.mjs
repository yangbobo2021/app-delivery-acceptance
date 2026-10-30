import {commandRegistry} from '../shared/command.mjs';
import {recomputeCoverage} from './stage.mjs';
export default commandRegistry({id:'acceptance-coverage-recompute',intent:'Verify selected existing native coverage reports and invoke only the project-owned mature summarizer, without rerunning tests or claiming a fresh product execution.',successState:'summarized',operation:recomputeCoverage});
