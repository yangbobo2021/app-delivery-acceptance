"""Select scene reports; registered dedicated providers own all coverage math."""
from pathlib import Path
import json
import subprocess
import tempfile

PROVIDER=Path(__file__).resolve().parents[1]/'coverage-istanbul/provider.mjs'

def summarize(traces):
    groups={}
    for trace in traces:
        project=trace.get('project') or {}
        key=(project.get('id'),project.get('revision'))
        if all(key):groups.setdefault(key,[]).append(trace)
    result=[]
    for (project_id,revision),rows in groups.items():
        latest={}
        for trace in rows:
            for scene in trace.get('scenarios',[]):
                scene_id=scene.get('id')
                if scene_id and (scene_id not in latest or trace.get('generated_at','')>latest[scene_id].get('generated_at','')):latest[scene_id]=trace
        reports=[];missing=[]
        collection_gaps=[]
        for scene_id,trace in latest.items():
            c=trace.get('coverage') or {}
            collection_gaps.extend(c.get('collection_check',{}).get('limitations',[]))
            collection_gaps.extend(x['reason'] for x in c.get('scope_limitations',[]) if x.get('path','').startswith('electron-'))
            if c.get('provider')=='istanbul-source-v1' and c.get('istanbul_path'):
                reports.append(str(Path(c['istanbul_path']).with_name('coverage-report.json')))
            else:missing.append(scene_id)
        inventories=[r['change']['inventory'] for r in rows if r.get('change',{}).get('inventory')]
        inventory=inventories[0] if inventories else None
        scopes={};tools=[]
        try:
            if not reports:raise ValueError('没有经专用工具链验证的覆盖率报告；历史旧口径不计入当前统计。')
            if any(other!=inventory for other in inventories[1:]):raise ValueError('统计范围版本不兼容')
            with tempfile.TemporaryDirectory(prefix='coverage-summary-') as folder:
                request=Path(folder)/'request.json';output=Path(folder)/'summary.json'
                request.write_text(json.dumps({'reports':sorted(set(reports)),'inventory':inventory}))
                completed=subprocess.run(['node',str(PROVIDER),'summarize',str(request),str(output)],text=True,capture_output=True,timeout=120)
                if completed.returncode:raise ValueError('专用工具校验或汇总失败：'+completed.stderr[-1000:])
                summary=json.loads(output.read_text());scopes=summary['scopes']
                tools=[{'role':role,**summary['tools'][role]} for role in ['instrumenter','statistics']]
            if missing:
                for metric in scopes.values():
                    metric['status']='incomplete';metric['line']['status']='incomplete';metric['branch']['status']='incomplete'
                    metric['scenes_without_line_report']=len(missing)
            if collection_gaps:
                for metric in scopes.values():
                    metric['status']='incomplete';metric['line']['status']='incomplete';metric['branch']['status']='incomplete'
                    metric['collection_limitations']=sorted(set(collection_gaps))
        except (ValueError,OSError,subprocess.TimeoutExpired) as error:
            for name in ['project','changed_files','changed_lines']:
                scopes[name]={'status':'unavailable','covered':None,'total':None,'branch':{'status':'unavailable','covered':None,'total':None},'reason':str(error),'unavailable_reasons':[str(error)]}
        result.append({'project_id':project_id,'project_label':rows[0]['project'].get('label') or project_id,'revision':revision,'scenes':len(latest),'scenes_with_coverage':len(reports),'scopes':scopes,'tools':tools})
    return result
