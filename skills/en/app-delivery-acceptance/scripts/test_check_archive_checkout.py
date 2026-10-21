import subprocess
import tempfile
import unittest
from pathlib import Path

from check_archive_checkout import check_archive


class ArchiveCheckoutTests(unittest.TestCase):
    def test_ignored_frozen_file_must_be_in_git_index(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            subprocess.run(['git', 'init', '-q', str(root)], check=True)
            (root / '.gitignore').write_text('dist/\n')
            store = root / 'project' / '.acceptance' / 'AT-example'
            frozen = store / 'records' / 'evidence-1' / 'frozen' / 'dist' / 'app.js'
            frozen.parent.mkdir(parents=True)
            frozen.write_text('console.log(1)\n')
            (store / 'manifest.json').write_text('{}\n')
            subprocess.run(['git', 'add', '.gitignore', 'project/.acceptance/AT-example/manifest.json'], cwd=root, check=True)
            result = check_archive(store)
            self.assertEqual(result['status'], 'incomplete')
            self.assertEqual(result['missing_from_index'], [frozen.relative_to(root).as_posix()])
            subprocess.run(['git', 'add', '-f', frozen.relative_to(root).as_posix()], cwd=root, check=True)
            self.assertEqual(check_archive(store)['status'], 'ready')
            frozen.write_text('console.log(2)\n')
            self.assertTrue(check_archive(store)['unstaged_changes'])


if __name__ == '__main__':
    unittest.main()
