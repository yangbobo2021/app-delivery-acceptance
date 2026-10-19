"""Read-only viewer rooted at one user project, isolated by acceptance ID."""
from __future__ import annotations

import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import copy
import threading
import time
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from acceptance_store import locations, inside, owned_path, read, read_current, validate, validate_knowledge, validate_catalog, digest, project_root
from progress_views import collect
from project_statistics import project_state
from coverage_views import summarize
from serve import HTML, coverage_inputs
from evidence_store import resolve as resolve_artifact, verify_import_trace

SKIP = {"checkout", "worktrees", "node_modules", ".git", ".acceptance", ".acceptance-local", "__pycache__"}


def files_under(roots, name):
    files = []
    for root in roots:
        if not root.is_dir():
            continue
        for folder, dirs, names in os.walk(root, followlinks=False):
            dirs[:] = sorted(d for d in dirs if d not in SKIP and not (Path(folder) / d).is_symlink())
            if name in names:
                file = inside(root, (Path(folder) / name).relative_to(root))
                files.append(file)
    return sorted(set(files))


def catalog_trace(path, project_id):
    value = read(path)
    validate_catalog(value)
    return {"schema": "delivery-trace-v1", "generated_at": value.get("updated_at", ""),
            "project": {**value.get("project", {}), "id": project_id},
            "requirements": value.get("requirements", []), "reverse_rules": value.get("reverse_rules", []),
            "scenarios": value["scenarios"], "bindings": [], "case_results": [], "attempt_id": "catalog",
            "stage": "scenario_self_checked", "judgment": {"status": "not_run"},
            "coverage": {"status": "pending"}}


def current_progress_for_catalog(progress):
    """Keep the newest candidate list per target for project statistics."""
    latest = {}
    other = []
    for preview in progress.get('previews', []):
        scenes = preview.get('scenarios', [])
        if preview.get('stage') not in {'scenario_self_checked', 'scenario_approved'}:
            other.append(preview)
            continue
        owners = {scene.get('requirement_id') for scene in scenes}
        if len(owners) != 1 or None in owners:
            other.append(preview)
            continue
        owner = next(iter(owners))
        key = (preview.get('generated_at') or '', preview.get('progress_folder') or '')
        if owner not in latest or key > latest[owner][0]:
            latest[owner] = (key, preview)
    return {**progress, 'previews': [*other, *(preview for _, preview in latest.values())]}


def catalog_observed_scene_ids(traces, progress):
    """Compare the catalog with current target lists and bound case history."""
    current = current_progress_for_catalog(progress)
    return {scene['id'] for trace in [*traces, *current.get('previews', []),
                                     *current.get('case_history', [])]
            for scene in trace.get('scenarios', [])}


def registered_artifact_path(local, shared, mapping, name, expected=None):
    """Resolve an immutable registered capture in this checkout's archive."""
    from coverage_protocol import resolved
    key = str(name)
    item = mapping.get(key + '#' + expected) if expected else None
    item = item or mapping.get(key)
    if item and (expected is None or item['sha256'] == expected):
        path = owned_path(shared, item['path'])
        if digest(path) != item['sha256']:
            raise ValueError('archived coverage artifact changed: ' + key)
        return path
    return resolved(owned_path(local, name), mapping, expected)


def workflow_requests(roots, local):
    """An archive is the same attempt, never a newer run because it was copied."""
    selected, origins = {}, {}
    for path in files_under(roots, 'request.frozen.json'):
        origin = {'original_path': str(path)}
        for parent in path.parents:
            if parent == roots[0].parent or parent == roots[1].parent:
                break
            record_path = parent / 'record.json'
            if record_path.is_file():
                record = read(record_path)
                if record.get('schema') != 'acceptance-evidence-record-v1':
                    continue
                relative = path.relative_to(parent).as_posix()
                original = next((key for key, value in record.get('original_paths', {}).items()
                                 if value == relative), str(path))
                origin = record.get('workflow_requests', {}).get(relative, {'original_path': original})
                break
        key = (origin['original_path'], digest(path))
        companions = ['state.json', 'summary.json', 'case/answer.json', 'coverage-report.json',
                      'review/answer.json', 'execution/execution.json']
        score = (path.is_relative_to(local / 'workflows'),
                 sum((path.parent / name).is_file() for name in companions))
        if key not in selected or score > selected[key][0]:
            selected[key] = (score, path)
        origins[str(path)] = origin
    return [item[1] for item in selected.values()], origins


class ProjectView:
    def __init__(self, root, selected=None):
        self.root = project_root(root)
        self.selected = selected
        self._snapshot_lock = threading.RLock()
        self._snapshots = {}
        self._validated = {}

    def validated_state(self, acceptance_id):
        # Viewer-only cache. Execution guards always perform full validation.
        _, shared, _ = locations(self.root, acceptance_id)
        files = [self.root / '.gitignore', self.root / '.git']
        for folder, dirs, names in os.walk(shared, followlinks=False):
            dirs[:] = [d for d in dirs if not (Path(folder) / d).is_symlink()]
            files.extend(Path(folder) / name for name in names)
        marker = tuple((str(p), p.lstat().st_size, p.lstat().st_mtime_ns)
                       for p in sorted(files) if p.exists())
        with self._snapshot_lock:
            cached = self._validated.get(acceptance_id)
            if cached and cached[0] == marker:
                return cached[1]
            state = validate(self.root, acceptance_id, check_knowledge=False)
            self._validated[acceptance_id] = (marker, state)
            return state

    def snapshot_token(self, selected):
        """Watch registered inputs, never recursively walk the imported raw tree."""
        _, shared, local = locations(self.root, selected)
        files = [self.root / '.acceptance-local/current.json', local / 'project-context.json']
        for base in [shared, local / 'workflows', self.root / '.acceptance/knowledge']:
            if not base.is_dir():
                continue
            for folder, dirs, names in os.walk(base, followlinks=False):
                dirs[:] = [d for d in dirs if d not in SKIP and not (Path(folder) / d).is_symlink()]
                files.extend(Path(folder) / name for name in names)
                for name in names:
                    if name=='prepared.json':
                        prepared=read(Path(folder)/name)
                        if prepared.get('schema')=='project-coverage-preparation-v1':
                            source=Path(prepared['spec']['project_root'])
                            files.extend(source/item for item in prepared['adapter_files'])
                    if name == 'trace.json':
                        transport = read(Path(folder) / name).get('coverage', {}).get('transport')
                        if transport:
                            files.append(inside(local, transport['path']))
        cases_path = shared / 'case-catalog.json'
        if cases_path.is_file():
            cases = read(cases_path)
            workspace = local / 'workspace'
            for case in cases.get('cases', []):
                files.extend(inside(workspace, item['path']) for item in case.get('files', []))
        from evidence_store import index
        for item in index(self.root, selected).values():
            kind, name = item['storage'].split(':', 1)
            files.append(inside(local if kind == 'local' else shared, name))
        files.extend([Path(__file__), Path(__file__).with_name('coverage_views.py'),
                      Path(__file__).parents[2] / 'playbook/v4/coverage_protocol.py',
                      Path(__file__).parents[1] / 'coverage-istanbul/provider.mjs',
                      Path(__file__).parents[1] / 'coverage-istanbul/evidence-transport.mjs'])
        stamps = []
        for file in sorted(set(files)):
            stat = file.stat() if file.is_file() else None
            stamps.append((str(file), stat.st_size if stat else None, stat.st_mtime_ns if stat else None))
        return tuple(stamps)

    def current_status(self):
        try:
            return read_current(self.root), None
        except (ValueError, KeyError, OSError) as error:
            return None, str(error)

    def inventory(self):
        rows = []
        base = inside(self.root, ".acceptance")
        if not base.is_dir():
            return rows
        for folder in sorted(base.iterdir()):
            if folder.name == "knowledge" or not folder.is_dir():
                continue
            try:
                _, shared, _ = locations(self.root, folder.name)
                manifest = read(shared / "manifest.json")
                row = {"id": folder.name, "title": manifest.get("title", folder.name),
                       "owner": manifest.get("owner"), "created_at": manifest.get("created_at", "")}
                # Listing metadata must not wait for evidence validation or the
                # snapshot/coverage lock. Validate only when opening that ID.
                rows.append(row)
            except (ValueError, KeyError, OSError) as error:
                rows.append({"id": folder.name, "title": folder.name, "validation_error": str(error)})
        return sorted(rows, key=lambda r: (r.get("created_at", ""), r["id"]), reverse=True)

    def selection(self, requested=None):
        rows = self.inventory()
        active, _ = self.current_status()
        selected = requested or self.selected or active or (rows[0]["id"] if rows else None)
        if selected and selected not in {row["id"] for row in rows}:
            raise ValueError("unknown acceptance ID")
        return selected, rows

    def roots(self, acceptance_id):
        _, shared, local = locations(self.root, acceptance_id)
        return [shared / "records", local / "workflows"]

    def snapshot(self, requested=None):
        # Cold coverage conversion is expensive. Multiple open tabs must share
        # one calculation rather than spawning a tool process per HTTP poll.
        with self._snapshot_lock:
            selected, inventory = self.selection(requested)
            if not selected:
                return self._snapshot(requested)
            token = (self.snapshot_token(selected), json.dumps(inventory, sort_keys=True))
            cached = self._snapshots.get(selected)
            if cached and cached[0] == token and (not cached[3] or time.monotonic() - cached[1] < 1):
                return copy.deepcopy(cached[2])
            payload = self._snapshot(requested)
            active = any(not s.get('finished') for s in payload['progress'].get('stages', []))
            recheck = active or any(row.get('profile') for row in payload.get('coverage',[]))
            self._snapshots[selected] = (token, time.monotonic(), payload, recheck)
            return copy.deepcopy(payload)

    def registered_coverage(self, selected, warnings=None):
        """Coverage-only reruns supply counters, never a new business judgment."""
        _, shared, local = locations(self.root, selected)
        context_path = local / 'project-context.json'
        context = read(context_path) if context_path.is_file() else {}
        if context and (context.get('acceptance', {}).get('id') != selected or
                context.get('acceptance', {}).get('project_root') != str(self.root)):
            raise ValueError('coverage context belongs to another acceptance')
        known_scenes = {item['id'] for item in read(shared / 'scenarios.json')['scenarios']}
        paths = context.get('coverage_registries', [])
        if context.get('coverage_registry'):
            paths = [*paths, context['coverage_registry']]
        rows = []
        from coverage_views import artifact_mapping
        mapping=artifact_mapping(local)
        warnings=warnings if warnings is not None else []
        registered_artifact=lambda name,expected=None: registered_artifact_path(
            local,shared,mapping,name,expected)
        entries={}
        for name in paths:
            try:
                registry_path=registered_artifact(name)
                if not registry_path.is_file():continue  # Explicit archived captures remain discoverable below.
                registry=read(registry_path)
                if registry.get('schema') not in {'continuous-coverage-index-v1','project-coverage-index-v1'}:
                    raise ValueError('invalid registered coverage index')
                for entry in registry.get('entries',[]):entries[entry['report_sha256']]=entry
            except (ValueError,OSError,KeyError) as error:
                warnings.append('覆盖率运行索引不可用：'+str(error))
        for record_path in sorted((shared/'records').glob('*/record.json')):
            record=read(record_path)
            for name in record.get('coverage_reports',[]):
                report_file=inside(record_path.parent,name)
                if digest(report_file)!=record['files'].get(name):raise ValueError('Archived coverage report changed')
                report=read(report_file)
                original=next((path for path,relative in record['original_paths'].items() if relative==name),None)
                if not original:raise ValueError('Archived coverage report lacks origin')
                entries[record['files'][name]]={'report':original,'report_sha256':record['files'][name],
                    'scene_id':report['scene_id'],'profile':report['prepared_sha256']}
        for entry in entries.values():
            try:
                if entry['scene_id'] not in known_scenes:
                    raise ValueError('coverage scene is outside the registered project catalog')
                report_path = registered_artifact(entry['report'], entry['report_sha256'])
                if digest(report_path) != entry['report_sha256']:
                    raise ValueError('registered coverage report changed')
                report = read(report_path)
                if report['scene_id'] != entry['scene_id'] or report['prepared_sha256'] != entry['profile']:
                    raise ValueError('registered coverage binding changed')
                prepared = read(registered_artifact(Path(report['prepared']) / 'prepared.json',report['prepared_sha256']))
                receipt = read(registered_artifact(report['receipt_path'],report.get('execution_sha256')))
                if report.get('protocol')=='project-coverage-v1':
                    rows.append({'schema':'registered-coverage-capture-v1',
                        'project':{'id':read(shared/'manifest.json')['project_id'],'revision':receipt['head_after']},
                        'scenarios':[{'id':entry['scene_id']}],'generated_at':receipt['end_utc'],
                        'change':{'inventory':read(registered_artifact(prepared['spec']['inventory_path'],prepared['spec'].get('inventory_sha256')))},
                        'coverage':{**report,'report_path':entry['report'],'capture_end':receipt['end_utc']}})
                    continue
                check = report_path.parent / 'collection-check.json'
                rows.append({'schema': 'registered-coverage-capture-v1',
                    'project': {'id': read(shared / 'manifest.json')['project_id'], 'revision': receipt['head_after']},
                    'scenarios': [{'id': entry['scene_id']}], 'generated_at': receipt['end_utc'],
                    'change': {'inventory': read(owned_path(local, prepared['spec']['inventory_path']))},
                    'coverage': {'provider': report['provider'], 'istanbul_path': report['istanbul_path'],
                                 'capture_end': receipt['end_utc'],
                                 'collection_check': read(check) if check.is_file() else {}}})
            except (ValueError,OSError,KeyError) as error:
                warnings.append('覆盖率条目未通过校验：'+str(error))
        return rows

    def coverage_cohort_rows(self, selected, rows):
        """Metadata-only commits may share counters only for identical source/scope/tool units.

        The dedicated provider still verifies and merges every original report. This
        projection changes no evidence or judgment and preserves actual capture revisions.
        """
        _, _, local = locations(self.root, selected)
        # Ordinary v4 reports carry their own prepared inventory. Cohort projection
        # is optional historical metadata, not a prerequisite for a new acceptance.
        if not (local / 'project-context.json').is_file():
            return rows
        context = read(local / 'project-context.json')
        if not context.get('continuation_config'):
            return rows
        config = read(owned_path(local, context['continuation_config']))
        coverage = config.get('coverage', {})
        prepared = read(owned_path(local, coverage['prepared']) / 'prepared.json')
        current_inventory = read(owned_path(local, coverage['inventory_path']))
        if not current_inventory.get('source_hashes') or current_inventory['source_hashes'] != prepared['spec']['source_hashes']:
            raise ValueError('complete current product hashes do not match the prepared tool profile')
        def source_scope(inv):
            return (inv.get('source_hashes'), sorted(
                (json.dumps(f, sort_keys=True) for f in inv.get('files', []) if f.get('kind') == 'source')))
        expected_scope = source_scope(current_inventory)
        projected = copy.deepcopy(rows)
        mappings = {}
        for row in projected:
            change = row.get('change', {})
            inventory = change.get('inventory')
            if change.get('inventory_ref'):
                file, _ = resolve_artifact(self.root, selected, change['inventory_ref'])
                if file is None:
                    raise ValueError('coverage scope evidence is unavailable')
                inventory = read(file)
            if not inventory or source_scope(inventory) != expected_scope:
                raise ValueError('product source or changed source-line scope differs; keep collections separate')
            c = row.get('coverage', {})
            if c.get('provider') == 'istanbul-source-v1' and c.get('istanbul_path'):
                report = Path(c['istanbul_path']).with_name('coverage-report.json')
                transport = c.get('transport')
                if transport:
                    mapping_path = inside(local, transport['path'])
                    if digest(mapping_path) != transport['sha256']:
                        raise ValueError('coverage path transport changed')
                    mapping = mappings.setdefault(str(mapping_path), read(mapping_path))
                    item = mapping['files'].get(str(report))
                    if item:
                        report = owned_path(local, mapping_path.parent / item['path'])
                        if digest(report) != item['sha256']:
                            raise ValueError('relocated coverage report changed')
                report = owned_path(local, report)
                if read(report).get('compatibility_key') != prepared['compatibility_key']:
                    raise ValueError('dedicated-tool source/unit compatibility differs; keep collections separate')
            row['coverage_capture_revision'] = row.get('coverage_actual_revision') or row['project']['revision']
            row['coverage_source_cohort'] = 'identical-source:' + prepared['compatibility_key']
            row['coverage_reference_revision'] = config['revision']
            row['change'] = {**change, 'inventory': current_inventory}
            row['change'].pop('inventory_ref', None)
        return projected

    def workspace_context(self, selected):
        """Current candidate locations are separate from frozen execution evidence."""
        _, shared, local = locations(self.root, selected)
        context_path, cases_path = local / 'project-context.json', shared / 'case-catalog.json'
        if not context_path.is_file() or not cases_path.is_file():
            return None, {}
        context, catalog = read(context_path), read(cases_path)
        if (context.get('acceptance', {}).get('id') != selected or
                context.get('acceptance', {}).get('project_root') != str(self.root) or
                catalog.get('schema') != 'acceptance-workspace-cases-v1' or catalog.get('acceptance_id') != selected):
            raise ValueError('workspace/case catalog belongs to another acceptance')
        workspace = owned_path(local, context['source_checkout'])
        if workspace != local / 'workspace' or not workspace.is_dir():
            raise ValueError('current acceptance workspace is missing or outside its registered location')
        cases, file_paths = {}, set()
        for case in catalog.get('cases', []):
            if case['scene_id'] in cases:
                raise ValueError('duplicate workspace scene mapping')
            for item in case.get('files', []):
                file_paths.add(item['path'])
                file = inside(workspace, item['path'])
                if not file.is_file() or digest(file) != item['sha256']:
                    raise ValueError('current candidate file changed or missing: ' + item['path'])
            cases[case['scene_id']] = case
        if len(cases) != catalog['scene_count'] or len(file_paths) != catalog['file_count']:
            raise ValueError('workspace case/file counts do not reconcile')
        verification = None
        verification_path = shared / 'path-verification.json'
        if verification_path.is_file():
            item = read(verification_path)
            if (item.get('schema') != 'acceptance-path-verification-v1' or
                    item.get('acceptance_id') != selected):
                raise ValueError('invalid path verification record')
            if (item.get('source_revision') == catalog['source_revision'] and
                    item.get('case_catalog_sha256') == digest(cases_path)):
                verification = item
        return {'path': str(workspace), 'source_revision': catalog['source_revision'],
                'scene_count': len(cases), 'file_count': catalog['file_count'],
                'promoted_scene_count': catalog.get('promoted_scene_count', 0),
                'excluded_scene_count': catalog.get('excluded_scene_count', 0),
                'integration_status': catalog['integration_status'],
                'test_execution': catalog['test_execution'], 'path_verification': verification}, cases

    def _snapshot(self, requested=None):
        selected, rows = self.selection(requested)
        payload = {"schema": "acceptance-project-view-v1", "project_root": str(self.root),
                   "acceptances": rows, "acceptance_id": selected, "traces": [],
                   "progress": {"previews": [], "stages": []}, "coverage": [],
                   "project_state": {"traces": [], "projects": []}, "warnings": [],
                   "design_gaps": []}
        payload["denominator_complete"] = False
        active, current_error = self.current_status()
        payload["current_acceptance_id"] = active
        payload["current_error"] = current_error
        if current_error:
            payload["warnings"].append("当前验收指针无效；执行将被拦截，历史查看不改变指针：" + current_error)
        if not selected:
            payload["warnings"].append("项目尚未登记验收测试 ID；旧目录不会自动并入新的验收。")
            return payload
        _, shared, local = locations(self.root, selected)
        state = self.validated_state(selected)
        try:
            validate_knowledge(self.root)
        except (ValueError, OSError) as error:
            payload["warnings"].append("当前知识库校验未通过，新执行将被拦截；历史记录保持可读：" + str(error))
        payload["scope"] = read(shared / state["scope"]["path"])
        workspace_cases = {}
        try:
            payload['workspace'], workspace_cases = self.workspace_context(selected)
        except (ValueError, OSError, KeyError) as error:
            payload['warnings'].append('当前用例位置核对失败；历史结论保持原样：' + str(error))
        roots = self.roots(selected)
        traces, folders = [], []
        for path in files_under(roots, "trace.json"):
            trace = read(path)
            if trace.get("schema") != "delivery-trace-v1":
                raise ValueError("invalid trace: " + str(path))
            owner = trace.get("acceptance", {}).get("id")
            if owner and owner != selected:
                raise ValueError("trace belongs to another acceptance")
            if not verify_import_trace(self.root, selected, trace):
                payload['warnings'].append('迁移来源快照未随当前工作目录提供；保留原确认结论，不声称当前已完成证据核验。')
            for label, reference in list(trace.get('current_links', {}).items()):
                if reference.startswith('artifact:'):
                    file, _ = resolve_artifact(self.root, selected, reference)
                    if file:
                        trace['current_links'][label] = self.artifact_url(selected, reference)
                    else:
                        trace['current_links'].pop(label)
                        payload['warnings'].append('部分导入证据未随当前工作目录提供；结论保留原版本，不表示重新核验通过。')
            for result in trace.get("case_results", []):
                evidence = self.resolve_evidence(path, result.get("evidence_path", ""), selected)
                if evidence:
                    result["evidence_url"] = self.evidence_url(selected, path, result, evidence)
                else:
                    result.pop("evidence_url", None)
                    if result.get("evidence_path"):
                        payload["warnings"].append("部分原始证据仅保存在原机器或外部存储，当前无法读取。")
            mapped = [workspace_cases[s['id']] for s in trace.get('scenarios', []) if s['id'] in workspace_cases]
            if len(mapped) == 1:
                trace['workspace_case'] = mapped[0]
            traces.append(trace)
            folders.append(str(path.parent.parent if path.parent.name.startswith("attempt-") else path.parent))
        # Only pass explicit request files; never recursively scan a checkout or a cache.
        requests, origins = workflow_requests(roots, local)
        resolver = lambda path, name: self.resolve_evidence(path, name, selected)
        progress = collect([], traces, request_paths=requests, artifact_resolver=resolver,
                           request_origins=origins)
        for row in [*progress.get("previews", []), *progress.get("case_history", [])]:
            path = Path(row["progress_folder"]) / "request.frozen.json"
            for result in row.get("case_results", []):
                file = resolver(path, result.get("evidence_path", ""))
                if file:
                    result["evidence_url"] = self.evidence_url(selected, path, result, file)
                elif result.get("evidence_path"):
                    payload["warnings"].append("部分原始证据仅保存在原机器或外部存储，当前无法读取。")
        pid = state["manifest"]["project_id"]
        for trace in [*traces, *progress.get("previews", []), *progress.get("case_history", [])]:
            trace["project"]["id"] = pid
        for stage in progress.get("stages", []):
            stage["project_id"] = pid
        catalog = shared / "scenarios.json"
        all_traces = list(traces)
        if catalog.is_file():
            catalog_value = read(catalog)
            payload["design_gaps"] = catalog_value.get("design_gaps", [])
            if payload["design_gaps"]:
                payload["warnings"].append(
                    f"场景设计仍有 {len(payload['design_gaps'])} 项必达义务缺口；相关需求不可宣称完整验收。")
                payload["warnings"].extend(
                    f"{gap['requirement_id']}：{gap['quote']}；{gap['reason']}"
                    for gap in payload["design_gaps"])
            all_traces.append(catalog_trace(catalog, pid))
            catalog_ids = {s["id"] for s in all_traces[-1]["scenarios"]}
            observed_ids = catalog_observed_scene_ids(traces, progress)
            payload["denominator_complete"] = observed_ids.issubset(catalog_ids)
            if not payload["denominator_complete"]:
                payload["warnings"].append("场景清单缺少执行记录中的场景；修正清单前不显示项目场景比例。")
        else:
            payload["warnings"].append("缺少项目完整场景清单；当前仅显示已发现记录，不能作为项目整体覆盖或完整验收结论。")
        coverage_rows = coverage_inputs(traces, progress, folders)
        coverage_rows.extend(t for t in all_traces if t.get('attempt_id')=='catalog')
        # Supplemental coverage-only captures require the complete catalog for
        # scene membership checks. Partial v4 scene traces already carry their
        # same-run coverage, so do not report a false index failure here.
        if catalog.is_file():
            try:
                coverage_rows.extend(self.registered_coverage(selected,payload['warnings']))
            except (ValueError, OSError, KeyError) as error:
                payload['warnings'].append('新增覆盖率索引核对失败；原确认结论保持不变：' + str(error))
        try:
            coverage_rows = self.coverage_cohort_rows(selected, coverage_rows)
        except (ValueError, OSError, KeyError) as error:
            payload['warnings'].append('覆盖率保持各实际版本分别展示：' + str(error))
        measured=summarize(coverage_rows,evidence_root=local)
        payload.update(traces=traces, progress=progress,
                       project_state=project_state(all_traces, current_progress_for_catalog(progress) if catalog.is_file() else progress),
                       coverage=measured)
        # Coverage-only captures replace no business judgment. Attach each proved
        # capture only to its actual scene/revision, retaining the original time.
        from coverage_views import artifact_mapping
        from coverage_protocol import resolved
        mapping=artifact_mapping(local);captures={}
        for group in measured:
            for item in group.get('verified_reports',[]):
                file=resolved(item['path'],mapping)
                if digest(file)!=item['sha256']:continue
                report=read(file)
                key=(group['project_id'],report['revision'],report['scene_id'])
                value={**report,'report_path':item['path'],'verified':True}
                if key not in captures or value.get('capture_end','')>captures[key].get('capture_end',''):captures[key]=value
        for trace in [*traces,*progress.get('previews',[]),*progress.get('case_history',[]),*payload['project_state'].get('traces',[])]:
            scenes=trace.get('scenarios',[])
            if len(scenes)!=1:continue
            project=trace.get('project',{});capture=captures.get((project.get('id'),project.get('revision'),scenes[0]['id']))
            if capture:
                trace['coverage']={**capture,'capture_note':'独立补采记录；业务结论和原执行时间保持不变。'}
        # Uncollected catalog scenes must not be treated as new coverage captures.
        payload["warnings"] = sorted(set(payload["warnings"]))
        return payload

    @staticmethod
    def key(path):
        return hashlib.sha256(str(path).encode()).hexdigest()[:16]

    def evidence_url(self, selected, source, result, evidence):
        from urllib.parse import urlencode
        return "/api/evidence?" + urlencode({"acceptance_id": selected, "trace": self.key(source),
            "binding": result["binding_id"], "artifact": self.key(evidence)})

    def artifact_url(self, selected, reference):
        from urllib.parse import urlencode
        return '/api/artifact?' + urlencode({'acceptance_id': selected, 'ref': reference})

    def resolve_evidence(self, trace_path, name, acceptance_id):
        if not name:
            return None
        if name.startswith('artifact:'):
            return resolve_artifact(self.root, acceptance_id, name)[0]
        # An archive retains frozen JSON verbatim; map its original references via
        # the publication index rather than rewriting old evidence receipts.
        shared = locations(self.root, acceptance_id)[1]
        for parent in trace_path.parents:
            if not parent.is_relative_to(shared / "records"):
                break
            record_path = parent / "record.json"
            if record_path.is_file():
                record = read(record_path)
                mapping = record.get("original_paths", {})
                mapped = mapping.get(name) or (mapping.get(str(Path(name).resolve())) if Path(name).is_absolute() else None)
                if mapped:
                    target = inside(parent, mapped)
                    if target.is_file() and digest(target) == record["files"].get(mapped):
                        return target
                break
        path = Path(name)
        if not path.is_absolute():
            try:
                path = inside(trace_path.parent, name)
            except ValueError:
                return None
        for root in self.roots(acceptance_id):
            try:
                file = owned_path(root, path)
                if file.is_file():
                    return file
            except ValueError:
                pass
        return None


def project_html():
    html = HTML.replace('<section class="panel" id="activePanel"',
        '<section class="panel"><div class="toolbar"><label>验收测试 ID <select id="acceptanceId" disabled><option value="">正在读取验收列表…</option></select></label>'
        '<span id="acceptanceListStatus" class="small"></span><span id="acceptanceScope" class="small"></span><span id="currentAcceptance" class="small"></span></div><p id="acceptanceWorkspace" class="small"></p><p id="acceptanceWarning" class="small"></p></section>'
        '<section class="panel" id="activePanel"', 1)
    html = html.replace('分母 <select id="coverageScope">', '统计范围 <select id="coverageScope">')
    html = html.replace('</style>', '.coverage-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:12px 0}.coverage-meta{overflow-wrap:anywhere}.toolbar select{max-width:100%}.coverage-toolbar h2{min-width:6em}@media(max-width:560px){.coverage-pair{grid-template-columns:1fr}.toolbar label{max-width:100%}.coverage-toolbar h2{flex-basis:100%}}</style>', 1)
    html = html.replace('<div class="toolbar"><h2 style="margin:0;flex:1">代码覆盖率', '<div class="toolbar coverage-toolbar"><h2 style="margin:0;flex:1">代码覆盖率', 1)
    html = html.replace('代码覆盖率</h2>', '代码覆盖率</h2><label>采集版本 <select id="coverageVersion"></select></label>', 1)
    html = html.replace('id="coverageSummary" class="metrics"', 'id="coverageSummary"')
    # A project view already selects one acceptance within one project root.
    html = html.replace('<label>项目 <select id="project"><option value="">全部项目</option></select></label>', '')
    html = html.replace('<th>独立结论</th><th>代码覆盖率</th>', '<th>独立结论</th>')
    html = html.replace('colspan="4"', 'colspan="3"').replace('colspan="6"', 'colspan="5"')
    html = html.replace('</style>', 'th:nth-child(1){width:18%}th:nth-child(2){width:22%}th:nth-child(3){width:26%}th:nth-child(4){width:14%}th:nth-child(5){width:20%}.conclusion-preview.clamp{display:block;max-height:4.5em}.conclusion-preview.clamp.open{max-height:none}</style>', 1)
    html = html.replace('<p id="acceptanceWarning" class="small"></p>',
        '<p id="acceptanceWarning" class="small">正在读取已保存的验收资料……</p>')
    html = html.replace('<script>', '''<script>
window.addEventListener('error',event=>{
 const warning=document.querySelector('#acceptanceWarning');
 if(warning)warning.textContent='视图脚本无法启动：'+event.message;
});
window.addEventListener('unhandledrejection',event=>{
 const warning=document.querySelector('#acceptanceWarning');
 if(warning)warning.textContent='视图读取失败：'+String(event.reason);
});
</script><script>''', 1)
    cover_start = html.index('function cover(c){')
    cover_end = html.index('function render(items){', cover_start)
    html = html[:cover_start] + r'''function conclusionBlock(t,s){
 const key=JSON.stringify(['conclusion',document.querySelector('#acceptanceId').value,t.project.id,s.id]),open=expanded.has(key);
 const links=Object.entries(t.current_links||{}).map(([label,url])=>`<div><a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a></div>`).join('');
 return `${status(t.judgment.status)}<div class="clamp conclusion-preview${open?' open':''}"><div>${esc(t.judgment.reason||'')}</div>${links}</div><button type="button" data-expand="${esc(key)}" data-more="展开查看更多" aria-expanded="${open}" onclick="toggleBlock(this)">${open?'收起':'展开查看更多'}</button>`;
}
''' + html[cover_end:]
    html = html.replace("${status(t.judgment.status)}${block(t.judgment.reason||'')}</td><td${span}>${cover(t.coverage)}</td>", '${conclusionBlock(t,s)}</td>')
    html = html.replace("button.textContent=expanded.has(key)?'收起':'展开'", "button.textContent=expanded.has(key)?'收起':button.dataset.more||'展开';button.setAttribute('aria-expanded',String(expanded.has(key)))")
    html = html.replace('${esc(b.test_file)}</div>', '${block(b.test_file)}</div>')
    html = html.replace("${b.test_file?", "${t.workspace_case?`<div class=\"small\">${t.workspace_case.integration_status==='committed_to_pr_branch'?'项目回归入口：':'用例入口：'}${esc(t.workspace_case.command.join(' ')||'历史证据审计，未纳入自动回归')}</div>${block(t.workspace_case.files.map(f=>f.path).join('\\n'))}<div class=\"small\">${t.workspace_case.integration_status==='committed_to_pr_branch'?'已提交至 PR 分支；':''}此处保留原确认结论和历史执行绑定。</div>`:''}${b.test_file?", 1)
    start = html.index('function renderCoverage(){')
    end = html.index('async function refresh(){', start)
    html = html[:start] + r'''
let selectedCoverageKey='';
function renderCoverage(){
 const project=document.querySelector('#project').value,scope=document.querySelector('#coverageScope').value;
 const rows=coverageRows.filter(x=>!project||x.project_id===project),selector=document.querySelector('#coverageVersion');
 const key=x=>JSON.stringify(x.profile?[x.project_id,x.revision,x.profile]:[x.project_id,x.revision]);
 const when=x=>x.last_capture_at?new Date(x.last_capture_at).toLocaleString('zh-CN',{hour12:false}):'采集时间未记录';
 selector.innerHTML=rows.map(x=>`<option value="${esc(key(x))}">${esc(when(x))} · ${esc(String(x.revision||'版本未记录').slice(0,12))} · ${esc(x.scenes_with_coverage??x.scenes??0)} 个场景</option>`).join('');
 const x=rows.find(x=>key(x)===selectedCoverageKey)||rows[0];
 selector.disabled=!x;selectedCoverageKey=x?key(x):'';selector.value=selectedCoverageKey;
 if(!x){document.querySelector('#coverageSummary').innerHTML='<span class="muted">暂无可计算的执行数据</span>';return;}
 const m=x.scopes?.[scope]||{},tools=(x.tools||[]).map(t=>`${t.name} ${t.version||'版本未记录'}`).join('；');
 const metric=(label,v)=>{const ready=v&&typeof v.total==='number'&&typeof v.covered==='number';return `<div class="metric"><span>${esc(label)}</span><strong>${ready?(v.total?esc(toolPct(v)):'不适用'):'暂不可计算'}</strong><div class="small">${ready?`${v.covered} / ${v.total}`:''}</div><div class="small">${esc(v?.status==='incomplete'||m.status==='incomplete'?'已测范围，数据尚不完整':v?.reason||m.reason||'')}</div></div>`;};
 const native=c=>Object.entries(c).filter(([name,v])=>!['id','label','source_paths','line','branch'].includes(name)&&v&&typeof v==='object'&&typeof v.tool_output==='string').map(([name,v])=>`<details><summary>${esc(v.label||name)} · ${esc(v.status||'原生统计')}</summary><pre>${esc(v.tool_output.slice(0,4000))}</pre></details>`).join('');
 const values=m.components?.length?m.components.map(c=>`<h3>${esc(c.label||c.id)}</h3><div class="coverage-pair">${metric('行覆盖率',c.line)}${metric('分支覆盖率',c.branch)}</div>${native(c)}`).join(''):`<div class="coverage-pair">${metric('行覆盖率',m.line)}${metric('分支覆盖率',m.branch)}</div>`;
 document.querySelector('#coverageSummary').innerHTML=`<div class="small coverage-meta">实际采集版本：${esc(x.revision)} · ${esc(x.scenes_with_coverage??0)} / ${esc(x.scenes??0)} 个场景有采集 · 最近采集：${esc(when(x))}</div>${values}<div class="small coverage-meta">${esc(m.reason||m.basis||'')} ${esc(tools?'工具：'+tools:'工具信息未记录')}</div><div class="small">${esc(x.collection_note||'')}</div>`+(rows.length>1?'<div class="small">按最近采集时间从新到旧排列；不同版本或准备不混算，也不代表当前交付版本已重新采集。</div>':'');
}
document.querySelector('#coverageVersion').addEventListener('change',()=>{selectedCoverageKey=document.querySelector('#coverageVersion').value;renderCoverage();});
''' + html[end:]
    start = html.index('async function refresh(){')
    end = html.index("document.querySelector('#project').addEventListener", start)
    html = html[:start] + r'''
let refreshSequence=0,refreshInFlight=false,inventoryReady=false,inventoryInFlight=false;
const initialId=new URL(location.href).searchParams.get('acceptance_id')||'';
async function loadAcceptances(){
 if(inventoryInFlight)return;inventoryInFlight=true;
 const selector=document.querySelector('#acceptanceId');
 try{
  const response=await fetch('/api/acceptances',{cache:'no-store'}),data=await response.json();
  if(!response.ok)throw Error(data.reason||'验收列表无法读取');
  const rows=data.acceptances||[],previous=selector.value;
  selector.innerHTML=rows.map(x=>`<option value="${esc(x.id)}">${esc(x.title)} · ${esc(x.id)}</option>`).join('');
  selector.value=rows.some(x=>x.id===previous)?previous:(!inventoryReady&&initialId?initialId:data.acceptance_id||rows[0]?.id||'');
  selector.disabled=!rows.length;
  document.querySelector('#acceptanceListStatus').textContent=rows.length?`共 ${rows.length} 项验收，可切换查看历史`:'项目尚未登记验收';
  document.querySelector('#currentAcceptance').textContent=data.current_error?'当前验收指针无效':(data.current_acceptance_id?'当前进行中：'+data.current_acceptance_id:'当前无进行中的验收');
  const first=!inventoryReady;inventoryReady=true;if(first&&rows.length)refresh();
 }catch(e){document.querySelector('#acceptanceListStatus').textContent='验收列表读取失败：'+e.message;}
 finally{inventoryInFlight=false;}
}
async function refresh(){
 if(refreshInFlight||!inventoryReady||!document.querySelector('#acceptanceId').value)return;
 const seq=refreshSequence,selector=document.querySelector('#acceptanceId');
 refreshInFlight=true;
 const requested=selector.value||initialId;
 try{
  const response=await fetch('/api/traces'+(requested?'?acceptance_id='+encodeURIComponent(requested):''),{cache:'no-store'});
  const data=await response.json();if(seq!==refreshSequence)return;
  if(!response.ok)throw Error(data.reason||'验收数据无法读取');
  const url=new URL(location.href);if(data.acceptance_id)url.searchParams.set('acceptance_id',data.acceptance_id);history.replaceState(null,'',url);
  document.querySelector('#acceptanceScope').textContent=data.scope?'范围版本 '+data.scope.version+' · '+data.scope.basis:'';
  document.querySelector('#currentAcceptance').textContent=data.current_error?'当前验收指针无效':
   (data.current_acceptance_id?'当前进行中：'+data.current_acceptance_id:'当前无进行中的验收');
  const workspace=data.workspace;
  document.querySelector('#acceptanceWorkspace').textContent=workspace?
   '专用工作树：'+workspace.path+' · '+workspace.scene_count+' 个场景映射、'+workspace.file_count+' 个配套文件。'+(workspace.integration_status==='committed_to_pr_branch'?workspace.promoted_scene_count+' 个自动化场景用例已提交至 PR 分支。'+(workspace.excluded_scene_count?' '+workspace.excluded_scene_count+' 项历史证据审计未纳入自动回归。':''):workspace.integration_status==='committed_locally'?'用例已在本地提交，尚未推送或合并。':workspace.integration_status==='collected_in_acceptance_workspace_not_committed'?'用例整理中，尚未提交。':'用例交付状态：'+workspace.integration_status+'。')+(workspace.path_verification?.status==='verified'?' 旧根临时改名核对已通过，原目录已恢复。':''):'';
  document.querySelector('#acceptanceWarning').textContent=(data.warnings||[]).join(' ');
  traces=data.traces;previews=data.progress?.previews||[];stages=data.progress?.stages||[];
  coverageRows=data.coverage;projectRows=data.project_state?.traces||[];
  render(projectRows);renderProgress(stages);renderCoverage();
  if(!data.denominator_complete){document.querySelector('#metrics').innerHTML='<span class="muted">项目场景清单不完整，暂不计算项目场景比例。</span>';document.querySelector('#resultBalance').textContent='';}
  document.querySelector('#updated').textContent='最后更新：'+new Date().toLocaleString();
 }catch(e){
  if(seq!==refreshSequence)return;
  document.querySelector('#acceptanceWorkspace').textContent='';
  traces=[];previews=[];stages=[];coverageRows=[];projectRows=[];
  render([]);renderProgress([]);renderCoverage();
  document.querySelector('#acceptanceWarning').textContent='当前验收读取失败，已清空上一验收数据：'+e.message;
  document.querySelector('#updated').textContent='读取失败：'+e.message;
 }finally{if(seq===refreshSequence)refreshInFlight=false;}
}
document.querySelector('#acceptanceId').addEventListener('change',()=>{
 refreshSequence++;refreshInFlight=false;
 selectedCoverageKey='';
 document.querySelector('#acceptanceWorkspace').textContent='';
 document.querySelector('#acceptanceScope').textContent='';
 document.querySelector('#acceptanceWarning').textContent='';
 document.querySelector('#updated').textContent='正在读取所选验收资料……';
 traces=[];previews=[];stages=[];coverageRows=[];projectRows=[];
 render([]);renderProgress([]);renderCoverage();refresh();
});
''' + html[end:]
    html = html.replace("document.querySelector('#project').value", "''")
    html = html.replace("document.querySelector('#project').addEventListener('change',()=>{render(projectRows||[...previews,...traces]);renderProgress(stages);renderCoverage()});", '')
    html = html.replace("document.querySelector('#coverageScope').addEventListener('change',renderCoverage)",
                        "document.querySelector('#coverageScope').addEventListener('change',()=>{renderCoverage();render(projectRows||[]);})")
    html = html.replace('refresh();setInterval(refresh,5000);', 'loadAcceptances();setInterval(refresh,5000);setInterval(loadAcceptances,30000);')
    return html


def make_server(project, port=0, selected=None):
    view = ProjectView(project, selected)
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urlparse(self.path)
            args = parse_qs(parsed.query)
            status = 200
            try:
                if parsed.path == "/":
                    raw, mime = project_html().encode(), "text/html; charset=utf-8"
                elif parsed.path == "/api/acceptances":
                    rows = view.inventory()
                    active, error = view.current_status()
                    ids = {row['id'] for row in rows}
                    default = next((x for x in [view.selected, active] if x in ids), rows[0]['id'] if rows else None)
                    raw, mime = json.dumps({"acceptances": rows, "acceptance_id": default,
                        "current_acceptance_id": active, "current_error": error}, ensure_ascii=False).encode(), "application/json"
                elif parsed.path == "/api/traces":
                    raw, mime = json.dumps(view.snapshot(args.get("acceptance_id", [None])[0]), ensure_ascii=False).encode(), "application/json"
                elif parsed.path == '/api/artifact':
                    selected_id, _ = view.selection(args.get('acceptance_id', [None])[0])
                    file, item = resolve_artifact(view.root, selected_id, args['ref'][0])
                    if file is None:
                        raise ValueError('artifact is not available in this checkout')
                    raw, mime = file.read_bytes(), item.get('mime', 'application/octet-stream')
                    if mime in {'text/html', 'application/javascript'}:mime='text/plain; charset=utf-8'
                elif parsed.path == "/api/evidence":
                    selected_id, _ = view.selection(args.get("acceptance_id", [None])[0])
                    view.validated_state(selected_id)
                    candidates = files_under(view.roots(selected_id), "trace.json") + files_under(view.roots(selected_id), "request.frozen.json")
                    path = next(p for p in candidates if view.key(p) == args["trace"][0])
                    if path.name == "trace.json":
                        results = read(path)["case_results"]
                    else:
                        progress = collect([], [], request_paths=[path], artifact_resolver=lambda p, n: view.resolve_evidence(p, n, selected_id))
                        results = [r for row in [*progress["previews"], *progress["case_history"]] for r in row["case_results"]]
                    files = [view.resolve_evidence(path, r.get("evidence_path", ""), selected_id)
                             for r in results if r["binding_id"] == args["binding"][0]]
                    file = next((f for f in files if f and (not args.get("artifact") or view.key(f) == args["artifact"][0])), None)
                    if not file:
                        raise ValueError("evidence missing or outside selected acceptance")
                    raw, mime = file.read_bytes(), "text/plain; charset=utf-8"
                else:
                    self.send_error(404)
                    return
            except (ValueError, KeyError, OSError, StopIteration, TypeError) as error:
                status = 422
                raw, mime = json.dumps({"status": "unavailable", "reason": str(error), "acceptances": view.inventory(),
                                       "acceptance_id": args.get("acceptance_id", [None])[0]}, ensure_ascii=False).encode(), "application/json"
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(raw)
    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


def serve_project(project, port=0, selected=None):
    server = make_server(project, port, selected)
    print(json.dumps({"url": f"http://127.0.0.1:{server.server_port}/", "project": str(Path(project).resolve())}), flush=True)
    server.serve_forever()
