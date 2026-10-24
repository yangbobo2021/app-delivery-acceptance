import base64
from copy import deepcopy
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from case_identity import finalize, load, save, verify, rebuilt
from existing_case_policy import snapshot, verify as policy_verify
from case_evaluation_contract import context


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name); self.root = self.base / 'workspace'; self.root.mkdir()
        self.project = self.base / 'project'; (self.project / '.acceptance').mkdir(parents=True)
        self.path = self.root / 'checks' / 'test_example.py'; self.path.parent.mkdir()
        self.path.write_text('import unittest\nclass Cases(unittest.TestCase):\n    def test_first(self):\n        self.assertEqual(2 + 2, 4)\n    def test_second(self):\n        self.assertEqual(3 + 3, 6)\n')
        for args in [('init', '-q'), ('add', '.'), ('-c','user.name=Fixture','-c','user.email=test@example.invalid','commit','-qm','fixture')]:
            subprocess.run(['git',*args],cwd=self.root,check=True)
        self.catalog = {'project_root': str(self.root), 'revision': 'fixture', 'test_roots': ['checks']}
        self.input = {'acceptance': {'id': 'AT-one', 'project_root': str(self.project)}, 'scene': {'id':'SC-one'}}
        self.answer = {'status': 'host_ready', 'test_files': ['checks/test_example.py'], 'case_descriptions': [
            {'id':'C1','name':'加法计算正确','source': {'file':'checks/test_example.py','title':'test_first','origin':'existing','line_start':3,'line_end':4,'id_comment':'# {id}'}},
            {'id':'C2','name':'另一组加法正确','source': {'file':'checks/test_example.py','title':'test_second','origin':'generated','line_start':5,'line_end':6,'id_comment':'# {id}'}}],
            'case_discovery': {'associations':[{'case_id':'C1'},{'case_id':'C2'}], 'obligations':[{'case_ids':['C1','C2']}],
                               'evidence':[{'file':'checks/test_example.py','line_start':3,'line_end':6,'quote':'def test_first'}]},
            'case_reuse': {'decisions':[{'case_id':'C1','existing_case_ids':['old-C1']},{'case_id':'C2','existing_case_ids':[]}]}}
        self.output = self.base / 'out'; self.output.mkdir(); save(self.output/'answer.json',self.answer)

    def stamp(self):
        return finalize(self.catalog,self.input,self.output)

    def test_source_comments_mapping_citations_evaluator_and_real_behavior(self):
        original=self.path.read_bytes(); report=self.stamp(); answer=load(self.output/'answer.json')
        verify(answer,self.root,scene_id='SC-one',acceptance_id='AT-one')
        ids=[c['id'] for c in answer['case_descriptions']]
        self.assertEqual(len(set(ids)),2); self.assertTrue(all(x.startswith('TC-') for x in ids))
        self.assertEqual(answer['case_discovery']['obligations'][0]['case_ids'],ids)
        self.assertEqual(answer['case_reuse']['decisions'][0]['existing_case_ids'],['old-C1'])
        self.assertEqual([c['source']['line_start'] for c in answer['case_descriptions']],[4,7])
        quote=answer['case_discovery']['evidence'][0]
        self.assertIn(quote['quote'],'\n'.join(self.path.read_text().splitlines()[quote['line_start']-1:quote['line_end']]))
        self.assertEqual(load(self.output/'answer.agent.json'),self.answer)
        self.assertEqual(base64.b64decode(report['patches']['checks/test_example.py']['before_base64']),original)
        self.assertEqual(context(self.input,answer)['cases'][0]['original_id'],ids[0])
        result=subprocess.run([sys.executable,'-m','unittest','discover','-s','checks'],cwd=self.root,capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr.decode())

    def test_same_output_is_idempotent(self):
        first=self.stamp(); before=self.path.read_bytes(); self.assertEqual(self.stamp(),first); self.assertEqual(self.path.read_bytes(),before)

    def next_attempt(self, name='out2'):
        self.answer=load(self.output/'answer.json'); self.answer.pop('case_identity',None)
        self.output=self.base/name; self.output.mkdir(); save(self.output/'answer.json',self.answer)

    def test_other_scene_reuses_ids_and_records_both_relationships(self):
        first=self.stamp(); self.next_attempt(); self.input['scene']['id']='SC-two'; second=self.stamp()
        self.assertEqual(first['local_id_map']['C1'],second['cases'][0]['id']); self.assertEqual(second['patches'],{})
        registry=load(self.project/'.acceptance/case-identities.json')
        self.assertEqual(len(registry['cases'][second['cases'][0]['id']]['relationships']),2)

    def test_new_acceptance_reuses_unintegrated_exact_source(self):
        original=self.path.read_bytes(); first=self.stamp(); self.path.write_bytes(original)
        self.output=self.base/'new-at';self.output.mkdir();save(self.output/'answer.json',self.answer)
        self.input['acceptance']['id']='AT-two'; second=self.stamp()
        self.assertEqual(first['local_id_map'],second['local_id_map'])

    def test_rename_move_and_assertion_extension_keep_source_marker_id(self):
        first=self.stamp(); self.next_attempt()
        text=self.path.read_text().replace('test_first','test_renamed').replace('2 + 2, 4','2 + 3, 5')
        moved=self.path.with_name('test_moved.py');moved.write_text(text);self.path.unlink();self.path=moved
        self.answer['test_files']=['checks/test_moved.py']
        for case in self.answer['case_descriptions']:case['source']['file']='checks/test_moved.py'
        self.answer['case_descriptions'][0]['source']['title']='test_renamed';self.answer['case_discovery']['evidence']=[]
        save(self.output/'answer.json',self.answer);second=self.stamp()
        self.assertEqual(first['cases'][0]['id'],second['cases'][0]['id'])

    def test_duplicate_id_anywhere_is_rejected_without_mutation(self):
        self.stamp();self.next_attempt(); shutil.copy2(self.path,self.root/'checks/copy.py');before=self.path.read_bytes()
        with self.assertRaisesRegex(ValueError,'duplicate'):self.stamp()
        self.assertEqual(self.path.read_bytes(),before)

    def test_existing_only_allows_exact_host_id_patch_not_assertion_or_mode_changes(self):
        baseline=snapshot(self.catalog);self.stamp();answer=load(self.output/'answer.json');policy_verify(self.catalog,baseline,answer)
        self.path.write_text(self.path.read_text().replace('2 + 2, 4','2 + 2, 5'))
        with self.assertRaises(ValueError):policy_verify(self.catalog,baseline,answer)

    def test_execution_source_hashes_and_scene_cannot_be_swapped(self):
        self.stamp();answer=load(self.output/'answer.json')
        for kw in [{'scene_id':'wrong'},{'acceptance_id':'wrong'},{'receipt_hashes':{'checks/test_example.py':'wrong'}}]:
            with self.subTest(kw=kw),self.assertRaises(ValueError):verify(answer,self.root,**kw)

    def test_selected_id_or_report_tampering_is_rejected(self):
        self.stamp();answer=load(self.output/'answer.json');answer['case_descriptions'][0]['id']='C-wrong'
        with self.assertRaisesRegex(ValueError,'selection'):verify(answer,self.root)
        answer=load(self.output/'answer.json');p=self.output/'case-identities.json';p.write_text(p.read_text()+' ')
        with self.assertRaisesRegex(ValueError,'hash'):verify(answer,self.root)

    def test_unsafe_or_missing_comment_syntax_wrong_title_and_symlink_are_rejected(self):
        for change in [{'id_comment':'print("{id}")'},{'id_comment':None},{'title':'invented'},{'file':'../escape'}]:
            value=deepcopy(self.answer);value['case_descriptions'][0]['source'].update(change);save(self.output/'answer.json',value)
            with self.subTest(change=change),self.assertRaises(ValueError):self.stamp()
        save(self.output/'answer.json',self.answer);target=self.path.with_name('target.py');self.path.rename(target);self.path.symlink_to(target)
        with self.assertRaisesRegex(ValueError,'symlink'):self.stamp()

    def test_identical_unmarked_test_copy_does_not_reuse_id(self):
        first=self.stamp();self.next_attempt();text=self.path.read_text();text='\n'.join(x for x in text.split('\n') if '@case-id:' not in x)
        copy=self.path.with_name('test_copy.py');copy.write_text(text)
        self.answer=deepcopy(self.answer);self.answer['test_files']=['checks/test_copy.py'];self.answer['case_discovery']['evidence']=[]
        for c, start in zip(self.answer['case_descriptions'],[3,5]):c['source'].update(file='checks/test_copy.py',line_start=start,line_end=start+1)
        save(self.output/'answer.json',self.answer);second=self.stamp()
        self.assertTrue(set(c['id'] for c in first['cases']).isdisjoint(c['id'] for c in second['cases']))

    def test_full_cli_checks_real_scene_lease_and_writes_ids(self):
        sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
        from acceptance_store import initialize, read_knowledge, publish_catalog
        from acceptance_definitions import binding, scene_input
        from acceptance_workspace import workspace_lease
        import os
        at='AT-cli'
        initialize(self.project,at,'身份入口验收','host',{'purpose':'isolated test'},'test authorization')
        acceptance=read_knowledge(self.project,at,[])['acceptance']
        local=self.project/'.acceptance-local'/at;workspace=local/'workspace'
        subprocess.run(['git','clone','-q',str(self.root),str(workspace)],check=True)
        publish_catalog(self.project,at,{'schema':'acceptance-catalog-v2','project':{'id':'fixture'},'context':{'business_goal':'准确定位用例。'},'basis':'fixture',
            'requirements':[],'reverse_rules':[],'scenarios':[{'id':'SC1','title':'加法正确','description':'加法正确','priority':'P1','priority_reason':'正确计算',
            'related_refs':[],'external_refs':[],'origin':{'kind':'fixture','reference':'native source'},'check':{'method':'host','basis':'fixture'}}]})
        config={'acceptance':acceptance,'definitions':binding(self.project,at),'workspace_policy':'single-acceptance-v1','source_checkout':str(self.project)}
        catalog={**config,'project_root':str(workspace),'revision':subprocess.check_output(['git','rev-parse','HEAD'],cwd=workspace,text=True).strip(),'test_roots':['checks']}
        value={**config,**scene_input(config,'SC1')}
        output=local/'workflows'/'identity';output.mkdir(parents=True)
        save(local/'catalog.json',catalog);save(local/'input.json',value);save(output/'answer.json',self.answer)
        command=[sys.executable,str(Path(__file__).with_name('case_identity.py')),str(local/'catalog.json'),str(local/'input.json'),str(output)]
        denied=subprocess.run(command,capture_output=True);self.assertNotEqual(denied.returncode,0)
        with workspace_lease(config,output,scene=True):
            result=subprocess.run(command,capture_output=True,env={**os.environ,'ACCEPTANCE_WORKSPACE_LEASE':str(output.resolve())})
        self.assertEqual(result.returncode,0,result.stderr.decode())
        verify(load(output/'answer.json'),workspace,scene_id='SC1',acceptance_id=at)

    def test_malformed_marker_and_unsafe_script_header_are_rejected(self):
        self.path.write_text('# @case-id: TC-broken\n'+self.path.read_text())
        with self.assertRaisesRegex(ValueError,'malformed'):self.stamp()
        self.path.write_text('#!/bin/sh\nexit 0\n')
        self.answer['case_descriptions']=self.answer['case_descriptions'][:1]
        self.answer['case_descriptions'][0]['source'].update(title='test_example.py',line_start=1,line_end=2)
        save(self.output/'answer.json',self.answer)
        with self.assertRaisesRegex(ValueError,'shebang'):self.stamp()

    def test_raw_agent_answer_is_preserved_byte_for_byte_and_hash_bound(self):
        original=json.dumps(self.answer,ensure_ascii=True,indent=4).encode()+b'\n\n'
        (self.output/'answer.json').write_bytes(original);self.stamp()
        self.assertEqual((self.output/'answer.agent.json').read_bytes(),original)
        (self.output/'answer.agent.json').write_bytes(original+b' ')
        with self.assertRaisesRegex(ValueError,'original Agent'):verify(load(self.output/'answer.json'),self.root)

    def test_documentation_examples_are_not_test_declarations(self):
        (self.root/'README.md').write_text('# @case-id: TC-<UUID>\n')
        first=self.stamp();self.next_attempt()
        # Even an example copied from a real test is documentation, not a
        # second test declaration in the project's declared test scope.
        (self.root/'README.md').write_text('# @case-id: '+first['cases'][0]['id']+'\n')
        self.assertEqual(self.stamp()['cases'][0]['id'],first['cases'][0]['id'])

    def test_changed_mode_is_not_an_id_only_change(self):
        baseline=snapshot(self.catalog);self.stamp();self.path.chmod(0o755)
        with self.assertRaises(ValueError):policy_verify(self.catalog,baseline,load(self.output/'answer.json'))

    def test_parameterized_declaration_has_one_id_not_one_per_data_row(self):
        text='import unittest\nclass Example(unittest.TestCase):\n    def test_rows(self):\n        for n in (1,2,3):\n            with self.subTest(n=n): self.assertGreater(n,0)\n'
        self.path.write_text(text);self.answer['case_descriptions']=self.answer['case_descriptions'][:1]
        self.answer['case_descriptions'][0]['source'].update(title='test_rows',line_start=3,line_end=5)
        self.answer.pop('case_discovery');self.answer.pop('case_reuse');save(self.output/'answer.json',self.answer)
        report=self.stamp();self.assertEqual(len(report['cases']),1);self.assertEqual(self.path.read_text().count('@case-id:'),1)

    def test_no_associations_no_source_writes_and_no_execution_claim(self):
        self.answer.update(status='not_executed',case_descriptions=[],test_files=[]);self.answer.pop('case_discovery');self.answer.pop('case_reuse')
        save(self.output/'answer.json',self.answer);before=self.path.read_bytes();report=self.stamp()
        self.assertEqual(report['patches'],{});self.assertEqual(self.path.read_bytes(),before)
        self.assertEqual(load(self.output/'answer.json')['status'],'not_executed')

    def test_bom_crlf_and_mode_are_preserved(self):
        self.path.write_bytes(b'\xef\xbb\xbf'+self.path.read_bytes().replace(b'\n',b'\r\n'));self.path.chmod(0o755)
        report=self.stamp();data=self.path.read_bytes();self.assertTrue(data.startswith(b'\xef\xbb\xbf'));self.assertEqual(data.count(b'\n'),data.count(b'\r\n'));self.assertEqual(self.path.stat().st_mode&0o777,0o755)
        self.assertEqual(rebuilt(report['patches']['checks/test_example.py']),data)

    def test_python_js_shell_actual_commands(self):
        examples=[('case.mjs',"import assert from 'node:assert/strict';\nassert.equal(2+2,4);\n",2,'// {id}',['node','checks/case.mjs']),
                  ('case.sh','#!/bin/sh\n[ "$((2 + 2))" = 4 ]\n',2,'# {id}',['sh','checks/case.sh'])]
        for n,(name,text,line,syntax,cmd) in enumerate(examples):
            path=self.root/'checks'/name;path.write_text(text)
            self.output=self.base/f'lang{n}';self.output.mkdir()
            answer={'status':'host_ready','test_files':['checks/'+name],'case_descriptions':[{'id':'C1','source':{'file':'checks/'+name,'title':name,'line_start':line,'line_end':line,'id_comment':syntax}}]}
            save(self.output/'answer.json',answer);self.stamp();result=subprocess.run(cmd,cwd=self.root,capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr.decode());self.assertTrue(path.read_text().startswith(text.splitlines()[0]))


if __name__=='__main__':unittest.main()
