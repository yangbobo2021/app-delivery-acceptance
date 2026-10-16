"""Regression: the actual run guard must protect nested component products."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import scenario_execution as execution

class ProductManifestSubmodulesTest(unittest.TestCase):
    def git(self, root, *args):
        return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.DEVNULL)

    def commit(self, root):
        self.git(root, 'add', '.')
        self.git(root, '-c', 'user.name=Fixture', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture')

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'parent'
        self.child = self.root / 'client'
        self.nested = self.child / 'nested'
        self.nested.mkdir(parents=True)
        for repo in (self.root, self.child, self.nested):
            self.git(repo, 'init', '-q')
            (repo / 'product.ts').write_text('original\n')
            (repo / 'product.test.ts').write_text('test\n')
        for repo in (self.nested, self.child, self.root):
            self.commit(repo)
        self.ledger = Path(self.tmp.name) / 'ledger'
        self.ledger.mkdir()
        self.paths = ['product.test.ts', 'client/product.test.ts', 'client/nested/product.test.ts']
        execution.atomic_json(self.ledger / 'project.json', {'test_layout': {'paths': self.paths, 'basis': 'Exact colocated test filenames'}})
        self.run = {}
        execution.initialize(self.root, self.ledger, [], self.run)

    def test_actual_initialized_run_rejects_changed_nested_product(self):
        self.assertIn('client/product.ts', self.run['product_manifest'])
        self.assertIn('client/nested/product.ts', self.run['product_manifest'])
        for file in (self.child / 'product.ts', self.nested / 'product.ts'):
            with self.subTest(path=str(file)):
                file.write_text('changed\n')
                with self.assertRaisesRegex(ValueError, 'product files changed'):
                    execution.verify_product(self.root, self.run)
                file.write_text('original\n')
        execution.verify_product(self.root, self.run)

    def test_added_and_deleted_product_rejected(self):
        added = self.child / 'new.ts'
        added.write_text('untracked product\n')
        with self.assertRaises(ValueError):
            execution.verify_product(self.root, self.run)
        added.unlink()
        (self.child / 'product.ts').unlink()
        with self.assertRaises(ValueError):
            execution.verify_product(self.root, self.run)

    def test_test_only_commit_allowed_and_prefix_boundary_preserved(self):
        (self.child / 'product.test.ts').write_text('new test\n')
        self.commit(self.child)
        execution.verify_product(self.root, self.run)
        (self.child / 'product.test.ts.extra').write_text('not an approved test\n')
        with self.assertRaises(ValueError):
            execution.verify_product(self.root, self.run)

    def test_uninitialized_submodule_fails_closed(self):
        shutil.rmtree(self.child)
        self.child.mkdir()
        with self.assertRaisesRegex(ValueError, 'submodule must be initialized'):
            execution.verify_product(self.root, self.run)

    def test_legacy_missing_manifest_is_not_silently_upgraded(self):
        self.run['product_manifest'] = {'client': 'missing'}
        with self.assertRaises(ValueError):
            execution.verify_product(self.root, self.run)

if __name__ == '__main__':
    unittest.main()
