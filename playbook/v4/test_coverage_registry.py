import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from legacy_coverage_registry import ensure_active,project_coverage
from unittest.mock import patch

class CoverageRegistryTest(unittest.TestCase):
    def test_active_profile_and_scope_cannot_be_silently_replaced(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);inventory=root/'inventory.json';inventory.write_text('{}')
            registry=root/'index.json';prepared=root/'prepared.json'
            prepared.write_text(json.dumps({'spec':{'registry_path':str(registry),'inventory_path':str(inventory)}}))
            registry.write_text(json.dumps({'active_profile':hashlib.sha256(prepared.read_bytes()).hexdigest(),
                'active_inventory_sha256':hashlib.sha256(inventory.read_bytes()).hexdigest()}))
            ensure_active(root)
            inventory.write_text('{"changed":true}')
            with self.assertRaisesRegex(ValueError,'inventory changed'):ensure_active(root)
            inventory.write_text('{}');prepared.write_text(prepared.read_text()+' ')
            with self.assertRaisesRegex(ValueError,'profile is not active'):ensure_active(root)

    def test_javascript_provider_cannot_accept_other_language_units(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            (root/'prepared.json').write_text(json.dumps({'files':{'source.py':{}},'spec':{}}))
            with self.assertRaisesRegex(ValueError,'another language'):ensure_active(root)

    def test_project_policy_is_inherited_and_cannot_be_downgraded_by_old_templates(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);prepared=root/'prepared';prepared.mkdir();(prepared/'prepared.json').write_text('{}')
            policy=root/'policy.json';coverage={'policy':'required','provider':'istanbul-source-v1','prepared':str(prepared),'inventory_path':'frozen.json'}
            policy.write_text(json.dumps({'coverage':coverage,'revision':'frozen','prepared_sha256':hashlib.sha256((prepared/'prepared.json').read_bytes()).hexdigest()}))
            with patch('legacy_coverage_registry.project_policy_path',return_value=policy),patch('legacy_coverage_registry._git',return_value='frozen'):
                self.assertEqual(project_coverage(root),coverage)
                with self.assertRaisesRegex(ValueError,'downgrade'):project_coverage(root,{'policy':'unavailable'})
                with self.assertRaisesRegex(ValueError,'active project'):project_coverage(root,{**coverage,'prepared':'old'})
            with patch('legacy_coverage_registry.project_policy_path',return_value=policy),patch('legacy_coverage_registry._git',return_value='new-revision'):
                with self.assertRaisesRegex(ValueError,'this revision'):project_coverage(root)

if __name__=='__main__':unittest.main()
