"""Incremental scenario lifecycle, execution bindings and independent evidence judgments."""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from datetime import datetime, timezone
import output_quality
import white_box_rules
import case_design

PHASES = ('pending', 'preparing', 'executing', 'evaluating', 'completed')


def abort_run(folder, run, reason):
    """Close a superseded run without inventing scene outcomes or AI failures.

    Caller owns the run lock and stops its workers first. This is a cancellation
    record, not finish-run or a positive acceptance settlement.
    """
    if run.get('lifecycle') != 'running' or not text(reason):
        raise ValueError('only a running run can be aborted with a concrete reason')
    run.update(lifecycle='aborted', updated_at=stamp(),
               termination={'kind': 'aborted', 'reason': reason, 'at': stamp()})
    atomic_json(Path(folder) / 'run.json', run)
    return {'run_id': Path(folder).name, 'status': 'aborted', 'reason': reason}
STATUSES = ('passed', 'failed', 'blocked', 'unproven', 'execution_error')
FINAL_STATUSES = ('passed', 'failed', 'execution_error')
MODES = ('existing_case', 'new_case', 'human_simulation', 'combined')


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


@contextlib.contextmanager
def lock(folder):
    with (Path(folder) / '.execution.lock').open('a+b') as stream:
        if os.name == 'nt':
            import msvcrt
            if stream.tell() == 0:
                stream.write(b'\0')
                stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(stream, fcntl.LOCK_UN)


def stamp():
    return datetime.now(timezone.utc).isoformat()


def hash_value(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def text(value):
    return isinstance(value, str) and bool(value.strip())


def safe_path(root, relative):
    if not text(relative) or Path(relative).is_absolute() or '..' in Path(relative).parts:
        raise ValueError('reference must be a project-relative path')
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError('reference escapes the project')
    return path


def test_paths(project, ledger):
    layout = json.loads((ledger / 'project.json').read_text()).get('test_layout', {})
    paths = layout.get('paths')
    if not isinstance(paths, list) or not paths or not text(layout.get('basis')):
        raise ValueError('project.json needs reviewed test_layout.paths and basis from project conventions')
    for relative in paths:
        path = safe_path(project, relative)
        if path == project.resolve() or ledger.resolve().is_relative_to(path) and path == ledger.resolve():
            raise ValueError('test code must use project test locations, outside the result ledger')
    return paths


def is_test(relative, paths):
    return any(Path(relative) == Path(p) or Path(p) in Path(relative).parents for p in paths)


def product_manifest(project, paths):
    # Include dirty/untracked product files and recurse into initialized gitlinks.
    # Keep paths relative to the outer project so reviewed test exclusions retain
    # their exact boundaries inside every component.
    project = Path(project).resolve()
    manifest = {}

    def collect(repo, prefix=''):
        listed = subprocess.run(['git', '-C', str(repo), 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], capture_output=True, check=True)
        staged = subprocess.run(['git', '-C', str(repo), 'ls-files', '--stage', '-z'], capture_output=True, check=True)
        gitlinks = set()
        for entry in staged.stdout.decode().split('\0'):
            if entry:
                metadata, relative = entry.split('\t', 1)
                if metadata.split()[0] == '160000':
                    gitlinks.add(relative)
        for relative in sorted(set(listed.stdout.decode().split('\0')) - {''}):
            qualified = prefix + relative
            if is_test(qualified, paths):
                continue
            path = repo / relative
            if relative in gitlinks:
                if not (path / '.git').exists() or path.is_symlink() or not path.resolve().is_relative_to(project):
                    raise ValueError('product submodule must be initialized inside project: ' + qualified)
                top = subprocess.run(['git', '-C', str(path), 'rev-parse', '--show-toplevel'], capture_output=True, text=True, check=True)
                if Path(top.stdout.strip()).resolve() != path.resolve():
                    raise ValueError('product submodule is not an independent worktree: ' + qualified)
                # Product bytes, rather than component HEAD, allow test-only commits.
                manifest[qualified] = 'git-submodule'
                collect(path, qualified + '/')
            else:
                manifest[qualified] = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else 'missing'

    collect(project)
    return manifest


def verify_product(project, run):
    if product_manifest(project, run['test_code_paths']) != run['product_manifest']:
        raise ValueError('product files changed during acceptance; preserve this run and start a new run after separate repair')


def initialize(project, ledger, scenarios, run):
    paths = test_paths(project, ledger)
    run.update({'execution_schema': 2, 'lifecycle': 'running', 'updated_at': stamp(),
                'test_code_paths': paths, 'product_manifest': product_manifest(project, paths),
                'progress': [{'scenario_id': s['id'], 'phase': 'pending'} for s in scenarios],
                'scenario_reviews': [], 'issues': [], 'attempt_history': [], 'execution_repairs': []})


def evidence_hashes(folder, refs):
    if not isinstance(refs, list) or not refs or len(refs) != len(set(refs)):
        raise ValueError('evidence must contain distinct references')
    hashes = {}
    for ref in refs:
        path = safe_path(folder, ref)
        if not path.is_file() or not path.stat().st_size:
            raise ValueError('missing or empty evidence: ' + ref)
        hashes[ref] = hashlib.sha256(path.read_bytes()).hexdigest()
    return hashes


def judgment_errors(payload, assessment):
    """Check authored argument and audit bindings; semantic truth still needs a reviewer."""
    errors = []
    cited = payload.get('evidence') if isinstance(payload.get('evidence'), list) else []
    audit = assessment.get('execution_audit')
    aspects = {'scenario_alignment', 'test_implementation', 'execution_authenticity', 'evidence_sufficiency'}
    if not isinstance(audit, dict):
        errors.append('assessment execution_audit is required')
    else:
        checks = audit.get('checks')
        checks = checks if isinstance(checks, list) else []
        if len(checks) != 4 or {c.get('aspect') for c in checks if isinstance(c, dict)} != aspects:
            errors.append('execution_audit must cover scenario_alignment, test_implementation, execution_authenticity and evidence_sufficiency exactly once')
        for c in checks:
            if not isinstance(c, dict) or c.get('status') not in ('passed', 'failed', 'unproven') or not all(output_quality.meaningful(c.get(k)) for k in ('subject', 'finding')):
                errors.append('execution_audit check needs subject, concrete finding and status')
                continue
            if not isinstance(c.get('evidence'), list) or not c['evidence'] or any(r not in cited for r in c['evidence']):
                errors.append('execution_audit must cite this review evidence')
        if audit.get('status') not in ('passed', 'repair_required', 'execution_error') or not isinstance(audit.get('issues'), list) or not all(output_quality.meaningful(i) for i in audit.get('issues', [])):
            errors.append('execution_audit needs status and concrete issues list')
        if audit.get('status') == 'passed' and (audit.get('issues') or any(c.get('status') != 'passed' for c in checks if isinstance(c, dict))):
            errors.append('passed execution_audit cannot contain problems or unproven checks')
        if audit.get('status') != 'passed' and not audit.get('issues'):
            errors.append('incomplete execution_audit must explain its issues')
        if payload.get('status') in ('passed', 'failed') and audit.get('status') != 'passed':
            errors.append('final product verdict requires passed execution_audit; repair testing problems first')
    if payload.get('status') not in ('passed', 'failed'):
        return errors
    explanation = assessment.get('explanation')
    if not isinstance(explanation, dict):
        return errors + ['final assessment explanation is required']
    errors.extend(output_quality.summary_errors(explanation.get('conclusion'), 'assessment conclusion'))
    for key in ('preconditions', 'actions', 'reasoning'):
        v = explanation.get(key)
        if not isinstance(v, list) or not v or not all(output_quality.meaningful(i) for i in v):
            errors.append('explanation needs substantive lists preconditions, actions and reasoning')
    requirements = explanation.get('requirements')
    if not isinstance(requirements, list) or not requirements or any(not isinstance(r, dict) or not all(output_quality.meaningful(r.get(k)) for k in ('id', 'text', 'source')) for r in requirements):
        errors.append('explanation needs requirement id, original text and source')
    checks = [c for c in (assessment.get('checks') or []) if isinstance(c, dict)]
    decisive = explanation.get('decisive_evidence')
    covered = set()
    if not isinstance(decisive, list) or not decisive:
        errors.append('explanation needs decisive_evidence')
    else:
        for e in decisive:
            if not isinstance(e, dict) or e.get('path') not in cited or not all(output_quality.meaningful(e.get(k)) for k in ('locator', 'observation')):
                errors.append('decisive_evidence needs a bound path, precise locator and observed fact')
                continue
            supports = e.get('supports')
            if not isinstance(supports, list) or not supports or any(s not in [c.get('criterion') for c in checks] for s in supports):
                errors.append('decisive_evidence supports must identify assessed criteria')
                continue
            if any(e['path'] not in c.get('evidence', []) for c in checks if c.get('criterion') in supports):
                errors.append('decisive evidence must also be cited by its supported check')
            covered.update(supports)
    needed = {c.get('criterion') for c in checks if payload['status'] == 'passed' or c.get('status') == 'failed'}
    if not needed or not needed <= covered:
        errors.append('decisive_evidence must cover all passing criteria or all BUG failure criteria')
    if payload['status'] == 'failed' and not any(c.get('status') == 'failed' for c in checks):
        errors.append('BUG verdict requires a failed acceptance criterion')
    if not assessment.get('limitations'):
        errors.append('final assessment must state judgment boundaries')
    return errors


def assessment_errors(payload):
    """Validate authored review sections without interpreting legacy reason prose."""
    errors = output_quality.summary_errors(payload.get('summary'), 'review short summary')
    if 'assessment' not in payload:
        return errors + ['independent assessment is required']
    assessment = payload['assessment']
    if not isinstance(assessment, dict):
        return errors + ['assessment must be an object']
    if not text(payload.get('summary')):
        errors.append('structured assessment needs a short summary')
    for key in ('scope', 'basis', 'limitations'):
        value = assessment.get(key)
        if not isinstance(value, list) or (key != 'limitations' and not value) or not all(text(v) for v in value):
            errors.append('assessment needs text lists scope, basis and limitations (limitations may be empty)')
    quality = assessment.get('output_quality')
    errors.extend(judgment_errors(payload, assessment))
    errors.extend(output_quality.review_errors(quality, dict.fromkeys(('operation_plan', 'execution', 'evidence')), 'assessment output quality review', repair=payload.get('status') == 'repair_required'))
    checks = assessment.get('checks')
    if not isinstance(checks, list) or not checks:
        return errors + ['assessment needs nonempty checks']
    for check in checks:
        if not isinstance(check, dict) or not all(output_quality.meaningful(check.get(k)) for k in ('criterion', 'expected', 'actual')) or check.get('status') not in ('passed', 'failed', 'unproven'):
            errors.append('assessment check needs criterion, expected, actual and passed/failed/unproven status')
            continue
        refs = check.get('evidence')
        cited = payload.get('evidence') if isinstance(payload.get('evidence'), list) else []
        if not isinstance(refs, list) or not refs or not all(text(ref) and ref in cited for ref in refs):
            errors.append('assessment check must cite evidence from this independent review')
        if payload.get('status') == 'passed' and check['status'] != 'passed':
            errors.append('passed assessment cannot contain failed or unproven checks')
    return errors


def procedure_errors(procedure):
    if not isinstance(procedure, dict):
        return ['each case/manual operation needs its own structured procedure']
    errors = []
    if not output_quality.meaningful(procedure.get('objective')) or not all(
            isinstance(procedure.get(k), list) and procedure[k] and all(output_quality.meaningful(v) for v in procedure[k])
            for k in ('preconditions', 'test_data')):
        errors.append('procedure needs objective, preconditions and test_data')
    steps = procedure.get('steps')
    if not isinstance(steps, list) or not steps or not all(isinstance(v, dict) and all(output_quality.meaningful(v.get(k)) for k in ('action', 'expected')) for v in steps):
        errors.append('procedure steps need action and expected result separately')
    checks = procedure.get('scenario_checks')
    if not isinstance(checks, list) or not checks or not all(isinstance(v, dict) and all(output_quality.meaningful(v.get(k)) for k in ('scenario_id', 'criterion', 'scope')) for v in checks):
        errors.append('procedure needs precise scenario_checks with criterion and individual scope')
    return errors


def procedure_reference_errors(binding, scenarios, identifier):
    errors = []
    definitions = {v['id']: v for v in scenarios}
    items = [v for key in ('cases', 'manual_operations') for v in (binding.get(key) if isinstance(binding.get(key), list) else []) if isinstance(v, dict)]
    for item in items:
        procedure = item.get('procedure')
        checks = procedure.get('scenario_checks', []) if isinstance(procedure, dict) else []
        checks = [v for v in checks if isinstance(v, dict)] if isinstance(checks, list) else []
        if not any(v.get('scenario_id') == identifier for v in checks):
            errors.append('case/manual procedure must state its scope in the current scenario')
        for check in checks:
            scene = definitions.get(check.get('scenario_id'), {})
            if check.get('criterion') not in scene.get('acceptance', {}).get('criteria', []):
                errors.append('procedure criterion must exactly reference a frozen scenario acceptance criterion')
    return errors


def binding_errors(project, ledger, run, binding, historical=False):
    errors = output_quality.summary_errors(binding.get('summary'), 'preparation')
    if binding.get('mode') not in MODES or not text(binding.get('reason')):
        errors.append('execution choice needs mode and reason based on requirements, code, scenario, method and existing tests')
    cases = binding.get('cases', [])
    if not isinstance(cases, list) or (binding.get('mode') in ('existing_case', 'new_case', 'combined') and not cases):
        return errors + ['case execution needs precise project case references']
    identities = [(c.get('path'), c.get('selector')) for c in cases if isinstance(c, dict)]
    if len(set(identities)) != len(cases):
        errors.append('case associations must be distinct exact cases')
    for case in cases:
        errors.extend(procedure_errors(case.get('procedure') if isinstance(case, dict) else None))
        try:
            if not output_quality.meaningful(case.get('name')):
                raise ValueError('case business name must be meaningful')
            if case.get('origin') not in ('existing_case', 'new_case'):
                raise ValueError('case origin must be existing_case or new_case')
            if case.get('origin') and binding.get('mode') in ('existing_case', 'new_case') and case['origin'] != binding['mode']:
                raise ValueError('case origin conflicts with this run execution choice')
            path = safe_path(project, case.get('path'))
            if path.is_relative_to(ledger.resolve()) or not is_test(case['path'], run['test_code_paths']):
                raise ValueError('test case belongs outside project test locations or inside results')
            if not text(case.get('selector')) or not text(case.get('command')):
                raise ValueError('case needs selector/entry point and invocation command')
            if historical:
                revision = case.get('revision')
                if not text(revision) or not all(c in '0123456789abcdef' for c in revision) or len(revision) != 40:
                    raise ValueError('case needs exact committed test revision')
                content = subprocess.run(['git', '-C', str(project), 'show', revision + ':' + case['path']], capture_output=True, check=True).stdout
            else:
                if not path.is_file():
                    raise ValueError('case file missing')
                content = path.read_bytes()
            if case.get('sha256') != hashlib.sha256(content).hexdigest():
                raise ValueError('case file changed since binding')
        except (ValueError, TypeError, AttributeError, KeyError, subprocess.CalledProcessError) as error:
            errors.append(str(error))
    operations = binding.get('manual_operations', [])
    if not isinstance(operations, list):
        errors.append('manual_operations must be a list')
        operations = []
    if binding.get('mode') == 'human_simulation' and cases:
        errors.append('human simulation cannot claim automated cases')
    if binding.get('mode') == 'human_simulation' and not operations:
        errors.append('human simulation needs individually described manual_operations')
    if binding.get('mode') == 'combined' and not operations:
        origins = {case.get('origin') for case in cases if isinstance(case, dict)}
        if not {'existing_case', 'new_case'}.issubset(origins):
            errors.append('combined needs mixed case origins or manual_operations')
    if operations and binding.get('mode') not in ('human_simulation', 'combined'):
        errors.append('manual_operations conflicts with the selected case-only mode')
    identifiers = [v.get('id') for v in operations if isinstance(v, dict)]
    if len(set(identifiers)) != len(operations):
        errors.append('manual operation IDs must be distinct')
    for operation in operations:
        if not isinstance(operation, dict) or not all(output_quality.meaningful(operation.get(k)) for k in ('id', 'name', 'tool', 'entry_point')):
            errors.append('manual operation needs id, name, actual tool and entry_point')
        errors.extend(procedure_errors(operation.get('procedure') if isinstance(operation, dict) else None))
    plan = binding.get('operation_plan')
    if plan is not None:
        if not isinstance(plan, dict) or not output_quality.meaningful(plan.get('objective')) or not all(
                isinstance(plan.get(key), list) and plan[key] and all(output_quality.meaningful(v) for v in plan[key])
                for key in ('preconditions', 'steps', 'criteria', 'evidence_expected')):
            errors.append('operation_plan needs objective and nonempty text lists: preconditions, steps, criteria, evidence_expected')
        elif 'technical' in plan and (not isinstance(plan['technical'], dict) or not all(
                text(v) or isinstance(v, list) and all(text(x) for x in v) for v in plan['technical'].values())):
            errors.append('operation_plan technical fields must be text or text lists')
    return errors


def observation_detail_errors(payload):
    errors = output_quality.summary_errors(payload.get('summary'), 'short execution summary')
    if 'step_results' not in payload:
        return errors + ['structured step_results is required']
    if not text(payload.get('summary')):
        errors.append('step_results needs a short execution summary')
    steps = payload['step_results']
    if not isinstance(steps, list) or not steps:
        return errors + ['step_results must be a nonempty list']
    cited = payload.get('evidence') if isinstance(payload.get('evidence'), list) else []
    for step in steps:
        if not isinstance(step, dict) or not output_quality.meaningful(step.get('step')) or not output_quality.meaningful(step.get('actual')):
            errors.append('step_results entry needs step and actual observation')
            continue
        if 'action' in step and not text(step['action']):
            errors.append('step_results action must be nonempty text when supplied')
        refs = step.get('evidence')
        if not isinstance(refs, list) or not refs or not all(text(ref) and ref in cited for ref in refs):
            errors.append('step_results must cite this observation evidence')
    return errors


def evidence_detail_errors(payload):
    if 'evidence_details' not in payload:
        return ['evidence_details is required for every observed file']
    details = payload['evidence_details']
    if not isinstance(details, list):
        return ['evidence_details must be a list']
    seen = set()
    for detail in details:
        if not isinstance(detail, dict) or not text(detail.get('path')) or detail.get('path') not in payload.get('evidence', []) or detail.get('path') in seen:
            return ['evidence_details must uniquely reference this observation evidence']
        seen.add(detail['path'])
        if not all(output_quality.meaningful(detail.get(k)) for k in ('name', 'step', 'captured_at', 'criterion')):
            return ['evidence_details needs name, step, captured_at and criterion']
        try:
            if datetime.fromisoformat(detail['captured_at'].replace('Z', '+00:00')).tzinfo is None:
                raise ValueError('timezone missing')
        except ValueError:
            return ['evidence_details captured_at must be an ISO timestamp with timezone']
    return []


def next_item(plan, run, now=None):
    from priorities import next_scenario
    active = next((p for p in run['progress'] if p['phase'] not in ('pending', 'completed', 'not_run')), None)
    if active:
        return {'scenario_id': active['scenario_id'], 'reason': 'resume', 'phase': active['phase'], 'started_at': active['started_at']}
    done = [{'scenario_id': p['scenario_id'], 'status': 'passed'} for p in run['progress'] if p['phase'] == 'completed']
    return next_scenario(plan, done, now)


def dependency_errors(ledger, run):
    import acceptance_plan
    path = ledger / 'resources.json'
    if not path.exists():
        return ['resources.json is missing']
    decisions = json.loads(path.read_text()).get('decisions', [])
    checks = {c.get('dependency_id'): c for c in run.get('dependency_checks', [])}
    errors = []
    for decision in decisions:
        if acceptance_plan.required(ledger) and decision.get('scope', {}).get('status') == 'out_of_scope':
            continue
        check = checks.get(decision.get('id'), {})
        if check.get('status') != 'passed':
            errors.append('per-run dependency check is missing/failed: ' + str(decision.get('id')))
            continue
        try:
            evidence_hashes(ledger, [check.get('evidence')])
        except (ValueError, TypeError) as error:
            errors.append(str(error))
    return errors


def advance(project, ledger, folder, run, plan, identifier, action, payload):
    import acceptance_plan
    acceptance_plan.assert_current(ledger, run)
    import execution_coverage
    policy_issues = execution_coverage.policy_errors(folder, run)
    if policy_issues:
        raise ValueError('; '.join(policy_issues))
    verify_product(project, run)
    scenario = next((s for s in json.loads((folder / "scenarios.snapshot.json").read_text())["items"] if s["id"] == identifier), {})
    if action in ("begin", "prepared") or action == "evaluate" and payload.get("status") in ("passed", "failed"):
        errors = white_box_rules.execution_errors(ledger, scenario, project)
        if errors:
            raise ValueError("; ".join(errors))
    history_errors = attempt_errors(folder, run)
    if history_errors:
        raise ValueError('; '.join(history_errors))
    progress = next((p for p in run['progress'] if p['scenario_id'] == identifier), None)
    if not progress or run['lifecycle'] != 'running':
        raise ValueError('unknown scenario or closed run')
    selected = next_item(plan, run)
    if selected['scenario_id'] != identifier and action != 'reopen':
        raise ValueError('must complete and independently evaluate the preceding priority scenario')
    phase = progress['phase']
    if action == 'reopen' and phase == 'completed':
        queue = plan['ordered_scenario_ids']
        if identifier not in queue or any(p['scenario_id'] in queue[queue.index(identifier)+1:] and p['phase'] != 'pending' for p in run['progress']):
            raise ValueError('only the current completed scenario may reopen before any later scenario begins')
        if not text(payload.get('reason')) or payload.get('reviewer_kind') not in ('playbook', 'independent_ai') or not text(payload.get('review_reference')):
            raise ValueError('recording repair needs independent reason and review source')
        record = next(r for r in run['results'] if r['scenario_id'] == identifier)
        review = next(r for r in run['scenario_reviews'] if r['scenario_id'] == identifier)
        archived = {'scenario_id': identifier, 'attempt': progress['attempt'], 'observation': record, 'review': review}
        # A record-gate repair may discover already missing/corrupt evidence. Preserve
        # its observed damaged state and the original expected hashes explicitly;
        # never rewrite that history to manufacture adequate original evidence.
        archived['recording_damage'] = {'reason': payload['reason'], 'observation_sha256': hash_value(record), 'evidence_state': evidence_state(folder, record['evidence'])}
        run['attempt_history'].append(archived)
        run['execution_repairs'].append({'scenario_id': identifier, 'attempt': progress['attempt'], 'problem_kind': 'recording', 'reason': payload['reason'], 'evidence': record['evidence']})
        run['results'].remove(record)
        run['scenario_reviews'].remove(review)
        progress.update(phase='preparing', attempt=progress['attempt']+1, repair_reason=payload['reason'])
        progress.pop('binding', None)
        progress.pop('case_results', None)
        progress.pop('result_sha256', None)
        progress.pop('evaluation_status', None)
    elif action == 'begin' and phase == 'pending':
        for previous in run['progress']:
            if previous['phase'] == 'completed':
                errors = completion_errors(project, ledger, folder, run, identifier=previous['scenario_id'])
                if errors:
                    raise ValueError('preceding scenario recording needs repair: ' + '; '.join(errors))
        errors = dependency_errors(ledger, run)
        if errors:
            raise ValueError('; '.join(errors))
        progress.update(phase='preparing', started_at=selected['started_at'], attempt=1)
    elif action == 'prepared' and phase == 'preparing':
        errors = dependency_errors(ledger, run)
        if errors:
            raise ValueError('; '.join(errors))
        for case in payload.get('cases', []):
            revision = subprocess.run(['git', '-C', str(project), 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
            case['revision'] = revision
        errors = binding_errors(project, ledger, run, payload)
        errors.extend(execution_coverage.collection_errors(project, folder, run, payload, scenario))
        errors.extend(binding_errors(project, ledger, run, payload, historical=True))
        if not errors:
            definitions = json.loads((folder / 'scenarios.snapshot.json').read_text())['items']
            errors.extend(procedure_reference_errors(payload, definitions, identifier))
            errors.extend(case_design.design_errors(payload, next(v for v in definitions if v['id']==identifier)))
        if errors:
            raise ValueError('; '.join(errors))
        if execution_coverage.required(run):
            payload['coverage_collection']['evidence_sha256'] = evidence_hashes(folder, list(dict.fromkeys(ref for p in payload['coverage_collection']['projects'] for ref in p['evidence'])))
        progress.update(phase='executing', binding=payload)
    elif action == 'case-result' and phase == 'executing':
        binding=progress['binding']; key=payload.get('association_key')
        task=case_design.associations(binding).get(key)
        if not task: raise ValueError('case result must belong to this attempt execution binding')
        subset={'cases':[task] if key.startswith('case:') else [],'manual_operations':[task] if key.startswith('manual:') else []}
        errors=case_design.result_errors({'status':payload.get('status'),'evidence':payload.get('evidence',[]),'case_results':[payload]},subset)
        if errors: raise ValueError('; '.join(errors))
        hashes=evidence_hashes(folder,payload.get('evidence'))
        if any(v.get('association_key')==key for v in progress.get('case_results',[])):
            raise ValueError('case result already recorded; correct execution through the same-scene repair loop')
        progress.setdefault('case_results',[]).append({**payload,'evidence_sha256':hashes,'observed_at':stamp()})
    elif action == 'observe' and phase in ('preparing', 'executing'):
        if 'case_recording_damage' in payload:
            raise ValueError('case recording damage is derived from immutable live case records, not supplied by the executor')
        if payload.get('status') not in STATUSES or not text(payload.get('actual')):
            raise ValueError('observation needs status and actual observations')
        if phase == 'preparing' and payload['status'] not in ('blocked', 'unproven', 'execution_error'):
            raise ValueError('unprepared execution can only be blocked or unproven')
        errors = evidence_detail_errors(payload) + observation_detail_errors(payload)
        details = payload.get('evidence_details')
        if not isinstance(details, list) or {v.get('path') for v in details if isinstance(v, dict)} != set(payload.get('evidence', [])):
            errors.append('evidence_details must describe every observed evidence file')
        if errors:
            raise ValueError('; '.join(errors))
        case_recording_damage = []
        if phase == 'executing':
            errors = binding_errors(project, ledger, run, progress['binding']) + case_design.result_errors(payload, progress['binding'])
            for saved in progress.get('case_results',[]):
                latest=next((v for v in payload.get('case_results',[]) if v.get('association_key')==saved['association_key']),{})
                if any(latest.get(k)!=saved.get(k) for k in ('status','summary','evidence','step_results')):
                    errors.append('scene observation cannot overwrite or change recorded case facts/evidence')
                current_state = evidence_state(folder, saved['evidence'])
                if current_state != saved['evidence_sha256']:
                    if payload['status'] not in ('blocked', 'unproven'):
                        errors.append('scene observation cannot overwrite or change recorded case facts/evidence')
                    else:
                        # Disclose the damage so the separate Reviewer can request repair.
                        # Keep the original case facts and expected hashes; this observation
                        # is never eligible for a normal final verdict or acceptance.
                        case_recording_damage.append({'association_key': saved['association_key'],
                            'saved_case_result': saved, 'evidence_state': current_state})
            if errors:
                raise ValueError('; '.join(errors))
        scenario = next(s for s in json.loads((folder / 'scenarios.snapshot.json').read_text())['items'] if s['id'] == identifier)
        hashes = evidence_hashes(folder, payload.get('evidence'))
        record = {**payload, 'scenario_id': identifier, 'started_at': progress['started_at'],
                  'attempt': progress['attempt'], 'binding': progress.get('binding'), 'evidence_sha256': hashes, 'observed_at': stamp()}
        if case_recording_damage:
            record['case_recording_damage'] = case_recording_damage
        run['results'].append(record)
        progress.update(phase='evaluating', result_sha256=hash_value(record))
    elif action == 'evaluate' and phase == 'evaluating':
        record = next(r for r in run['results'] if r['scenario_id'] == identifier)
        if hash_value(record) != progress['result_sha256'] or payload.get('result_sha256') != progress['result_sha256']:
            raise ValueError('review must bind the unchanged observation hash')
        if record.get('case_recording_damage') and payload.get('status') != 'repair_required':
            raise ValueError('recorded case evidence was damaged; independent same-scene repair is required')
        evidence_changed = evidence_state(folder, record['evidence']) != record['evidence_sha256']
        if evidence_changed and payload.get('status') != 'repair_required':
            raise ValueError('evidence changed after observation; independently diagnose and request same-scene repair')
        if payload.get('status') not in (*FINAL_STATUSES, 'repair_required') or not text(payload.get('reason')) or payload.get('reviewer_kind') not in ('playbook', 'independent_ai') or not text(payload.get('review_reference')):
            raise ValueError('independent evaluation needs status, reason, reviewer identity and reference')
        if not isinstance(payload.get('evidence'), list) or not payload['evidence'] or any(e not in record['evidence'] for e in payload['evidence']):
            raise ValueError('review must cite this scenario evidence')
        errors = assessment_errors(payload)
        if payload.get('status') in ('passed', 'failed'):
            errors.extend(execution_coverage.obligation_errors(project, folder, run, progress, record, payload.get('assessment', {})))
        if payload.get('status') == 'execution_error' and execution_coverage.required(run):
            check = payload.get('assessment', {}).get('execution_coverage', {})
            if check.get('status') != 'not_completed' or not text(check.get('reason')) or not check.get('evidence') or any(e not in record['evidence'] for e in check['evidence']):
                errors.append('AI执行异常必须说明覆盖率未完成的具体原因及本次证据')
        scene = next(v for v in json.loads((folder / 'scenarios.snapshot.json').read_text())['items'] if v['id']==identifier)
        if record.get('binding'):
            errors.extend(case_design.review_errors(payload.get('assessment',{}), record['binding'], scene))
            if payload['status'] in ('passed','failed') and payload.get('assessment',{}).get('case_coverage',{}).get('status')!='sufficient':
                errors.append('incomplete case coverage requires same-scene test_design repair')
        if errors:
            raise ValueError('; '.join(errors))
        if payload['status'] == 'repair_required':
            if payload.get('problem_kind') not in ('evidence', 'test_design', 'execution'):
                raise ValueError('repair verdict must identify a non-product execution problem')
            review = {**payload, 'scenario_id': identifier, 'evaluated_at': stamp()}
            archived = {'scenario_id': identifier, 'attempt': progress['attempt'], 'observation': record, 'review': review}
            if evidence_changed:
                archived['recording_damage'] = {'reason': payload['reason'], 'observation_sha256': hash_value(record), 'evidence_state': evidence_state(folder, record['evidence'])}
            run['attempt_history'].append(archived)
            run['execution_repairs'].append({'scenario_id': identifier, 'attempt': progress['attempt'], 'problem_kind': payload['problem_kind'], 'reason': payload['reason'], 'evidence': payload['evidence']})
            run['results'].remove(record)
            progress.update(phase='preparing', attempt=progress['attempt'] + 1, repair_reason=payload['reason'])
            progress.pop('binding', None)
            progress.pop('case_results', None)
            progress.pop('result_sha256', None)
            run['updated_at'] = stamp()
            atomic_json(folder / 'run.json', run)
            return progress
        if payload['status'] == 'execution_error':
            if not text(payload.get('capability_problem')) or not isinstance(payload.get('recovery_attempts'), list) or not payload['recovery_attempts'] or not all(text(a) for a in payload['recovery_attempts']):
                raise ValueError('AI execution exception needs a concrete capability problem and attempted recovery; ordinary evidence/test issues require repair')
        if payload['status'] == 'failed' and (record['status'] != 'failed' or not text(payload.get('bug_description'))):
            raise ValueError('BUG verdict needs observed product failure and bug_description, not an execution problem')
        if payload['status'] == 'passed' and record['status'] != 'passed':
            raise ValueError('evaluation cannot promote failed/blocked/unproven observations to passed')
        review = {**payload, 'scenario_id': identifier, 'evaluated_at': stamp()}
        run['scenario_reviews'].append(review)
        progress.update(phase='completed', evaluation_status=review['status'])
        if record['status'] != 'passed' or review['status'] != 'passed':
            run['issues'].append({'id': 'ISSUE-' + identifier + '-' + str(progress['attempt']), 'scenario_id': identifier, 'attempt': progress['attempt'],
                'execution_status': record['status'], 'evaluation_status': review['status'],
                'summary': review['summary'], 'execution_summary': record['summary'],
                'actual': record['actual'], 'reason': review['reason'], 'evidence': record['evidence'],
                'details': {'title': review['assessment'].get('explanation', {}).get('conclusion', review['summary']), 'preconditions': review['assessment'].get('explanation', {}).get('preconditions') or list(dict.fromkeys(v for task in case_design.associations(record.get('binding') or {}).values() for v in task.get('procedure', {}).get('preconditions', []) + task.get('procedure', {}).get('test_data', []))),
                            'steps': record['step_results'], 'expected': [c['expected'] for c in review['assessment']['checks']],
                            'actual': [c['actual'] for c in review['assessment']['checks']],
                            'impact': review.get('bug_description') or review.get('capability_problem'),
                            'recovery_attempts': review.get('recovery_attempts', [])},
                'kind': 'bug' if review['status'] == 'failed' else 'ai_execution_error',
                'disposition': 'recorded_for_separate_repair' if review['status'] == 'failed' else 'requires_execution_recovery'})
    else:
        raise ValueError(f'invalid lifecycle transition {phase} -> {action}')
    run['updated_at'] = stamp()
    atomic_json(folder / 'run.json', run)
    return progress


def evidence_state(folder, refs):
    state = {}
    for ref in refs:
        path = safe_path(folder, ref)
        state[ref] = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else 'missing'
    return state


def attempt_errors(folder, run):
    errors = []
    for attempt in run.get('attempt_history', []):
        record, review = attempt.get('observation', {}), attempt.get('review', {})
        damage = attempt.get('recording_damage')
        if damage:
            if hash_value(record) != damage.get('observation_sha256') or evidence_state(folder, record.get('evidence', [])) != damage.get('evidence_state'):
                errors.append('archived damaged recording changed; preserve the discovered state')
            continue
        if hash_value(record) != review.get('result_sha256'):
            errors.append('archived attempt observation changed')
        try:
            if evidence_hashes(folder, record.get('evidence')) != record.get('evidence_sha256'):
                errors.append('archived attempt evidence changed; preserve originals')
        except (ValueError, TypeError) as error:
            errors.append(str(error))
    return errors


def completion_errors(project, ledger, folder, run, review=None, identifier=None):
    if run.get('execution_schema') != 2:
        return []
    import execution_coverage
    errors = attempt_errors(folder, run) + dependency_errors(ledger, run) + execution_coverage.policy_errors(folder, run)
    import acceptance_plan
    try:
        acceptance_plan.assert_current(ledger, run)
    except ValueError as error:
        errors.append(str(error))
    try:
        verify_product(project, run)
    except (ValueError, subprocess.CalledProcessError) as error:
        errors.append(str(error))
    if identifier is None and run.get('lifecycle') != 'completed':
        errors.append('run is still in progress')
    scenarios = json.loads((folder / 'scenarios.snapshot.json').read_text())['items']
    expected = {s['id'] for s in scenarios}
    progress_ids = [p.get('scenario_id') for p in run.get('progress', [])]
    if set(progress_ids) != expected or len(progress_ids) != len(expected):
        errors.append('progress must retain every pinned scenario exactly once')
    reviews = {r.get('scenario_id'): r for r in run.get('scenario_reviews', [])}
    results = {r.get('scenario_id'): r for r in run.get('results', [])}
    for progress in run.get('progress', []):
        sid = progress['scenario_id']
        if identifier is not None and sid != identifier:
            continue
        if progress['phase'] == 'not_run':
            if identifier is not None:
                errors.append('scenario has not been executed')
            continue
        result, evaluation = results.get(sid, {}), reviews.get(sid, {})
        if result.get('case_recording_damage'):
            errors.append(f'{sid}: recorded case evidence was damaged; independent same-scene repair is required')
        if evaluation.get('status') in ('passed', 'failed'):
            errors.extend(execution_coverage.obligation_errors(project, folder, run, progress, result, evaluation.get('assessment', {})))
            scene = next((s for s in scenarios if s['id'] == sid), {})
            errors.extend(f'{sid}: {e}' for e in white_box_rules.execution_errors(ledger, scene, project))
        errors.extend(f'{sid}: {error}' for error in observation_detail_errors(result) + evidence_detail_errors(result))
        details = result.get('evidence_details')
        if not isinstance(details, list) or {v.get('path') for v in details if isinstance(v, dict)} != set(result.get('evidence', [])):
            errors.append(f'{sid}: evidence_details must describe every observed evidence file')
        if evaluation.get('status') not in FINAL_STATUSES or not text(evaluation.get('reason')) or evaluation.get('reviewer_kind') not in ('playbook', 'independent_ai') or not text(evaluation.get('review_reference')):
            errors.append(f'{sid}: missing independent final verdict (pass, BUG or AI execution exception)')
        if len([r for r in run.get('scenario_reviews', []) if r.get('scenario_id') == sid]) != 1:
            errors.append(f'{sid}: duplicate/missing independent verdict')
        if progress['phase'] != 'completed' or hash_value(result) != progress.get('result_sha256') or evaluation.get('result_sha256') != progress.get('result_sha256'):
            errors.append(f'{sid}: incomplete or stale independent scenario evaluation')
        try:
            if evidence_hashes(folder, result.get('evidence')) != result.get('evidence_sha256'):
                errors.append(f'{sid}: evidence changed after observation')
        except (ValueError, TypeError) as error:
            errors.append(f'{sid}: {error}')
        if evaluation.get('status') == 'passed' and result.get('status') != 'passed':
            errors.append(f'{sid}: failed observations cannot become a passed final verdict')
        cited = evaluation.get('evidence')
        if not isinstance(cited, list) or not cited or any(e not in result.get('evidence', []) for e in cited):
            errors.append(f'{sid}: final verdict must cite its observed evidence')
        errors.extend(f'{sid}: {error}' for error in assessment_errors(evaluation))
        if evaluation.get('status') == 'failed' and (result.get('status') != 'failed' or not text(evaluation.get('bug_description'))):
            errors.append(f'{sid}: BUG verdict lacks observed product failure')
        if evaluation.get('status') == 'execution_error' and (not text(evaluation.get('capability_problem')) or not evaluation.get('recovery_attempts')):
            errors.append(f'{sid}: AI exception lacks capability/recovery explanation')
        if evaluation.get('status') == 'execution_error' and execution_coverage.required(run):
            check = evaluation.get('assessment', {}).get('execution_coverage', {})
            if check.get('status') != 'not_completed' or not text(check.get('reason')) or not check.get('evidence') or any(e not in result.get('evidence', []) for e in check['evidence']):
                errors.append(f'{sid}: AI异常必须保留覆盖率未完成原因与证据')
        if result.get('binding'):
            errors.extend(binding_errors(project, ledger, run, result['binding'], historical=True))
            errors.extend(procedure_reference_errors(result['binding'], scenarios, sid))
            errors.extend(case_design.review_errors(evaluation.get('assessment',{}),result['binding'],next(v for v in scenarios if v['id']==sid)))
            errors.extend(case_design.result_errors(result,result['binding']))
            if evaluation.get('status') in ('passed','failed') and evaluation.get('assessment',{}).get('case_coverage',{}).get('status')!='sufficient':
                errors.append(f'{sid}: final pass/BUG requires sufficient independent case coverage')
        if progress.get('evaluation_status') != evaluation.get('status'):
            errors.append(f'{sid}: progress and independent verdict disagree')
        if review is not None:
            final = next((r for r in review.get('results', []) if r.get('scenario_id') == sid), {})
            if any(final.get(k) != evaluation.get(k) for k in ('status', 'reason', 'evidence', 'summary', 'assessment')):
                errors.append(f'{sid}: final summary changed the per-scenario verdict')
    return errors
