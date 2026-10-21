const criteria=['requirement_alignment','coverage_completeness','method_discrimination','fault_detection','scope_boundaries'];
function addWhite(d){
 const rules=d.documents['white_box_rules.json']; const record=d.documents['coverage_review.json'].white_box_priority_review;
 rules.design_standard=record.design_standard='design-quality-v3'; rules.design_basis=[];record.design_reviews=[];
 for(const r of rules.items){
  const scenes=d.documents['scenarios.json'].items.filter(s=>(s.reverse_rule_ids||[]).includes(r.id));
  for(const s of scenes)s.acceptance={description:'检查无效来源被拒绝且原记录保持',preconditions:['准备有效业务请求'],actions:['提交无效来源请求并查询前后记录'],criteria:['拒绝且没有写入'],evidence_expected:['响应及原记录前后对照']};
  const c={id:r.id+'-C1',condition:'发送错误来源请求',expected:'拒绝且无写入',identification_basis:'接口契约的异常来源与记录保持边界',scenario_ids:scenes.map(s=>s.id),check_points:[{id:'deny',text:'错误来源拒绝'},{id:'retain',text:'原记录保持且无写入'}]};
  rules.design_basis.push({requirement_id:r.id,scope:['来源拒绝'],exclusions:[],techniques:[{name:'等价类',reason:'区分有效与错误来源'}],limitations:[],coverage_items:[c]});
  record.design_reviews.push({requirement_id:r.id,verdict:'sufficient',reason:'场景检查来源拒绝及原记录保持',scope:['来源拒绝'],limitations:[],findings:[],criteria_checks:criteria.map(criterion=>({criterion,status:'passed',reason:'检查请求与拒绝及保留判据'})),coverage_results:[{coverage_id:c.id,status:'covered',reason:'来源拒绝和原记录保持均有对应判据',scenario_coverage:scenes.map(s=>({scenario_id:s.id,covered_point_ids:['deny','retain'],reason:'操作与判据包含拒绝和原记录保持'}))}]});
 }
 return d;
}
function partial(d,index=0){const r=d.documents['coverage_review.json'].white_box_priority_review.design_reviews[index];r.verdict='gap';r.coverage_results[0].status='partial';r.coverage_results[0].scenario_coverage.forEach(c=>{c.covered_point_ids=['deny'];c.reason='只断言返回码';});r.findings=[{kind:'coverage_gap',coverage_id:r.coverage_results[0].coverage_id}];return d;}
module.exports={addWhite,partial};
