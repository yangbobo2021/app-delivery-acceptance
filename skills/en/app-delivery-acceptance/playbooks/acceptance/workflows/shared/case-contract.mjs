import fs from 'node:fs';
import path from 'node:path';
import {inside} from './store.mjs';
import {digest,object} from './definitions.mjs';
import {cloneJson} from './json.mjs';
const len=text=>[...text].length;
const strings=value=>typeof value==='string'?[value]:Array.isArray(value)?value.flatMap(strings):object(value)?Object.values(value).flatMap(strings):[];
const sourceText=file=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(fs.readFileSync(file));
const lines=file=>sourceText(file).replace(/(?:\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029])$/,'').split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
export function caseContext(input,answer){
  const values=answer.case_descriptions?.length?answer.case_descriptions:answer.associated_tests?.length?answer.associated_tests:(answer.test_files??[]).map(file=>({file}));
  return {cases:values.map((value,index)=>{const source=value.source??value;return {case_id:'C'+(index+1),original_id:value.id??'',file:source.file??'',title:source.title||value.name||'',line_start:source.line_start??null,line_end:source.line_end??null,file_sha256:source.file_sha256||value.file_sha256||''};}),
    scene_texts:[...['title','description','conditions','preconditions','operation','steps','expected','expected_result'].flatMap(key=>strings(input.scene?.[key])),...strings(input.scene?.ui_acceptance?.visual_expectation)]};
}
function validators(prefix){
  const require=(condition,message)=>{if(!condition)throw Error(prefix+message);};
  const text=(item,field,maximum,empty=false)=>{const value=item?.[field];require(typeof value==='string'&&(empty||Boolean(value.trim()))&&len(value)<=maximum,field+' 缺失或超过长度限制');return value;};
  const rows=(item,field,maximum)=>{const value=item?.[field];require(Array.isArray(value)&&value.length<=maximum&&value.every(object),field+' 必须是结构化列表');return value;};
  const index=(items,field)=>{const found=new Map();for(const item of items){const key=text(item,field,80);require(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(key)&&!found.has(key),field+' 重复或格式无效');found.set(key,item);}return found;};
  const refs=(item,field,known,required=false)=>{const value=item[field];require(Array.isArray(value)&&value.every(x=>typeof x==='string')&&new Set(value).size===value.length&&value.every(x=>known.has(x))&&(!required||value.length>0),field+' 缺失、重复或包含未知标识/未知引用');return value;};
  return {require,text,rows,index,refs};
}
function sourcePath(root,name,message='源码路径越界'){
  if(typeof name!=='string'||!name||name.split('/').some(x=>['.git','.acceptance','.acceptance-local'].includes(x)))throw Error(message);
  try{return inside(root,name);}catch(error){throw Error(message+': '+error.message);}
}
export function validateDiscovery(answer,input,root,baseline=null,{discoveryOnly=false}={}){
  answer=cloneJson(answer);root=fs.realpathSync(root);
  const {require,text,rows,index,refs}=validators('查找用例结构或引用无效：');require(object(answer),'需要 JSON 对象');
  const discovery=answer.case_discovery;require(object(discovery)&&discovery.schema==='existing-case-discovery-v1','缺少查找记录');text(discovery,'summary',180);
  function source(name,directory=false){
    const file=sourcePath(root,name);require(fs.existsSync(file)&&(directory||fs.statSync(file).isFile()),'源码路径不存在：'+name);
    if(baseline&&!directory){require(Boolean(baseline.files?.[name]?.sha256),'引用并非启动时已有文件：'+name);require(digest(file)===baseline.files[name].sha256,'源码字节与启动快照不符：'+name);}return file;
  }
  function span(item,file){const body=lines(file),start=item.line_start,end=item.line_end;require(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=1&&start<=end&&end<=body.length,'源码行号无效');return body.slice(start-1,end).join('\n');}
  const scope=rows(discovery,'search_scope',100);require(scope.length>0,'缺少实际查找范围');
  for(const item of scope){source(text(item,'path',1000),true);require(['manifest','tests','source'].includes(item.kind),'未知查找范围类型');text(item,'summary',180);}
  const evidence=index(rows(discovery,'evidence',200),'id');
  for(const item of evidence.values()){
    const file=source(text(item,'file',1000)),body=span(item,file);require(item.line_end-item.line_start<30,'单条引用过长');require(body.includes(text(item,'quote',1800)),'引用与连续源码原文不符：'+item.file);item.file_sha256=digest(file);
  }
  const cases=index(rows(answer,'case_descriptions',500),'id'),files=answer.test_files;
  require(Array.isArray(files)&&files.every(x=>typeof x==='string')&&new Set(files).size===files.length,'test_files 无效');for(const name of files)source(name);
  for(const item of cases.values()){
    for(const [key,maximum]of [['name',120],['method',600],['assertions',600],['boundary',600]])text(item,key,maximum);
    const loc=item.source;require(object(loc)&&loc.origin==='existing','已有用例来源无效');const name=text(loc,'file',1000),file=source(name);require(files.includes(name),'关联用例文件不在 test_files 中');const body=span(loc,file),title=text(loc,'title',500);require(body.includes(title)||[name,path.basename(file)].includes(title),'用例标题不在声明范围内');loc.file_sha256=digest(file);
  }
  const obligations=index(rows(discovery,'obligations',100),'id');require(obligations.size>0,'缺少当前场景关联目标');
  for(const item of obligations.values()){
    require(caseContext(input,{}).scene_texts.some(s=>s.includes(text(item,'quote',1000))),'关联目标不是当前场景原文');require(['found','not_found','uncertain'].includes(item.status),'关联目标状态无效');const linked=refs(item,'case_ids',cases,item.status==='found');require(item.status!=='not_found'||!linked.length,'未找到与关联列表冲突');text(item,'reason',180);
  }
  const associations=index(rows(discovery,'associations',500),'case_id');require(associations.size===cases.size&&[...associations.keys()].every(id=>cases.has(id)),'逐用例关联与展示列表不同');
  for(const [id,item]of associations){
    const targets=refs(item,'obligation_ids',obligations,true),expected=[...obligations].filter(([,o])=>o.case_ids.includes(id)).map(([oid])=>oid);require(targets.length===expected.length&&targets.every(t=>expected.includes(t)),'场景与用例关联不是双向一致');require(['active','skipped','conditional','unknown'].includes(item.availability),'关联可运行状态无效');text(item,'contribution',180);if(['skipped','conditional'].includes(item.availability))text(item,'availability_note',180);
    const ids=refs(item,'evidence_ids',evidence,true),loc=cases.get(id).source;require(ids.some(e=>{const item=evidence.get(e);return item.file===loc.file&&item.line_start<=loc.line_end&&item.line_end>=loc.line_start;}),'缺少自身测试正文引用');
  }
  for(const item of rows(discovery,'excluded_candidates',12)){
    const name=text(item,'file',1000),file=source(name);text(item,'reason',180);const title=text(item,'title',500);require(sourceText(file).includes(title)||[name,path.basename(file)].includes(title),'排除候选标题并不存在');require(refs(item,'evidence_ids',evidence,true).some(id=>evidence.get(id).file===name),'排除候选缺少自身引用');
  }
  require(Array.isArray(discovery.limitations)&&discovery.limitations.length<=5&&discovery.limitations.every(x=>typeof x==='string'&&len(x)>0&&len(x)<=180),'限制说明无效');
  if(discoveryOnly)require(answer.status==='not_executed'&&Array.isArray(answer.observations)&&!answer.observations.length&&Array.isArray(answer.evidence_paths)&&!answer.evidence_paths.length,'静态查找不得声称执行');
  discovery.citation_check='source_quotes_verified';return answer;
}
export function validateEvaluation(value,input,answer,root,{requireTargetChecks=false}={}){
  value=cloneJson(value);const {require,text,rows,index,refs}=validators('评估引用或结构校验失败：');require(object(value)&&value.schema==='case-evaluation-v2','需要 case-evaluation-v2');text(value,'summary',180);require(['sufficient','partial','gap','uncertain'].includes(value.coverage),'未知支持程度');
  const context=caseContext(input,answer),known=new Map(context.cases.map(c=>[c.case_id,c])),evidence=index(rows(value,'evidence',80),'id');
  for(const item of evidence.values()){
    const name=text(item,'file',1000),file=sourcePath(root,name,'引用必须在源码工作区内');require(fs.existsSync(file)&&fs.statSync(file).isFile(),'引用文件不存在：'+name);const start=item.line_start,end=item.line_end,body=lines(file);require(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=1&&start<=end&&end-start<30,'引用行号无效');require(end<=body.length,'引用行号越界：'+name);const quote=text(item,'quote',1800);
    if(!body.slice(start-1,end).join('\n').includes(quote)){
      const full=body.join('\n'),position=full.indexOf(quote),actualStart=position>=0?full.slice(0,position).split('\n').length:null,actualEnd=actualStart===null?null:actualStart+quote.split('\n').length-1;
      require(position>=0&&full.indexOf(quote,position+quote.length)<0&&actualStart===start&&actualEnd===end+1&&actualEnd-start<30,'引用原文与行号不符：'+name);item.reported_line_end=end;item.line_end=actualEnd;item.citation_resolution='unique_exact_quote_end_boundary';
    }
    item.file_sha256=digest(file);
  }
  const obligations=index(rows(value,'obligations',16),'id');require(obligations.size>0,'缺少场景义务');
  for(const item of obligations.values()){const quote=text(item,'quote',1000);require(context.scene_texts.some(s=>s.includes(quote)),'义务摘录不是当前场景原文');require(['supported','partial','unsupported','uncertain'].includes(item.status),'未知义务支持程度');text(item,'assessment',160);refs(item,'evidence_ids',evidence,['supported','partial'].includes(item.status));}
  const findings=index(rows(value,'findings',6),'id');
  for(const item of findings.values()){
    require(['gap','quality','uncertainty','enhancement'].includes(item.kind),'未知问题类型');refs(item,'obligation_ids',obligations,item.kind==='gap');for(const [key,max]of [['statement',180],['impact',200],['recommendation',180]])text(item,key,max);refs(item,'evidence_ids',evidence,known.size>0&&['gap','quality'].includes(item.kind));
  }
  require([...findings.values()].filter(f=>f.kind==='enhancement').length<=2,'可选增强过多');
  const assessments=index(rows(value,'case_assessments',200),'case_id');require(assessments.size===known.size&&[...assessments.keys()].every(id=>known.has(id)),'逐用例评价与当前关联不一致');
  const overlaps=(e,c)=>e.file===c.file&&(!c.line_start||e.line_start<=(c.line_end??c.line_start)&&e.line_end>=c.line_start);
  for(const [id,item]of assessments){
    require(['essential','complementary','duplicate','out_of_scope','uncertain'].includes(item.role),'未知用例贡献类型');text(item,'contribution',180);const compared=refs(item,'compared_with',known,item.role==='duplicate');require(!compared.includes(id),'用例不能与自己比较');const ids=refs(item,'evidence_ids',evidence,item.role!=='uncertain'),caseItem=known.get(id);
    if(item.role!=='uncertain')require(ids.some(id=>overlaps(evidence.get(id),caseItem)),id+' 缺少自身测试正文引用');
    if(item.role==='duplicate')for(const other of compared)require(ids.some(id=>overlaps(evidence.get(id),known.get(other))),'重复判断缺少对照用例证据');
    for(const id of ids){const e=evidence.get(id);if(e.file===caseItem.file)require(!caseItem.file_sha256||caseItem.file_sha256===e.file_sha256,'关联测试源码已变化');}
    if(requireTargetChecks||Object.hasOwn(item,'checks')){
      require(Array.isArray(item.checks)&&item.checks.length>=1&&item.checks.length<=20&&item.checks.every(object),id+' 缺少逐目标核验');const checks=item.checks;for(const check of checks){text(check,'target',120);text(check,'assessment',180);if(requireTargetChecks)text(check,'counterexample',180);refs(check,'evidence_ids',evidence,item.role!=='uncertain');}
    }
  }
  text(value,'selection_advice',180);require(Array.isArray(value.limitations)&&value.limitations.length<=3&&value.limitations.every(x=>typeof x==='string'&&len(x)>0&&len(x)<=180),'限制说明应简洁');
  const statuses=new Set([...obligations.values()].map(o=>o.status));
  if(value.coverage==='sufficient')require(statuses.size===1&&statuses.has('supported')&&![...findings.values()].some(f=>f.kind==='gap'),'充分结论与必要缺口冲突');
  if(['partial','gap'].includes(value.coverage)){const empty=!known.size&&value.coverage==='gap'&&statuses.size===1&&statuses.has('unsupported');require(empty||[...findings.values()].some(f=>f.kind==='gap'),'不足结论未列必要缺口');}
  value.cases=context.cases;value.citation_check='source_quotes_verified';return value;
}
