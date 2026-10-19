from pathlib import Path
import tempfile
import unittest

from scene_pipeline import execution_evidence_roots


class ExecutionEvidenceRootsTest(unittest.TestCase):
    def test_project_declared_output_is_inside_frozen_execution(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'execution'
            ui = root / 'ui'
            ui.mkdir(parents=True)
            self.assertEqual(execution_evidence_roots(root, ['ui']), [ui.resolve()])
            with self.assertRaisesRegex(ValueError, 'relative'):
                execution_evidence_roots(root, [str(ui)])
            with self.assertRaisesRegex(ValueError, 'outside'):
                execution_evidence_roots(root, ['../outside'])
            (root / 'escape').symlink_to(Path(folder))
            with self.assertRaisesRegex(ValueError, 'outside'):
                execution_evidence_roots(root, ['escape'])


if __name__ == '__main__':
    unittest.main()
