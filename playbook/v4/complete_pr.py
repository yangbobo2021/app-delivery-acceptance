#!/usr/bin/env python3
"""Deterministically account for every frozen PR target and every generated scene."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

from run_plan import slug


def read(path):
    return json.loads(Path(path).read_text())


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: complete_pr.py pr-targets.json plan.json result.json")
    targets_path, plan_path, output_path = map(lambda p: Path(p).resolve(), sys.argv[1:])
    targets, plan = read(targets_path), read(plan_path)
    if targets.get("schema") != "pr-targets-v1" or plan.get("schema") != "acceptance-v4-plan-v1":
        raise ValueError("frozen PR targets and v4 plan required")
    run_dir = Path(plan["run_dir"]).resolve()
    errors, results = [], []
    if plan.get("selected_scene_ids"):
        errors.append("selected scene subset cannot establish PR-wide completion")
    target_keys = [item["key"] for item in targets["targets"]]
    if len(target_keys) != len(set(target_keys)):
        errors.append("PR target keys are duplicated")
    requests = [read(path) for path in plan["scenario_requests"]]
    request_keys = [item["scenario_kind"] + ":" + item["target_requirement_id"] for item in requests]
    if set(request_keys) != set(target_keys) or len(request_keys) != len(set(request_keys)):
        errors.append("v4 plan does not cover every PR target exactly once")
    source_root = Path(plan["case_template"]["source_checkout"]).resolve()
    current_head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source_root, text=True).strip()
    if current_head != targets["head_revision"]:
        errors.append("current PR head differs from frozen targets")
    for index, request in enumerate(requests):
        key = request_keys[index]
        reverse_hash = (request.get("reviewed_reverse_sha256") or
                        request.get("pr_reviewed_reverse_sha256"))
        if reverse_hash != targets.get("change_sha256"):
            errors.append("scenario target is bound to another PR analysis: " + key)
        stem = f"{index:03d}-{slug(request['target_requirement_id'])}"
        scenario_dir = run_dir / "scenarios" / stem
        try:
            terminal = read(scenario_dir / "terminal.json")
            frozen_request = read(scenario_dir / "request.frozen.json")
            scenes_path = scenario_dir / "scenarios.current.json"
            scenes = read(scenes_path)["scenarios"]
            if (terminal.get("final_state") != "done" or
                    frozen_request.get("scenario_kind") != request["scenario_kind"] or
                    frozen_request.get("target_requirement_id") != request["target_requirement_id"] or
                    frozen_request.get("requirements") != request.get("requirements") or
                    frozen_request.get("analysis") != request.get("analysis") or
                    frozen_request.get("user_constraints") != request.get("user_constraints") or
                    frozen_request.get("selected_commit_scope") != request.get("selected_commit_scope") or
                    Path(frozen_request.get("project_root", "")).resolve() !=
                    Path(request.get("project_root", "")).resolve() or
                    (frozen_request.get("reviewed_reverse_sha256") or
                     frozen_request.get("pr_reviewed_reverse_sha256")) != reverse_hash or
                    terminal.get("request_sha256") != sha(scenario_dir / "request.frozen.json") or
                    terminal.get("scenarios_sha256") != sha(scenes_path) or
                    read(scenario_dir / "draft-gate.json").get("status") != "ready"):
                raise ValueError("scenario artifact or gate invalid")
        except (OSError, KeyError, ValueError) as exc:
            errors.append(f"scenario list unavailable for {key}: {exc}")
            continue
        if not scenes:
            errors.append("target has no generated scenes: " + key)
        for scene in scenes:
            scene_key = f"{stem}-{slug(scene['id'])}"
            case_dir = run_dir / "cases" / scene_key
            handoff_dir = run_dir / "handoffs" / scene_key
            try:
                input_data = read(handoff_dir / "case-input.json")
                state = read(case_dir / "state.json")
                summary = read(case_dir / "summary.json")
                if (input_data["scene"] != scene or
                        input_data.get("scenario_source_sha256") != sha(scenes_path) or
                        summary.get("scene_id") != scene["id"]):
                    raise ValueError("case input differs from generated scene")
                if any(item.get("status") != "completed" for item in state.get("stages", {}).values()):
                    raise ValueError("case has an unfinished stage")
                execution_keys = [name for name in state["stages"]
                                  if name == "execution" or name.startswith("execution-review-")]
                review_keys = [name for name in state["stages"]
                               if name == "review" or name.startswith("review-") and name[7:].isdigit()]
                if not execution_keys or not review_keys:
                    raise ValueError("execution or independent review missing")
                def order(name):
                    return 0 if '-' not in name else int(name.rsplit('-', 1)[-1])
                execution = max(execution_keys, key=order)
                review = max(review_keys, key=order)
                receipt = read(case_dir / execution / "execution.json")
                verdict = read(case_dir / review / "answer.json")
                decision = read(case_dir / review / "decision-gate.json")
                review_number = "" if review == "review" else review.removeprefix("review-")
                review_input = read(case_dir / ("review-input.json" if not review_number else
                                                f"review-input-{review_number}.json"))
                handoff_gate = read(case_dir / ("handoff-gate.json" if not review_number else
                                                 f"handoff-gate-{review_number}.json"))
                if (receipt.get("head_before") != targets["head_revision"] or
                        receipt.get("head_after") != targets["head_revision"] or
                        decision.get("status") != "valid" or
                        decision.get("review_status") != verdict.get("status") or
                        decision.get("execution_exit_code") != receipt.get("exit_code") or
                        Path(review_input.get("frozen_execution_receipt", "")).resolve() !=
                        (case_dir / execution / "execution.json").resolve() or
                        handoff_gate.get("status") != "ready_for_review" or
                        handoff_gate.get("receipt_sha256") != sha(case_dir / execution / "execution.json") or
                        verdict.get("status") != summary.get("review_status") or
                        verdict.get("status") not in ("passed", "product_bug")):
                    raise ValueError("case has no valid final judgment on frozen PR head")
                results.append({"key": key, "scene_id": scene["id"],
                                "status": verdict["status"],
                                "summary_path": str(case_dir / "summary.json")})
            except (OSError, KeyError, ValueError, TypeError) as exc:
                errors.append(f"{key}/{scene['id']}: {exc}")
    if targets.get("unresolved"):
        errors.append("PR has unresolved behavior rules")
    if not targets["targets"]:
        errors.append("PR has no executable acceptance targets")
    status = ("blocked" if errors else
              "bugs_found" if any(item["status"] == "product_bug" for item in results) else "passed")
    result = {"schema": "acceptance-v4-pr-completion-v1", "status": status,
              "head_revision": targets["head_revision"], "targets_sha256": sha(targets_path),
              "plan_sha256": sha(plan_path), "results": results, "errors": errors}
    Path(output_path).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": status, "scenes": len(results), "errors": errors}, ensure_ascii=False))
    return 0 if status in ("passed", "bugs_found") else 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(json.dumps({"status": "blocked", "reason": str(exc)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(2)
