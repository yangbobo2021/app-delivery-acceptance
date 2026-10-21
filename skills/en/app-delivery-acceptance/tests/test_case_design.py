import copy,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import case_design as C
class CaseDesignTests(unittest.TestCase):
 def setUp(self):
  self.scene={'id':'S','acceptance':{'criteria':['A B C']}}
  self.binding={'case_design':{'standard':C.STANDARD,'items':[{'criterion':'A B C','check_points':[{'id':x,'text':x} for x in 'ABC']}]},'cases':[{'path':'tests/t.py','selector':x,'procedure':{'steps':[{'action':x,'expected':x}], 'scenario_checks':[{'scenario_id':'S','criterion':'A B C','covered_point_ids':list(x),'step_numbers':[1]}]}} for x in ['AB','C']]}
  self.review={'case_coverage':{'standard':C.STANDARD,'status':'sufficient','items':[{'criterion':'A B C','status':'covered','reason':'A B C均有实际检查','contributions':[{'association_key':'case:tests/t.py:'+x,'covered_point_ids':list(x),'step_numbers':[1],'reason':'核验该用例步骤的对应断言'} for x in ['AB','C']]}]}}
 def test_combined_cases_cover_all_points(self):
  self.assertEqual([],C.design_errors(self.binding,self.scene));self.assertEqual([],C.review_errors(self.review,self.binding,self.scene))
 def test_repeated_a_b_cannot_replace_c(self):
  self.binding['cases'][1]['procedure']['scenario_checks'][0]['covered_point_ids']=['A','B']
  self.assertTrue(C.design_errors(self.binding,self.scene))
 def test_review_cannot_claim_unassigned_points(self):
  self.review['case_coverage']['items'][0]['contributions'][1]['covered_point_ids']=['A','C']
  self.assertIn('review contribution exceeds assigned case scope',C.review_errors(self.review,self.binding,self.scene))
 def test_wrong_step_location_is_rejected(self):
  self.binding['cases'][0]['procedure']['scenario_checks'][0]['step_numbers']=[2]
  self.assertTrue(C.design_errors(self.binding,self.scene))
 def test_independent_partial_union_is_not_sufficient(self):
  self.review['case_coverage']['items'][0]['contributions'].pop()
  self.assertTrue(C.review_errors(self.review,self.binding,self.scene))
  self.review['case_coverage']['items'][0]['status']='partial';self.review['case_coverage']['status']='partial'
  self.assertEqual([],C.review_errors(self.review,self.binding,self.scene))
 def test_each_case_actual_record_is_required(self):
  p={'status':'passed','evidence':['a.json'],'case_results':[{'association_key':'case:tests/t.py:AB','status':'passed','summary':'A B真实执行','evidence':['a.json'],'step_results':[{'step_number':1,'actual':'实际检查A B','evidence':['a.json']}]}]}
  self.assertTrue(C.result_errors(p,self.binding))
 def test_failed_sibling_cannot_become_scene_pass(self):
  p={'status':'passed','evidence':['a.json'],'case_results':[{'association_key':'case:tests/t.py:'+x,'status':'passed' if x=='AB' else 'failed','summary':'实际完成检查','evidence':['a.json'],'step_results':[{'step_number':1,'actual':'实际检查','evidence':['a.json']}]} for x in ['AB','C']]}
  self.assertIn('scene execution cannot pass with unfinished or failed case',C.result_errors(p,self.binding))
