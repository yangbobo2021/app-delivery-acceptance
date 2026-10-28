import fs from 'node:fs';
import path from 'node:path';
import {locations,requireCurrent,read} from '../shared/store.mjs';
import {validateStore} from '../shared/validation.mjs';
import {currentBinding,digest} from '../shared/definitions.mjs';
import {canonical,cloneJson} from '../shared/json.mjs';
import {caseId,marker,identitySource,sourceLines,verifyIdentity} from '../shared/identity.mjs';
import {caseContext,validateEvaluation} from '../shared/case-contract.mjs';
import {git} from '../shared/workspace.mjs';
const write=(file,value,exclusive=false)=>fs.writeFileSync(file,canonical(value)+'\n',exclusive?{flag:'wx'}:undefined);
function sourceText(bytes,name){
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('Assessment source must be UTF-8 text: '+name);}
 if(text.includes('\0'))throw Error('Assessment source contains NUL bytes, not source text: '+name);
 return text;
}
export function prepareAssessment(input,folder){
 const {root,shared}=locations(input.project_root,input.acceptance_id);requireCurrent(root,input.acceptance_id);validateStore(root,input.acceptance_id);const definitions=currentBinding(root,input.acceptance_id);
 if(definitions.sha256!==input.definitions_sha256)throw Error('assessment definitions changed');const current=read(path.join(shared,'scenarios.json')),scene=current.scenarios.find(s=>s.id===input.scene_id);if(!scene)throw Error('assessment scene absent from frozen definitions');
 const source=fs.realpathSync(input.source_checkout??root),frozen={definitions,scene:cloneJson(scene),source_root:source,enabled:input.enabled??true,source_files:{},source_revision:null};
 if(typeof frozen.enabled!=='boolean')throw Error('enabled must be an explicit boolean');if(!frozen.enabled){write(path.join(folder,'request.frozen.json'),frozen,true);return {frozen};}
 const answer=cloneJson(input.case_answer);if(!answer||typeof answer!=='object'||Array.isArray(answer))throw Error('actual current case_answer object required');const cases=answer.case_descriptions??answer.associated_tests;if(!Array.isArray(cases))throw Error('explicit case_descriptions or associated_tests array required; files alone are not declarations');
 if(answer.case_identity)verifyIdentity(answer,source,{sceneId:scene.id,acceptanceId:input.acceptance_id});const seenIds=new Set(),seenSources=new Set(),sourceFiles={},normalized=[];
 for(const item of cases){if(!item||typeof item!=='object'||Array.isArray(item))throw Error('case description must be an object');const src=cloneJson(item.source??item),name=src.file;if(typeof name!=='string')throw Error('actual test declaration file required');const file=identitySource(source,name),bytes=fs.readFileSync(file),expected=src.file_sha256??item.file_sha256;if(digest(file)!==expected)throw Error('associated source changed: '+name);
 const lines=sourceLines(bytes),start=src.line_start,end=src.line_end;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||!(1<=start&&start<=end&&end<=lines.length))throw Error('actual test declaration range required');const title=src.title??item.name??item.title,body=lines.slice(start-1,end).join('\n');if(typeof title!=='string'||!title||!body.includes(title))throw Error('test declaration title is not present in its source');
 const id=item.id??'',key=JSON.stringify([name,start,end]);if(typeof id!=='string')throw Error('case ID or candidate alias must be text');if(seenSources.has(key)||id&&seenIds.has(id))throw Error('duplicate case identity/declaration in the supplied group');seenSources.add(key);if(id)seenIds.add(id);const permanent=new RegExp('^'+caseId+'$').test(id);if(id.startsWith('TC-')&&!permanent)throw Error('invalid permanent case ID');if(permanent&&!(start>1&&marker.exec(lines[start-2])?.[1]===id))throw Error('permanent case ID is not adjacent to its declaration');
 Object.assign(src,{title,file_sha256:expected});normalized.push({...item,source:src,identity_status:permanent?'source_marked':'unassigned_candidate'});sourceFiles[name]={sha256:expected,text:sourceText(bytes,name)};
 }
 answer.case_descriptions=normalized;delete answer.associated_tests;answer.test_files=Object.keys(sourceFiles).sort();
 for(const item of input.supporting_files??[]){const file=identitySource(source,item.file);if(digest(file)!==item.sha256)throw Error('supporting source changed: '+item.file);sourceFiles[item.file]={sha256:digest(file),text:sourceText(fs.readFileSync(file),item.file)};}
 Object.assign(frozen,{answer,context:caseContext({scene},answer),source_files:sourceFiles,source_revision:git(source,'rev-parse','HEAD').trim()});write(path.join(folder,'request.frozen.json'),frozen,true);return {frozen};
}
export function checkAssessmentSources(folder){const frozen=read(path.join(folder,'request.frozen.json'));if(!frozen.enabled)return {current:true};if(git(frozen.source_root,'rev-parse','HEAD').trim()!==frozen.source_revision)throw Error('assessment source revision changed');for(const [name,item]of Object.entries(frozen.source_files))if(digest(identitySource(frozen.source_root,name))!==item.sha256)throw Error('assessment source changed during evaluation: '+name);return {current:true};}
function markdown(d){
 const support={sufficient:'支持充分',partial:'部分支持',gap:'存在缺口',uncertain:'无法判断'},roles={essential:'关键',complementary:'互补',duplicate:'重复',out_of_scope:'场景外',uncertain:'待确认'},cite=x=>x.evidence_ids.map(e=>'['+e+'](#'+e.toLowerCase()+')').join(' '),lines=[support[d.coverage]+'：'+d.summary,'','取舍建议：'+d.selection_advice,'','## 场景义务',''];
 for(const o of d.obligations)lines.push(`- ${o.id}「${o.quote}」：${o.assessment} ${cite(o)}`);
 for(const [kind,label]of [['gap','必要缺口'],['quality','设计质量'],['uncertainty','待确认'],['enhancement','可选增强']]){const items=d.findings.filter(f=>f.kind===kind);if(items.length){lines.push('','## '+label,'');for(const f of items)lines.push(`- ${f.statement}（${f.obligation_ids.join(', ')}） ${cite(f)}`,'  - 影响：'+f.impact,'  - 建议：'+f.recommendation);}}
 lines.push('','## 用例贡献与取舍','');const names=Object.fromEntries(d.cases.map(c=>[c.case_id,c.title||c.file]));for(const a of d.case_assessments){lines.push(`- ${a.case_id} ${names[a.case_id]} · ${roles[a.role]}：${a.contribution} ${cite(a)}`);for(const check of a.checks??[]){lines.push(`  - ${check.target}：${check.assessment} ${cite(check)}`);if(check.counterexample)lines.push('    - 反例核验：'+check.counterexample);}}
 lines.push('','## 引用依据','','仅核对引用原文和文件哈希；语义判断仍需审阅。','');for(const e of d.evidence){lines.push(`<a id="${e.id.toLowerCase()}"></a>`,`### ${e.id} · ${e.file}:${e.line_start}–${e.line_end}`,'','SHA-256：'+e.file_sha256,'','```',e.quote,'```','');if(e.citation_resolution)lines.push(`原结束行 ${e.reported_line_end}；宿主按唯一原文校正为 ${e.line_end}。`,'');}if(d.limitations.length)lines.push('## 评估边界','',...d.limitations.map(x=>'- '+x));return lines.join('\n');
}
export function finishAssessment(input,folder){
 const {root,shared}=locations(input.project_root,input.acceptance_id);requireCurrent(root,input.acceptance_id);validateStore(root,input.acceptance_id);const frozen=read(path.join(folder,'request.frozen.json'));if(digest(path.join(shared,'scenarios.json'))!==input.definitions_sha256)throw Error('assessment definitions changed during evaluation');checkAssessmentSources(folder);
 const description=validateEvaluation(read(path.join(folder,'candidate.json')),{scene:frozen.scene},frozen.answer,frozen.source_root,{requireTargetChecks:true}),result={schema:'case-evaluation-description-v1',advisory_only:true,status:'available',description,binding:{input_sha256:digest(path.join(folder,'input.json')),answer_sha256:digest(path.join(folder,'answer.txt')),definitions_sha256:input.definitions_sha256},evaluator_contract:'case-evaluation-v2',execution_control:'none',product_judgment:'not_performed'};
 write(path.join(folder,'case-evaluation.json'),result);fs.writeFileSync(path.join(folder,'case-evaluation.md'),'# 场景关联用例评估\n\n仅供人阅读，不改变关联、执行列表、修补或正式结论。\n\n'+markdown(description)+'\n');return result;
}
