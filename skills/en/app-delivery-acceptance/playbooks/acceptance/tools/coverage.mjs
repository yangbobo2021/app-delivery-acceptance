#!/usr/bin/env node
import {read} from '../workflows/shared/store.mjs';
import {coveragePreparation,verifyCoverageReport,summarizeCoverage} from '../workflows/shared/coverage.mjs';
import {activateCoverage,registerCoverage} from '../workflows/shared/coverage-registry.mjs';
import {runCoverage} from '../workflows/shared/coverage-execution.mjs';
const [operation,...args]=process.argv.slice(2);
try{
  const result=operation==='prepare-check'&&args.length===1?coveragePreparation(read(args[0])):
    operation==='verify'&&args.length>=1?verifyCoverageReport(args[0],args[1]):
    operation==='summarize'&&args.length>=1?summarizeCoverage(args):
    operation==='activate'&&args.length>=1?activateCoverage(args[0],args[1]):
    operation==='register'&&args.length===1?registerCoverage(args[0]):
    operation==='run'&&args.length===1?await runCoverage(read(args[0])):null;
  if(!result)throw Error('usage: node coverage-tool.mjs prepare-check CONFIG | verify REPORT [RECEIPT] | summarize REPORT... | activate PREPARED [CATALOG] | register REPORT | run REQUEST');
  console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({status:'blocked',reason:error.message}));process.exitCode=2;}
