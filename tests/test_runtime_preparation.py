"""Exercise install/reuse, interrupted installation, and concurrent callers without network."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(os.name == 'posix' and shutil.which('node') and shutil.which('npm'), 'requires Node/npm on macOS or Linux')
class RuntimePreparationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.skill = root / 'skill'
        (self.skill / 'scripts').mkdir(parents=True)
        self.package = self.skill / 'playbook'
        self.package.mkdir()
        shutil.copyfile(ROOT / 'scripts/ensure_runtime.py', self.skill / 'scripts/ensure_runtime.py')
        (self.package / 'package.json').write_text('{"private":true}')
        (self.package / 'package-lock.json').write_text('{"lockfileVersion":3}')
        (self.package / 'verify-runtime.mjs').write_text(
            "import fs from 'node:fs'; if (!fs.existsSync('node_modules/ready')) process.exit(1); console.log('{}');\n")
        binaries = root / 'bin'
        binaries.mkdir()
        npm = binaries / 'npm'
        npm.write_text(f'#!{sys.executable}\n' + '''import json,os,pathlib,sys,time
if sys.argv[1:] == ['--version']:
    print('10.9.9'); sys.exit(0)
assert sys.argv[1] == 'ci'
assert '--global=false' in sys.argv
assert 'npm_config_prefix' not in os.environ
root=pathlib.Path(sys.argv[sys.argv.index('--prefix')+1])
with (root/'calls').open('a') as f: f.write('ci\\n')
time.sleep(0.2)
if os.environ.get('FAIL_TEST_INSTALL'): sys.exit(17)
(root/'node_modules').mkdir(exist_ok=True)
(root/'node_modules/ready').touch()
''')
        npm.chmod(0o755)
        self.env = {**os.environ, 'PATH': str(binaries) + os.pathsep + os.environ['PATH'],
                    'npm_config_prefix': '/must-not-install-here'}
        self.command = [sys.executable, str(self.skill / 'scripts/ensure_runtime.py')]

    def run_preparation(self, **env):
        return subprocess.run(self.command, cwd=self.temp.name, env={**self.env, **env}, text=True, capture_output=True)

    def test_first_install_then_reuse_without_reinstall(self):
        first = self.run_preparation()
        self.assertEqual(first.returncode, 0, first.stderr)
        a = json.loads(first.stdout)
        receipt = self.package / 'node_modules/.acceptance-runtime.json'
        before = receipt.stat()
        second = self.run_preparation()
        self.assertEqual(second.returncode, 0, second.stderr)
        b = json.loads(second.stdout)
        self.assertEqual((a['status'], b['status']), ('installed', 'reused'))
        self.assertEqual(a['install_id'], b['install_id'])
        self.assertEqual(before.st_mtime_ns, receipt.stat().st_mtime_ns)
        self.assertEqual((self.package / 'calls').read_text(), 'ci\n')

    def test_failed_install_is_not_ready_and_next_call_recovers(self):
        failed = self.run_preparation(FAIL_TEST_INSTALL='1')
        self.assertNotEqual(failed.returncode, 0)
        self.assertFalse((self.package / 'node_modules/.acceptance-runtime.json').exists())
        recovered = self.run_preparation()
        self.assertEqual(recovered.returncode, 0, recovered.stderr)
        self.assertEqual(json.loads(recovered.stdout)['status'], 'installed')

    def test_missing_dependency_is_repaired(self):
        first = self.run_preparation()
        self.assertEqual(first.returncode, 0, first.stderr)
        (self.package / 'node_modules/ready').unlink()
        repaired = self.run_preparation()
        self.assertEqual(repaired.returncode, 0, repaired.stderr)
        self.assertEqual(json.loads(repaired.stdout)['status'], 'installed')
        self.assertNotEqual(json.loads(first.stdout)['install_id'], json.loads(repaired.stdout)['install_id'])

    def test_moved_skill_resolves_its_current_directory(self):
        first = self.run_preparation()
        self.assertEqual(first.returncode, 0, first.stderr)
        moved = Path(self.temp.name) / 'moved-skill'
        self.skill.rename(moved)
        self.skill, self.package = moved, moved / 'playbook'
        self.command = [sys.executable, str(moved / 'scripts/ensure_runtime.py')]
        reused = self.run_preparation()
        self.assertEqual(reused.returncode, 0, reused.stderr)
        self.assertEqual(json.loads(reused.stdout)['status'], 'reused')
        self.assertEqual(Path(json.loads(reused.stdout)['package_root']).resolve(), self.package.resolve())
        self.assertEqual((self.package / 'calls').read_text(), 'ci\n')

    def test_external_module_directory_is_not_modified(self):
        external = Path(self.temp.name) / 'external'
        external.mkdir()
        receipt = external / '.acceptance-runtime.json'
        receipt.write_text('unrelated environment')
        (self.package / 'node_modules').symlink_to(external, target_is_directory=True)
        refused = self.run_preparation()
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(receipt.read_text(), 'unrelated environment')
        self.assertFalse((self.package / 'calls').exists())

    def test_concurrent_calls_install_once(self):
        a = subprocess.Popen(self.command, cwd=self.temp.name, env=self.env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        b = subprocess.Popen(self.command, cwd=self.temp.name, env=self.env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        ao, ae = a.communicate(timeout=30)
        bo, be = b.communicate(timeout=30)
        self.assertEqual(a.returncode, 0, ae)
        self.assertEqual(b.returncode, 0, be)
        self.assertEqual({json.loads(ao)['status'], json.loads(bo)['status']}, {'installed', 'reused'})
        self.assertEqual(json.loads(ao)['install_id'], json.loads(bo)['install_id'])
        self.assertEqual((self.package / 'calls').read_text(), 'ci\n')


if __name__ == '__main__':
    unittest.main()
