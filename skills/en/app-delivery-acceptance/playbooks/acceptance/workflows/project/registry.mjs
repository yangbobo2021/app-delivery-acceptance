import {commandRegistry} from '../shared/command.mjs';
import {prepareProject} from './stage.mjs';
export default commandRegistry({rolePolicies:{project_preparer:{fileWrite:'deny',shellExecute:'allow',networkAccess:'deny'}},roles:["project_preparer"],id:'acceptance-project',intent:'Bind a verified runtime and current project-owned coverage preparation to immutable source/test inventory, then obtain the project operation guide and stop before cases.',successState:'prepared',operation:prepareProject});
