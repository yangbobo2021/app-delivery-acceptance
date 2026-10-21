import copy
import json
import unittest
from unittest.mock import patch
from test_live_coverage_policy import LiveCoveragePolicyTest
import execution_coverage as coverage

class SameRootEmptySubjectTest(unittest.TestCase):
    def setUp(self):
        self.fixture = LiveCoveragePolicyTest()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.f = self.fixture.f
        self.item = copy.deepcopy(self.fixture.item)
        self.subjects = [
            {'project_id': 'booking', 'project_root': str(self.f.project), 'revision': self.item['revision']},
            {'project_id': 'admin', 'project_root': str(self.f.project), 'revision': self.item['revision']}
        ]
    def errors(self, inventories):
        p = self.f.ledger / 'project.json'
        obj = json.loads(p.read_text()); obj['coverage_subjects'] = self.subjects; p.write_text(json.dumps(obj))
        with patch.object(coverage.coverage_subjects, 'subject', side_effect=lambda s: inventories[s['project_id']]):
            return coverage.collection_errors(self.f.project, self.f.folder, self.f.run, {'coverage_collection': {'projects': [self.item]}}, {})
    def test_same_root_empty_peer_keeps_valid_identity(self):
        self.assertEqual([], self.errors({'booking': {'booking.py': {1}}, 'admin': {}}))
    def test_wrong_component_id_still_rejected(self):
        self.item['project_id'] = 'invented'
        self.assertTrue(self.errors({'booking': {'booking.py': {1}}, 'admin': {}}))
    def test_wrong_peer_revision_still_rejected(self):
        self.subjects[1]['revision'] = '0' * 40
        self.assertTrue(self.errors({'booking': {'booking.py': {1}}, 'admin': {}}))
    def test_executable_peer_cannot_be_silently_ignored(self):
        self.assertTrue(self.errors({'booking': {'booking.py': {1}}, 'admin': {'admin.py': {1}}}))
    def test_missing_primary_source_still_rejected(self):
        self.assertTrue(self.errors({'booking': {'booking.py': {1}, 'other.py': {1}}, 'admin': {}}))
