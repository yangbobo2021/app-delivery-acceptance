// Optional integration probe. Dependencies belong to the test environment,
// never the tested product; set ACCEPTANCE_COVERAGE_NODE_PACKAGE_ANCHOR.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {Session} from 'node:inspector';
const req=createRequire(process.env.ACCEPTANCE_COVERAGE_NODE_PACKAGE_ANCHOR);
const {convert}=await import(pathToFileURL(req.resolve('ast-v8-to-istanbul')));
const {parse}=req('@babel/parser'), {createCoverageMap}=req('istanbul-lib-coverage');
const [inputSource,output,input]=process.argv.slice(2), source=fs.realpathSync(inputSource), url=pathToFileURL(source).href;
const session=new Session();session.connect();
const post=(name,params={})=>new Promise((resolve,reject)=>session.post(name,params,(error,value)=>error?reject(error):resolve(value)));
await post('Profiler.enable');await post('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
const {book}=await import(url);
if(input==='both' && book(false)!==true)throw Error('valid booking unexpectedly rejected');
const actual=book(input==='true'||input==='both');
const {result}=await post('Profiler.takePreciseCoverage');await post('Profiler.stopPreciseCoverage');session.disconnect();
const entry=result.find(r=>r.url===url);if(!entry)throw Error('original source missing from real V8');
const code=fs.readFileSync(source,'utf8');
const data=await convert({ast:parse(code,{sourceType:'module',plugins:['estree']}).program,code,coverage:entry,wrapperLength:0});
const toolFile=path.join(path.dirname(req.resolve('ast-v8-to-istanbul')),'../package.json');
const tool={name:'ast-v8-to-istanbul',version:JSON.parse(fs.readFileSync(toolFile)).version,command:`node ${process.argv[1]} ${source} ${output} ${input}`};
fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'v8.json'),JSON.stringify({result:[entry]}));
fs.writeFileSync(path.join(output,'istanbul.json'),JSON.stringify(data));
fs.writeFileSync(path.join(output,'provenance.json'),JSON.stringify({tool,node:process.version,source,actual,input,captured_at:new Date().toISOString(),mapping:'direct original ESM source; no transpilation',official_summary:createCoverageMap(data).getCoverageSummary().toJSON()},null,2));
console.log(JSON.stringify({actual,tool}));
