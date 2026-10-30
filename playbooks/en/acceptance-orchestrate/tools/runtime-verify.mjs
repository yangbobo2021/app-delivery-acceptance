#!/usr/bin/env node
import {validateRuntime} from '../workflows/shared/runtime.mjs';
const [file,...args]=process.argv.slice(2);
try{if(!file||args.some(x=>x!=='--no-resmoke'))throw Error('usage: node runtime-verify.mjs RUNTIME.json [--no-resmoke]');console.log(JSON.stringify(validateRuntime(file,{resmoke:!args.includes('--no-resmoke')})));}
catch(error){console.error(JSON.stringify({status:'blocked',reason:error.message}));process.exitCode=2;}
