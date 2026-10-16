"""Explicit shared-contract fixtures for structural gate tests."""
from design_quality import STANDARD, CRITERIA


def add_contract(scenarios, review, methods=None):
    method_map = {m['id']: m for m in (methods or {}).get('items', [])}
    for scene in scenarios['items']:
        mids = scene.pop('method_ids', [])
        if mids and mids[0] in method_map:
            source = method_map[mids[0]]
            scene['acceptance'] = {k: source[k] for k in ('description', 'preconditions', 'actions', 'criteria', 'evidence_expected')}
        elif 'acceptance' not in scene:
            scene['acceptance'] = {'description': '检查过期输入被拒绝且记录保持', 'preconditions': ['准备已过期输入'], 'actions': ['提交过期输入'], 'criteria': ['拒绝且业务记录不变'], 'evidence_expected': ['提交前后状态记录']}
    for record, kind in [(review, 'black_box'), (review.get('white_box_priority_review', {}), 'white_box')]:
        for check in record.get('output_quality', {}).get('checks', []):
            if check.get('artifact') == 'methods':
                check['artifact'] = 'acceptance'
                check['record_ids'] = [x['id'] for x in scenarios['items'] if x.get('kind') == kind]

    scenes = [s for s in scenarios["items"] if s.get("kind") == "black_box"]
    scenarios["design_standard"] = review["design_standard"] = STANDARD
    scenarios["design_basis"] = []
    for item in review["items"]:
        rid = item["requirement_id"]
        linked = [s for s in scenes if rid in s["requirement_ids"]]
        covers = [{"id": rid + "-C" + str(i), "condition": s["title"], "expected": s["expected"], "scenario_ids": [s["id"]], "identification_basis": "需求规定过期输入必须拒绝，检查拒绝结果及业务记录保持", "check_points": [{"id": "deny", "text": "过期输入被拒绝且业务状态保持"}]} for i, s in enumerate(linked)]
        scenarios["design_basis"].append({"requirement_id": rid, "scope": ["过期凭据拒绝"], "exclusions": [], "techniques": [{"name": "等价类划分", "reason": "过期输入对应明确的拒绝规则"}], "coverage_items": covers, "limitations": []})
        item.update(scope=["过期凭据拒绝"], limitations=[], findings=[],
                    coverage_results=[{"coverage_id": c["id"], "status": "covered", "reason": "提交过期输入并检查拒绝和业务状态保留", "scenario_coverage": [{"scenario_id": c["scenario_ids"][0], "covered_point_ids": ["deny"], "reason": "执行过期输入，判据要求拒绝且业务状态保持"}]} for c in covers],
                    criteria_checks=[{"criterion": c, "status": "passed", "reason": "按确认过期规则检查输入、操作、拒绝判据与状态证据要求"} for c in sorted(CRITERIA)])


def white_contract(scenes):
    """A concrete two-point white-box contract, including existing requirement targets."""
    white = [s for s in scenes if s.get('kind') == 'white_box']
    targets = sorted({r for s in white for r in s.get('requirement_ids', []) + s.get('reverse_rule_ids', [])})
    bases, reviews = [], []
    for rid in targets:
        linked = [s for s in white if rid in s.get('requirement_ids', []) + s.get('reverse_rule_ids', [])]
        covers = [{'id': rid+'-C'+str(i), 'condition':'提交已过期或无效输入', 'expected':'拒绝且原记录保持', 'identification_basis':'关联契约的异常输入和状态保持要求', 'scenario_ids':[s['id']], 'check_points':[{'id':'deny','text':'无效输入被拒绝'},{'id':'retain','text':'原业务记录保持'}]} for i,s in enumerate(linked)]
        bases.append({'requirement_id':rid,'scope':['无效输入拒绝及状态保持'],'exclusions':[],'techniques':[{'name':'等价类','reason':'区分契约允许及拒绝的输入'}],'coverage_items':covers,'limitations':[]})
        reviews.append({'requirement_id':rid,'verdict':'sufficient','reason':'无效输入组检查拒绝和原记录保持，关联契约和证据要求明确。','scope':['无效输入拒绝及状态保持'],'limitations':[],'findings':[], 'criteria_checks':[{'criterion':c,'status':'passed','reason':'核对契约、输入操作及拒绝和保留判据'} for c in sorted(CRITERIA)],'coverage_results':[{'coverage_id':c['id'],'status':'covered','reason':'场景要求拒绝且原记录保持','scenario_coverage':[{'scenario_id':c['scenario_ids'][0],'covered_point_ids':['deny','retain'],'reason':'场景操作提交无效输入，判据包含拒绝与原记录保持'}]} for c in covers]})
    return {'version':1,'items':[],'design_standard':STANDARD,'design_basis':bases}, {'design_standard':STANDARD,'design_reviews':reviews}
