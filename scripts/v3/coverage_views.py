"""Select scene reports; registered dedicated providers own all coverage math."""
from pathlib import Path
import json
import subprocess
import tempfile
import os
import hashlib
from functools import wraps
from threading import RLock
from datetime import datetime, timezone

PROVIDER=Path(__file__).resolve().parents[1]/'coverage-istanbul/provider.mjs'
TRANSPORT=PROVIDER.with_name('evidence-transport.mjs')
_cache={}
_summary_lock=RLock()


def capture_time(value):
    """Only recorded collection timestamps count; view/commit/file dates do not."""
    try:
        stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return stamp.astimezone(timezone.utc) if stamp.tzinfo is not None else None
    except (AttributeError, TypeError, ValueError):
        return None

def serialized_summary(fn):
    @wraps(fn)
    def call(*args, **kwargs):
        # Several open views can request the same cold report simultaneously.
        # Let one dedicated tool finish and populate the verified cache first.
        with _summary_lock:
            return fn(*args, **kwargs)
    return call

@serialized_summary
def summarize(traces, evidence_root=None):
    groups={}
    for trace in traces:
        project=trace.get('project') or {}
        # Retained business judgments may refer to an older revision than the
        # actual coverage capture. Provider compatibility still gates merging.
        key=(project.get('id'),trace.get('coverage_source_cohort') or trace.get('coverage_actual_revision') or project.get('revision'))
        if all(key):groups.setdefault(key,[]).append(trace)
    result=[]
    for (project_id,revision),rows in groups.items():
        latest={}
        for trace in rows:
            for scene in trace.get('scenarios',[]):
                scene_id=scene.get('id')
                if scene_id and (scene_id not in latest or trace.get('generated_at','')>latest[scene_id].get('generated_at','')):latest[scene_id]=trace
        reports=[];missing=[]
        capture_times=[stamp for trace in rows
                       if (trace.get('coverage',{}).get('provider')=='istanbul-source-v1'
                           and trace.get('coverage',{}).get('istanbul_path'))
                       if (stamp:=capture_time(trace['coverage'].get('capture_end'))) is not None]
        collection_gaps=[]
        for scene_id,trace in latest.items():
            c=trace.get('coverage') or {}
            collection_gaps.extend(c.get('collection_check',{}).get('limitations',[]))
            collection_gaps.extend(x['reason'] for x in c.get('scope_limitations',[]) if x.get('path','').startswith('electron-'))
            if c.get('provider')=='istanbul-source-v1' and c.get('istanbul_path'):
                reports.append(str(Path(c['istanbul_path']).with_name('coverage-report.json')))
            else:missing.append(scene_id)
        last_capture_at = max(capture_times).isoformat() if capture_times else None
        inventories=[r['change']['inventory'] for r in rows if (r.get('change') or {}).get('inventory')]
        inventory_error=None
        try:
            for row in rows:
                reference=(row.get('change') or {}).get('inventory_ref')
                if reference:
                    if evidence_root is None:raise ValueError('Inventory artifact needs its project evidence root')
                    from evidence_store import resolve
                    owner=Path(evidence_root)
                    file,_=resolve(owner.parent.parent,owner.name,reference)
                    if file is None:raise ValueError('Frozen coverage scope inventory is not available')
                    inventories.append(json.loads(file.read_text()))
        except (ValueError,KeyError,OSError) as error:
            inventory_error=str(error)
        inventory=inventories[0] if inventories else None
        scopes={};tools=[];cache_key=None
        try:
            if inventory_error:raise ValueError(inventory_error)
            if not reports:raise ValueError('没有经专用工具链验证的覆盖率报告；历史旧口径不计入当前统计。')
            if any(other!=inventory for other in inventories[1:]):raise ValueError('统计范围版本不兼容')
            transports=[r.get('coverage',{}).get('transport') for r in rows if r.get('coverage',{}).get('transport')]
            argv=['node'];env=os.environ.copy();cache_key=None
            if transports:
                if evidence_root is None or any(t!=transports[0] for t in transports):raise ValueError('迁移覆盖率路径映射缺失或不兼容')
                from acceptance_store import inside,digest,read
                mapping=inside(Path(evidence_root),transports[0]['path'])
                if digest(mapping)!=transports[0]['sha256']:raise ValueError('迁移路径映射已变更')
                spec=read(mapping)
                stamps=[]
                for item in spec['files'].values():
                    file=inside(mapping.parent,item['path']);stat=file.stat()
                    stamps.append((str(file),stat.st_size,stat.st_mtime_ns))
                cache_key=hashlib.sha256(json.dumps([project_id,revision,sorted(latest),missing,collection_gaps,sorted(set(reports)),inventory,digest(mapping),digest(PROVIDER),digest(TRANSPORT),stamps],sort_keys=True).encode()).hexdigest()
                if cache_key in _cache:
                    result.append({**json.loads(json.dumps(_cache[cache_key])), 'last_capture_at': last_capture_at});continue
                argv.extend(['--import',str(TRANSPORT)])
                env['ACCEPTANCE_EVIDENCE_MAP']=str(mapping)
            with tempfile.TemporaryDirectory(prefix='coverage-summary-') as folder:
                request=Path(folder)/'request.json';output=Path(folder)/'summary.json'
                request.write_text(json.dumps({'reports':sorted(set(reports)),'inventory':inventory}))
                completed=subprocess.run([*argv,str(PROVIDER),'summarize',str(request),str(output)],text=True,capture_output=True,timeout=120,env=env)
                if completed.returncode:raise ValueError('专用工具校验或汇总失败：'+completed.stderr[-1000:])
                summary=json.loads(output.read_text());scopes=summary['scopes']
                tools=[{'role':role,**summary['tools'][role]} for role in ['instrumenter','statistics']]
                if transports:tools.append({'role':'evidence_path_transport','name':'只读证据路径映射','version':'1','sha256':digest(TRANSPORT)})
            if missing:
                for metric in scopes.values():
                    metric['status']='incomplete';metric['line']['status']='incomplete';metric['branch']['status']='incomplete'
                    metric['scenes_without_line_report']=len(missing)
            if collection_gaps:
                for metric in scopes.values():
                    metric['status']='incomplete';metric['line']['status']='incomplete';metric['branch']['status']='incomplete'
                    metric['collection_limitations']=sorted(set(collection_gaps))
        except (ValueError,OSError,subprocess.TimeoutExpired) as error:
            state='unavailable';reasons=[str(error)]
            if not reports and not inventory_error:
                if not latest:
                    state='pending';reasons=['尚无场景的覆盖率报告。']
                elif all((r.get('coverage') or {}).get('status')=='off' for r in latest.values()):
                    state='off';reasons=['已明确关闭覆盖率采集。']
                else:
                    reasons=sorted({(r.get('coverage') or {}).get('reason') for r in latest.values()
                                    if (r.get('coverage') or {}).get('reason')}) or reasons
            for name in ['project','changed_files','changed_lines']:
                scopes[name]={'status':state,'covered':None,'total':None,'line':{'status':state,'covered':None,'total':None},'branch':{'status':state,'covered':None,'total':None},'reason':'；'.join(reasons),'unavailable_reasons':reasons}
        row={'project_id':project_id,'project_label':rows[0]['project'].get('label') or project_id,'revision':revision,'last_capture_at':last_capture_at,'scenes':len(latest),'scenes_with_coverage':len(reports),'scopes':scopes,'tools':tools}
        if any(t.get('coverage_source_cohort') for t in rows):
            row['actual_capture_revisions'] = sorted({t.get('coverage_capture_revision') or t.get('coverage_actual_revision') or t['project']['revision'] for t in rows})
            row['reference_revision'] = rows[0].get('coverage_reference_revision')
            row['source_equivalence'] = 'complete product hashes, changed source-file/line scope and dedicated-tool units verified identical; original capture revisions retained'
        result.append(row)
        if cache_key and scopes and all(s.get('status')!='unavailable' for s in scopes.values()):
            if len(_cache)>8:_cache.clear()
            _cache[cache_key]=row
    result.sort(key=lambda row: capture_time(row.get('last_capture_at')) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return result
