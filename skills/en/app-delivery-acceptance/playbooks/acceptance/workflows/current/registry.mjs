import {commandRegistry} from '../shared/command.mjs';
import {current,projectRoot} from '../shared/store.mjs';
export default commandRegistry({id:'acceptance-current',intent:'Read the authoritative current AT pointer without changing it or starting work.',successState:'read',operation:input=>{if(!input||Object.keys(input).some(k=>k!=='project_root'))throw Error('Only project_root is accepted');const root=projectRoot(input.project_root);return {status:'read',project_root:root,acceptance_id:current(root),read_only:true};}});
