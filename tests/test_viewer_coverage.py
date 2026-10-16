import json
import os
from pathlib import Path
import tempfile
import subprocess
from threading import Event, Thread
import time
import unittest
from unittest.mock import patch
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer

import test_serve_ledger as fixture_module
from test_serve_ledger import VIEWER, save
import viewer_coverage as coverage


class BackgroundCoverageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        self.ledger = self.project / 'ledger'
        self.folder = self.ledger / 'runs' / 'fresh'
        self.folder.mkdir(parents=True)
        self.run = {'lifecycle': 'running', 'coverage_policy': {'mode': 'required'},
                    'progress': [{'scenario_id': 'A', 'phase': 'completed'}],
                    'evidence_sha256': {'proof.json': 'frozen'}}
        self.document = {'receipts': [{'scenario_id': 'A', 'provenance_evidence': ['receipt.log']}]}
        save(self.folder / 'run.json', self.run)
        save(self.folder / coverage.execution_coverage.NAME, self.document)
        (self.folder / 'proof.json').write_text('one')
        (self.folder / 'receipt.log').write_text('raw')
        self.cache = coverage.CoverageCache()

    def get(self):
        return self.cache.get(self.project, self.ledger, self.folder, self.run, self.document)

    def wait_idle(self):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            with self.cache.lock:
                working = self.cache.entries.get(str(self.folder), {}).get('working')
            if not working:
                return
            time.sleep(.01)
        self.fail('background worker did not finish')

    def test_slow_verification_never_blocks_progress_and_only_runs_once(self):
        entered, release = Event(), Event()
        def slow(*args):
            entered.set()
            release.wait(3)
            return {'subjects': [{'status': 'measured'}]}
        with patch.object(coverage.execution_coverage, 'summarize', side_effect=slow) as verify:
            self.addCleanup(release.set)
            started = time.monotonic()
            self.assertEqual(self.get()['verification_state'], 'pending')
            self.assertLess(time.monotonic() - started, 1)
            self.assertTrue(entered.wait(1))
            for _ in range(3):
                self.assertEqual(self.get()['subjects'], [])
            self.assertEqual(verify.call_count, 1)
            release.set(); self.wait_idle()
            self.assertEqual(self.get()['verification_state'], 'ready')
            self.assertEqual(verify.call_count, 1)

    def test_changed_proof_with_same_size_and_restored_mtime_hides_old_metrics(self):
        with patch.object(coverage.execution_coverage, 'summarize', return_value={'subjects': [{'status': 'measured'}]}):
            self.get(); self.wait_idle()
            self.assertEqual(self.get()['verification_state'], 'ready')
        for name in ('proof.json', 'receipt.log'):
            with self.subTest(name=name):
                before = coverage.signature(self.project, self.ledger, self.folder, self.run, self.document)
                path = self.folder / name; stat = path.stat()
                path.write_text('new')
                os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
                self.assertNotEqual(before, coverage.signature(self.project, self.ledger, self.folder, self.run, self.document))
        release = Event()
        with patch.object(coverage.execution_coverage, 'summarize', side_effect=lambda *a: (release.wait(3) or {})):
            self.addCleanup(release.set)
            self.assertEqual(self.get()['subjects'], [])
            release.set(); self.wait_idle()

    def test_write_during_verification_discards_result_and_retries(self):
        entered, release = Event(), Event()
        def verify(*args):
            entered.set(); release.wait(3)
            return {'subjects': [{'status': 'measured'}]}
        with patch.object(coverage.execution_coverage, 'summarize', side_effect=verify) as summarize:
            self.addCleanup(release.set)
            self.get(); self.assertTrue(entered.wait(1))
            (self.folder / 'proof.json').write_text('changed')
            release.set(); self.wait_idle()
            self.assertEqual(self.get()['verification_state'], 'pending')
            self.wait_idle()
            self.assertEqual(self.get()['verification_state'], 'ready')
            self.assertEqual(summarize.call_count, 2)

    def test_aborted_runs_skip_expensive_verification(self):
        self.run['lifecycle'] = 'aborted'
        with patch.object(coverage.execution_coverage, 'summarize') as verify:
            self.assertEqual(self.get()['verification_state'], 'aborted')
            verify.assert_not_called()

    def test_failure_is_explicit_and_has_no_green_metrics(self):
        with patch.object(coverage.execution_coverage, 'summarize', side_effect=ValueError('proof missing')):
            self.get(); self.wait_idle()
            result = self.get()
            self.assertEqual(result['verification_state'], 'invalid')
            self.assertIn('proof missing', result['verification_reason'])
            self.assertEqual(result['subjects'], [])

    def test_live_retry_receipts_and_test_edits_do_not_invalidate_completed_metrics(self):
        (self.project / 'tests').mkdir()
        case = self.project / 'tests' / 'shared.py'; case.write_text('original test')
        (self.project / 'product.py').write_text('business')
        for args in (['init', '-q'], ['add', 'tests/shared.py', 'product.py'],
                     ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'frozen']):
            subprocess.run(['git', '-C', str(self.project), *args], check=True, capture_output=True)
        revision = subprocess.check_output(['git', '-C', str(self.project), 'rev-parse', 'HEAD'], text=True).strip()
        self.run['test_code_paths'] = ['tests']
        self.run['progress'][0]['binding'] = {'cases': [{'path': 'tests/shared.py', 'revision': revision}]}
        self.run['progress'].append({'scenario_id': 'B', 'phase': 'preparing', 'attempt': 1})
        # Keep the result ledger outside the product inventory in this fixture.
        (self.project / '.git/info/exclude').write_text('ledger/\n')
        save(self.folder / 'run.json', self.run)
        with patch.object(coverage.execution_coverage, 'summarize', return_value={'subjects': [{'status': 'measured'}], 'measured_scenario_ids': ['A']}) as verify:
            self.get(); self.wait_idle()
            before = coverage.signature(self.project, self.ledger, self.folder, self.run, self.document)
            self.run['updated_at'] = 'later'
            self.run['progress'][1].update(phase='executing', attempt=4, binding={'cases': [{'path': 'tests/new.py'}]})
            self.run['results'] = [{'scenario_id': 'B', 'evidence': ['new-proof.log']}]
            self.run['attempt_history'] = [{'scenario_id': 'B', 'observation': {'evidence': ['old-proof.log']}}]
            self.document['receipts'].append({'scenario_id': 'B', 'raw_evidence': {'path': 'new-proof.log'}})
            case.write_text('later test edits use a different version')
            (self.project / 'tests/new.py').write_text('new case')
            (self.folder / 'new-proof.log').write_text('still running')
            save(self.folder / 'run.json', self.run); save(self.folder / coverage.execution_coverage.NAME, self.document)
            self.assertEqual(before, coverage.signature(self.project, self.ledger, self.folder, self.run, self.document))
            result = self.get()
            self.assertEqual(result['verification_state'], 'ready')
            self.assertEqual(result['measured_scenario_ids'], ['A'])
            self.assertEqual(verify.call_count, 1)
            self.assertTrue(any(r['scenario_id'] == 'B' and r['status'] == 'missing' for r in result['collection']))

    def test_large_test_allowlist_preserves_path_boundaries_and_product_invalidation(self):
        subprocess.run(['git', '-C', str(self.project), 'init', '-q'], check=True, capture_output=True)
        (self.project / '.git/info/exclude').write_text('ledger/\n')
        self.run['test_code_paths'] = ['tests'] + [f'test-suite-{n}' for n in range(63)]
        (self.project / 'tests').mkdir()
        (self.project / 'tests-backup').mkdir()
        test = self.project / 'tests' / 'case.py'; test.write_text('test one')
        product = self.project / 'tests-backup' / 'product.py'; product.write_text('product one')
        before = coverage.signature(self.project, self.ledger, self.folder, self.run, self.document)
        test.write_text('test edit unrelated to completed frozen cases')
        self.assertEqual(before, coverage.signature(self.project, self.ledger, self.folder, self.run, self.document))
        product.write_text('product changed')
        self.assertNotEqual(before, coverage.signature(self.project, self.ledger, self.folder, self.run, self.document))

    def test_new_completed_scene_keeps_verified_subset_until_new_counters_are_ready(self):
        self.run['progress'].append({'scenario_id': 'B', 'phase': 'executing'})
        save(self.folder / 'run.json', self.run)
        entered, release = Event(), Event()
        def verify(project, ledger, folder, run, document):
            ids = [p['scenario_id'] for p in run['progress'] if p['phase'] == 'completed']
            if 'B' in ids:
                entered.set(); release.wait(3)
            return {'subjects': [{'status': 'measured', 'metrics': {'lines': {'covered': len(ids), 'total': 10}}}], 'measured_scenario_ids': ids}
        with patch.object(coverage.execution_coverage, 'summarize', side_effect=verify):
            self.addCleanup(release.set)
            self.get(); self.wait_idle()
            self.assertEqual(self.get()['subjects'][0]['metrics']['lines']['covered'], 1)
            self.run['progress'][1]['phase'] = 'completed'; save(self.folder / 'run.json', self.run)
            result = self.get(); self.assertTrue(entered.wait(1))
            self.assertEqual(result['verification_state'], 'updating')
            self.assertEqual(result['subjects'][0]['metrics']['lines']['covered'], 1)
            self.assertIn('尚未计入', result['verification_reason'])
            release.set(); self.wait_idle()
            self.assertEqual(self.get()['subjects'][0]['metrics']['lines']['covered'], 2)

    def test_background_job_ignores_live_phase_writes_but_rejects_contributor_repair(self):
        self.run['progress'].append({'scenario_id': 'B', 'phase': 'preparing'})
        save(self.folder / 'run.json', self.run)
        for contributor_change in (False, True):
            with self.subTest(contributor_change=contributor_change):
                self.cache = coverage.CoverageCache()
                entered, release = Event(), Event()
                def verify(*args):
                    entered.set(); release.wait(3)
                    return {'subjects': [{'status': 'measured'}]}
                with patch.object(coverage.execution_coverage, 'summarize', side_effect=verify):
                    self.addCleanup(release.set)
                    self.get(); self.assertTrue(entered.wait(1))
                    current = json.loads((self.folder / 'run.json').read_text())
                    current['progress'][1]['phase'] = 'executing'
                    if contributor_change:
                        current['progress'][0]['phase'] = 'preparing'
                    save(self.folder / 'run.json', current)
                    release.set(); self.wait_idle()
                    entry = self.cache.entries[str(self.folder)]
                    self.assertEqual('result' in entry, not contributor_change)

    def test_rolled_back_contributor_or_changed_product_never_retains_percentages(self):
        for changed in ('contributor', 'product', 'scope'):
            with self.subTest(changed=changed):
                self.cache = coverage.CoverageCache()
                self.run['progress'][0]['phase'] = 'completed'; save(self.folder / 'run.json', self.run)
                save(self.ledger / 'project.json', {'coverage_subjects': []})
                subprocess.run(['git', '-C', str(self.project), 'init', '-q'], check=True, capture_output=True)
                product = self.project / 'product.py'; product.write_text('version one')
                with patch.object(coverage.execution_coverage, 'summarize', return_value={'subjects': [{'status': 'measured'}]}):
                    self.get(); self.wait_idle()
                if changed == 'contributor':
                    self.run['progress'][0]['phase'] = 'preparing'; save(self.folder / 'run.json', self.run)
                elif changed == 'product':
                    product.write_text('version two')
                else:
                    save(self.ledger / 'project.json', {'coverage_subjects': [{'scope': 'different'}]})
                release = Event()
                def verify(*args):
                    release.wait(3); return {'subjects': []}
                with patch.object(coverage.execution_coverage, 'summarize', side_effect=verify):
                    self.addCleanup(release.set)
                    result = self.get()
                    self.assertEqual(result['subjects'], [])
                    self.assertEqual(result['verification_state'], 'pending')
                    release.set(); self.wait_idle()


class LiveLedgerResponseTest(unittest.TestCase):
    def test_overlapping_refreshes_share_one_read_but_next_refresh_reads_again(self):
        fixture = fixture_module.LedgerViewerTest(); fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        ledger = VIEWER.Ledger(fixture.root, fixture.selected, background_coverage=True)
        entered, release = Event(), Event()
        responses = []
        def slow():
            entered.set(); release.wait(3)
            return {'loaded_at': 'one consistent reading'}
        with patch.object(ledger, '_snapshot', side_effect=slow) as read:
            self.addCleanup(release.set)
            threads = [Thread(target=lambda: responses.append(ledger.snapshot())) for _ in range(3)]
            threads[0].start(); self.assertTrue(entered.wait(1))
            threads[1].start(); threads[2].start()
            time.sleep(.05)
            release.set()
            for thread in threads: thread.join(2); self.assertFalse(thread.is_alive())
            self.assertEqual(read.call_count, 1)
            self.assertEqual(len(responses), 3)
            self.assertTrue(all(v == responses[0] for v in responses))
            ledger.snapshot()
            self.assertEqual(read.call_count, 2)

    def test_live_reader_skips_stale_coverage_and_defers_artifact_inventory(self):
        fixture = fixture_module.LedgerViewerTest(); fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        folder = fixture.assets / 'runs' / 'old'
        save(folder / 'run.json', {'coverage_policy': {'mode': 'required'}, 'lifecycle': 'completed',
                                  'ledger_hashes': {name: 'outdated' for name in VIEWER.RUN_HASH_FILES}})
        ledger = VIEWER.Ledger(fixture.root, fixture.selected, background_coverage=True)
        with patch.object(ledger.coverage_cache, 'get', side_effect=AssertionError('stale verification must not run')):
            with patch.object(ledger, 'artifacts', side_effect=AssertionError('inventory must be requested separately')):
                data = ledger.snapshot()
        self.assertEqual(data['runs'][0]['ledger_match'], 'stale')
        self.assertEqual(data['runs'][0]['execution_coverage']['verification_state'], 'stale')
        self.assertEqual(data['runs'][0]['execution_coverage']['subjects'], [])
        self.assertTrue(data['artifacts']['deferred'])
        self.assertEqual(data['artifacts']['files'], [])
        # Direct evidence inventory remains available and applies its normal guards.
        (folder / 'proof.txt').write_text('actual evidence')
        self.assertIn('runs/old/proof.txt', [v['path'] for v in ledger.artifacts('old')['files']])

    def test_api_returns_execution_progress_while_verifier_is_blocked(self):
        fixture = fixture_module.LedgerViewerTest(); fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        folder = fixture.assets / 'runs' / 'live'
        save(folder / 'run.json', {'coverage_policy': {'mode': 'required'}, 'lifecycle': 'running',
                                  'progress': [{'scenario_id': 'BB-1', 'phase': 'executing'}]})
        ledger = VIEWER.Ledger(fixture.root, fixture.selected, background_coverage=True)
        server = ThreadingHTTPServer(('127.0.0.1', 0), VIEWER.handler_for(ledger))
        Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close); self.addCleanup(server.shutdown)
        before = {str(p): p.read_bytes() for p in fixture.assets.rglob('*') if p.is_file()}
        release = Event()
        def slow(*args):
            release.wait(3)
            return {'projects': [], 'subjects': []}
        with patch.object(coverage.execution_coverage, 'summarize', side_effect=slow):
            self.addCleanup(release.set)
            conn = HTTPConnection(*server.server_address, timeout=2)
            started = time.monotonic(); conn.request('GET', '/api/ledger')
            response = conn.getresponse(); data = json.loads(response.read()); conn.close()
            self.assertEqual(response.status, 200)
            self.assertLess(time.monotonic() - started, 2)
            self.assertEqual(data['runs'][0]['documents']['run.json']['progress'][0]['phase'], 'executing')
            self.assertEqual(data['runs'][0]['execution_coverage']['verification_state'], 'pending')
            release.set()
            deadline = time.monotonic() + 3
            while ledger.coverage_cache.entries[str(folder.resolve())]['working'] and time.monotonic() < deadline:
                time.sleep(.01)
        after = {str(p): p.read_bytes() for p in fixture.assets.rglob('*') if p.is_file()}
        self.assertEqual(before, after)
