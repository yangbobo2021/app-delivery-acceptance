const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

test('a timed-out load clears old verdicts, explains the failure and permits retry',async()=>{
 const nodes=new Map();
 const $=id=>{
  if(!nodes.has(id))nodes.set(id,{disabled:false,textContent:'',children:['old green result'],replaceChildren(...v){this.children=v;}});
  return nodes.get(id);
 };
 let timeoutMs,fail=true,fetchOptions;
 const context=vm.createContext({state:{data:{old:true},trace:{old:true},run:'',runAuto:true},$,
  AbortSignal:{timeout(ms){timeoutMs=ms;return {deadline:ms};}},
  async fetch(url,options){fetchOptions=options;if(fail)throw {name:'TimeoutError'};return {ok:true,json:async()=>({runs:[]})};},
  el:(tag,classes,text)=>({text}),hidePriorityTooltip(){},capturePriorityTooltip(){},restorePriorityTooltip(){},
  renderOverview(){},render(){},syncDesignReview(){},pendingDesignReview:'',
  AcceptanceTrace:{buildLatest(){return {latest:new Map()};}},ExecutionView:{sync(){}},
  document:{activeElement:null,querySelectorAll(){return [];}}
 });
 const source=fs.readFileSync(path.resolve(__dirname,'../assets/ledger-viewer/viewer.js'),'utf8');
 vm.runInContext(source.slice(source.indexOf('let loadingLedger = false;'),source.indexOf('\ndocument.querySelectorAll("nav button")')),context);
 await vm.runInContext('load()',context);
 assert.equal(timeoutMs,15000);assert.equal(fetchOptions.signal.deadline,15000);
 assert.equal(context.state.data,null);assert.equal($('refresh').disabled,false);
 assert.match($('alerts').children[0].text,/读取超过15秒/);
 for(const id of ['summary','list','detail','extra'])assert.deepEqual($(id).children,[]);
 fail=false;await vm.runInContext('load()',context);
 assert.ok(context.state.data);assert.ok(context.state.trace.latest instanceof Map);
 assert.equal(nodes.has('run'),false);assert.equal(nodes.has('run-note'),false);
});
