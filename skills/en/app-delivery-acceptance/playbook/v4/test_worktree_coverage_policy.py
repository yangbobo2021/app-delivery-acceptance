"""Coverage policies are isolated for separate acceptance worktrees."""
from pathlib import Path
import subprocess
import tempfile
import unittest

from coverage_registry import project_policy_path as current_policy_path
from legacy_coverage_registry import project_policy_path as legacy_policy_path


class WorktreeCoveragePolicyTest(unittest.TestCase):
    def test_sibling_worktrees_have_distinct_policy_paths(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            repo = base / 'repo'
            repo.mkdir()
            subprocess.run(['git', 'init', '-q', str(repo)], check=True)
            subprocess.run(['git', '-C', str(repo), 'config', 'user.name', 'Test'], check=True)
            subprocess.run(['git', '-C', str(repo), 'config', 'user.email', 'test@example.invalid'], check=True)
            (repo / 'README').write_text('baseline\n')
            subprocess.run(['git', '-C', str(repo), 'add', 'README'], check=True)
            subprocess.run(['git', '-C', str(repo), 'commit', '-qm', 'baseline'], check=True)
            first, second = base / 'first', base / 'second'
            for worktree in (first, second):
                subprocess.run(['git', '-C', str(repo), 'worktree', 'add', '-q', '--detach', str(worktree)], check=True)
            for policy_path in (current_policy_path, legacy_policy_path):
                paths = [policy_path(worktree) for worktree in (first, second)]
                self.assertEqual(len(set(paths)), 2)
                for worktree, path in zip((first, second), paths):
                    self.assertEqual(path.parent, Path(subprocess.check_output(
                        ['git', '-C', str(worktree), 'rev-parse', '--absolute-git-dir'], text=True).strip()))


if __name__ == '__main__':
    unittest.main()
