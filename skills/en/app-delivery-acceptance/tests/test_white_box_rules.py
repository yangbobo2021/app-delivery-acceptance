import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import white_box_rules as W
from design_fixture import white_contract
import priorities
import scenario_execution as E
import test_playbook as base
import test_scenario_execution as lifecycle_base

class RuleContractTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name).resolve(); self.ledger = self.project / 'ledger'; self.ledger.mkdir()
        (self.project/'app.py').write_text('def change(value):\n    return value\n')
        (self.ledger/'requirements.json').write_text('{"items":[{"id":"R1","text":"有效库存"}]}')
        self.source={'path':'app.py','symbol':'change','revision':'controlled-source-v1','sha256':hashlib.sha256((self.project/'app.py').read_bytes()).hexdigest(),'line_start':1,'line_end':2,'excerpt':'def change(value):\n    return value'}
        self.scene={'id':'W1','kind':'white_box','requirement_ids':[],'reverse_rule_ids':['WR1'],'priority':'P0','code_sources':[self.source]}
        self.rule={'id':'WR1','title':'修改前校验','text':'无效修改必须拒绝','rationale':'错误输入可破坏数据','basis':'接口契约要求拒绝无效输入','basis_kind':'contract','status':'supported','code_sources':[self.source]}
        self.document, self.review = white_contract([self.scene])
        self.review['rule_reviews']=[{'rule_id':'WR1','verdict':'accepted','reason':'实际契约支持该约束'}]
        self.write()
    def write(self):
        self.document['items']=[self.rule]
        (self.ledger/W.NAME).write_text(json.dumps(self.document,ensure_ascii=False))
    def errors(self): return W.definitions_errors(self.project,self.ledger,[self.scene],{'R1'})
    def test_supported_rule_is_separate_and_has_reviewed_check_mapping(self):
        self.assertEqual(self.errors(),[]);self.assertEqual(W.review_errors(self.ledger,[self.scene],self.review),[])
        self.assertEqual(self.scene['requirement_ids'],[])
    def test_white_box_scene_cannot_omit_actual_source_even_with_existing_requirement(self):
        self.scene.update(requirement_ids=['R1'],reverse_rule_ids=[]);self.scene.pop('code_sources')
        self.assertTrue(any('code sources need' in e for e in self.errors()))
    def test_gap_review_is_readable_but_blocks_acceptance(self):
        self.review['rule_reviews'][0]['verdict']='gap';self.review['design_reviews'][0]['verdict']='gap';self.review['design_reviews'][0]['coverage_results'][0].update(status='partial');self.review['design_reviews'][0]['coverage_results'][0]['scenario_coverage'][0]['covered_point_ids']=['deny'];self.review['design_reviews'][0]['findings']=[{'kind':'coverage_gap','requirement_basis':'原记录不得变化','condition':'无效请求错误写入','escaping_fault':'返回拒绝但修改记录','why_existing_misses':'只检查拒绝码','expected_detection':'对照完整前后记录','scenario_ids':['W1']}]
        self.assertEqual(W.review_errors(self.ledger,[self.scene],self.review,False),[])
        self.assertTrue(W.review_errors(self.ledger,[self.scene],self.review,True))
    def test_implementation_alone_is_not_an_oracle(self):
        self.rule['basis_kind']='implementation';self.write();self.assertIn('implementation alone',' '.join(self.errors()))
    def test_pending_design_can_be_reviewed_but_not_executed_or_accepted(self):
        self.rule.update(status='needs_confirmation',question='是否自动校正？',basis_kind='candidate');self.write();self.review['rule_reviews'][0]['verdict']='needs_confirmation'
        self.assertEqual(W.review_errors(self.ledger,[self.scene],self.review,False),[])
        self.assertIn('awaiting business',' '.join(W.review_errors(self.ledger,[self.scene],self.review)))
        self.assertIn('before',' '.join(W.execution_errors(self.ledger,self.scene,self.project)))
    def test_current_file_hash_and_excerpt_both_checked(self):
        self.source['excerpt']='invented';self.write();self.assertIn('excerpt',' '.join(self.errors()))
        self.source['excerpt']='def change(value):\n    return value';self.write();(self.project/'app.py').write_text('changed')
        self.assertIn('source changed',' '.join(self.errors()));self.assertIn('source changed',' '.join(W.execution_errors(self.ledger,self.scene,self.project)))
    def test_unknown_collision_blackbox_and_malformed_links_rejected(self):
        self.rule['id']='R1';self.write();self.assertIn('confirmed requirement',' '.join(self.errors()))
        self.rule['id']='WR1';self.write();self.scene['kind']='black_box';self.assertIn('cannot derive',' '.join(self.errors()))
        self.scene['reverse_rule_ids']=[{}];self.assertTrue(self.errors())
    def test_rule_edit_changes_scope_binding_and_partial_coverage_never_passes(self):
        before=priorities.white_box_hashes(self.ledger,[self.scene]);self.rule['basis']='different contract';self.write()
        self.assertNotEqual(before['white_box_rules_sha256'],priorities.white_box_hashes(self.ledger,[self.scene])['white_box_rules_sha256'])
        self.review['design_reviews'][0]['verdict']='gap';self.review['design_reviews'][0]['coverage_results'][0].update(status='partial');self.review['design_reviews'][0]['coverage_results'][0]['scenario_coverage'][0]['covered_point_ids']=['deny'];self.review['design_reviews'][0]['findings']=[{'kind':'coverage_gap','requirement_basis':'原记录不得变化','condition':'无效请求错误写入','escaping_fault':'返回拒绝但修改记录','why_existing_misses':'只检查拒绝码','expected_detection':'对照完整前后记录','scenario_ids':['W1']}];self.assertIn('not completely covered',' '.join(W.review_errors(self.ledger,[self.scene],self.review)))

    def test_same_union_standard_rejects_falsely_complete_and_duplicate_only_coverage(self):
        result=self.review['design_reviews'][0]['coverage_results'][0]
        result['scenario_coverage'][0]['covered_point_ids']=['deny']
        self.assertIn('union of check points (partial)', ' '.join(W.review_errors(self.ledger,[self.scene],self.review,False)))
        second=dict(self.scene,id='W2')
        self.document['design_basis'][0]['coverage_items'][0]['scenario_ids'].append('W2');self.write()
        result['scenario_coverage'].append({'scenario_id':'W2','covered_point_ids':['deny'],'reason':'第二场景也只检查拒绝'})
        self.assertIn('union of check points (partial)', ' '.join(W.review_errors(self.ledger,[self.scene,second],self.review,False)))
        result['scenario_coverage'][1]['covered_point_ids']=['retain']
        self.assertEqual(W.review_errors(self.ledger,[self.scene,second],self.review,False),[])
    def test_missing_standard_or_shared_criterion_cannot_be_approved(self):
        self.review['design_reviews'][0]['criteria_checks'].pop()
        self.assertIn('five shared criteria',' '.join(W.review_errors(self.ledger,[self.scene],self.review,False)))
        self.document['design_standard']='white-only-standard';self.write()
        self.assertIn('shared design_standard',' '.join(self.errors()))
    def test_existing_requirement_white_design_keeps_confirmation_baseline_separate(self):
        self.scene.update(requirement_ids=['R1'],reverse_rule_ids=[])
        self.document,self.review=white_contract([self.scene]);self.document['items']=[]
        (self.ledger/W.NAME).write_text(json.dumps(self.document,ensure_ascii=False))
        self.assertEqual(self.errors(),[])
        self.assertEqual(W.review_errors(self.ledger,[self.scene],self.review),[])
        self.assertEqual(self.scene['requirement_ids'],['R1'])

class PendingLifecycleTest(unittest.TestCase):
    setUp=lifecycle_base.ScenarioExecutionTest.setUp
    save=lifecycle_base.ScenarioExecutionTest.save
    git=lifecycle_base.ScenarioExecutionTest.git
    step=lifecycle_base.ScenarioExecutionTest.step
    # Reuse the actual Git/product-pinning setup, only define new regression cases.
    def test_pending_rule_blocks_real_lifecycle_begin_and_final_gate(self):
        rule={'id':'WR1','status':'needs_confirmation'};self.save(self.ledger/W.NAME,{'version':1,'items':[rule]})
        self.scenarios[1]['reverse_rule_ids']=['WR1'];self.save(self.folder/'scenarios.snapshot.json',{'items':self.scenarios})
        with self.assertRaisesRegex(ValueError,'must be confirmed'):self.step('begin')
        self.run['scenario_reviews']=[{'scenario_id':'HIGH','status':'passed'}]
        errors=E.completion_errors(self.project,self.ledger,self.folder,self.run,identifier='HIGH')
        self.assertTrue(any('must be confirmed' in e for e in errors))

class RuleSnapshotTest(unittest.TestCase):
    setUp=base.PlaybookGatesTest.setUp
    def test_new_run_freezes_rules_and_rule_edit_stales_gate(self):
        base.save(self.ledger/W.NAME,{'version':1,'items':[]})
        with patch('sys.stdout'):base.PLAYBOOK.new_run(self.project,'rules-run','abc123','test', execution_coverage_mode='off')
        folder=self.ledger/'runs/rules-run';run=base.PLAYBOOK.read_json(folder/'run.json')
        self.assertTrue((folder/'white_box_rules.snapshot.json').exists());self.assertIn(W.NAME,run['ledger_hashes'])
        base.save(self.ledger/W.NAME,{'version':1,'items':[],'note':'changed'})
        issues=base.PLAYBOOK.validate(self.project,'rules-run')['gates']['execution']['issues']
        self.assertTrue(any(W.NAME in e and 'changed' in e for e in issues))
