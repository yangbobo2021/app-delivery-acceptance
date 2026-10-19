"""A verified runtime Agent result is the catalog and scene environment binding."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from acceptance_store import initialize, read_knowledge
from acceptance_workspace import verify_frozen_workspace
from runtime_preparation import prepare as prepare_runtime
from prepare_project import prepare as prepare_catalog


class RuntimeCatalogTests(unittest.TestCase):
    def test_catalog_rejects_stale_runtime_and_retains_binding(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "project"
            root.mkdir()
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            for key, value in (("user.email", "fixture@example.test"), ("user.name", "Fixture")):
                subprocess.run(["git", "config", key, value], cwd=root, check=True)
            (root / "deps.txt").write_text("fixture\n")
            (root / "app.py").write_text("print('ready')\n")
            subprocess.run(["git", "add", "deps.txt", "app.py"], cwd=root, check=True)
            subprocess.run(["git", "commit", "-qm", "fixture"], cwd=root, check=True)
            revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
            aid = "AT-runtime-catalog-fixture"
            initialize(root, aid, "Runtime catalog", "Fixture", {"purpose": "binding"}, "test")
            binding = read_knowledge(root, aid, [])["acceptance"]
            flows = root / ".acceptance-local" / aid / "workflows"
            flows.mkdir()
            runtime_spec = flows / "runtime-spec.json"
            runtime_spec.write_text(json.dumps({"schema": "project-runtime-spec-v1", "acceptance": binding,
                "source_checkout": str(root), "revision": revision, "dependency_files": ["deps.txt"],
                "knowledge_used": ["INDEX.md"], "recipe_candidate": "Recreate the fixture runtime.",
                "setup_commands": [], "executables": [{"name": "python", "path": sys.executable,
                "version_command": [sys.executable, "--version"]}],
                "smoke": {"command": [sys.executable, "app.py"]}}))
            checked = prepare_runtime(runtime_spec, flows / "runtime-1")
            catalog_spec = {"schema": "portable-project-prep-v1", "preparation_protocol": "two-agent-v1",
                "acceptance": binding, "project_root": str(root), "source_checkout": str(root),
                "revision": revision, "runtime": {"manifest": checked["runtime_manifest"],
                "sha256": checked["runtime_sha256"]}, "source_paths": ["app.py"], "test_roots": []}
            spec_path = flows / "catalog-spec.json"
            spec_path.write_text(json.dumps(catalog_spec))
            output = flows / "catalog-1"
            prepare_catalog(spec_path, output, catalog_spec, spec_path.read_bytes())
            catalog = json.loads((output / "catalog.json").read_text())
            self.assertEqual(catalog["runtime"], catalog_spec["runtime"])
            verify_frozen_workspace(catalog_spec, catalog)
            workspace = root / ".acceptance-local" / aid / "workspace"
            (workspace / "deps.txt").write_text("stale\n")
            with self.assertRaisesRegex(ValueError, "runtime dependency changed"):
                verify_frozen_workspace(catalog_spec, catalog)


if __name__ == "__main__":
    unittest.main()
