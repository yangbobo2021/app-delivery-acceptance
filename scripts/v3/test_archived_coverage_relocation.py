import hashlib
from pathlib import Path
import tempfile
import unittest

from project_view import registered_artifact_path


class ArchivedCoverageRelocationTests(unittest.TestCase):
    def test_archive_wins_over_old_live_checkout_and_detects_changes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            local = root / '.acceptance-local' / 'AT-1'
            shared = root / '.acceptance' / 'AT-1'
            live = root / 'old-checkout' / 'coverage-report.json'
            archived = shared / 'records' / 'evidence-1' / 'coverage-report.json'
            live.parent.mkdir(parents=True)
            archived.parent.mkdir(parents=True)
            live.write_text('old live bytes')
            archived.write_text('frozen archive bytes')
            wanted = hashlib.sha256(archived.read_bytes()).hexdigest()
            mapping = {str(live): {'path': str(archived), 'sha256': wanted},
                       str(live) + '#' + wanted: {'path': str(archived), 'sha256': wanted}}
            self.assertEqual(registered_artifact_path(local, shared, mapping, live, wanted), archived.resolve())
            archived.write_text('changed')
            with self.assertRaisesRegex(ValueError, 'archived coverage artifact changed'):
                registered_artifact_path(local, shared, mapping, live, wanted)

    def test_unregistered_external_path_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with self.assertRaisesRegex(ValueError, 'path belongs to another acceptance'):
                registered_artifact_path(root / 'local', root / 'shared', {}, root / 'old' / 'coverage.json')


if __name__ == '__main__':
    unittest.main()
