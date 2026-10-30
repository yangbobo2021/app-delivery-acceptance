import {commandRegistry} from '../shared/command.mjs';
import {cleanupAcceptance} from './stage.mjs';
export default commandRegistry({id:'acceptance-cleanup',intent:'After explicit authorization and verified recoverable evidence/candidate backups, remove only selected inactive AT-local assets, preserving shared records and Git objects.',successState:'cleaned',operation:cleanupAcceptance});
