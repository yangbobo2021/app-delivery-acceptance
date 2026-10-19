"""Read-only coverage presentation; project-declared tools own all statistics."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from threading import RLock
from legacy_coverage_views import capture_time
from legacy_coverage_views import summarize as legacy_summary

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'playbook/v4'))
from coverage_protocol import PROTOCOL, read, sha, resolved, summarize_reports, verify_report, preparation
_lock=RLock()
_cache={}


def archived_summary(evidence_root, report_refs, prepared_sha256, tools):
    """Use only a tool-produced summary frozen with this exact verified report set."""
    if evidence_root is None:return None
    local=Path(evidence_root);shared=local.parent.parent/'.acceptance'/local.name
    expected=sorted(report_refs,key=lambda item:item['path'])
    for record_path in sorted((shared/'records').glob('*/record.json'),reverse=True):
        record=read(record_path)
        name=record.get('coverage_summary')
        if not name:continue
        snapshot_path=record_path.parent/name
        if not snapshot_path.resolve().is_relative_to(record_path.parent.resolve()):
            raise ValueError('Coverage summary escapes its archive')
        if record.get('files',{}).get(name)!=sha(snapshot_path):
            raise ValueError('Archived coverage summary changed')
        snapshot=read(snapshot_path)
        if (snapshot.get('schema')!='project-coverage-summary-snapshot-v1' or
            sorted(snapshot.get('reports',[]),key=lambda item:item['path'])!=expected or
            snapshot.get('prepared_sha256')!=prepared_sha256):continue
        summary=snapshot.get('summary',{})
        if summary.get('tools')!=tools or not isinstance(summary.get('scopes'),dict):
            raise ValueError('Archived coverage summary provenance is invalid')
        for scope in ('project','changed_files','changed_lines'):
            value=summary['scopes'].get(scope,{})
            if value.get('status') not in ('measured','incomplete','unavailable'):
                raise ValueError('Archived coverage summary scope is invalid')
        return summary
    return None


def summary_archive_stamps(evidence_root):
    if evidence_root is None:return []
    local=Path(evidence_root);shared=local.parent.parent/'.acceptance'/local.name
    stamps=[]
    for record_path in sorted((shared/'records').glob('*/record.json')):
        record=read(record_path);name=record.get('coverage_summary')
        if name:
            path=record_path.parent/name
            if not path.resolve().is_relative_to(record_path.parent.resolve()):
                raise ValueError('Coverage summary escapes its archive')
            stamps.append((str(path),sha(path),record.get('files',{}).get(name)))
    return stamps


def artifact_mapping(evidence_root):
    if evidence_root is None:return {}
    local=Path(evidence_root);shared=local.parent.parent/'.acceptance'/local.name
    result={}
    for record_path in sorted((shared/'records').glob('*/record.json')):
        record=read(record_path)
        for original,name in {**record.get('original_paths',{}),**record.get('path_aliases',{})}.items():
            file=(record_path.parent/name).resolve()
            if not file.is_relative_to(record_path.parent.resolve()):raise ValueError('Coverage archive mapping escapes record')
            digest=record['files'].get(name)
            if digest:
                item={'path':str(file),'sha256':digest}
                result[original]=item;result[original+'#'+digest]=item
    return result


def unavailable(reason):
    return {name:{'status':'unavailable','line':{'status':'unavailable'},'branch':{'status':'unavailable'},'reason':reason}
            for name in ('project','changed_files','changed_lines')}


def summarize(traces,evidence_root=None):
    new_keys={((t.get('project') or {}).get('id'),(t.get('project') or {}).get('revision'))
              for t in traces if (t.get('coverage') or {}).get('protocol')==PROTOCOL}
    if not new_keys:return legacy_summary(traces,evidence_root)
    old=[t for t in traces if t.get('attempt_id')!='catalog' and
         ((t.get('project') or {}).get('id'),(t.get('project') or {}).get('revision')) not in new_keys]
    result=legacy_summary(old,evidence_root) if old else []
    with _lock:
        mapping=artifact_mapping(evidence_root)
        for project_id,revision in sorted(new_keys):
            rows=[t for t in traces if ((t.get('project') or {}).get('id'),(t.get('project') or {}).get('revision'))==(project_id,revision)]
            profiles={t['coverage']['prepared_sha256'] for t in rows if t.get('coverage',{}).get('protocol')==PROTOCOL}
            all_scenes={s['id'] for t in traces if (t.get('project') or {}).get('id')==project_id
                        for s in t.get('scenarios',[])}
            for profile in sorted(profiles):
                latest={}
                for t in rows:
                    c=t.get('coverage') or {}
                    if c.get('protocol')!=PROTOCOL or c.get('prepared_sha256')!=profile:continue
                    for scene in t.get('scenarios',[]):
                        old=latest.get(scene['id'])
                        if old is None or (c.get('capture_end') or t.get('generated_at',''))>(old['coverage'].get('capture_end') or old.get('generated_at','')):latest[scene['id']]=t
                reports=sorted({t['coverage']['report_path'] for t in latest.values()})
                times=[capture_time(t['coverage'].get('capture_end')) for t in latest.values()]
                last=max((t for t in times if t),default=None)
                tools=[];verified=[]
                try:
                    stamps=[]
                    for t in latest.values():
                        c=t['coverage'];name=c['report_path']
                        report=verify_report(name,run_check=False,mapping=mapping);tools=report['tools']
                        preparation(report,run_check=False,mapping=mapping)
                        if (report['scene_id'] not in {s['id'] for s in t['scenarios']} or
                            report['revision']!=revision or report['prepared_sha256']!=profile or
                            (c.get('report_sha256') and c['report_sha256']!=sha(resolved(name,mapping)))):
                            raise ValueError('Coverage report does not bind the displayed scene, revision or profile')
                        for item in [{'path':name,'sha256':sha(resolved(name,mapping))},*report['raw_evidence']]:
                            file=resolved(item['path'],mapping);stamps.append((str(file),sha(file)))
                        prepared=resolved(Path(report['prepared'])/'prepared.json',mapping);stamps.append((str(prepared),sha(prepared)))
                        p=read(prepared)
                        # Verify binding on every read, including cache hits. The cache
                        # stores only expensive native statistics, never evidence validity.
                        for name in p['adapter_files']:
                            file=resolved(Path(p['spec']['project_root'])/name,mapping);stamps.append((str(file),sha(file)))
                    inventories=[t['change']['inventory'] for t in latest.values() if (t.get('change') or {}).get('inventory')]
                    inventory=inventories[0] if inventories else read(resolved(p['spec']['inventory_path'],mapping))
                    if any(x!=inventory for x in inventories):raise ValueError('Frozen coverage scope inventories differ')
                    key=hashlib.sha256(json.dumps([stamps,inventory,summary_archive_stamps(evidence_root),
                        sha(Path(__file__).parents[2]/'playbook/v4/coverage_protocol.py')],sort_keys=True).encode()).hexdigest()
                    if key not in _cache:
                        try:
                            summary=summarize_reports(reports,inventory,mapping)
                        except (OSError,ValueError) as error:
                            # A retired runtime may be absent. The immutable
                            # publication contains the project's own summary.
                            if not isinstance(error,OSError) and not any(
                                    marker in str(error) for marker in ('No such file or directory','ENOENT')):
                                raise
                            refs=[{'path':name,'sha256':sha(resolved(name,mapping))} for name in reports]
                            summary=archived_summary(evidence_root,refs,profile,tools)
                            if summary is None:raise
                        if len(_cache)>12:_cache.clear()
                        _cache[key]=summary
                    summary=_cache[key];scopes=summary['scopes'];tools=summary['tools']
                    verified=[{'path':name,'sha256':sha(resolved(name,mapping))} for name in reports]
                except (ValueError,OSError,KeyError,subprocess.TimeoutExpired) as error:
                    scopes=unavailable(str(error))
                result.append({'project_id':project_id,'project_label':rows[0]['project'].get('label',project_id),
                    'revision':revision,'profile':profile,'last_capture_at':last.isoformat() if last and verified else None,
                    'scenes':len(all_scenes),'scenes_with_coverage':len(latest) if verified else 0,'scopes':scopes,'tools':tools,
                    'verified_reports':verified,
                    'scenes_without_collection':len(all_scenes-set(latest)) if verified else len(all_scenes),
                    'collection_note':'覆盖率来自新采集尝试；旧验收结论与无覆盖率记录仍保留。'})
    result.sort(key=lambda r:r.get('last_capture_at') or '',reverse=True)
    return result
