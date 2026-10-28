import {commandRegistry} from '../shared/command.mjs';
import {publishKnowledge} from './stage.mjs';
export default commandRegistry({id:'acceptance-knowledge',intent:'Publish explicitly reviewed portable project knowledge with verified runtime evidence, conflict-checked assets and complete layered indexes; never copy private machine state or product judgments.',successState:'published',operation:publishKnowledge});
