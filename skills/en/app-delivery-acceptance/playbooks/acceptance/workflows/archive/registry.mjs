import {commandRegistry} from '../shared/command.mjs';
import {archiveAcceptance} from './stage.mjs';
export default commandRegistry({id:'acceptance-archive',intent:'Publish only explicitly selected and protocol-required evidence into an immutable project-owned archive, retaining original paths and exact hashes without copying environments or sessions.',successState:'archived',operation:archiveAcceptance});
