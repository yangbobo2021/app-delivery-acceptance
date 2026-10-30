import {commandRegistry} from '../shared/command.mjs';
import {recordRisk} from './stage.mjs';
export default commandRegistry({id:'acceptance-risk',intent:'Record the user’s explicit acceptance of a known technical risk with the original decision, affected scene, immutable finding and remaining impact; never rewrite a pass.',successState:'recorded',operation:recordRisk});
