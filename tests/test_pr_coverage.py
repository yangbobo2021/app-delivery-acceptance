"""Real Git diff boundaries and original-unit union, never average percentages."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import coverage_subjects as pr_coverage
import playbook


class PRCoverageTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.git('init', '-q'); self.git('config', 'user.email', 'fixture@example.test'); self.git('config', 'user.name', 'fixture')
        (self.root/'booking.py').write_text('def book(value):\n    if value > 0:\n        return True\n    return False\n')
        (self.root/'removed.py').write_text('x = 1\n')
        self.git('add', '.'); self.git('commit', '-qm', 'base'); self.base=self.git('rev-parse','HEAD').strip()
        (self.root/'booking.py').write_text('def book(value):\n    if value >= 0:\n        return True\n    return False\n')
        (self.root/'new.py').write_text('created = 1\n')
        (self.root/'note.txt').write_text('non executable\n')
        (self.root/'removed.py').unlink()
        self.git('add', '.'); self.git('commit', '-qm', 'change'); self.head=self.git('rev-parse','HEAD').strip()
        self.subject={'kind':'pr_changes','intent':'验收此PR修改','basis':'指定PR变更代码','project_id':'booking','project_label':'预订服务','project_root':str(self.root),'revision':self.head,
                      'changes':[{'pr_url':'https://example.test/pull/1','base_revision':self.base,'head_revision':self.head}],
                      'source_paths':['booking.py','new.py'],'excluded_paths':[{'path':'note.txt','reason':'非执行文档'}]}

    def git(self, *args):
        return subprocess.run(['git','-C',str(self.root),*args],capture_output=True,check=True,text=True).stdout

    def units(self, hit=('[2, 3]',)):
        branches={'[2, 3]','[2, 4]','[3, -1]'}
        return {'booking.py':{'sha256':'fixture-source-hash', 'lines':{'all':{'1','2','3','4'},'hit':{'1','2'}},
                              'branches':{'all':branches,'hit':set(hit)}},
                'new.py':{'sha256':'fixture-new-hash','lines':{'all':{'1'},'hit':set()},'branches':{'all':set(),'hit':set()}}}

    def receipt(self, sid='A', **kwargs):
        return {'project_id':'booking','project_root':str(self.root),'revision':self.head,'scenario_id':sid,
                'tool':{'name':'coverage.py','version':'7'},**kwargs}

    def test_git_new_side_has_only_modified_and_added_lines(self):
        self.assertEqual(pr_coverage.subject(self.subject),{'booking.py':{2},'new.py':{1}})

    def test_all_changed_decision_exits_and_unhit_new_file_remain(self):
        row=pr_coverage.summarize([self.subject],[(self.receipt(),self.units())])[0]
        self.assertEqual(row['status'],'measured')
        self.assertEqual(row['metrics'],{'lines':{'covered':1,'total':2},'branches':{'covered':1,'total':2}})

    def test_subset_scopes_union_hits_once_and_complete_inventory(self):
        a=self.units(); b=self.units(hit=('[2, 4]',)); a.pop('new.py'); b['new.py']['lines']['hit']={'1'}
        row=pr_coverage.summarize([self.subject],[(self.receipt(),a),(self.receipt('B'),b)])[0]
        self.assertEqual(row['metrics']['lines'],{'covered':2,'total':2})
        self.assertEqual(row['metrics']['branches'],{'covered':2,'total':2})
        self.assertEqual(row['scenario_ids'],['A','B'])

    def test_missing_file_cannot_shrink_pr_denominator_or_fabricate_zero(self):
        units=self.units(); units.pop('new.py')
        row=pr_coverage.summarize([self.subject],[(self.receipt(),units)])[0]
        self.assertEqual(row['status'],'incomplete');self.assertEqual(row['missing_paths'],['new.py']);self.assertIsNone(row['metrics'])

    def test_changed_branch_denominator_or_tool_cannot_merge(self):
        for edit in ['denominator','tool']:
            a=self.units(); b=self.units(); r=self.receipt('B')
            if edit=='denominator':b['booking.py']['branches']['all'].add('[2, -1]')
            else:r['tool']['version']='8'
            row=pr_coverage.summarize([self.subject],[(self.receipt(),a),(r,b)])[0]
            self.assertEqual(row['status'],'invalid');self.assertIsNone(row['metrics'])

    def test_missing_pr_inventory_and_dirty_or_relocated_sources_reject(self):
        other=copy.deepcopy(self.subject);other['excluded_paths']=[]
        self.assertEqual(pr_coverage.summarize([other],[])[0]['status'],'invalid')
        (self.root/'booking.py').write_text('\n'+(self.root/'booking.py').read_text())
        with self.assertRaisesRegex(ValueError,'冻结被测源码'):pr_coverage.subject(self.subject)

    def test_istanbul_modified_parent_includes_implicit_else_not_other_decisions(self):
        keys=[json.dumps(['if',[[2,4],[4,16]],0,[[3,8],[3,19]]]),json.dumps(['if',[[2,4],[4,16]],1,'implicit_else']),json.dumps(['if',[[1,0],[1,8]],0,[[1,5],[1,8]]])]
        units=self.units();units['booking.py']['branches']={'all':set(keys),'hit':{keys[0],keys[2]}}
        row=pr_coverage.summarize([self.subject],[(self.receipt(format='istanbul'),units)])[0]
        self.assertEqual(row['metrics']['branches'],{'covered':1,'total':2})

    def test_zero_modified_decisions_are_not_false_hundred_percent(self):
        units=self.units();units['booking.py']['branches']={'all':set(),'hit':set()}
        row=pr_coverage.summarize([self.subject],[(self.receipt(),units)])[0]
        self.assertEqual(row['metrics']['branches'],{'covered':0,'total':0})

    def test_files_scope_counts_whole_selected_files_not_changed_lines(self):
        value=copy.deepcopy(self.subject);value.update(kind='files',selected_paths=['booking.py','new.py'],excluded_paths=[])
        row=pr_coverage.summarize([value],[(self.receipt(),self.units())])[0]
        self.assertEqual(row['metrics']['lines'],{'covered':2,'total':5})
        self.assertEqual(row['metrics']['branches'],{'covered':1,'total':3})

    def test_project_inventory_includes_unvisited_files_and_explicit_exclusions(self):
        value=copy.deepcopy(self.subject);value['kind']='project'
        self.assertEqual(pr_coverage.subject(value),{'booking.py':None,'new.py':None})
        value['source_paths']=['booking.py']
        self.assertEqual(pr_coverage.summarize([value],[])[0]['status'],'invalid')

    def test_directory_scope_inventory_and_unknown_directory(self):
        (self.root/'src').mkdir();(self.root/'src/a.py').write_text('x = 1\n');(self.root/'src/readme.txt').write_text('docs\n')
        self.git('add','.');self.git('commit','-qm','directory');revision=self.git('rev-parse','HEAD').strip()
        value=copy.deepcopy(self.subject);value.update(kind='directories',revision=revision,directories=['src'],source_paths=['src/a.py'],excluded_paths=[{'path':'src/readme.txt','reason':'文档'}])
        self.assertEqual(pr_coverage.subject(value),{'src/a.py':None})
        value['directories']=['absent'];self.assertEqual(pr_coverage.summarize([value],[])[0]['status'],'invalid')

    def test_commit_changes_use_explicit_parent_and_no_pr_identity(self):
        value=copy.deepcopy(self.subject);value['kind']='commit_changes';value['changes'][0].pop('pr_url')
        self.assertEqual(pr_coverage.subject(value),{'booking.py':{2},'new.py':{1}})
        value['changes'][0]['base_revision']=self.head
        self.assertEqual(pr_coverage.summarize([value],[])[0]['status'],'invalid')

    def test_intent_and_independent_review_are_required_and_hash_bound(self):
        value=copy.deepcopy(self.subject);values=[value]
        review={'coverage_subject_review':{'status':'passed','subjects_sha256':pr_coverage.definition_hash(values),'reviewer_kind':'independent_ai','review_reference':'independent-fixture','reason':'测试意图是该PR修改，非执行文件只有文档'}}
        self.assertEqual(pr_coverage.validate_definition({'coverage_subjects':values},review),values)
        value['basis']='擅自缩小范围'
        with self.assertRaisesRegex(ValueError,'独立审查'):pr_coverage.validate_definition({'coverage_subjects':values},review)
        value['intent']=''
        self.assertEqual(pr_coverage.summarize(values,[])[0]['status'],'invalid')

    def test_malformed_scope_is_explained_instead_of_crashing_viewer(self):
        for values in ([None], {}, [dict(self.subject, source_paths=[{}])]):
            row=pr_coverage.summarize(values,[])[0]
            self.assertEqual(row['status'],'invalid');self.assertIsNone(row['metrics']);self.assertTrue(row['reason'])

    def test_new_run_requires_reviewed_intent_scope_before_creating_files(self):
        ledger=Path(self.tmp.name)/'acceptance-results'/'delivery-acceptance'
        ledger.mkdir(parents=True)
        def save(name,value): (ledger/name).write_text(json.dumps(value))
        save('project.json',{'project_root':str(self.root),'test_layout':{'paths':['tests'],'basis':'fixture convention'}})
        save('resources.json',{});save('requirements.json',{'items':[]})
        save('scenarios.json',{'items':[{'id':'A','priority':'P0'}]});save('coverage_review.json',{})
        def create(revision=self.head):
            return playbook.new_run(self.root,'scoped',revision,'fixture',str(ledger.parent),scenario_loop=True,execution_coverage_mode='required')
        with self.assertRaisesRegex(ValueError,'测试意图'):create()
        self.assertFalse((ledger/'runs/scoped').exists())
        save('project.json',{'project_root':str(self.root),'test_layout':{'paths':['tests'],'basis':'fixture convention'},'coverage_subjects':[self.subject]})
        with self.assertRaisesRegex(ValueError,'独立审查'):create()
        self.assertFalse((ledger/'runs/scoped').exists())
        save('coverage_review.json',{'coverage_subject_review':{'status':'passed','subjects_sha256':pr_coverage.definition_hash([self.subject]),'reviewer_kind':'independent_ai','review_reference':'scope-fixture','reason':'验证PR全部变更'}})
        with self.assertRaisesRegex(ValueError,'本轮冻结'):create(self.base)
        self.assertFalse((ledger/'runs/scoped').exists())
        with patch('sys.stdout'):create()
        run=json.loads((ledger/'runs/scoped/run.json').read_text())
        self.assertEqual(run['coverage_policy']['mode'],'required')
        self.assertEqual(run['ledger_hashes']['project.json'],playbook.digest(ledger/'project.json'))


if __name__=='__main__':unittest.main()
