#!/usr/bin/env node
import {runProbePlan,verifyProbeReport} from '../workflows/shared/coverage-probes.mjs';
const [operation,...args]=process.argv.slice(2);
try{
  const result=operation==='run'&&args.length===2?runProbePlan(args[0],args[1]):
    operation==='verify'&&args.length>=3?verifyProbeReport(args[0],args[1],args[2],args.slice(3)):null;
  if(!result)throw Error('usage: node coverage-probes.mjs run PLAN OUTPUT | verify REPORT RUNTIME SHA [SOURCE...]');
  console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({status:'blocked',reason:error.message}));process.exitCode=2;}
