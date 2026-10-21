"""Migration-only probes. These never execute product cases or coverage collectors."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'scripts'),str(ROOT/'scripts/v3')]
from acceptance_store import initialize,save,digest,validate
from evidence_store import resolve,verify_import_trace
from import_legacy import copy_tree
from coverage_views import summarize
from project_statistics import project_state
from project_view import ProjectView


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name).resolve()/'project';self.root.mkdir()
        self.at='AT-import-test'
        initialize(self.root,self.at,'Synthetic import','Fixture',{'targets':['fixture']},'Tool test')
        self.local=self.root/'.acceptance-local'/self.at
        self.shared=self.root/'.acceptance'/self.at

    def artifact(self,value):
        path=self.local/'imports/source.json';save(path,value)
        h=digest(path)
        save(self.shared/'evidence-index.json',{'schema':'acceptance-evidence-index-v1','acceptance_id':self.at,
             'artifacts':{h:{'sha256':h,'size':path.stat().st_size,'storage':'local:imports/source.json','mime':'application/json'}}})
        return path,'artifact:'+h

    def test_import_copies_are_independent_and_frozen(self):
        source=Path(self.tmp.name)/'legacy';source.mkdir()
        (source/'old.json').write_text('{"original":true}')
        (source/'checkout').mkdir();(source/'checkout/code.ts').write_text('not copied')
        dest=self.local/'imports/frozen'
        result=copy_tree(source,dest,self.local/'imports/copy.json')
        self.assertEqual(result['files'],1)
        (dest/'old.json').write_text('changed copy')
        self.assertEqual((source/'old.json').read_text(),'{"original":true}')
        self.assertNotEqual((source/'old.json').stat().st_ino,(dest/'old.json').stat().st_ino)
        with self.assertRaisesRegex(ValueError,'never overwrite'):
            copy_tree(source,dest,self.local/'imports/retry.json')

    def test_source_fields_and_confirmation_time_cannot_be_changed_by_import(self):
        original={'scenarios':[{'id':'S1'}],'judgment':{'status':'accepted_risk'},
                  'judgment_confirmed_at':'2026-01-01','generated_at':'2026-01-01',
                  'execution_known':True,'project':{'revision':'old'},'coverage_actual_revision':'new',
                  'judgment_source':{'revision':'old'}}
        _,reference=self.artifact({'rows':[original]})
        trace={**copy.deepcopy(original),'import_source':{'snapshot_ref':reference,'json_pointer':'/rows/0'}}
        verify_import_trace(self.root,self.at,trace)
        for field,value in [('judgment',{'status':'passed'}),('judgment_confirmed_at','migration date'),('coverage_actual_revision','fake')]:
            bad=copy.deepcopy(trace);bad[field]=value
            with self.assertRaisesRegex(ValueError,'altered'):
                verify_import_trace(self.root,self.at,bad)

    def test_artifact_tampering_is_detected(self):
        path,reference=self.artifact({'fixture':'frozen'})
        self.assertEqual(resolve(self.root,self.at,reference)[0],path)
        path.write_text('tampered')
        with self.assertRaisesRegex(ValueError,'changed'):
            resolve(self.root,self.at,reference)

    def test_migration_record_is_checked_like_other_archives(self):
        record=self.shared/'records/migration-fixture';record.mkdir()
        file=record/'trace.json';save(file,{'fixture':True})
        save(record/'record.json',{'schema':'acceptance-evidence-record-v1','acceptance_id':self.at,'files':{'trace.json':digest(file)}})
        validate(self.root,self.at)
        save(file,{'fixture':'changed'})
        with self.assertRaisesRegex(ValueError,'archived evidence'):
            validate(self.root,self.at)

    def test_transport_reads_relocated_bytes_and_refuses_original_fallback(self):
        folder=self.local/'imports/transport';folder.mkdir(parents=True)
        legacy=Path(self.tmp.name).resolve()/'old-evidence';legacy.mkdir()
        (legacy/'raw.json').write_text('original still exists')
        (folder/'raw.json').write_text('copied frozen bytes')
        mapping=folder/'map.json'
        save(mapping,{'schema':'acceptance-path-map-v1','legacy_roots':[str(legacy)],
                      'files':{str(legacy/'raw.json'):{'path':'raw.json','sha256':digest(folder/'raw.json')}},
                      'directories':{str(legacy):['raw.json']}})
        script=ROOT/'scripts/coverage-istanbul/evidence-transport.mjs'
        env={**os.environ,'ACCEPTANCE_EVIDENCE_MAP':str(mapping)}
        def run(code):return subprocess.run(['node','--import',str(script),'--input-type=module','-e',code],env=env,capture_output=True,text=True)
        code='import fs from "node:fs"; process.stdout.write(fs.readFileSync('+json.dumps(str(legacy/'raw.json'))+',"utf8"));'
        self.assertEqual(run(code).stdout,'copied frozen bytes')
        (legacy/'unmapped.json').write_text('must not read the original')
        denied=run(code.replace('raw.json','unmapped.json'))
        self.assertNotEqual(denied.returncode,0);self.assertIn('fallback is forbidden',denied.stderr)
        (folder/'raw.json').write_text('changed')
        self.assertIn('Relocated raw evidence changed',run(code).stderr)

    def test_capture_revision_does_not_overwrite_business_judgment_version(self):
        rows=[{'project':{'id':'p','revision':revision},'coverage_actual_revision':'capture-version',
               'generated_at':'2026-01-01','scenarios':[{'id':scene}], 'coverage':{'status':'unavailable'}}
              for revision,scene in [('business-old','S1'),('business-new','S2')]]
        report=summarize(rows)
        self.assertEqual(len(report),1)
        self.assertEqual(report[0]['revision'],'capture-version')
        self.assertEqual(report[0]['scenes'],2)
        self.assertEqual(rows[0]['project']['revision'],'business-old')
        trace={**rows[0],'requirements':[{'id':'R1'}],
               'scenarios':[{'id':'S1','requirement_id':'R1'}],'executed_scene_ids':['S1'],
               'judgment':{'status':'passed'},'judgment_source':{'revision':'retained-business-version'},
               'bindings':[],'case_results':[]}
        state=project_state([trace],{})
        actual=next(t for t in state['traces'] if t['scenarios'])
        self.assertEqual(actual['judgment_source']['revision'],'retained-business-version')

    def test_readonly_views_share_cold_snapshot_and_refresh_on_input_changes(self):
        view=ProjectView(self.root,self.at)
        payload={'progress':{'stages':[]},'fixture':'snapshot'}
        with patch.object(view,'_snapshot',return_value=payload) as calculate:
            with ThreadPoolExecutor(max_workers=4) as pool:
                values=list(pool.map(lambda _:view.snapshot(),range(8)))
            self.assertEqual(calculate.call_count,1)
            self.assertTrue(all(v==payload for v in values))
            values[0]['fixture']='caller mutation'
            self.assertEqual(view.snapshot()['fixture'],'snapshot')
            save(self.shared/'migration-note.json',{'new_record':True})
            view.snapshot()
            self.assertEqual(calculate.call_count,2)


if __name__=='__main__':unittest.main()
