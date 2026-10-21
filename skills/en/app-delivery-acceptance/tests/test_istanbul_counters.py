"""Istanbul shape/identity tests; these unit counters are explicit synthetic data."""
import copy
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import execution_coverage as coverage
import test_execution_coverage as fixture_module


class IstanbulCoverageTest(unittest.TestCase):
    def setUp(self):
        self.f = fixture_module.ExecutionCoverageTest(); self.f.setUp(); self.addCleanup(self.f.doCleanups)

    def scene(self, sid='HIGH', first=1, second=0, rename=False):
        r=self.f.scene(sid)
        loc=lambda line: {'start':{'line':line,'column':0},'end':{'line':line,'column':None}}
        ids=['21','3'] if rename else ['0','1']
        report={'booking.py':{'path':'booking.py','statementMap':{ids[0]:loc(1),ids[1]:loc(2)},
            's':{ids[0]:first,ids[1]:second},'fnMap':{},'f':{},
            'branchMap':{ids[0]:{'type':'if','loc':loc(2),'locations':[loc(2),loc(2)]}},'b':{ids[0]:[first,second]}}}
        raw=self.f.folder/r['raw_evidence']['path'];self.f.fixture.save(raw,report)
        proof=f'evidence/{sid}-mapping.log';(self.f.folder/proof).write_text('Explicit synthetic Istanbul shape; not measured JavaScript. Source identity booking.py, no transpilation.')
        r.update(format='istanbul',tool={'name':'fixture-Istanbul','version':'1','command':'explicit synthetic contract test'},
                 source_sha256={'booking.py':coverage.digest(self.f.project/'booking.py')},
                 provenance_evidence=[{'path':proof,'sha256':coverage.digest(self.f.folder/proof)}])
        r['raw_evidence']['sha256']=coverage.digest(raw)
        record=self.f.run['results'][-1];record['evidence'].append(proof)
        record['evidence_sha256'][proof]=coverage.digest(self.f.folder/proof)
        record['evidence_sha256'][r['raw_evidence']['path']]=coverage.digest(raw)
        # Fixture observation hashes must include changed shape and provenance.
        record['evidence_details'].append({'path':proof,'name':'合成映射契约','step':'原始位置核验','criterion':'绑定源代码','captured_at':'2026-10-11T00:00:00Z'})
        r['result_sha256']=coverage.lifecycle.hash_value(record)
        next(p for p in self.f.run['progress'] if p['scenario_id']==sid)['result_sha256']=r['result_sha256']
        return r

    def test_pending_omitted_then_completed_union_and_id_renaming(self):
        self.scene();self.assertFalse(self.f.summary()['projects']);self.f.complete()
        self.assertEqual(self.f.summary()['projects'][0]['metrics']['branches'],{'covered':1,'total':2})
        self.scene('NEXT',first=0,second=1,rename=True);self.f.complete('NEXT')
        p=self.f.summary()['projects'][0]
        self.assertEqual(p['metrics'],{'lines':{'covered':2,'total':2},'branches':{'covered':2,'total':2}})

    def test_multiple_statements_on_line_count_once(self):
        r=self.scene();path=self.f.folder/r['raw_evidence']['path'];d=coverage.read(path)
        v=d['booking.py'];v['statementMap']['2']=copy.deepcopy(v['statementMap']['0']);v['s']['2']=0
        self.f.fixture.save(path,d);r['raw_evidence']['sha256']=coverage.digest(path)
        units=coverage.counters(self.f.project,self.f.folder,r)['booking.py']
        self.assertEqual(len(units['lines']['all']),2);self.assertEqual(len(units['lines']['hit']),1)

    def test_invalid_locations_counts_identity_and_source_hash_rejected(self):
        r=self.scene();path=self.f.folder/r['raw_evidence']['path'];original=coverage.read(path)
        mutations=[lambda d:d['booking.py']['s'].update({'0':-1}),
            lambda d:d['booking.py']['s'].update({'0':True}),
            lambda d:d['booking.py']['s'].pop('1'),
            lambda d:d['booking.py']['b'].update({'0':[1]}),
            lambda d:d['booking.py']['statementMap']['0']['start'].update(line=999),
            lambda d:d['booking.py'].update(path='../other.py'),
            lambda d:d['booking.py']['statementMap']['0'].update(skip=True)]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                d=copy.deepcopy(original);mutate(d);self.f.fixture.save(path,d);r['raw_evidence']['sha256']=coverage.digest(path)
                with self.assertRaises(ValueError):coverage.counters(self.f.project,self.f.folder,r)
        self.f.fixture.save(path,original);r['raw_evidence']['sha256']=coverage.digest(path);r['source_sha256']['booking.py']='0'*64
        with self.assertRaisesRegex(ValueError,'字节'):coverage.counters(self.f.project,self.f.folder,r)

    def test_provenance_cannot_be_missing_or_changed(self):
        r=self.scene();proof=r['provenance_evidence'];r['provenance_evidence']=[]
        with self.assertRaisesRegex(ValueError,'映射证据'):coverage.counters(self.f.project,self.f.folder,r)
        r['provenance_evidence']=proof;(self.f.folder/proof[0]['path']).write_text('changed')
        with self.assertRaisesRegex(ValueError,'已改变'):coverage.counters(self.f.project,self.f.folder,r)


if __name__=='__main__':unittest.main()
