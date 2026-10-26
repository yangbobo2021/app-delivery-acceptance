"""Synthetic coverage probe contract tests; no language/tool is assumed by the Skill."""
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from coverage_preparation import run_plan, sha, verify_report


SCRIPT = r'''
import json,sys
from pathlib import Path
kind,raw=sys.argv[1:]
raw=Path(raw)
if kind=='collect':
 raw.mkdir(parents=True,exist_ok=True)
 (raw/'native.json').write_text(json.dumps({'covered':COVERED,'total':9}))
else:
 native=json.loads((raw/'native.json').read_text())
 print(json.dumps({'schema':'coverage-probe-normalized-v1','components':[
  {'id':'component','source_paths':['src/unit.fixture'],'metrics':
   {'line':{'status':'measured','covered':native['covered'],'total':native['total']},
    'branch':{'status':'unavailable','reason':'synthetic fixture'}}}]}))
'''


class CoveragePreparationTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.runtime_path = self.root / 'runtime.json'
        self.runtime_path.write_text('{}')
        self.runtime = {'schema': 'project-runtime-preparation-v1', 'status': 'ready',
                        'workspace': str(self.root), 'revision': 'synthetic-revision',
                        'executables': [{'path': sys.executable, 'resolved_path': str(Path(sys.executable).resolve())}]}

    def make_plan(self, zero_covered):
        zero = self.root / 'zero.py'
        zero.write_text(SCRIPT.replace('COVERED', str(zero_covered)))
        nonzero = self.root / 'nonzero.py'
        nonzero.write_text(SCRIPT.replace('COVERED', '2'))
        def commands(script):
            return {'collect': [sys.executable, str(script), 'collect', '{raw_dir}'],
                    'adapter': [sys.executable, str(script), 'adapter', '{raw_dir}'],
                    'direct': [sys.executable, str(script), 'direct', '{raw_dir}']}
        plan = {'schema': 'project-coverage-probe-plan-v1',
                'runtime_manifest': str(self.runtime_path), 'runtime_sha256': sha(self.runtime_path),
                'workspace': str(self.root), 'revision': self.runtime['revision'],
                'routes': [{'id': 'synthetic', 'source_paths': ['src/unit.fixture'],
                            'zero': commands(zero), 'nonzero': commands(nonzero)}]}
        path = self.root / 'plan.json'
        path.write_text(json.dumps(plan))
        return path

    def test_empty_native_false_100_is_not_certified(self):
        plan = self.make_plan(9)  # Emulates Electron empty-native source map -> 9/9.
        with patch('coverage_preparation._runtime', return_value=self.runtime):
            report = run_plan(plan, self.root / 'probes')
        self.assertEqual(report['status'], 'partial')
        self.assertIn('zero-hit native probe reported covered units',
                      report['routes'][0]['probes']['zero']['reason'])
        self.assertEqual(report['routes'][0]['probes']['nonzero']['status'], 'passed')
        self.assertTrue((self.root / 'probes/synthetic/zero/raw/native.json').is_file())

    def test_zero_and_nonzero_are_compared_against_same_native_bytes(self):
        plan = self.make_plan(0)
        with patch('coverage_preparation._runtime', return_value=self.runtime):
            report = run_plan(plan, self.root / 'probes')
            self.assertEqual(verify_report(self.root / 'probes/coverage-probes.json',
                self.runtime_path, sha(self.runtime_path), ['src/unit.fixture'])['status'], 'ready')
        self.assertEqual(report['status'], 'ready')
        for probe in report['routes'][0]['probes'].values():
            self.assertEqual(probe['status'], 'passed')
            self.assertEqual(len(probe['native']), 1)
        native = self.root / 'probes/synthetic/nonzero/raw/native.json'
        native.write_bytes(native.read_bytes() + b' ')
        with patch('coverage_preparation._runtime', return_value=self.runtime):
            with self.assertRaisesRegex(ValueError, 'bound artifact'):
                verify_report(self.root / 'probes/coverage-probes.json', self.runtime_path,
                              sha(self.runtime_path), ['src/unit.fixture'])

    def test_archived_probe_refs_resolve_by_hash_without_old_local(self):
        self.runtime_path.write_text(json.dumps(self.runtime))
        plan = self.make_plan(0)
        with patch('coverage_preparation._runtime', return_value=self.runtime):
            run_plan(plan, self.root / 'probes')
        archived = self.root / 'archive'
        archived.mkdir()
        originals = [plan, self.runtime_path, *(p for p in (self.root / 'probes').rglob('*') if p.is_file())]
        mapping = {}
        for index, original in enumerate(originals):
            destination = archived / f'{index}{original.suffix}'
            shutil.copy2(original, destination)
            mapping[str(original)] = {'path': str(destination), 'sha256': sha(destination)}
        report = mapping[str(self.root / 'probes/coverage-probes.json')]['path']
        runtime = mapping[str(self.runtime_path)]['path']
        plan.rename(plan.with_suffix('.offline'))
        self.runtime_path.rename(self.runtime_path.with_suffix('.offline'))
        shutil.rmtree(self.root / 'probes')
        result = verify_report(report, runtime, mapping[str(self.runtime_path)]['sha256'],
                               ['src/unit.fixture'], verify_runtime=False, mapping=mapping)
        self.assertEqual(result['status'], 'ready')

    def test_valid_but_mutated_native_data_retains_integrity_diagnosis(self):
        plan = self.make_plan(0)
        script = self.root / 'zero.py'
        script.write_text(script.read_text() + "\nif kind=='adapter': (raw/'native.json').write_text(json.dumps({'covered':0,'total':9,'mutated':True}))\n")
        with patch('coverage_preparation._runtime', return_value=self.runtime):
            report = run_plan(plan, self.root / 'probes')
        self.assertEqual(report['routes'][0]['probes']['zero']['status'], 'failed')
        proof = json.loads((self.root / 'probes/synthetic/zero/native-integrity.json').read_text())
        file = str(self.root / 'probes/synthetic/zero/raw/native.json')
        self.assertEqual(proof['changed'], [file])
        self.assertNotEqual(proof['before'][file], proof['after'][file])

    def test_failing_reader_mutation_is_recorded_before_error_exit(self):
        plan = self.make_plan(0)
        script = self.root / 'zero.py'
        script.write_text(script.read_text() + "\nif kind=='adapter':\n (raw/'native.json').write_text('changed')\n raise SystemExit(3)\n")
        with patch('coverage_preparation._runtime', return_value=self.runtime):
            report = run_plan(plan, self.root / 'probes')
        self.assertEqual(report['routes'][0]['probes']['zero']['status'], 'failed')
        proof = json.loads((self.root / 'probes/synthetic/zero/native-integrity.json').read_text())
        self.assertEqual(proof['reader'], 'adapter')
        self.assertEqual(len(proof['changed']), 1)


if __name__ == '__main__':
    unittest.main()
