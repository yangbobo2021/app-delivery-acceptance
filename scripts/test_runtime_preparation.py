import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from acceptance_store import initialize, read_knowledge
from runtime_preparation import bootstrap, prepare, validate_runtime


class RuntimePreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "project"
        self.root.mkdir()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        subprocess.run(["git", "config", "user.email", "fixture@example.test"], cwd=self.root, check=True)
        subprocess.run(["git", "config", "user.name", "Fixture"], cwd=self.root, check=True)
        (self.root / "requirements.txt").write_text("# fixture dependencies\n")
        (self.root / "sample.py").write_text("print('ready')\n")
        subprocess.run(["git", "add", "requirements.txt", "sample.py"], cwd=self.root, check=True)
        subprocess.run(["git", "commit", "-qm", "fixture"], cwd=self.root, check=True)
        self.revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.root, text=True).strip()
        self.aid = "AT-runtime-fixture"
        initialize(self.root, self.aid, "Runtime fixture", "Fixture", {"target": "runtime"}, "test")
        self.binding = read_knowledge(self.root, self.aid, [])["acceptance"]
        self.output = self.root / ".acceptance-local" / self.aid / "workflows" / "runtime-1"
        self.spec = self.root / ".acceptance-local" / self.aid / "runtime-spec.json"
        self.spec.write_text(json.dumps({
            "schema": "project-runtime-spec-v1", "acceptance": self.binding,
            "source_checkout": str(self.root), "revision": self.revision,
            "dependency_files": ["requirements.txt"], "knowledge_used": ["INDEX.md"],
            "recipe_candidate": "Use the repository dependency list and smoke command. Verify after install.",
            "setup_commands": [],
            "executables": [{"name": "python", "path": sys.executable,
                             "version_command": [sys.executable, "--version"]}],
            "smoke": {"command": [sys.executable, "sample.py"]},
        }))

    def test_prepare_verify_and_reject_stale_dependency(self):
        result = prepare(self.spec, self.output)
        self.assertEqual(result["status"], "ready")
        manifest = self.output / "runtime.json"
        self.assertEqual(result["runtime_manifest"], str(manifest.resolve()))
        self.assertEqual(validate_runtime(manifest)["runtime_sha256"], result["runtime_sha256"])
        self.assertTrue((self.output / "smoke.log").is_file())
        self.assertTrue((self.output / "recipe-candidate.md").is_file())
        workspace = self.root / ".acceptance-local" / self.aid / "workspace"
        (workspace / "requirements.txt").write_text("changed\n")
        with self.assertRaisesRegex(ValueError, "dependency changed"):
            validate_runtime(manifest)

    def test_failed_smoke_preserves_first_attempt(self):
        spec = json.loads(self.spec.read_text())
        spec["smoke"] = {"command": [sys.executable, "-c", "raise SystemExit(7)"]}
        self.spec.write_text(json.dumps(spec))
        with self.assertRaisesRegex(ValueError, "did not succeed"):
            prepare(self.spec, self.output)
        self.assertFalse((self.output / "runtime.json").exists())
        self.assertEqual(json.loads((self.output / "failure.json").read_text())["schema"],
                         "project-runtime-failure-v1")
        self.assertTrue((self.output / "smoke.log").is_file())
        with self.assertRaisesRegex(ValueError, "immutable"):
            prepare(self.spec, self.output)

    def test_reject_different_acceptance_binding(self):
        prepare(self.spec, self.output)
        with self.assertRaisesRegex(ValueError, "another acceptance"):
            validate_runtime(self.output / "runtime.json",
                             expected_acceptance={**self.binding, "id": "AT-other"})

    def test_agent_bootstrap_then_nested_runtime_and_receipt_integrity(self):
        request = self.root / ".acceptance-local" / self.aid / "agent-request.json"
        request.write_text(json.dumps({"schema": "project-runtime-agent-request-v1",
                                       "acceptance": self.binding, "source_checkout": str(self.root),
                                       "revision": self.revision}))
        result = bootstrap(request, self.output)
        self.assertEqual(result["revision"], self.revision)
        self.output.mkdir(parents=True)
        nested = self.output / "runtime"
        prepare(self.spec, nested)
        (nested / "smoke.log").write_text("tampered\n")
        with self.assertRaisesRegex(ValueError, "receipt/log changed"):
            validate_runtime(nested / "runtime.json")


if __name__ == "__main__":
    unittest.main()
