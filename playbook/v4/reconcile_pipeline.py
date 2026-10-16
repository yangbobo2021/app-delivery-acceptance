"""Conservative recovery of interrupted stages in the isolated scene prototype."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from datetime import datetime, timezone


def read(path):
    path = Path(path)
    return json.loads(path.read_text()) if path.is_file() else None


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, TypeError, ValueError):
        return False


def check_receipt(receipt_path, catalog):
    receipt = read(receipt_path)
    if not receipt:
        raise ValueError("execution receipt missing")
    root = Path(catalog["project_root"])
    if receipt.get("head_before") != catalog["revision"] or receipt.get("head_after") != catalog["revision"]:
        raise ValueError("execution revision differs from catalog")
    if sha(Path(receipt_path).with_name("execution.log")) != receipt.get("log_sha256"):
        raise ValueError("execution log hash differs from receipt")
    for name, expected in receipt.get("test_file_sha256_after", {}).items():
        path = (root / name).resolve()
        if not path.is_relative_to(root) or not path.is_file() or sha(path) != expected:
            raise ValueError("execution test file changed: " + name)
    if receipt.get("unexpected_tracked_changes"):
        raise ValueError("execution changed unexpected tracked files")
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    if head != catalog["revision"]:
        raise ValueError("current revision differs from receipt")
    return receipt


def reconcile(config, output, state, catalog, save):
    """Only adopt proved results or resume a saved session; never guess a side effect."""
    stages = state["stages"]
    repair_key = next((name for name, value in stages.items()
                       if (name == "case_repair" or name.startswith("review-repair-"))
                       and value.get("status") == "running"), None)
    execution_key = next((name for name, value in stages.items()
                          if (name == "execution" or name.startswith("execution-review-"))
                          and value.get("status") == "running"), None)
    review_key = next((name for name, value in stages.items()
                       if (name == "review" or (name.startswith("review-") and name[7:].isdigit()))
                       and value.get("status") == "running"), None)
    deterministic_key = next((name for name, value in stages.items()
                              if (name in ("evidence", "gate") or name.startswith("evidence-review-")
                                  or name.startswith("gate-review-"))
                              and value.get("status") == "running"), None)
    event = None
    if stages.get("case", {}).get("status") == "running":
        case = output / "case"
        pid_path = case / "runner.pid"
        if pid_path.is_file() and alive(pid_path.read_text().strip()):
            raise RuntimeError("case Agent runner is still alive; do not start another")
        events_path = case / "agent.jsonl"
        if not events_path.is_file():
            raise RuntimeError("case Agent lacks a session trace; manual reconciliation required")
        events = [json.loads(x) for x in events_path.read_text().splitlines() if x.strip()]
        session = next((x.get("sessionId") for x in events if x.get("type") == "init"), None)
        done = next((x for x in reversed(events)
                     if x.get("type") == "done" and x.get("payload", {}).get("status") == "success"), None)
        binding = read(case / "catalog-binding.json")
        if not session or not binding or binding.get("sha256") != sha(output / "catalog.json"):
            raise RuntimeError("case session or catalog binding cannot be verified")
        if json.loads((case / "input.json").read_text()) != read(config["case_input"]):
            raise RuntimeError("case input changed after session started")
        if done:
            raw = next((x.get("payload", {}).get("content", "") for x in reversed(events)
                        if x.get("type") == "text"), "").strip()
            try:
                answer = json.loads(raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip())
            except (ValueError, TypeError) as exc:
                raise RuntimeError("completed case has no parseable final answer") from exc
            root = Path(catalog["project_root"])
            head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
            changed = subprocess.check_output(["git", "diff", "--name-only", "HEAD"], cwd=root, text=True).splitlines()
            roots = tuple(x.rstrip("/") + "/" for x in catalog.get("write_roots", catalog["test_roots"]))
            if head != catalog["revision"] or any(not x.startswith(roots) for x in changed):
                raise RuntimeError("completed case changed source or revision")
            (case / "answer.json").write_text(json.dumps(answer, ensure_ascii=False, indent=2) + "\n")
            metrics = {"status": "success", "seconds": done.get("payload", {}).get("durationMs", 0) / 1000,
                       "usage": done.get("payload", {}).get("usage"),
                       "tool_calls": sum(x.get("type") == "tool_use" for x in events),
                       "materialized_after_interruption": True, "resumed_from_session": session}
            (case / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n")
            stages["case"].update(status="completed", result={
                "answer": str(case / "answer.json"), "metrics": str(case / "metrics.json"),
                "seconds": metrics["seconds"], "usage": metrics["usage"],
                "tool_calls": metrics["tool_calls"]})
            event = {"stage": "case", "action": "materialize_completed_session", "session_id": session}
        else:
            if read(config["case_input"]).get("local_loopback_required") and not config.get("resume_safe_after_local_loopback"):
                raise RuntimeError("case Agent may have made a local service effect; resume safety is not declared")
            stages["case"]["status"] = "resume_ready"
            event = {"stage": "case", "action": "resume_session", "session_id": session}
    elif execution_key:
        directory = output / execution_key
        receipt_path = directory / "execution.json"
        if receipt_path.is_file():
            receipt = check_receipt(receipt_path, catalog)
            stages[execution_key].update(status="completed", result={
                "receipt": str(receipt_path), "log": str(directory / "execution.log"),
                "exit_code": receipt["exit_code"], "seconds": receipt["duration_seconds"],
                "test_files": list(receipt.get("test_file_sha256_after", {}))})
            event = {"stage": execution_key, "action": "adopt_verified_receipt"}
        else:
            intent = read(directory / "execution-intent.json")
            if intent and alive(intent.get("child_pid")):
                raise RuntimeError("frozen test child is still alive; do not replay")
            if not config.get("rerun_safe_after_interruption") or not config.get("fresh_env_root_key"):
                raise RuntimeError("execution result uncertain; local isolated retry is not declared safe")
            fresh_name = ("fresh-execution" if execution_key == "execution"
                          else "fresh-review-" + execution_key.removeprefix("execution-review-"))
            for name in (execution_key, fresh_name):
                path = output / name
                if path.exists():
                    archive = output / (name + "-interrupted-1")
                    if archive.exists():
                        raise RuntimeError("interrupted execution archive already exists")
                    shutil.move(str(path), str(archive))
            stages[execution_key]["status"] = "retry_ready"
            event = {"stage": execution_key, "action": "retry_in_fresh_isolated_directory",
                     "previous_intent": str(output / (execution_key + "-interrupted-1") / "execution-intent.json")}
    elif review_key:
        review = output / review_key
        pid_path = review / "runner.pid"
        if pid_path.is_file() and alive(pid_path.read_text().strip()):
            raise RuntimeError("independent Reviewer runner is still alive")
        input_name = ("review-input.json" if review_key == "review"
                      else "review-input-" + review_key.removeprefix("review-") + ".json")
        if read(review / "input.json") != read(output / input_name):
            raise RuntimeError("review input changed after Reviewer started")
        trace = review / "agent.jsonl"
        if not trace.is_file():
            raise RuntimeError("review has no session trace")
        events = [json.loads(x) for x in trace.read_text().splitlines() if x.strip()]
        session = next((x.get("sessionId") for x in events if x.get("type") == "init"), None)
        done = next((x for x in reversed(events)
                     if x.get("type") == "done" and x.get("payload", {}).get("status") == "success"), None)
        if not session:
            raise RuntimeError("review has no saved session")
        if done:
            raw = next((x.get("payload", {}).get("content", "") for x in reversed(events)
                        if x.get("type") == "text"), "").strip()
            try:
                answer = json.loads(raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip())
            except (ValueError, TypeError) as exc:
                raise RuntimeError("completed review has no parseable final answer") from exc
            from decision_gate import validate
            verdict = validate(answer, read(output / input_name))
            if verdict["status"] != "valid":
                raise RuntimeError("completed review failed decision gate: " + "; ".join(verdict["errors"]))
            (review / "answer.json").write_text(json.dumps(answer, ensure_ascii=False, indent=2) + "\n")
            (review / "decision-gate.json").write_text(json.dumps(verdict, ensure_ascii=False, indent=2) + "\n")
            metrics = {"status": "success", "seconds": done.get("payload", {}).get("durationMs", 0) / 1000,
                       "usage": done.get("payload", {}).get("usage"),
                       "tool_calls": sum(x.get("type") == "tool_use" for x in events),
                       "materialized_after_interruption": True, "resumed_from_session": session}
            (review / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n")
            stages[review_key].update(status="completed", result={
                "answer": str(review / "answer.json"), "metrics": str(review / "metrics.json"),
                "status": answer.get("status"), "seconds": metrics["seconds"],
                "usage": metrics["usage"], "tool_calls": metrics["tool_calls"]})
            event = {"stage": review_key, "action": "materialize_completed_session", "session_id": session}
        else:
            stages[review_key]["status"] = "resume_ready"
            event = {"stage": review_key, "action": "resume_session", "session_id": session}
    elif repair_key:
        directory = output / ("case-repair" if repair_key == "case_repair" else repair_key)
        pid_path = directory / "runner.pid"
        if pid_path.is_file() and alive(pid_path.read_text().strip()):
            raise RuntimeError("repair Agent runner is still alive")
        bindings = read(directory / "binding.json")
        if not bindings or any(sha(item["path"]) != item["sha256"] for item in bindings):
            raise RuntimeError("repair input or scope changed")
        root = Path(catalog["project_root"])
        head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
        if head != catalog["revision"]:
            raise RuntimeError("repair source revision changed")
        changed = set(subprocess.check_output(
            ["git", "diff", "--name-only", "HEAD"], cwd=root, text=True).splitlines())
        changed.update(subprocess.check_output(
            ["git", "ls-files", "--others", "--exclude-standard"], cwd=root, text=True).splitlines())
        roots = tuple(name.rstrip("/") + "/" for name in
                      catalog.get("write_roots", catalog.get("test_roots", [])))
        if not roots or any(not name.startswith(roots) or not (root / name).is_file()
                            for name in changed):
            raise RuntimeError("repair checkout contains an unbound or missing file")
        test_snapshot = {name: sha(root / name) for name in sorted(changed)}
        trace = directory / "agent.jsonl"
        if not trace.is_file():
            raise RuntimeError("repair Agent has no session trace")
        events = [json.loads(x) for x in trace.read_text().splitlines() if x.strip()]
        session = next((x.get("sessionId") for x in events if x.get("type") == "init"), None)
        done = next((x for x in reversed(events)
                     if x.get("type") == "done" and x.get("payload", {}).get("status") == "success"), None)
        if not session:
            raise RuntimeError("repair Agent has no saved session")
        if done:
            raw = next((x.get("payload", {}).get("content", "") for x in reversed(events)
                        if x.get("type") == "text"), "").strip()
            try:
                answer = json.loads(raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip())
            except (ValueError, TypeError) as exc:
                raise RuntimeError("completed repair has no parseable final answer") from exc
            (directory / "answer.json").write_text(json.dumps(answer, ensure_ascii=False, indent=2) + "\n")
            metrics = {"status": "success", "seconds": done.get("payload", {}).get("durationMs", 0) / 1000,
                       "usage": done.get("payload", {}).get("usage"),
                       "tool_calls": sum(x.get("type") == "tool_use" for x in events),
                       "materialized_after_interruption": True, "resumed_from_session": session}
            (directory / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n")
            stages[repair_key].update(status="completed", result={
                "answer": str(directory / "answer.json"), "metrics": str(directory / "metrics.json"),
                "seconds": metrics["seconds"], "usage": metrics["usage"],
                "tool_calls": metrics["tool_calls"]})
            event = {"stage": repair_key, "action": "materialize_completed_session", "session_id": session,
                     "test_file_sha256_at_recovery": test_snapshot}
        else:
            if read(config["case_input"]).get("local_loopback_required") and not config.get("resume_safe_after_local_loopback"):
                raise RuntimeError("repair Agent may have made a local service effect; resume safety is not declared")
            stages[repair_key]["status"] = "resume_ready"
            event = {"stage": repair_key, "action": "resume_session", "session_id": session,
                     "test_file_sha256_at_recovery": test_snapshot}
    elif deterministic_key:
        stages[deterministic_key]["status"] = "retry_ready"
        event = {"stage": deterministic_key, "action": "retry_deterministic_stage"}
    if event:
        event["at"] = datetime.now(timezone.utc).isoformat()
        state.setdefault("recovery_history", []).append(event)
        save(output / "state.json", state)
    return event
