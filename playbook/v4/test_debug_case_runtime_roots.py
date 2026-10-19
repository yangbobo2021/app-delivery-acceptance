import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))

from acceptance_store import digest
from debug_case import verified_runtime_root


class RuntimeRootGrantTests(unittest.TestCase):
    def test_verified_manifest_grants_exact_runtime_root_without_resmoke(self):
        with TemporaryDirectory() as temporary:
            manifest = Path(temporary) / 'runtime.json'
            runtime_root = Path(temporary) / 'runtime'
            manifest.write_text(json.dumps({'runtime_root': str(runtime_root)}))
            acceptance = {'project_root': '/project', 'id': 'AT-1', 'scope_sha256': 'scope'}
            catalog = {'acceptance': acceptance,
                       'runtime': {'manifest': str(manifest), 'sha256': digest(manifest)}}
            with patch('runtime_preparation.validate_runtime') as validate:
                self.assertEqual(verified_runtime_root(catalog), runtime_root)
            validate.assert_called_once_with(manifest.resolve(), expected_acceptance=acceptance, resmoke=False)

    def test_changed_manifest_is_rejected_before_grant(self):
        with TemporaryDirectory() as temporary:
            manifest = Path(temporary) / 'runtime.json'
            manifest.write_text('{"runtime_root":"/original"}')
            catalog = {'acceptance': {},
                       'runtime': {'manifest': str(manifest), 'sha256': digest(manifest)}}
            manifest.write_text('{"runtime_root":"/other"}')
            with patch('runtime_preparation.validate_runtime') as validate:
                with self.assertRaisesRegex(ValueError, 'binding changed'):
                    verified_runtime_root(catalog)
            validate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
