#!/usr/bin/env python3
"""Real Chromium pixels versus DOM-only success, using the native production Reviewer.

Pass an installed Playwright ESM module explicitly. This is a Mac review-quality
probe, not cold-install/browser portability evidence.
"""
import argparse
import json
from pathlib import Path
import sys

from review_probes import execution_review, SKILL
sys.path[:0]=[str(SKILL/'scripts'),str(SKILL/'tests')]
from acceptance_store import initialize,read_knowledge,publish_catalog,save,digest,finish_acceptance
from acceptance_definitions import binding,scene_input
from run_case_discovery_forward import git

HTML='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>今日事项</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f3f6f9;color:#203047;font:18px -apple-system,BlinkMacSystemFont,sans-serif}main{max-width:760px;margin:70px auto;padding:36px;background:white;border:1px solid #dbe2ea;border-radius:18px;box-shadow:0 12px 40px #2030470a}h1{margin:0 0 12px;font-size:32px}p{color:#66768a}label{display:block;margin:30px 0 10px;font-weight:600}.entry{display:flex;gap:12px}input{flex:1;min-width:0;padding:14px;border:1px solid #8a9aae;border-radius:8px;font:inherit}button{background:#245bc4;color:white;border:0;border-radius:8px;padding:14px 28px;font:inherit;font-weight:600}section{position:relative;margin-top:32px;min-height:180px}h2{font-size:20px;border-bottom:1px solid #e3e8f0;padding-bottom:14px}li{padding:14px 8px}#veil{display:none;position:absolute;inset:44px -8px -8px;background:#e3e8f0;z-index:3;align-items:center;justify-content:center;color:#34445b;font-weight:600}</style>
<main><h1>今日事项</h1><p>记录要做的事，一次专注一件。</p><form><label for="title">事项标题</label><div class="entry"><input id="title" placeholder="例如：核对本周交付清单" required><button>添加事项</button></div></form><section><h2>待办清单</h2><ul></ul><div id="veil">正在处理，请稍候…</div></section></main>
<script>document.querySelector('form').onsubmit=e=>{e.preventDefault();let field=document.querySelector('input');let item=document.createElement('li');item.textContent=field.value;document.querySelector('ul').append(item);field.value='';BAD_OVERLAY};</script></html>'''
CAPTURE='''import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.argv[2]).href);
const folder=process.env.QUALITY_EVIDENCE;mkdirSync(folder,{recursive:true});
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(readFileSync('index.html'));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try{const context=await browser.newContext({viewport:{width:1000,height:700},deviceScaleFactor:1});const page=await context.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
 await page.screenshot({path:folder+'/before.png'});
 await page.getByLabel('事项标题').fill('核对本周交付清单');await page.getByRole('button',{name:'添加事项'}).click();
 const text=await page.locator('li').textContent();if(text!=='核对本周交付清单')throw Error('Wrong DOM result');
 await page.screenshot({path:folder+'/after.png'});
 console.log(JSON.stringify({viewport:{width:1000,height:700},browser:browser.version(),submitted:'核对本周交付清单',dom_result:text,screenshots:['before.png','after.png']}));
 await context.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
'''


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--playwright-module',type=Path,required=True);args=p.parse_args()
    out=args.output.resolve()
    if out.exists():p.error('Use new output to retain original evidence')
    out.mkdir(parents=True);rows=[]
    for name in ['good','obscured','missing-images']:
        root=out/name;root.mkdir();(root/'tests').mkdir()
        (root/'index.html').write_text(HTML.replace('BAD_OVERLAY',"document.querySelector('#veil').style.display='flex'" if name=='obscured' else ''))
        (root/'tests/capture.mjs').write_text(CAPTURE)
        git(root,'init','-q');git(root,'add','.')
        git(root,'-c','user.name=UI fixture','-c','user.email=fixture@example.invalid','commit','-qm','Controlled browser fixture')
        revision=git(root,'rev-parse','HEAD');aid='AT-ui-'+name
        initialize(root,aid,'UI复审质量对照','host',{'purpose':'native pixel review'},'User authorized Agent-quality testing')
        acceptance=read_knowledge(root,aid,[])['acceptance'];flows=root/'.acceptance-local'/aid/'workflows';flows.mkdir()
        workspace=flows.parent/'workspace';git(root,'clone','-q',str(root),str(workspace))
        text='用户填写事项标题并添加后，在页面中能看到标题一致的新事项。'
        visual='输入状态的标题输入框与添加按钮、成功状态的新事项应可见、可读、无遮挡，布局和层次清楚，控件样式一致。'
        publish_catalog(root,aid,{'schema':'acceptance-catalog-v2','project':{'id':'ui-probe'},
            'context':{'business_goal':'添加事项后能实际查看结果。'},'basis':'Explicit host-authored review test',
            'requirements':[{'id':'R1','text':text+visual,'origin':{'kind':'user','reference':'controlled acceptance contract'},'external_refs':[]}],
            'reverse_rules':[],'scenarios':[{'id':'S1','requirement_id':'R1','title':'添加事项后看到结果',
                'description':text+visual,'priority':'P0','priority_reason':'新增后结果不可见会阻断用户任务。',
                'related_refs':[],'external_refs':[],'origin':{'kind':'user','reference':'controlled UI contract'},
                'check':{'method':'host-adopted','basis':'Exact original user-visible task'},
                'ui_acceptance':{'required':True,'visual_expectation':visual}}]})
        context={'acceptance':acceptance,'definitions':binding(root,aid)}
        original={**context,**scene_input(context,'S1'),'coverage':{'policy':'off'}}
        catalog={**context,'schema':'portable-project-catalog-v1','project_root':str(workspace),'revision':revision,
            'source_checkout':str(root),'components':[],'source_hashes':{'index.html':digest(workspace/'index.html')}}
        save(flows/'catalog.json',catalog)
        row={'probe':name,'semantic_review':'requires independent pixel and result reading',
            **execution_review(root,original,flows/'catalog.json',flows/'attempt-1',['tests/capture.mjs'],
                ['node','tests/capture.mjs',str(args.playwright_module.resolve())],flows/'browser-evidence',name!='missing-images')}
        save(flows/'result.json',row);rows.append(row);finish_acceptance(root,aid)
        print(json.dumps(row,ensure_ascii=False),flush=True)
    save(out/'results.json',{'rows':rows,'scope':'Mac real Chromium pixels; not independent browser setup or Linux UI support'})


if __name__=='__main__':main()
