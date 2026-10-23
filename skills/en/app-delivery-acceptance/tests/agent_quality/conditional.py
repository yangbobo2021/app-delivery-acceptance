#!/usr/bin/env python3
"""Native edit-preservation, independent v3 scenario review and manual parking."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import sys
from run import project,invoke,SKILL
from acceptance_store import read,save,publish_catalog,finish_acceptance
from acceptance_definitions import binding
from scenario_revision import candidate


def scene(sid,title,text,rid='R1'):
    return {'id':sid,'requirement_id':rid,'title':title,'description':text,'priority':'P1',
        'priority_reason':'错误会妨碍当前明确约定的操作。','related_refs':[],'external_refs':[],
        'origin':{'kind':'user','reference':'human-adopted fixture'},
        'check':{'method':'human supplied','basis':'Independent controlled contract'}}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--only',nargs='+',choices=['edit','independent-scenes','manual'],default=['edit','independent-scenes','manual'])
    args=p.parse_args()
    if args.output.exists() or not args.output.is_absolute():p.error('New absolute output required')
    args.output.mkdir(parents=True);rows=[]
    for name in args.only:
        old='成功读取配置时返回配置内容，读取不得修改原文件。' if name=='edit' else '按下设备状态键后，屏幕显示的设备编号应与机身标签一致。'
        spec={'id':name,'fixture':'parcel-cli','requirements':[old,'现有报告仍可查看。']}
        root,aid,local,flows,reqs,context=project(spec,args.output)
        doc=read(root/'.acceptance'/aid/'scenarios.json')
        doc={k:doc[k] for k in ['schema','project','context','requirements','reverse_rules','scenarios']};doc['basis']='Controlled frozen human designs'
        if name=='edit':
            doc['scenarios']=[scene('READ','读取配置内容','配置文件存在且有效时读取，返回其完整内容。'),
                scene('HUMAN','读取后保留原文件','读取含中文注释的配置，读取前后原文件字节完全一致。'),
                scene('OTHER','现有报告可查看','打开现有报告并看到内容。','R2')]
            doc['scenarios'][0].update(priority='P0',priority_reason='读取完整配置是当前主要正常路径。')
            doc['scenarios'][1].update(priority='P0',priority_reason='读取不能破坏原始配置，且没有已确认恢复途径。')
            publish_catalog(root,aid,doc);previous=binding(root,aid)
            doc['requirements'][0]['text']=old+'文件不存在时明确报告无法读取。'
            doc['scenarios'][1]['description']+='人工补充：以读取前的原始字节为对照。'
            publish_catalog(root,aid,doc)
            request={**context,'definitions':binding(root,aid),'previous_definitions':previous,
                'mode':'edit','scenario_kind':'BLACK_BOX','target_requirement_id':'R1'}
            save(flows/'request.json',request)
            result=invoke(['node',str(SKILL/'playbook/v4/run_scenarios.mjs'),str(flows/'request.json'),str(flows/'attempt-1')],root,flows/'stage.log')
            if result['exit_code']==0:
                merged=candidate(flows/'request.json',flows/'attempt-1');save(flows/'merged.json',merged)
                byid={x['id']:x for x in merged['scenarios']}
                result['human_and_other_preserved']=all(byid[x['id']]==x for x in read(root/'.acceptance'/aid/'scenarios.json')['scenarios'])
        else:
            s=scene('DEVICE','查看设备编号','对照机身标签记录编号，按下现场设备状态键，屏幕显示编号与该标签一致。')
            doc['requirements']=doc['requirements'][:1];doc['scenarios']=[s];publish_catalog(root,aid,doc)
            context.update(definitions=binding(root,aid))
            request={**context,'scenario_kind':'BLACK_BOX','target_requirement_id':'R1',
                'requirements':{'items':doc['requirements'],'shared_constraints':''},
                'analysis':{'business_goal':'核对现场设备的身份显示。','confirmed_scope':{'included_requirement_ids':['R1'],
                    'exclusions':[],'limitations':['现场设备当前不可访问；不虚构操作记录。']},'requirement_groups':[]},'user_constraints':[]}
            save(flows/'request.json',request)
            if name=='independent-scenes':
                save(flows/'draft.json',{'requirement_id':'R1','kind':'BLACK_BOX','scenarios':[
                    {k:s[k] for k in ['id','title','description','priority','priority_reason']}]})
                result=invoke(['node',str(SKILL/'playbook/v3/scenarios/run.mjs'),'independent-check',str(flows/'request.json'),
                    str(flows/'attempt-1'),str(flows/'draft.json')],root,flows/'stage.log')
            else:
                request={**context,'project':{'id':'offline-device','label':'现场设备','root':str(root),
                    'revision':'operator-contract-1','revision_mode':'declared',
                    'revision_provenance':'Controlled user contract; no device source or access supplied','sources':[]},
                    'requirements':doc['requirements'],'scene':{**s,'kind':'BLACK_BOX'},
                    'business_goal':'核对现场设备的身份显示。','confirmed_scope':request['analysis']['confirmed_scope'],
                    'coverage':{'policy':'off'},'case_catalog':[{'id':'MANUAL-1','kind':'manual','origin':'existing',
                    'title':'现场对照设备编号','procedure':'现场操作员读取机身标签编号，按下设备状态键，记录屏幕编号并与标签对照，保存带设备上下文的照片。'}]}
                save(flows/'request.json',request)
                result=invoke(['node',str(SKILL/'playbook/v3/cases/run.mjs'),'manual-check',str(flows/'request.json'),
                    str(flows/'attempt-1')],root,flows/'stage.log')
        row={'id':name,**result,'workflow':str(flows),'semantic_review':'Read native artifact and actual terminal/parking evidence'}
        save(flows/'result.json',row);rows.append(row);finish_acceptance(root,aid)
        print(json.dumps(row,ensure_ascii=False),flush=True)
    save(args.output/'results.json',{'rows':rows})


if __name__=='__main__':main()
