import unittest
from coverage_collection_check import check_collection

class CoverageLifecycleTest(unittest.TestCase):
    def test_assertion_failure_does_not_invalidate_real_counters(self):
        result=check_collection('1 failed\nError: expect(received).toBe(expected)\naccepted risk', 'receipt')
        self.assertEqual(result['status'],'no_observed_collector_error')

    def test_collector_teardown_failure_remains_explicit(self):
        for name in ['browser','coverageRuntime']:
            result=check_collection(f'Fixture "{name}" timeout of 30000ms exceeded during teardown.', 'receipt')
            self.assertEqual(result['status'],'incomplete')
            self.assertTrue(result['limitations'])

    def test_forced_worker_shutdown_is_not_a_complete_collection(self):
        result=check_collection('Error: worker-0 process did not exit within 300000ms after stop, force-killed it','receipt')
        self.assertEqual(result['status'],'incomplete')
        self.assertTrue(result['limitations'])

if __name__=='__main__':unittest.main()
