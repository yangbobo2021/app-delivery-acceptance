"""Regression checks for the launcher problems found in a full fixture run."""

import json
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


RUNNER = Path(__file__).resolve().parents[1] / "scripts" / "run_workflow.py"


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = self.root / "app"
        self.project.mkdir()
        self.requirements = self.project / "requirements.json"
        self.requirements.write_text('{"source":"fixture","version":"1","items":[{"id":"R1","text":"works"}]}')
        subprocess.run(["git", "init", "-q", str(self.project)], check=True)

    def launch(self, env=None, stage=None, test_dir="tests", extra=(), cwd=None):
        command = [sys.executable, str(RUNNER), str(self.project), "--requirements", str(self.requirements)]
        if test_dir is not None:
            command += ["--test-dir", str(test_dir)]
        command += list(extra)
        if stage:
            command += ["--stage", stage]
        if env:
            selected = Path(env['PATH'].split(os.pathsep)[0]) / 'playbook'
            if selected.is_relative_to(self.root) and selected.is_file():
                node = selected.parent / 'node'
                real_node = shutil.which('node')
                node.write_text("#!/usr/bin/env python3\nimport os,sys\n" +
                    "target=" + repr(str(selected)) + " if '--with' in sys.argv else " + repr(real_node) + "\n" +
                    "os.execv(target, [target] + sys.argv[1:])\n")
                node.chmod(0o755)
                bootstrap = (
                    "import sys,importlib.util;from pathlib import Path;"
                    "sys.path.insert(0," + repr(str(RUNNER.parent)) + ");"
                    "s=importlib.util.spec_from_file_location('fixture_launcher'," + repr(str(RUNNER)) + ");"
                    "m=importlib.util.module_from_spec(s);s.loader.exec_module(m);"
                    "m.ensure_runtime_modules=lambda:None;"
                    "m.playbook_package=lambda:Path(" + repr(str(selected.parent)) + ");"
                    "sys.argv=[" + repr(str(RUNNER)) + "]+sys.argv[1:];sys.exit(m.main())"
                )
                command = [sys.executable, '-c', bootstrap, *command[2:]]
        return subprocess.run(
            command,
            cwd=cwd or self.project, env=env, capture_output=True, text=True, timeout=90,
        )

    def fake_runtime(self):
        fake_bin = self.root / "storage-bin"
        fake_bin.mkdir()
        runtime = fake_bin / "playbook"
        runtime.write_text(
            "#!/usr/bin/env python3\n"
            "import json, os, sys\n"
            "config = json.load(open(sys.argv[sys.argv.index('--with') + 1]))\n"
            "print(json.dumps({'sessionId': '55555555-5555-4555-8555-555555555555', 'reply': 'ok', 'config': config, 'prompt': sys.argv[-1], 'selection': os.getenv('DELIVERY_ACCEPTANCE_TEST_DIR'), 'cwd': os.getcwd()}))\n"
        )
        runtime.chmod(0o755)
        # The packaged launcher pins its local Playbook CLI instead of resolving
        # a global playbook executable. Intercept only that CLI in this fixture.
        node = fake_bin / "node"
        node.write_text("#!/usr/bin/env python3\nimport os,sys\n" +
            "if '--with' not in sys.argv:\n os.execv(" + repr(shutil.which('node')) + ", [" + repr(shutil.which('node')) + "] + sys.argv[1:])\n" +
            runtime.read_text().split('\n', 1)[1])
        node.chmod(0o755)
        env = os.environ.copy()
        env["PATH"] = f"{fake_bin}{os.pathsep}{env['PATH']}"
        return env

    def test_all_stages_and_resume_receive_artifact_standard(self):
        env = self.fake_runtime()
        for stage in ('black-box', 'white-box', 'acceptance'):
            directory = 'standard-' + stage
            first = self.launch(env, stage=stage, test_dir=directory)
            self.assertEqual(first.returncode, 0, first.stderr)
            output = json.loads(first.stdout)
            self.assertIn('references/output-standards.md', output['prompt'])
            self.assertIn('references/scenario-priority.md', output['prompt'])
            self.assertIn('全部角色', output['prompt'])
            resumed = self.launch(env, stage=stage, test_dir=directory, extra=('--session', output['sessionId']))
            self.assertEqual(resumed.returncode, 0, resumed.stderr)
            self.assertIn('references/output-standards.md', json.loads(resumed.stdout)['prompt'])
            self.assertIn('references/scenario-priority.md', json.loads(resumed.stdout)['prompt'])

    def test_live_policy_is_fixed_across_resume_and_missing_file_is_not_recreated(self):
        env = self.fake_runtime()
        # Acceptance now enables live execution coverage unless the user
        # explicitly opts out.
        first = self.launch(env, stage='acceptance')
        self.assertEqual(first.returncode, 0, first.stderr)
        output = json.loads(first.stdout)
        policy = Path(output['assets']) / 'execution-coverage-policy.json'
        self.assertEqual(json.loads(policy.read_text()), {'mode': 'required'})
        binding = json.loads((policy.parent / 'workflow-sessions.json').read_text())[output['sessionId']]
        self.assertEqual(binding['execution_coverage'], 'required')
        extra = ('--session', output['sessionId'])
        resumed = self.launch(env, stage='acceptance', extra=extra)
        self.assertEqual(resumed.returncode, 0, resumed.stderr)
        self.assertEqual(json.loads(policy.read_text()), {'mode': 'required'})
        refused = self.launch(env, stage='acceptance', extra=extra + ('--execution-coverage', 'off'))
        self.assertEqual(refused.returncode, 2)
        policy.unlink()
        refused = self.launch(env, stage='acceptance', extra=extra)
        self.assertEqual(refused.returncode, 2)
        self.assertIn('policy missing or changed', refused.stderr)
        self.assertFalse(policy.exists())

    def test_language_policy_defaults_to_requirement_and_accepts_explicit_override(self):
        env = self.fake_runtime()
        inherited = self.launch(env, stage='acceptance', test_dir='language-inherited')
        self.assertEqual(inherited.returncode, 0, inherited.stderr)
        inherited_output = json.loads(inherited.stdout)
        inherited_policy = Path(inherited_output['assets']) / 'output-language-policy.json'
        self.assertEqual(json.loads(inherited_policy.read_text()), {'mode': 'requirement'})

        explicit = self.launch(env, stage='acceptance', test_dir='language-explicit', extra=('--language', 'English'))
        self.assertEqual(explicit.returncode, 0, explicit.stderr)
        explicit_output = json.loads(explicit.stdout)
        explicit_policy = Path(explicit_output['assets']) / 'output-language-policy.json'
        self.assertEqual(json.loads(explicit_policy.read_text()), {'mode': 'explicit', 'language': 'English'})

    def test_relative_directory_preserves_existing_tracked_tests(self):
        original_ignore = "# Project rules\nnode_modules/\n"
        (self.project / ".gitignore").write_text(original_ignore)
        existing = self.project / "tests" / "existing_case.py"
        existing.parent.mkdir()
        existing.write_text("# existing project test\n")
        subprocess.run(["git", "-C", str(self.project), "add", ".gitignore", "tests/existing_case.py"], check=True)
        before = subprocess.run(["git", "-C", str(self.project), "status", "--porcelain"], capture_output=True, text=True, check=True).stdout
        selected = "QA results [v1]'"
        result = self.launch(self.fake_runtime(), test_dir=selected, cwd=self.root)
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        assets = (self.project / selected / "delivery-acceptance").resolve()
        self.assertEqual(Path(output["assets"]), assets)
        self.assertEqual(Path(output["selection"]), assets.parent)
        self.assertEqual(output["config"]["playbooks"]["delivery-acceptance"]["testDir"], str(assets.parent))
        self.assertTrue((assets / "workflow-sessions.json").is_file())
        self.assertEqual((self.project / ".gitignore").read_text(), original_ignore)
        after = subprocess.run(["git", "-C", str(self.project), "status", "--porcelain"], capture_output=True, text=True, check=True).stdout
        self.assertEqual(after, before)
        self.assertEqual(existing.read_text(), "# existing project test\n")
        self.assertFalse((self.project / ".delivery-acceptance").exists())

    def test_absolute_directory_and_resume_keep_same_storage(self):
        env = self.fake_runtime()
        selected = self.root / "external results [v2]'"
        result = self.launch(env, test_dir=selected, stage="black-box")
        self.assertEqual(result.returncode, 0, result.stderr)
        first = json.loads(result.stdout)
        self.assertEqual(Path(first["assets"]), (selected / "delivery-acceptance").resolve())
        for role in first["config"]["players"].values():
            grants = role["permissions"]["writablePaths"]
            self.assertEqual(len(grants), 1)
            self.assertFalse(Path(grants[0]).is_absolute())
            self.assertEqual((Path(first["cwd"]) / grants[0]).resolve(), Path(first["assets"]))
        resumed = self.launch(env, test_dir=selected, stage="black-box", extra=("--session", first["sessionId"], "--reply", "continue"))
        self.assertEqual(resumed.returncode, 0, resumed.stderr)
        self.assertEqual(json.loads(resumed.stdout)["assets"], first["assets"])
        wrong = self.launch(env, test_dir="different-tests", stage="black-box", extra=("--session", first["sessionId"]))
        self.assertEqual(wrong.returncode, 2)
        self.assertIn("same --test-dir", wrong.stderr)
        self.assertFalse((self.project / "different-tests").exists())
        wrong_stage = self.launch(env, test_dir=selected, stage="acceptance", extra=("--session", first["sessionId"]))
        self.assertEqual(wrong_stage.returncode, 2)
        self.assertFalse((self.project / "tests").exists())

    def test_selected_asset_symlink_cannot_write_outside_selection(self):
        selected = self.project / "tests"
        selected.mkdir()
        (selected / "delivery-acceptance").symlink_to(self.project / ".git", target_is_directory=True)
        result = self.launch(self.fake_runtime(), test_dir=selected)
        self.assertEqual(result.returncode, 2)
        self.assertIn("outside the selected test directory", result.stderr)
        self.assertFalse((self.project / ".git" / "workflow-sessions.json").exists())

    def test_coverage_enhancement_requires_explicit_selection(self):
        env = self.fake_runtime()
        env["DELIVERY_ACCEPTANCE_COVERAGE_MODE"] = "coverage"
        result = self.launch(env)
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        options = output["config"]["playbooks"]["delivery-acceptance"]
        self.assertEqual(options["coverageMode"], "standard")
        binding = json.loads((Path(output["assets"]) / "workflow-sessions.json").read_text())[output["sessionId"]]
        self.assertEqual(binding["coverage_mode"], "standard")

    def test_enhanced_resume_inherits_mode_and_original_options(self):
        env = self.fake_runtime()
        result = self.launch(env, extra=("--coverage-mode", "coverage"))
        self.assertEqual(result.returncode, 0, result.stderr)
        first = json.loads(result.stdout)
        command = [sys.executable, str(RUNNER), str(self.project), "--test-dir", "tests", "--session", first["sessionId"]]
        resumed = subprocess.run(command, env=env, capture_output=True, text=True)
        self.assertEqual(resumed.returncode, 0, resumed.stderr)
        original = first["config"]["playbooks"]["delivery-acceptance"]
        self.assertEqual(json.loads(resumed.stdout)["config"]["playbooks"]["delivery-acceptance"], original)
        for replacement in ("standard",):
            wrong = subprocess.run(command + ["--coverage-mode", replacement], env=env, capture_output=True, text=True)
            self.assertEqual(wrong.returncode, 2)
            self.assertIn("mode cannot change", wrong.stderr)

    def test_standard_resume_cannot_enable_enhancement(self):
        env = self.fake_runtime()
        result = self.launch(env)
        self.assertEqual(result.returncode, 0, result.stderr)
        sid = json.loads(result.stdout)["sessionId"]
        rejected = self.launch(env, extra=("--session", sid, "--coverage-mode", "coverage"))
        self.assertEqual(rejected.returncode, 2)
        self.assertIn("mode cannot change", rejected.stderr)

    def test_black_box_rejects_enhancement_before_creating_assets(self):
        result = self.launch(stage="black-box", extra=("--coverage-mode", "coverage"))
        self.assertEqual(result.returncode, 2)
        self.assertIn("only to --stage acceptance", result.stderr)
        self.assertFalse((self.project / "tests").exists())

    def test_storage_selection_is_required_before_agent_work(self):
        result = self.launch(test_dir=None)
        self.assertEqual(result.returncode, 2)
        self.assertIn("--test-dir", result.stderr)
        self.assertFalse((self.project / "tests").exists())

    def test_optional_coverage_machine_routes_and_bounds(self):
        probe = RUNNER.parents[1] / "tests" / "workflow_optional_coverage_probe.mjs"
        checked = subprocess.run(["node", str(probe)], capture_output=True, text=True, timeout=30)
        self.assertEqual(checked.returncode, 0, checked.stderr)
        result = json.loads(checked.stdout)
        self.assertEqual(result["status"], "passed")
        self.assertEqual(len(result["probes"]), 8)

    def test_compiled_workflows_relay_selected_directory_to_every_role(self):
        probe = RUNNER.parents[1] / "tests" / "workflow_storage_contract.mjs"
        checked = subprocess.run(["node", str(probe)], capture_output=True, text=True, timeout=30)
        self.assertEqual(checked.returncode, 0, checked.stderr)
        self.assertEqual(json.loads(checked.stdout)["status"], "passed")

    def test_tracked_generated_assets_fail_before_agent_work(self):
        assets = self.project / "tests" / "delivery-acceptance"
        assets.mkdir(parents=True)
        (assets / "scenarios.json").write_text("{}")
        subprocess.run(["git", "-C", str(self.project), "add", "tests/delivery-acceptance/scenarios.json"], check=True)
        result = self.launch()
        self.assertEqual(result.returncode, 2)
        self.assertIn("generated test assets are tracked", result.stderr)

    def test_empty_requirements_fail_with_exact_gap_before_agent_work(self):
        self.requirements.write_text('{"source":"approved","version":"1","items":[]}')
        result = self.launch()
        self.assertEqual(result.returncode, 2)
        self.assertIn("confirmed requirements list is empty", result.stderr)

    def test_duplicate_requirement_ids_fail_before_agent_work(self):
        self.requirements.write_text('{"source":"approved","version":"1","items":[{"id":"R1","text":"first"},{"id":"R1","text":"second"}]}')
        result = self.launch()
        self.assertEqual(result.returncode, 2)
        self.assertIn("duplicate requirement ID: R1", result.stderr)

    def test_invalid_requirements_json_fails_before_agent_work(self):
        self.requirements.write_text('{broken')
        result = self.launch()
        self.assertEqual(result.returncode, 2)
        self.assertIn("not valid UTF-8 JSON", result.stderr)

    def test_nested_workflow_is_rejected(self):
        (self.project / ".gitignore").write_text(".delivery-acceptance/\n")
        env = os.environ.copy()
        env["DELIVERY_ACCEPTANCE_ACTIVE"] = str(self.project)
        result = self.launch(env)
        self.assertEqual(result.returncode, 2)
        self.assertIn("already active", result.stderr)

    def test_launcher_grants_worktree_write_and_sets_recursion_guard(self):
        (self.project / ".gitignore").write_text(".delivery-acceptance/\n")
        fake_bin = self.root / "bin"
        fake_bin.mkdir()
        fake_playbook = fake_bin / "playbook"
        fake_playbook.write_text(
            "#!/usr/bin/env python3\n"
            "import json, os, sys\n"
            "config = json.load(open(sys.argv[sys.argv.index('--with') + 1]))\n"
            "print(json.dumps({'sessionId': '33333333-3333-4333-8333-333333333333', 'reply': 'ok', 'config': config, 'guard': os.getenv('DELIVERY_ACCEPTANCE_ACTIVE')}))\n"
        )
        fake_playbook.chmod(0o755)
        env = os.environ.copy()
        env["PATH"] = f"{fake_bin}{os.pathsep}{env['PATH']}"
        result = self.launch(env)
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual(Path(output["guard"]), self.project.resolve())
        for player in output["config"]["players"].values():
            self.assertEqual(player["permissions"], {"mode": "auto", "writablePaths": ["tests/delivery-acceptance"]})

    def test_black_box_stage_selects_scenario_playbook(self):
        (self.project / ".gitignore").write_text(".delivery-acceptance/\n")
        fake_bin = self.root / "bin"
        fake_bin.mkdir()
        fake_playbook = fake_bin / "playbook"
        fake_playbook.write_text(
            "#!/usr/bin/env python3\n"
            "import json, sys\n"
            "config = json.load(open(sys.argv[sys.argv.index('--with') + 1]))\n"
            "print(json.dumps({'sessionId': '44444444-4444-4444-8444-444444444444', 'reply': 'ok', 'config': config, 'prompt': sys.argv[-1]}))\n"
        )
        fake_playbook.chmod(0o755)
        env = os.environ.copy()
        env["PATH"] = f"{fake_bin}{os.pathsep}{env['PATH']}"
        result = self.launch(env, stage="black-box")
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertIn("black-box-scenarios", output["config"]["playbooks"])
        self.assertEqual(set(output["config"]["playbooks"]["black-box-scenarios"]["roles"]), {"analyst", "reviewer"})
        self.assertIn("/black-box-scenarios", output["prompt"])

    def test_incomplete_reply_uses_exact_terminal_output(self):
        (self.project / ".gitignore").write_text(".delivery-acceptance/\n")
        fake_bin = self.root / "bin"
        fake_bin.mkdir()
        fake_playbook = fake_bin / "playbook"
        fake_playbook.write_text(
            "#!/usr/bin/env python3\n"
            "import json, os\n"
            "from pathlib import Path\n"
            "sid = '11111111-1111-4111-8111-111111111111'\n"
            "path = Path(os.environ['SPEX_HOME']) / 'sessions' / (sid + '.records.jsonl')\n"
            "path.parent.mkdir(parents=True)\n"
            "trace = {'record': {'type': 'captain_telemetry', 'turnId': 1, 'topic': 'playbook.trace', 'payload': {'playbookId': 'delivery-acceptance', 'type': 'boss.input.settled', 'payload': {'terminal': {'kind': 'failure'}, 'output': {'response': 'REQ-1 is TBD; no approved behavior exists.'}}}}}\n"
            "reply = {'record': {'type': 'captain_reply', 'turnId': 1, 'text': 'There were issues.'}}\n"
            "path.write_text(json.dumps(trace) + '\\n' + json.dumps(reply) + '\\n')\n"
            "print('workflow finished')\n"
            "print(json.dumps({'sessionId': sid, 'reply': 'There were issues.'}))\n"
        )
        fake_playbook.chmod(0o755)
        env = os.environ.copy()
        env["PATH"] = f"{fake_bin}{os.pathsep}{env['PATH']}"
        env["SPEX_HOME"] = str(self.root / "spex")
        result = self.launch(env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("workflow finished", result.stdout)
        self.assertIn("REQ-1 is TBD", json.loads(result.stdout.splitlines()[-1])["reply"])

    def test_failed_terminal_without_cli_json_recovers_current_session(self):
        (self.project / ".gitignore").write_text(".delivery-acceptance/\n")
        fake_bin = self.root / "bin"
        fake_bin.mkdir()
        fake_playbook = fake_bin / "playbook"
        fake_playbook.write_text(
            "#!/usr/bin/env python3\n"
            "import json, os, sys\n"
            "from pathlib import Path\n"
            "sid = '22222222-2222-4222-8222-222222222222'\n"
            "path = Path(os.environ['SPEX_HOME']) / 'sessions' / (sid + '.records.jsonl')\n"
            "path.parent.mkdir(parents=True)\n"
            "started = {'record': {'type': 'turn_started', 'turnId': 1, 'turn': {'prompt': sys.argv[-1]}}}\n"
            "trace = {'record': {'type': 'captain_telemetry', 'turnId': 1, 'topic': 'playbook.trace', 'payload': {'playbookId': 'delivery-acceptance', 'type': 'boss.input.settled', 'payload': {'terminal': {'kind': 'failure'}, 'output': {'response': 'Acceptance incomplete. Run: run-1. Failure details: BB-01 failed.'}}}}}\n"
            "reply = {'record': {'type': 'captain_reply', 'turnId': 1, 'text': 'Completed with issues.'}}\n"
            "path.write_text('\\n'.join(json.dumps(x) for x in (started, trace, reply)) + '\\n')\n"
            "print('workflow finished')\n"
        )
        fake_playbook.chmod(0o755)
        env = os.environ.copy()
        env["PATH"] = f"{fake_bin}{os.pathsep}{env['PATH']}"
        env["SPEX_HOME"] = str(self.root / "spex")
        result = self.launch(env)
        self.assertEqual(result.returncode, 0, result.stderr)
        response = json.loads(result.stdout.splitlines()[-1])
        self.assertEqual(response["sessionId"], "22222222-2222-4222-8222-222222222222")
        self.assertEqual(response["reply"], "Acceptance incomplete. Run: run-1. Failure details: BB-01 failed.")

    def test_shared_skill_binds_local_modules_from_installed_runtime(self):
        installed = self.root / "installed-skill"
        shutil.copytree(RUNNER.parents[1], installed, ignore=shutil.ignore_patterns("node_modules", "__pycache__"))
        module_dir = installed / "playbook" / "node_modules"
        self.assertFalse(module_dir.exists())
        spec = importlib.util.spec_from_file_location("isolated_acceptance_runner", installed / "scripts" / "run_workflow.py")
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        runner.ensure_runtime_modules()
        self.assertEqual(json.loads((module_dir / "@sublang" / "playbook" / "package.json").read_text())["version"], "16.0.0")
        self.assertTrue((module_dir / "xstate" / "package.json").is_file())

        shutil.rmtree(module_dir / "xstate")
        (module_dir / "xstate").symlink_to(self.root / "missing-runtime", target_is_directory=True)
        runner.ensure_runtime_modules()
        self.assertTrue((module_dir / "xstate" / "package.json").is_file())

        shutil.rmtree(module_dir / "xstate")
        with patch.object(Path, "symlink_to", side_effect=OSError("symlinks unavailable")):
            runner.ensure_runtime_modules()
        self.assertFalse((module_dir / "xstate").is_symlink())
        self.assertTrue((module_dir / "xstate" / "package.json").is_file())


if __name__ == "__main__":
    unittest.main()
