#!/usr/bin/env python3
"""Bounded review-finding repair for the isolated single-scene driver."""
import json
import os
from pathlib import Path
import shutil

from scene_pipeline import HERE, collect_files, digest, load, run, save, stage, run_independent_review


def continue_after_review(config, output, state_path, state, prepared, catalog,
                          root, original, first_review):
    review = first_review
    if config.get('case_strategy', 'implement') == 'existing_only':
        return {"status": review["status"], "review": review,
                "reason": "existing_only retains the independent verdict without modifying tests"}
    maximum = int(config.get("max_review_repairs", 2))
    for number in range(1, maximum + 1):
        if review["status"] != "repair_required":
            break
        prior = load(review["answer"])
        if any(item.get("kind") in ("scenario", "contract")
               for item in prior.get("findings", [])):
            return {"status": "needs_scope_or_contract", "review": review,
                    "reason": "review finding requires scene or business contract decision"}
        tag = f"review-repair-{number}"
        repair_dir = output / tag

        def repair_step():
            command = ["node", str(HERE / "repair_case_delta_v3.mjs"),
                       str(Path(config["case_input"]).resolve()), review["answer"],
                       prepared["catalog"], str(Path(config["guide"]).resolve()),
                       str(repair_dir)]
            if repair_dir.exists():
                command.append("--resume")
            result = run(command, log=output / f"{tag}-stage.log", timeout=900)
            metrics = load(repair_dir / "metrics.json")
            answer = load(repair_dir / "answer.json")
            if result["exit_code"] or not metrics or metrics.get("status") != "success" or not answer:
                raise RuntimeError("review repair Agent incomplete: " + result["output_tail"])
            return {"answer": str(repair_dir / "answer.json"),
                    "metrics": str(repair_dir / "metrics.json"),
                    "seconds": metrics["seconds"], "usage": metrics.get("usage"),
                    "tool_calls": metrics.get("tool_calls")}

        repair = stage(state_path, state, tag, repair_step)
        answer = load(repair["answer"])
        if answer.get("status") == "needs_contract":
            return {"status": "needs_scope_or_contract", "review": review,
                    "reason": "repair Agent requires a newly bound contract or project preparation; "
                              "preserve this attempt and do not execute its old binding: " +
                              str(answer.get("reason", ""))}
        if answer.get("status") == "blocked" or not answer.get("test_command"):
            return {"status": "repair_parked", "review": review,
                    "reason": "repair Agent did not produce executable case"}
        files = collect_files(root, answer, catalog)
        execution_dir = output / f"execution-review-{number}"

        def execution_step():
            if execution_dir.exists():
                raise RuntimeError("execution directory exists without completed stage")
            command = ["python3", str(HERE / "run_evidence_v2.py"),
                       "--cwd", str(root), "--output", str(execution_dir)]
            for name in files:
                command += ["--file", name]
            values = dict(answer.get("test_env", {}))
            fresh_key = config.get("fresh_env_root_key")
            if fresh_key:
                fresh = output / f"fresh-review-{number}"
                command += ["--fresh-dir", str(fresh)]
                values[fresh_key] = str(fresh)
                for key, relative in config.get("fresh_env_paths", {}).items():
                    values[key] = str(fresh / relative)
            if config.get('coverage', {}).get('policy') == 'required':
                coverage_config = output / f'coverage-execution-config-{number}.json'
                save(coverage_config, config['coverage'])
                command += ['--coverage-config', str(coverage_config)]
            for key, value in values.items():
                command += ["--env", key + "=" + value]
            command += ["--"] + answer["test_command"]
            result = run(command, log=output / f"execution-review-{number}-stage.log", timeout=600)
            receipt = load(execution_dir / "execution.json")
            if not receipt:
                raise RuntimeError("execution receipt absent: " + result["output_tail"])
            return {"receipt": str(execution_dir / "execution.json"),
                    "log": str(execution_dir / "execution.log"),
                    "exit_code": receipt["exit_code"],
                    "seconds": receipt["duration_seconds"],
                    "test_files": files}

        execution = stage(state_path, state, f"execution-review-{number}", execution_step)
        evidence_dir = output / f"frozen-evidence-review-{number}"

        def evidence_step():
            from coverage_evidence import freeze_coverage, evidence_paths
            receipt = load(execution["receipt"])
            roots = [execution_dir]
            coverage_result, coverage_path = freeze_coverage(config.get("coverage"), root, execution_dir,
                                                             execution["receipt"], output / f"coverage-review-{number}-report")
            roots.extend(evidence_paths(coverage_result))
            for key in config.get("evidence_env_dir_keys", []):
                value = receipt.get("env_changes", {}).get(key)
                if value:
                    roots.append(Path(value).resolve())
            prefix = config.get("evidence_log_prefix")
            if prefix:
                matches = [line.split(prefix, 1)[1].strip()
                           for line in Path(execution["log"]).read_text(errors="replace").splitlines()
                           if prefix in line]
                if not matches:
                    raise ValueError("evidence location absent from frozen log")
                roots.append(Path(matches[-1]).resolve())
            from datetime import datetime
            execution_start = datetime.fromisoformat(receipt["start_utc"]).timestamp()
            for declared in answer.get("evidence_paths", []):
                path = Path(declared).resolve()
                if path.is_file() and not path.is_symlink() and path.stat().st_mtime >= execution_start:
                    roots.append(path)
            copied = []
            total = 0
            limit = int(config.get("evidence_max_bytes", 20000000))
            for index, evidence_root in enumerate(roots):
                selected = (["execution.log", "execution.json"] if evidence_root == execution_dir
                            else ["."] if evidence_root.is_file()
                            else config.get("evidence_relative_paths", ["."]))
                for relative in selected:
                    source = (evidence_root / relative).resolve()
                    if not source.is_relative_to(evidence_root) or not source.exists():
                        raise ValueError("frozen evidence missing: " + str(source))
                    globs = config.get("evidence_globs")
                    files_to_copy = (sorted({item for pattern in globs
                                             for item in source.glob(pattern) if item.is_file()})
                                     if globs else
                                     sorted(source.rglob("*")) if source.is_dir() else [source])
                    for item in files_to_copy:
                        if item.is_symlink() or not item.is_file():
                            continue
                        total += item.stat().st_size
                        if total > limit:
                            raise ValueError("selected evidence exceeds byte limit")
                        relative_item = Path(item.name) if evidence_root.is_file() else item.relative_to(evidence_root)
                        target = evidence_dir / str(index) / relative_item
                        target.parent.mkdir(parents=True, exist_ok=True)
                        if not target.exists() or digest(target) != digest(item):
                            shutil.copy2(item, target)
                        copied.append({"path": str(target), "sha256": digest(target),
                                       "source": str(item)})
            if not copied:
                raise ValueError("no frozen raw evidence selected")
            manifest_path = output / f"frozen-evidence-review-{number}.json"
            save(manifest_path, {"schema": "frozen-scene-evidence-v1", "files": copied,
                                 "source_execution_sha256": digest(execution["receipt"]),
                                 "coverage_path": str(coverage_path)})
            return {"manifest": str(manifest_path),
                    "paths": [item["path"] for item in copied],
                    "file_count": len(copied), "bytes": total}

        evidence = stage(state_path, state, f"evidence-review-{number}", evidence_step)
        review_input_path = output / f"review-input-{number}.json"
        review_input = {**original, "frozen_revision": catalog["revision"],
                        "test_files": files, "artifact_scope": "isolated_worktree",
                        "execution_evidence_paths": evidence["paths"] + [execution["log"]],
                        "frozen_evidence_manifest": evidence["manifest"],
                        "frozen_execution_receipt": execution["receipt"],
                        "frozen_execution_log": execution["log"],
                        "coverage_result_path": str(output / f"coverage-review-{number}-report.json"),
                        "agent_result_path": repair["answer"],
                        "previous_review": prior,
                        "scope_note": config.get("scope_note", "Only the frozen scene")}
        save(review_input_path, review_input)
        gate_path = output / f"handoff-gate-{number}.json"

        def gate_step():
            command = ["python3", str(HERE / "review_handoff_gate_v2.py"),
                       str(review_input_path), prepared["catalog"], str(gate_path)]
            result = run(command, log=output / f"gate-review-{number}-stage.log", timeout=60)
            gate = load(gate_path)
            if result["exit_code"] or not gate or gate["status"] != "ready_for_review":
                raise RuntimeError("review repair handoff rejected: " + result["output_tail"])
            return {"path": str(gate_path), "seconds": result["seconds"]}

        gate = stage(state_path, state, f"gate-review-{number}", gate_step)
        review_input["handoff_gate_path"] = gate["path"]
        save(review_input_path, review_input)
        review_dir = output / f"review-{number}"

        def review_step():
            return run_independent_review(root, review_input_path, review_dir,
                                          output / f"review-{number}-stage.log")

        review = stage(state_path, state, f"review-{number}", review_step)
    return {"status": review["status"], "review": review,
            "reason": "bounded independent review loop completed"}
