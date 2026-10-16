"""Read-only background verification; never delay the live progress response."""
import hashlib
import json
from pathlib import Path
import subprocess
from copy import deepcopy
from datetime import datetime, timezone
from threading import Lock, Thread

import execution_coverage


def completed_inputs(run, document, identifiers=None):
    """Freeze metric contributors, preserving the full scenario-ID roster.

    Other scenes' phases, receipts and attempts cannot change these counters.
    Native final acceptance gates continue to check the whole actual run.
    """
    eligible = {p.get('scenario_id') for p in run.get('progress', []) if p.get('phase') == 'completed'}
    ids = eligible if identifiers is None else eligible.intersection(identifiers)
    stable = deepcopy({k: v for k, v in run.items() if k not in (
        'updated_at', 'started_at', 'finished_at', 'lifecycle', 'progress', 'results',
        'scenario_reviews', 'attempt_history', 'execution_repairs', 'issues')})
    stable['lifecycle'] = 'running'
    stable['progress'] = [deepcopy(p) if p.get('scenario_id') in ids else
                          {'scenario_id': p.get('scenario_id'), 'phase': 'pending'} for p in run.get('progress', [])]
    for key in ('results', 'scenario_reviews', 'attempt_history'):
        stable[key] = deepcopy([v for v in run.get(key, []) if v.get('scenario_id') in ids])
    coverage = deepcopy(document)
    if isinstance(coverage, dict):
        coverage['receipts'] = [r for r in coverage.get('receipts', []) if r.get('scenario_id') in ids]
        coverage.pop('updated_at', None)
    return stable, coverage, sorted(ids)


def identity(path):
    """A changed, replaced, removed or symlinked file invalidates a cached proof."""
    path = Path(path)
    try:
        a, b = path.lstat(), path.stat()
        if path.is_dir():
            return (str(path), str(path.resolve()), 'directory', a.st_dev, a.st_ino, b.st_dev, b.st_ino)
        return (str(path), str(path.resolve()), *[(s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns) for s in (a, b)])
    except OSError:
        return (str(path), 'missing')


def signature(project, ledger, folder, run, document, identifiers=None):
    run, document, _ = completed_inputs(run, document, identifiers)
    paths = {ledger / n for n in ('project.json', 'requirements.json', 'resources.json', 'scenarios.json', 'coverage_review.json', 'white_box_rules.json', 'acceptance-plan.json', 'acceptance-plan-review.json', 'scope-decisions.json', 'acceptance-scope-policy.json', 'source-analysis.json', 'design-progress.json')}
    # run.json / coverage receipts are checked by their contributor projection,
    # not the mtime of a container also written by unrelated live scenes.
    paths.update(folder / n for n in ('execution-plan.json', 'scenarios.snapshot.json', 'white_box_rules.snapshot.json'))
    roots = {project}
    case_refs = set()
    def references(value, key=''):
        if isinstance(value, dict):
            if key == 'cases' and value.get('revision') and value.get('path'):
                # Completed cases were executed from this exact committed
                # version. Current test edits for later scenes are unrelated.
                case_refs.add((value['revision'], value['path']))
                return
            if key in ('evidence_sha256', 'source_sha256'):
                for reference in value:
                    paths.update(root / reference for root in (folder, ledger, project))
            root = value.get('root', value.get('project_root'))
            if isinstance(root, str) and root:
                roots.add(Path(root).resolve())
            for k, v in value.items():
                references(v, k)
        elif isinstance(value, list):
            for v in value:
                references(v, key)
        elif isinstance(value, str) and key in ('path', 'evidence', 'provenance_evidence', 'preparation_evidence', 'input_refs', 'input_references') and value and len(value) < 4096:
            # Evidence may be run-relative or ledger-relative. Track both;
            # the native verifier still decides which reference is permitted.
            paths.update(root / value for root in (folder, ledger, project))
    references(run); references(document)
    for name in ('project.json', 'resources.json', 'white_box_rules.json', 'scenarios.snapshot.json', 'white_box_rules.snapshot.json'):
        path = (folder if name.endswith('.snapshot.json') else ledger) / name
        try:
            references(json.loads(path.read_text()))
        except (OSError, ValueError):
            pass
    inventory = []
    # Parse each reviewed test path once. Checking every pattern against every
    # file repeatedly constructed millions of Path objects on larger runs.
    test_paths = {Path(p) for p in run.get('test_code_paths', [])}
    for root in sorted(roots, key=str):
        r = subprocess.run(['git', '-C', str(root), 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], capture_output=True, timeout=5)
        files = []
        if r.returncode == 0:
            for p in r.stdout.decode(errors='surrogateescape').split('\0'):
                if not p:
                    continue
                absolute = root / p
                try:
                    relative = absolute.relative_to(project).as_posix()
                except ValueError:
                    relative = None
                if relative is not None and not test_paths.isdisjoint((Path(relative), *Path(relative).parents)):
                    continue
                files.append(p); paths.add(absolute)
        inventory.append((str(root), r.returncode, files))
    for revision, path in sorted(case_refs):
        r = subprocess.run(['git', '-C', str(project), 'show', revision + ':' + path], capture_output=True, timeout=5)
        inventory.append(('committed_case', revision, path, r.returncode, hashlib.sha256(r.stdout).hexdigest()))
    payload = [run, document, inventory, [identity(p) for p in sorted(paths, key=str)]]
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def pending(run, reason='覆盖率及证据正在后台核验，执行进度可先查看；核验完成后自动更新指标。', state='pending'):
    return {'projects': [], 'subjects': [], 'collection': [], 'issues': [], 'measured_scenario_ids': [],
            'updated_at': None, 'policy': run.get('coverage_policy', {'mode': 'off'}),
            'verification_state': state, 'verification_reason': reason}


def live_result(result, run, document, verified_ids=(), updating=False):
    """Keep live collection stages separate from already verified counters."""
    value = deepcopy(result)
    value['collection'] = [r for r in value.get('collection', []) if r.get('scenario_id') in verified_ids]
    reviews = {r.get('scenario_id'): r for r in run.get('scenario_reviews', [])}
    for p in run.get('progress', []):
        sid = p.get('scenario_id')
        if sid in verified_ids:
            continue
        projects = (p.get('binding') or {}).get('coverage_collection', {}).get('projects', [])
        phase = p.get('phase')
        if not projects:
            value['collection'].append({'scenario_id': sid, 'status': 'pending' if phase in ('pending', 'preparing', 'not_run') else 'pending_review' if phase == 'completed' else 'missing',
                'reason': '尚未进入采集准备' if phase in ('pending', 'preparing', 'not_run') else '等待后台核验，尚未计入累计覆盖率' if phase == 'completed' else '本场景尚无采集准备记录，需补齐'})
        for item in projects:
            row = {k: item.get(k) for k in ('project_id', 'project_label', 'scope', 'reason', 'recovery_attempts')}
            row.update(scenario_id=sid, recorded_reason=item.get('reason'))
            if phase == 'completed' and reviews.get(sid, {}).get('status') == 'execution_error':
                row.update(status='not_completed', reason='AI未完成执行，覆盖率未计入')
            elif phase in ('completed', 'evaluating'):
                receipt = any(r.get('scenario_id') == sid and r.get('attempt') == p.get('attempt') and r.get('project_id') == item.get('project_id') for r in (document or {}).get('receipts', []))
                row.update(status='pending_review' if receipt or item.get('status') == 'unavailable' else 'missing',
                    reason='等待独立及后台核验，尚未计入累计覆盖率' if receipt or item.get('status') == 'unavailable' else '本次尚无采集收据，需补齐')
            else:
                row['status'] = 'collecting' if item.get('status') == 'available' else 'unavailable_pending'
            value['collection'].append(row)
    if updating:
        count = len(value.get('measured_scenario_ids', []))
        value.update(verification_state='updating', verification_reason=f'当前显示此前已核验的 {count} 个场景的累计覆盖率；新增已完成场景正在核验，尚未计入。')
    return value


class CoverageCache:
    def __init__(self):
        self.lock = Lock()
        self.entries = {}

    def get(self, project, ledger, folder, run, document):
        if run.get('lifecycle') == 'aborted':
            return pending(run, '该运行已中止，历史数据不计入当前覆盖率。', 'aborted')
        if document is None and not execution_coverage.required(run):
            return pending(run, '', 'not_requested')
        try:
            key = signature(project, ledger, folder, run, document)
            _, _, ids = completed_inputs(run, document)
        except (OSError, ValueError, TypeError, subprocess.TimeoutExpired) as error:
            return pending(run, '覆盖率依赖无法核验：' + str(error), 'invalid')
        with self.lock:
            entry = self.entries.setdefault(str(folder), {})
            if entry.get('key') == key and 'result' in entry:
                return live_result(entry['result'], run, document, entry.get('ids', []))
            previous = None
            if entry.get('result', {}).get('verification_state') == 'ready':
                try:
                    previous_key = signature(project, ledger, folder, run, document, entry.get('ids', []))
                except (OSError, ValueError, TypeError, subprocess.TimeoutExpired) as error:
                    return pending(run, '已核验覆盖率的依赖无法确认：' + str(error), 'invalid')
                if entry.get('key') == previous_key:
                    previous = live_result(entry['result'], run, document, entry['ids'], updating=True)
            if not entry.get('working'):
                entry['working'] = True
                Thread(target=self.verify, args=(project, ledger, folder, run, document, key, ids, entry), daemon=True).start()
        # Never retain green metrics while the result, evidence, source bytes,
        # denominator or any frozen input differs from the cached verification.
        return previous or live_result(pending(run), run, document)

    def verify(self, project, ledger, folder, run, document, key, ids, entry):
        try:
            stable_run, stable_document, _ = completed_inputs(run, document, ids)
            result = execution_coverage.summarize(project, ledger, folder, stable_run, stable_document)
            result.update(verification_state='ready', verification_reason='', verified_at=datetime.now(timezone.utc).isoformat())
            # Re-read mutable containers: a contributor may be repaired or
            # replaced while the background verification is in progress.
            current_run = execution_coverage.read(folder / 'run.json')
            current_document = execution_coverage.read(folder / execution_coverage.NAME) if (folder / execution_coverage.NAME).exists() else document
            after = signature(project, ledger, folder, current_run, current_document, ids)
            with self.lock:
                if after == key:
                    entry.update(key=key, ids=ids, result=result)
        except Exception as error:
            with self.lock:
                entry.update(key=key, ids=ids, result=pending(run, '覆盖率后台核验失败：' + str(error), 'invalid'))
        finally:
            with self.lock:
                entry['working'] = False
