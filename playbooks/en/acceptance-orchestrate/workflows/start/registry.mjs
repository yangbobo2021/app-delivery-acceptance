import {commandRegistry} from '../shared/command.mjs';
import {start} from '../shared/store.mjs';
import {validateStore} from '../shared/validation.mjs';
export default commandRegistry({id:'acceptance-start',intent:'Explicitly start an existing verified AT only when no other AT is active.',successState:'started',operation:input=>{if(!input||Object.keys(input).some(k=>!['project_root','acceptance_id','basis'].includes(k))||!String(input.basis??'').trim())throw Error('Explicit AT and actual startup basis required');validateStore(input.project_root,input.acceptance_id,{requireScope:false});return start(input.project_root,input.acceptance_id);}});
