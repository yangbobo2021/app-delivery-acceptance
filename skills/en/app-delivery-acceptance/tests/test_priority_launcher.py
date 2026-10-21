import json
import unittest
import test_run_workflow as base


class PriorityLauncherTests(unittest.TestCase):
    setUp = base.RunnerTests.setUp
    launch = base.RunnerTests.launch
    fake_runtime = base.RunnerTests.fake_runtime

    def test_explicit_scope_is_saved_and_resume_inherits_without_reset(self):
        env = self.fake_runtime()
        started = self.launch(env, extra=('--max-priority','P1','--time-limit-minutes','20'))
        self.assertEqual(started.returncode,0,started.stderr)
        output = json.loads(started.stdout)
        sid = output['sessionId']
        ledger = self.project/'tests/delivery-acceptance'
        policy = json.loads((ledger/'execution-policy.json').read_text())
        self.assertEqual(policy,{'max_priority':'P1','time_limit_minutes':20})
        binding = json.loads((ledger/'workflow-sessions.json').read_text())[sid]
        self.assertEqual(binding['execution_policy'],policy)
        resumed = self.launch(env, extra=('--session',sid,'--reply','继续'))
        self.assertEqual(resumed.returncode,0,resumed.stderr)
        self.assertEqual(json.loads((ledger/'execution-policy.json').read_text()),policy)
        rejected = self.launch(env, extra=('--session',sid,'--max-priority','P3'))
        self.assertNotEqual(rejected.returncode,0)
        self.assertIn('cannot change',rejected.stderr)
        rejected = self.launch(env, extra=('--session',sid,'--time-limit-minutes','21'))
        self.assertNotEqual(rejected.returncode,0)
        self.assertIn('cannot change',rejected.stderr)

    def test_missing_saved_policy_is_not_silently_recreated(self):
        env = self.fake_runtime()
        started = self.launch(env,extra=('--max-priority','P0'))
        sid=json.loads(started.stdout)['sessionId']
        path=self.project/'tests/delivery-acceptance/execution-policy.json'
        path.unlink()
        resumed=self.launch(env,extra=('--session',sid))
        self.assertNotEqual(resumed.returncode,0)
        self.assertIn('missing',resumed.stderr)
        self.assertFalse(path.exists())

    def test_invalid_budget_and_design_scope_are_rejected_before_start(self):
        for value in ('0','-1','nan','inf'):
            with self.subTest(value=value):
                result=self.launch(extra=('--time-limit-minutes',value))
                self.assertNotEqual(result.returncode,0)
                self.assertIn('finite positive',result.stderr)
        result=self.launch(stage='black-box',extra=('--max-priority','P0'))
        self.assertNotEqual(result.returncode,0)
        self.assertIn('design always covers',result.stderr)
        self.assertFalse((self.project/'tests/delivery-acceptance/execution-policy.json').exists())

    def test_new_session_defaults_to_full_scope_after_a_prior_scoped_session(self):
        env=self.fake_runtime()
        self.assertEqual(self.launch(env,extra=('--max-priority','P0')).returncode,0)
        self.assertEqual(self.launch(env).returncode,0)
        self.assertEqual(json.loads((self.project/'tests/delivery-acceptance/execution-policy.json').read_text()),{'max_priority':'P3','time_limit_minutes':None})


if __name__=='__main__':
    unittest.main()
