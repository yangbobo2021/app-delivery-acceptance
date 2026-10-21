"""Coverage-view ordering only; no project tests or real collection."""
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from coverage_views import summarize


class CoverageOrderTest(unittest.TestCase):
    def row(self, revision, scene, captured=None, displayed='2099-01-01T00:00:00Z'):
        return {'project': {'id': 'fixture', 'revision': revision},
                'scenarios': [{'id': scene}], 'generated_at': displayed,
                'coverage': {'provider': 'istanbul-source-v1',
                             'istanbul_path': f'/fixture/{revision}/{scene}/istanbul.json',
                             'capture_end': captured}}

    def fake_provider(self, args, **kwargs):
        # Unit-test provider boundary; sorting must not alter returned counters.
        Path(args[-1]).write_text(json.dumps({'scopes': {'project': {
            'line': {'total': 10, 'covered': 4, 'pct': 40},
            'branch': {'total': 8, 'covered': 2, 'pct': 25}}},
            'tools': {'instrumenter': {'name': 'fixture', 'version': '1'},
                      'statistics': {'name': 'fixture', 'version': '1'}}}))
        return SimpleNamespace(returncode=0)

    def test_latest_actual_collection_per_revision_not_projection_or_input_order(self):
        rows = [self.row('older', 'A', '2026-10-18T12:00:00+08:00'),
                self.row('unknown', 'X'),
                self.row('newest', 'B', '2026-10-17T23:00:00Z'),
                self.row('newest', 'C', '2026-10-18T05:00:00Z', '2000-01-01T00:00:00Z'),
                self.row('newest', 'C', '2026-10-17T22:00:00Z')]
        with patch('coverage_views.subprocess.run', side_effect=self.fake_provider):
            result = summarize(rows)
        self.assertEqual([r['revision'] for r in result], ['newest', 'older', 'unknown'])
        self.assertEqual(result[0]['last_capture_at'], '2026-10-18T05:00:00+00:00')
        self.assertEqual(result[0]['scenes_with_coverage'], 2)
        self.assertIsNone(result[-1]['last_capture_at'])
        self.assertTrue(all(r['scopes']['project']['line']['covered'] == 4 for r in result))

    def test_missing_invalid_or_timezone_free_dates_are_not_guessed(self):
        rows = [self.row('missing', 'A'), self.row('invalid', 'B', 'not-a-date'),
                self.row('naive', 'C', '2026-10-18T23:00:00'),
                self.row('known', 'D', '2026-10-01T00:00:00Z')]
        with patch('coverage_views.subprocess.run', side_effect=self.fake_provider):
            result = summarize(rows)
        self.assertEqual(result[0]['revision'], 'known')
        self.assertTrue(all(r['last_capture_at'] is None for r in result[1:]))


if __name__ == '__main__':
    unittest.main()
