#!/usr/bin/env python3
"""Resumable, project-neutral single-scene acceptance workflow.

Configuration supplies project-specific paths and commands. This driver knows no
language, app type, or business oracle. A running stage with no receipt is parked
for reconciliation rather than silently replayed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

# Shared project-owned storage and knowledge gate.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from acceptance_store import guard as acceptance_guard
from acceptance_workspace import (POLICY, workspace_path, workspace_lease, ensure_workspace,
                                  verify_frozen_workspace, finish_scene)
import time
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent
ACTIVE_ACCEPTANCE_CONFIG = None


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(path, obj):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def load(path):
    path = Path(path)
    return json.loads(path.read_text()) if path.is_file() else None


def run(argv, cwd=None, env=None, log=None, timeout=None):
    start = time.monotonic()
    result = subprocess.run(argv, cwd=cwd, env=env, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            timeout=timeout, check=False)
    if log:
        Path(log).parent.mkdir(parents=True, exist_ok=True)
        Path(log).write_text(result.stdout)
    return {"argv": argv, "exit_code": result.returncode,
            "seconds": round(time.monotonic() - start, 3),
            "output_tail": result.stdout[-2400:]}


def git(root, *args):
    return subprocess.check_output(["git", *args], cwd=root, text=True).strip()


def stage(state_path, state, name, fn):
    if ACTIVE_ACCEPTANCE_CONFIG is not None:
        acceptance_guard(ACTIVE_ACCEPTANCE_CONFIG, [ACTIVE_ACCEPTANCE_CONFIG["output_dir"]])
    if ACTIVE_ACCEPTANCE_CONFIG is not None:
        catalog_path = Path(ACTIVE_ACCEPTANCE_CONFIG["output_dir"]) / "catalog.json"
        if catalog_path.is_file():
            verify_frozen_workspace(ACTIVE_ACCEPTANCE_CONFIG, load(catalog_path))
    item = state["stages"].get(name)
    if item and item["status"] == "completed":
        return item["result"]
    if item and item["status"] == "running":
        raise RuntimeError(f"{name}: uncertain earlier effect; reconcile before replay")
    if item and item["status"] == "parked":
        raise RuntimeError(f"{name}: parked failure requires inspection or a new frozen attempt")
    recovered_from = item["status"] if item and item["status"] in ("resume_ready", "retry_ready") else None
    interruption_resumes = item.get("agent_interruption_resumes", 0) if item else 0
    state["stages"][name] = {"status": "running", "started_at": datetime.now(timezone.utc).isoformat(),
                             **({"agent_interruption_resumes": interruption_resumes} if interruption_resumes else {}),
                             **({"recovered_from": recovered_from} if recovered_from else {})}
    save(state_path, state)
    try:
        result = fn()
        if ACTIVE_ACCEPTANCE_CONFIG is not None:
            catalog_path = Path(ACTIVE_ACCEPTANCE_CONFIG["output_dir"]) / "catalog.json"
            if catalog_path.is_file():
                verify_frozen_workspace(ACTIVE_ACCEPTANCE_CONFIG, load(catalog_path))
    except Exception as error:
        state["stages"][name]["status"] = "parked"
        state["stages"][name]["error"] = str(error)
        save(state_path, state)
        raise
    state["stages"][name].update(status="completed", result=result,
                                 finished_at=datetime.now(timezone.utc).isoformat())
    save(state_path, state)
    return result


def prepare(config, output):
    source = Path(config["source_checkout"]).resolve()
    template_path = Path(config["template_catalog"]).resolve()
    template = load(template_path)
    if not template or template.get("schema") != "portable-project-catalog-v1":
        raise ValueError("invalid project catalog")
    required_coverage = template.get('coverage', {})
    if required_coverage.get('policy') == 'required':
        configured = config.get('coverage', {})
        if configured.get('policy') != 'required' or any(configured.get(k) != required_coverage.get(k) for k in ['provider','prepared','inventory_path']):
            raise ValueError('Scene cannot downgrade or replace frozen project coverage preparation')
    root = workspace_path(config)
    from coverage_registry import project_coverage
    coverage = project_coverage(source,config.get('coverage',template.get('coverage'))) or {}
    config['coverage']=coverage
    if coverage.get('policy') == 'required':
        if not coverage.get('scene_id') or coverage.get('revision')!=config.get('revision'):
            raise ValueError('Required coverage must be scene-bound; use bind_case with the current project catalog')
        from coverage_protocol import preparation
        coverage_prepared=preparation(coverage)
        if coverage_prepared['spec']['source_hashes'] != template.get('source_hashes'):
            raise ValueError('Coverage preparation differs from frozen project sources')
    revision = config["revision"]
    if template["revision"] != revision or git(source, "rev-parse", "HEAD") != revision:
        raise ValueError("source revision differs from frozen catalog")
    root = ensure_workspace(config, source, revision, template.get("components", []),
                            config.get("component_sources"))
    if Path(template["project_root"]).resolve() != root or template.get("workspace_policy") != POLICY:
        raise ValueError("prepare a new catalog in the single acceptance workspace; preserve old records")
    catalog = dict(template)
    if config.get('definitions'):
        catalog['definitions'] = config['definitions']
    if coverage.get('policy')=='required':catalog['coverage']=coverage
    catalog["project_root"] = str(root)
    catalog["write_roots"] = config.get("allowed_test_roots", template.get("test_roots", []))
    verify_frozen_workspace(config, catalog)
    for name, expected in template.get("binding_files", {}).items():
        path = root / name
        if not path.is_file() or digest(path) != expected:
            raise ValueError("binding file differs: " + name)
    for name, expected in template.get("source_hashes", {}).items():
        path = root / name
        if not path.is_file() or digest(path) != expected:
            raise ValueError("prepared source inventory differs: " + name)
    setup = []
    for marker in template.get("ready_markers", []):
        if not (root / marker["path"]).exists():
            for item in template.get("setup", []):
                if not item.get("command"):
                    continue
                result = run(item["command"], cwd=root, env={**os.environ, **item.get("env", {})},
                             log=output / "setup.log", timeout=300)
                setup.append(result)
                if result["exit_code"]:
                    raise RuntimeError("project setup failed: " + result["output_tail"])
            break
    catalog["ready_markers"] = [
        {"path": item["path"], "exists": (root / item["path"]).exists()}
        for item in template.get("ready_markers", [])
    ]
    if any(not item["exists"] for item in catalog["ready_markers"]):
        raise ValueError("prepared capability marker absent")
    checks = []
    for item in template.get("capability_checks", []):
        result = run(item["command"], cwd=root, env={**os.environ, **item.get("env", {})},
                     timeout=45)
        checks.append(result)
        if result["exit_code"]:
            raise RuntimeError("capability check failed: " + result["output_tail"])
    catalog["setup"] = setup
    catalog["capability_checks"] = checks
    catalog["fingerprint"] = hashlib.sha256(
        (digest(template_path) + str(root) + revision).encode()).hexdigest()
    save(output / "catalog.json", catalog)
    return {"root": str(root), "catalog": str(output / "catalog.json"),
            "setup_seconds": sum(x["seconds"] for x in setup),
            "check_seconds": sum(x["seconds"] for x in checks)}


def collect_files(root, answer, catalog):
    root = Path(root)
    declared = answer.get("test_files", [])
    if not isinstance(declared, list) or not declared:
        raise ValueError("Agent did not declare test files")
    untracked = git(root, "ls-files", "--others", "--exclude-standard").splitlines()
    changed = git(root, "diff", "--name-only", "HEAD").splitlines()
    roots = tuple(x.rstrip("/") + "/" for x in catalog.get("write_roots", []))
    all_names = sorted(set(declared) | set(untracked) | set(changed) |
                       set(catalog.get('coverage_test_files', {})))
    for name in all_names:
        path = (root / name).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError("test artifact missing/outside worktree: " + name)
        if name in set(untracked) | set(changed):
            if not name.startswith(roots):
                raise ValueError("Agent changed a file outside declared test roots: " + name)
    return all_names


def _run_review_attempt(root, input_path, review_dir, log_path):
    """Resume a Reviewer, or restart it once if its read-only session is unusable."""
    from review_decision_correction import completed_review
    existing = completed_review(review_dir, input_path)
    if existing:
        return existing
    review_dir = Path(review_dir)
    command = ["node", str(HERE / "review_case_v3.mjs"),
               str(root), str(input_path), str(review_dir)]
    resuming = review_dir.exists()
    first = run(command + (["--resume"] if resuming else []), log=log_path, timeout=900)
    metrics = load(review_dir / "metrics.json")
    answer = load(review_dir / "answer.json")
    restarted = False
    if resuming and metrics and metrics.get("status") == "error" and metrics.get("resumed_from_session"):
        archive = review_dir.with_name(review_dir.name + "-unresumable-1")
        if archive.exists():
            raise RuntimeError("Reviewer restart limit reached; inspect preserved attempt")
        review_dir.rename(archive)
        restarted = True
        first = run(command, log=log_path, timeout=900)
        metrics = load(review_dir / "metrics.json")
        answer = load(review_dir / "answer.json")
    if first["exit_code"] or not metrics or not answer or metrics.get("status") != "success":
        raise RuntimeError("review Agent incomplete: " + first["output_tail"])
    from decision_gate import validate
    verdict = validate(answer, load(input_path))
    save(review_dir / "decision-gate.json", verdict)
    return {"answer": str(review_dir / "answer.json"),
            "metrics": str(review_dir / "metrics.json"),
            "status": answer.get("status"), "seconds": metrics["seconds"],
            "usage": metrics.get("usage"), "tool_calls": metrics.get("tool_calls"),
            "restarted_after_unavailable_session": restarted}, verdict


def run_independent_review(root, input_path, review_dir, log_path):
    from review_decision_correction import correction_input
    review_dir = Path(review_dir)
    result, verdict = _run_review_attempt(root, input_path, review_dir, log_path)
    if verdict["status"] == "valid":
        return result
    # The host supplies structural feedback, never a replacement judgment.
    correction_path = correction_input(review_dir, input_path, verdict)
    corrected, gate = _run_review_attempt(
        root, correction_path, review_dir.with_name(review_dir.name + "-decision-correction-1"),
        Path(log_path).with_name(Path(log_path).stem + "-decision-correction-1.log"))
    if gate["status"] != "valid":
        raise RuntimeError("independent review correction invalid; bounded limit reached: " + "; ".join(gate["errors"]))
    corrected["decision_correction"] = {"previous_answer": result["answer"],
                                        "input": str(correction_path)}
    return corrected


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("config")
    parser.add_argument("--stop-after", choices=["prepare", "case", "execution", "evidence", "gate"])
    args = parser.parse_args()
    config_path = Path(args.config).resolve()
    config = load(config_path)
    if not config or config.get("schema") != "isolated-scene-pipeline-v1":
        raise ValueError("invalid pipeline config")
    case_input = load(config["case_input"])
    from acceptance_definitions import verify_case, load_binding
    verify_case(case_input or {})
    if case_input.get('definitions') != config.get('definitions'):
        raise ValueError('pipeline and case definitions differ')
    source = case_input.get("scenario_source_path")
    if source and (not Path(source).is_file() or digest(source) != case_input.get("scenario_source_sha256")):
        raise ValueError("scenario source changed; create a new case run")
    reverse = case_input.get("reviewed_reverse_path") or case_input.get("pr_reviewed_reverse_path")
    if reverse and (not Path(reverse).is_file() or digest(reverse) !=
                    (case_input.get("reviewed_reverse_sha256") or case_input.get("pr_reviewed_reverse_sha256"))):
        raise ValueError("reverse analysis changed; create a new case run")
    for item in case_input.get("source_evidence", {}).get("items", []):
        path = Path(config["source_checkout"]).resolve() / item["path"]
        if not path.is_file() or digest(path) != item["sha256"]:
            raise ValueError("white-box source changed: " + item["path"])
    output = Path(config["output_dir"]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    catalog_template = load(config["template_catalog"]) or {}
    scenario_request = (load(Path(source).with_name("request.frozen.json")) if source else None) or {}
    definitions = load_binding(case_input)
    originals = definitions['requirements'] if definitions else scenario_request.get("requirements", {}).get("items", [case_input["requirement"]])
    preview = {"acceptance": config["acceptance"],"progress_schema": "single-agent-scene-v1",
               "project": {"id": catalog_template.get("project_id") or Path(config["source_checkout"]).name,
                           "label": catalog_template.get("project_label") or Path(config["source_checkout"]).name,
                           "root": str(Path(config["source_checkout"]).resolve()),
                           "revision": config["revision"], "sources": catalog_template.get("source_paths", [])},
               "requirements": originals,
               "reverse_rules": (definitions['reverse_rules'] if definitions else [case_input["requirement"]] if case_input["scene"].get("kind") == "WHITE_BOX"
                                 and case_input["requirement"]["id"] not in
                                 {x["id"] for x in originals} else []),
               "scene": case_input["scene"], "case_catalog": [],
               "case_input_path": str(Path(config["case_input"]).resolve()),
               "config_path": str(config_path)}
    if definitions:
        preview['definition_binding_sha256'] = case_input['definition_binding_sha256']
        preview['definitions'] = config['definitions']
    reverse_path = case_input.get("reviewed_reverse_path") or case_input.get("pr_reviewed_reverse_path")
    if reverse_path:
        preview["change"] = (load(reverse_path) or {}).get("change", {})
    elif config.get('coverage', {}).get('inventory_path'):
        preview['change'] = {'inventory': load(config['coverage']['inventory_path'])}
    preview_path = output / "request.frozen.json"
    if preview_path.is_file() and load(preview_path) != preview:
        raise ValueError("progress request changed; create a new run")
    if not preview_path.exists():
        save(preview_path, preview)
    state_path = output / "state.json"
    bindings = {name: digest(Path(config[name]).resolve())
                for name in ("case_input", "guide", "template_catalog")}
    state = load(state_path) or {"schema": "isolated-scene-pipeline-state-v1",
                                  "config_sha256": digest(config_path),
                                  "bindings": bindings, "stages": {}}
    if state["config_sha256"] != digest(config_path):
        raise ValueError("pipeline input changed; create a new run")
    if state.get("bindings") != bindings:
        raise ValueError("case input, guide or catalog changed; create a new run")
    save(state_path, state)
    if (output / "catalog.json").is_file():
        from reconcile_pipeline import recover_interrupted_agent
        verify_frozen_workspace(config, load(output / "catalog.json"))
        recover_interrupted_agent(config, output, state, load(output / "catalog.json"), save)
    from review_decision_correction import recover_parked_review
    recover_parked_review(config, output, state, save)
    if any(item.get("status") == "running" for item in state["stages"].values()):
        from reconcile_pipeline import reconcile
        catalog_path = output / "catalog.json"
        if not catalog_path.is_file():
            raise RuntimeError("prepared catalog absent; cannot reconcile running stage")
        reconcile(config, output, state, load(catalog_path), save)
    prepared = stage(state_path, state, "prepare", lambda: prepare(config, output))
    if args.stop_after == "prepare":
        return
    root = Path(prepared["root"])
    catalog = load(prepared["catalog"])
    case_dir = output / "case"

    def case_step():
        command = ["node", str(HERE / "run_case_guided_v6.mjs"),
                   str(Path(config["case_input"]).resolve()), prepared["catalog"],
                   str(Path(config["guide"]).resolve()), str(case_dir)]
        resuming = case_dir.exists()
        if resuming:
            command.append("--resume")
        result = run(command, log=output / "case-stage.log", timeout=1200)
        metrics = load(case_dir / "metrics.json")
        answer = load(case_dir / "answer.json")
        restarted = False
        if resuming and metrics and metrics.get("status") == "error" and not answer:
            trace = case_dir / "agent.jsonl"
            events = ([json.loads(line) for line in trace.read_text().splitlines() if line.strip()]
                      if trace.is_file() else [])
            no_agent_effect = all(item.get("type") in ("init", "error", "done") for item in events)
            no_checkout_change = not git(root, "status", "--porcelain", "--untracked-files=all")
            if no_agent_effect and no_checkout_change and not load(config["case_input"]).get("local_loopback_required"):
                archive = output / "case-unresumable-1"
                if archive.exists():
                    raise RuntimeError("case Agent restart limit reached")
                case_dir.rename(archive)
                restarted = True
                result = run(command[:-1], log=output / "case-stage.log", timeout=1200)
                metrics = load(case_dir / "metrics.json")
                answer = load(case_dir / "answer.json")
        if result["exit_code"] or not answer or not metrics or metrics.get("status") != "success":
            raise RuntimeError("case Agent incomplete: " + result["output_tail"])
        if metrics.get("invalid_source_change"):
            raise ValueError("case Agent changed product source")
        return {"metrics": str(case_dir / "metrics.json"), "answer": str(case_dir / "answer.json"),
                "seconds": metrics["seconds"], "usage": metrics.get("usage"),
                "tool_calls": metrics.get("tool_calls"),
                "restarted_after_unavailable_session": restarted}

    case = stage(state_path, state, "case", case_step)
    if args.stop_after == "case":
        return
    active_answer_path = case["answer"]
    answer = load(active_answer_path)
    if answer.get("status") == "blocked":
        feedback_path = output / "case-feedback.json"
        save(feedback_path, {"kind": "local_case_blocker",
                             "reason": answer.get("reason"),
                             "observations": answer.get("observations", []),
                             "limitations": answer.get("limitations", []),
                             "previous_case_result": case["answer"],
                             "instruction": "Repair only the test setup or case gap that prevented target checks; preserve valid observations."})
        repair_dir = output / "case-repair"

        def repair_step():
            command = ["node", str(HERE / "repair_case_delta_v3.mjs"),
                       str(Path(config["case_input"]).resolve()), str(feedback_path),
                       prepared["catalog"], str(Path(config["guide"]).resolve()), str(repair_dir)]
            if repair_dir.exists():
                command.append("--resume")
            result = run(command, log=output / "repair-stage.log", timeout=900)
            metrics = load(repair_dir / "metrics.json")
            repaired = load(repair_dir / "answer.json")
            if result["exit_code"] or not metrics or metrics.get("status") != "success" or not repaired:
                raise RuntimeError("case repair incomplete: " + result["output_tail"])
            return {"answer": str(repair_dir / "answer.json"),
                    "metrics": str(repair_dir / "metrics.json"),
                    "seconds": metrics["seconds"], "usage": metrics.get("usage"),
                    "tool_calls": metrics.get("tool_calls")}

        repair = stage(state_path, state, "case_repair", repair_step)
        active_answer_path = repair["answer"]
        answer = load(active_answer_path)
    if answer.get("status") == "blocked" or not answer.get("test_command"):
        raise RuntimeError("case Agent did not produce an executable case")
    files = collect_files(root, answer, catalog)
    execution_name=state.get('execution_attempt_directory','execution')
    if Path(execution_name).name!=execution_name or not execution_name.startswith('execution'):
        raise ValueError('Invalid explicit execution-attempt directory')
    execution_dir = output / execution_name

    def execute_step():
        if execution_dir.exists():
            raise RuntimeError("execution directory exists without completed stage; reconcile first")
        command = ["python3", str(HERE / "run_evidence_v2.py"), "--cwd", str(root),
                   "--output", str(execution_dir)]
        if config.get('coverage', {}).get('policy') == 'required':
            coverage_config = output / 'coverage-execution-config.json'
            save(coverage_config, config['coverage'])
            command += ['--coverage-config', str(coverage_config)]
        for file in files:
            command += ["--file", file]
        business_command=answer['test_command']
        # Case Agents may use the required collector for local debugging, but
        # the host already supplies that collector around the frozen run.
        # Unwrap only our exact, scene/source/file-bound entry, never an arbitrary
        # shell command or a request belonging to another scene/worktree.
        if len(business_command)==3 and Path(business_command[1]).resolve()==(HERE/'run_coverage.py').resolve():
            nested_path=(root/business_command[2]).resolve()
            nested=load(nested_path)
            coverage=config.get('coverage',{})
            if (not nested or Path(nested.get('cwd','')).resolve()!=root or
                nested.get('scene_id')!=load(config['case_input'])['scene']['id'] or
                nested.get('revision')!=config['revision'] or
                Path(nested.get('prepared','')).resolve()!=Path(coverage.get('prepared','')).resolve() or
                set(nested.get('files',[]))!=set(files) or not nested.get('command') or
                any(Path(part).name in {'run_coverage.py','run_evidence_v2.py'} for part in nested['command'])):
                raise ValueError('Nested collector request is not the exact frozen case')
            business_command=nested['command']
            save(output/'execution-command-binding.json',{'declared_command':answer['test_command'],
              'local_debug_request':str(nested_path),'local_debug_request_sha256':digest(nested_path),
              'frozen_business_command':business_command,
              'reason':'Host supplies required collection once; local-debug command was already wrapped. Fresh host env/dirs replace local-debug paths.'})
        env_values = dict(answer.get("test_env", {}))
        fresh_key = config.get("fresh_env_root_key")
        if fresh_key:
            fresh_root = output / ('fresh-'+execution_name)
            command += ["--fresh-dir", str(fresh_root)]
            env_values[fresh_key] = str(fresh_root)
            for key, relative in config.get("fresh_env_paths", {}).items():
                env_values[key] = str(fresh_root / relative)
        for key, value in env_values.items():
            command += ["--env", key + "=" + value]
        command += ["--"] + business_command
        result = run(command, log=output / "execution-stage.log", timeout=600)
        receipt = load(execution_dir / "execution.json")
        if not receipt:
            raise RuntimeError("execution receipt absent: " + result["output_tail"])
        return {"receipt": str(execution_dir / "execution.json"),
                "log": str(execution_dir / "execution.log"),
                "exit_code": receipt["exit_code"],
                "seconds": receipt["duration_seconds"],
                "test_files": files}

    execution = stage(state_path, state, "execution", execute_step)
    if args.stop_after == "execution":
        return
    def evidence_step():
        from coverage_evidence import freeze_coverage, evidence_paths
        roots = [execution_dir]
        receipt = load(execution["receipt"])
        coverage_result, coverage_path = freeze_coverage(config.get("coverage"), root, execution_dir,
                                                         execution["receipt"], output / "coverage-report")
        roots.extend(evidence_paths(coverage_result))
        for key in config.get("evidence_env_dir_keys", []):
            value = receipt.get("env_changes", {}).get(key)
            if value:
                roots.append(Path(value).resolve())
        prefix = config.get("evidence_log_prefix")
        if prefix:
            candidates = [line.split(prefix, 1)[1].strip()
                          for line in Path(execution["log"]).read_text(errors="replace").splitlines()
                          if prefix in line]
            if not candidates:
                raise ValueError("frozen log lacks evidence location prefix")
            roots.append(Path(candidates[-1]).resolve())
        execution_start = datetime.fromisoformat(receipt["start_utc"]).timestamp()
        for declared in answer.get("evidence_paths", []):
            path = Path(declared).resolve()
            if path.is_file() and not path.is_symlink() and path.stat().st_mtime >= execution_start:
                roots.append(path)
        copied = []
        limit = int(config.get("evidence_max_bytes", 20000000))
        total = 0
        for index, evidence_root in enumerate(roots):
            selected = (["execution.log", "execution.json"] if evidence_root == execution_dir
                        else ["."] if evidence_root.is_file()
                        else config.get("evidence_relative_paths", ["."]))
            for relative in selected:
                source = (evidence_root / relative).resolve()
                if not source.is_relative_to(evidence_root) or not source.exists():
                    raise ValueError("frozen evidence path missing/outside root: " + str(source))
                globs = config.get("evidence_globs")
                if globs:
                    files = sorted({item for pattern in globs for item in source.glob(pattern)
                                    if item.is_file()})
                else:
                    files = sorted(source.rglob("*")) if source.is_dir() else [source]
                for item in files:
                    if item.is_symlink() or not item.is_file():
                        continue
                    total += item.stat().st_size
                    if total > limit:
                        raise ValueError("selected evidence exceeds configured byte limit")
                    relative_item = Path(item.name) if evidence_root.is_file() else item.relative_to(evidence_root)
                    target = output / "frozen-evidence" / str(index) / relative_item
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if not target.exists() or digest(target) != digest(item):
                        shutil.copy2(item, target)
                    copied.append({"path": str(target), "sha256": digest(target),
                                   "source": str(item)})
        if not copied:
            raise ValueError("no frozen raw evidence selected")
        manifest = {"schema": "frozen-scene-evidence-v1", "files": copied,
                    "source_execution_sha256": digest(execution["receipt"]),
                    "coverage_path": str(coverage_path)}
        save(output / "frozen-evidence.json", manifest)
        return {"manifest": str(output / "frozen-evidence.json"),
                "paths": [item["path"] for item in copied], "file_count": len(copied),
                "bytes": total}

    evidence = stage(state_path, state, "evidence", evidence_step)
    if args.stop_after == "evidence":
        return
    original = load(config["case_input"])
    review_input = {**original, "frozen_revision": catalog["revision"],
                    "test_files": files, "artifact_scope": "isolated_worktree",
                    "execution_evidence_paths": evidence["paths"] + [execution["log"]],
                    "frozen_evidence_manifest": evidence["manifest"],
                    "frozen_execution_receipt": execution["receipt"],
                    "frozen_execution_log": execution["log"],
                    "coverage_result_path": str(output / "coverage-report.json"),
                    "agent_result_path": active_answer_path,
                    "scope_note": config.get("scope_note", "Only the frozen scene")}
    save(output / "review-input.json", review_input)

    def gate_step():
        gate_path = output / "handoff-gate.json"
        command = ["python3", str(HERE / "review_handoff_gate_v2.py"),
                   str(output / "review-input.json"), prepared["catalog"], str(gate_path)]
        result = run(command, log=output / "gate-stage.log", timeout=60)
        gate = load(gate_path)
        if result["exit_code"] or not gate or gate["status"] != "ready_for_review":
            raise RuntimeError("handoff gate rejected: " + result["output_tail"])
        return {"path": str(gate_path), "seconds": result["seconds"]}

    gate = stage(state_path, state, "gate", gate_step)
    if args.stop_after == "gate":
        return
    review_input["handoff_gate_path"] = gate["path"]
    save(output / "review-input.json", review_input)
    review_dir = output / "review"

    def review_step():
        return run_independent_review(root, output / "review-input.json", review_dir,
                                      output / "review-stage.log")

    review = stage(state_path, state, "review", review_step)
    from review_repair_loop import continue_after_review
    final = continue_after_review(config, output, state_path, state, prepared,
                                  catalog, root, original, review)
    summary = {"scene_id": original["scene"]["id"], "review_status": final["status"],
               "review_path": final["review"]["answer"],
               "review_completion_reason": final["reason"],
               "stages": {name: data["result"] for name, data in state["stages"].items()
                          if data["status"] == "completed"},
               "total_seconds": sum(data["result"].get("seconds", 0)
                                    for data in state["stages"].values()
                                    if data["status"] == "completed")}
    if config.get('definitions'):
        summary.update(definitions=config['definitions'], definition_binding_sha256=original['definition_binding_sha256'])
    save(output / "summary.json", summary)
    finish_scene(config, output)
    print(json.dumps({"scene_id": summary["scene_id"],
                      "review_status": summary["review_status"],
                      "total_seconds": summary["total_seconds"],
                      "summary_path": str(output / "summary.json")}, ensure_ascii=False))


def locked_main():
    if len(sys.argv) < 2:
        raise ValueError("configuration path required")
    config = load(Path(sys.argv[1]).resolve())
    if not config or not config.get("output_dir"):
        raise ValueError("invalid pipeline configuration")
    global ACTIVE_ACCEPTANCE_CONFIG
    acceptance_guard(config, [config["output_dir"]])
    ACTIVE_ACCEPTANCE_CONFIG = config
    output = Path(config["output_dir"]).resolve()
    if config.get("workspace_policy") != POLICY:
        raise ValueError("legacy per-scene config is read-only; bind a new single-workspace attempt")
    # Completed results remain readable even when another scene owns the workspace.
    if (output / "summary.json").is_file():
        saved = load(output / "state.json") or {}
        if saved.get("config_sha256") != digest(Path(sys.argv[1]).resolve()):
            raise ValueError("completed pipeline configuration changed")
        # A crash may have saved summary just before releasing its persistent owner.
        owner = workspace_path(config).parent / 'workspace-owner.json'
        if owner.is_file() and load(owner).get('output_dir') == str(output):
            with workspace_lease(config, output, scene=True):
                finish_scene(config, output)
        print(json.dumps(load(output / "summary.json"), ensure_ascii=False))
        return
    with workspace_lease(config, output, scene=True):
        main()


if __name__ == "__main__":
    try:
        locked_main()
    except Exception as exc:
        print(json.dumps({"status": "parked", "reason": str(exc)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(2)
