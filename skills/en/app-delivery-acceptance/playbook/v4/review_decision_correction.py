"""One read-only correction for a completed, structurally invalid review.

Original answers and frozen executions are immutable. This never converts a
judgment or replays a product command; the Reviewer decides its corrected answer.
"""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from decision_gate import validate


def read(path):
    return json.loads(Path(path).read_text()) if Path(path).is_file() else None


def completed_review(directory, input_path):
    directory = Path(directory)
    answer = read(directory / "answer.json")
    metrics = read(directory / "metrics.json")
    if not answer or not metrics or metrics.get("status") != "success":
        return None
    if read(directory / "input.json") != read(input_path):
        raise RuntimeError("completed review input changed")
    events = [json.loads(line) for line in (directory / "agent.jsonl").read_text().splitlines() if line.strip()]
    if not any(e.get("type") == "done" and e.get("payload", {}).get("status") == "success" for e in events):
        raise RuntimeError("completed review lacks successful session evidence")
    raw = next((e.get("payload", {}).get("content", "") for e in reversed(events) if e.get("type") == "text"), "").strip()
    if json.loads(raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()) != answer:
        raise RuntimeError("completed review answer differs from session evidence")
    verdict = validate(answer, read(input_path))
    gate_path = directory / "decision-gate.json"
    if not gate_path.exists():
        gate_path.write_text(json.dumps(verdict, ensure_ascii=False, indent=2) + "\n")
    elif read(gate_path) != verdict:
        raise RuntimeError("completed review gate changed")
    return {"answer": str(directory / "answer.json"), "metrics": str(directory / "metrics.json"),
            "status": answer["status"], "seconds": metrics["seconds"],
            "usage": metrics.get("usage"), "tool_calls": metrics.get("tool_calls")}, verdict


def correction_input(directory, input_path, verdict):
    directory = Path(directory)
    answer_path = directory / "answer.json"
    value = {**read(input_path), "decision_gate_correction": {
        "previous_review": read(answer_path),
        "previous_review_path": str(answer_path),
        "previous_review_sha256": hashlib.sha256(answer_path.read_bytes()).hexdigest(),
        "gate": verdict,
        "instruction": "Correct only the judgment structure against the same frozen evidence. Copy every original finding verbatim; additional concrete findings are allowed, deletion or rewriting is not. Retain observations and uncertainty; do not change scope, files or execute tests. Missing assertions require repair_required, not a product verdict based on a successful command."}}
    target = directory.with_name(directory.name + "-decision-correction-input.json")
    if target.exists():
        if read(target) != value:
            raise RuntimeError("review decision correction binding changed")
    else:
        target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    return target


def recover_parked_review(config, output, state, save):
    """Recover only the old gate failure, once, after proving no test changed."""
    from reconcile_pipeline import alive, check_receipt
    for key, item in state["stages"].items():
        old_gate_failure = item.get("status") == "parked" and item.get("error", "").startswith("independent review structure invalid: ")
        interrupted_correction = item.get("status") == "running" and (Path(output) / (key + "-decision-correction-1")).is_dir()
        if not old_gate_failure and not interrupted_correction:
            continue
        if key != "review" and not (key.startswith("review-") and key[7:].isdigit()):
            continue
        directory = Path(output) / key
        correction = directory.with_name(key + "-decision-correction-1")
        if old_gate_failure and correction.exists():
            raise RuntimeError("review decision correction already attempted; inspect preserved attempt")
        pid = (correction if interrupted_correction else directory) / "runner.pid"
        if pid.is_file() and alive(pid.read_text().strip()):
            raise RuntimeError("independent Reviewer runner is still alive")
        input_path = Path(output) / ("review-input.json" if key == "review" else "review-input-" + key[7:] + ".json")
        existing = completed_review(directory, input_path)
        if not existing or existing[1]["status"] != "invalid":
            raise RuntimeError("parked review has no verifiable completed invalid answer")
        check_receipt(read(input_path)["frozen_execution_receipt"], read(Path(output) / "catalog.json"))
        if interrupted_correction:
            bound = correction_input(directory, input_path, existing[1])
            if read(correction / "input.json") != read(bound):
                raise RuntimeError("interrupted correction input changed")
        item["status"] = "retry_ready"
        state.setdefault("recovery_history", []).append({
            "stage": key, "action": "resume_review_correction" if interrupted_correction else "correct_invalid_review_once", "at": datetime.now(timezone.utc).isoformat(),
            "original_answer": str(directory / "answer.json"), "previous_error": item.get("error")})
        save(Path(output) / "state.json", state)
