"""Scene-to-case design and review contract; semantic correctness needs independent review."""
import output_quality

STANDARD = 'case-design-v1'

def meaningful(v):
    return isinstance(v, str) and bool(v.strip())

def associations(binding):
    return {**{'case:'+v.get('path','')+':'+v.get('selector',''):v for v in binding.get('cases',[]) if isinstance(v,dict)},
            **{'manual:'+v.get('id',''):v for v in binding.get('manual_operations',[]) if isinstance(v,dict)}}

def design_errors(binding, scene):
    errors=[]; criteria=scene.get('acceptance',{}).get('criteria',[])
    design=binding.get('case_design',{}); items=design.get('items',[]) if isinstance(design,dict) else []
    if not isinstance(design,dict) or design.get('standard')!=STANDARD or not isinstance(items,list) or len(items)!=len(criteria) or {v.get('criterion') for v in items if isinstance(v,dict)}!=set(criteria):
        return ['case_design must enumerate every frozen scenario criterion exactly once']
    tasks=associations(binding)
    expected_language = output_quality.language_hint(' '.join(str(scene.get(field, '')) for field in ('title', 'expected')))
    if expected_language in ('zh', 'en'):
        for key, task in tasks.items():
            if not output_quality.language_matches(task.get('name'), expected_language):
                errors.append(f'{key}: business name must follow the scenario language ({expected_language}); keep technical identifiers in their original form')
    for item in items:
        points=item.get('check_points',[])
        if not isinstance(points,list) or not points or not all(isinstance(v,dict) and meaningful(v.get('id')) and meaningful(v.get('text')) for v in points):
            errors.append('case design needs concrete check_points'); continue
        expected={v['id'] for v in points}
        if len(expected)!=len(points): errors.append('case design point IDs must be distinct within a criterion')
        covered=set()
        for task in tasks.values():
            proc=task.get('procedure',{})
            for check in proc.get('scenario_checks',[]):
                if check.get('scenario_id')!=scene['id'] or check.get('criterion')!=item['criterion']: continue
                ids=check.get('covered_point_ids',[]); nums=check.get('step_numbers',[])
                if not isinstance(ids,list) or not ids or not all(isinstance(v,str) and v in expected for v in ids):
                    errors.append('case mapping needs known covered_point_ids'); continue
                if not isinstance(nums,list) or not nums or len(set(nums))!=len(nums) or not all(type(n) is int and 1<=n<=len(proc.get('steps',[])) for n in nums):
                    errors.append('case mapping needs exact existing step_numbers'); continue
                covered.update(ids)
        if covered!=expected: errors.append('cases do not cover all scene check points: '+item['criterion'])
    return errors

def review_errors(assessment, binding, scene):
    errors=design_errors(binding,scene)
    design=binding.get('case_design',{}); items=design.get('items',[]) if isinstance(design,dict) else []
    review=assessment.get('case_coverage',{})
    rows=review.get('items',[]) if isinstance(review,dict) else []
    if not isinstance(review,dict) or review.get('standard')!=STANDARD or review.get('status') not in ('sufficient','partial','gap') or not isinstance(rows,list) or len(rows)!=len(items) or {v.get('criterion') for v in rows if isinstance(v,dict)}!={v.get('criterion') for v in items}:
        return errors+['independent case_coverage must review every scene check item']
    tasks=associations(binding); statuses=[]
    for row in rows:
        item=next(v for v in items if v['criterion']==row['criterion']); expected={v['id'] for v in item.get('check_points',[])}; covered=set()
        contributions=row.get('contributions',[])
        if not isinstance(contributions,list): errors.append('case coverage contributions must be a list'); continue
        for c in contributions:
            task=tasks.get(c.get('association_key')) if isinstance(c,dict) else None
            if not task or not meaningful(c.get('reason')): errors.append('case coverage needs exact association and concrete review reason'); continue
            ids=c.get('covered_point_ids',[]); nums=c.get('step_numbers',[])
            if not isinstance(ids,list) or not ids or not all(v in expected for v in ids) or not isinstance(nums,list) or not nums or not all(type(n) is int and 1<=n<=len(task.get('procedure',{}).get('steps',[])) for n in nums):
                errors.append('review contribution must locate real case steps and scene points'); continue
            assigned=[v for v in task.get('procedure',{}).get('scenario_checks',[]) if v.get('scenario_id')==scene['id'] and v.get('criterion')==row['criterion']]
            if not any(set(ids)<=set(v.get('covered_point_ids',[])) and set(nums)<=set(v.get('step_numbers',[])) for v in assigned): errors.append('review contribution exceeds assigned case scope')
            covered.update(ids)
        status='covered' if covered==expected else 'partial' if covered else 'gap'; statuses.append(status)
        if row.get('status')!=status or not meaningful(row.get('reason')): errors.append('case coverage status must match union of independently reviewed points')
    total='sufficient' if statuses and all(v=='covered' for v in statuses) else 'gap' if statuses and all(v=='gap' for v in statuses) else 'partial'
    if review.get('status')!=total: errors.append('case coverage total must match reviewed item union')
    return errors

def result_errors(payload,binding):
    tasks=associations(binding); rows=payload.get('case_results',[])
    if not isinstance(rows,list) or len(rows)!=len(tasks) or {v.get('association_key') for v in rows if isinstance(v,dict)}!=set(tasks):
        return ['case_results must separately record every bound case/manual task exactly once']
    errors=[]; statuses=[]
    for row in rows:
        task=tasks[row['association_key']]; refs=row.get('evidence',[]); steps=row.get('step_results',[]); statuses.append(row.get('status'))
        if row.get('status') not in ('passed','failed','blocked','unproven','execution_error') or not meaningful(row.get('summary')) or not isinstance(refs,list) or not refs or not all(v in payload.get('evidence',[]) for v in refs): errors.append('case result needs status, factual summary and exact observed evidence')
        errors.extend(output_quality.summary_errors(row.get('summary'), 'case result'))
        count=len(task.get('procedure',{}).get('steps',[]))
        valid_steps=isinstance(steps,list) and all(isinstance(v,dict) and type(v.get('step_number')) is int and 1<=v['step_number']<=count for v in steps)
        if not valid_steps or len({v['step_number'] for v in steps})!=len(steps):
            errors.append('case execution needs distinct real planned step numbers'); continue
        if row.get('status') in ('passed','failed') and {v['step_number'] for v in steps}!=set(range(1,count+1)):
            errors.append('case execution must record every planned step exactly once'); continue
        for step in steps:
            if not meaningful(step.get('actual')) or not isinstance(step.get('evidence'),list) or not step['evidence'] or not all(v in refs for v in step['evidence']): errors.append('case step needs actual facts and its own evidence references')
    if payload.get('status')=='passed' and any(v!='passed' for v in statuses): errors.append('scene execution cannot pass with unfinished or failed case')
    if payload.get('status')=='failed' and 'failed' not in statuses: errors.append('failed scene needs an observed failing case')
    return errors
