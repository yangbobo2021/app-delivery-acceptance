#!/usr/bin/env python3
"""Language-neutral review handoff gate for a single scene execution."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: review_handoff_gate.py case-review-input.json prepared-catalog.json output.json")
    request = json.loads(Path(sys.argv[1]).read_text())
    catalog = json.loads(Path(sys.argv[2]).read_text())
    output = Path(sys.argv[3])
    errors = []
    root = Path(catalog["project_root"]).resolve()
    receipt_path = Path(request["frozen_execution_receipt"]).resolve()
    log_path = Path(request["frozen_execution_log"]).resolve()
    receipt = json.loads(receipt_path.read_text()) if receipt_path.is_file() else {}
    revision = catalog.get("revision")
    if not receipt:
        errors.append("frozen execution receipt missing")
    if request.get("frozen_revision") != revision:
        errors.append("case version differs from prepared project")
    if request.get("scene", {}).get("requirement_id") != request.get("requirement", {}).get("id"):
        errors.append("scene owner differs from requirement")
    if receipt:
        if receipt.get("head_before") != revision or receipt.get("head_after") != revision:
            errors.append("execution changed or used a different source revision")
        changed_before = set(receipt.get("tracked_changes_before", "").splitlines())
        changed_after = set(receipt.get("tracked_changes_after", "").splitlines())
        if changed_before != changed_after or changed_after - set(request.get("test_files", [])):
            errors.append("tracked product/source changes during execution")
        if not isinstance(receipt.get("exit_code"), int):
            errors.append("actual command exit code missing")
        if not isinstance(receipt.get("command"), list) or not receipt["command"]:
            errors.append("actual command missing")
        if not log_path.is_file() or receipt.get("log_sha256") != sha(log_path):
            errors.append("execution log missing or hash mismatch")
    paths = request.get("test_files", [])
    if not paths or not isinstance(paths, list):
        errors.append("selected test files missing")
    before = receipt.get("test_file_sha256_before", {})
    after = receipt.get("test_file_sha256_after", {})
    if receipt:
        if set(before) != set(paths) or set(after) != set(paths):
            errors.append("test-file receipt does not bind exactly the selected files")
        for name in paths:
            path = (root / name).resolve()
            if not path.is_relative_to(root) or not path.is_file() or after.get(name) != before.get(name) or after.get(name) != sha(path):
                errors.append("test file changed, missing or outside project: " + name)
    if request.get("artifact_scope") == "isolated_worktree":
        actual = set(subprocess.check_output(
            ["git", "ls-files", "--others", "--exclude-standard"],
            cwd=root, text=True).splitlines())
        if actual - set(paths):
            errors.append("isolated worktree has unbound non-ignored files: "
                          + repr(sorted(actual - set(paths))))
    for item in request.get("execution_evidence_paths", []):
        if not Path(item).exists():
            errors.append("execution evidence path missing: " + item)
    evidence_manifest = Path(request.get("frozen_evidence_manifest", ""))
    if not evidence_manifest.is_file():
        errors.append("frozen evidence manifest missing")
    else:
        evidence = json.loads(evidence_manifest.read_text())
        if evidence.get("source_execution_sha256") != sha(receipt_path):
            errors.append("frozen evidence bound to another execution")
        for item in evidence.get("files", []):
            path = Path(item["path"])
            if not path.is_file() or sha(path) != item["sha256"]:
                errors.append("frozen evidence changed: " + str(path))
    coverage_path = Path(request.get("coverage_result_path", ""))
    if not coverage_path.is_file():
        errors.append("coverage measurement status missing")
    else:
        coverage = json.loads(coverage_path.read_text())
        if coverage.get("status") not in ("measured", "unavailable", "off"):
            errors.append("invalid coverage status")
        if coverage.get("status") == "measured":
            report = Path(coverage.get("line_raw_path", ""))
            if (coverage.get("execution_sha256") != sha(receipt_path) or
                    coverage.get("collection_relation") != "same_run" or
                    not report.is_file() or coverage.get("line_raw_sha256") != sha(report)):
                errors.append("measured coverage is not bound to frozen execution")
    if not errors:
        head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
        if head != revision:
            errors.append("current project revision changed after execution")
        for component in catalog.get("components", []):
            component_root = (root / component["path"]).resolve()
            if not component_root.is_relative_to(root) or not component_root.is_dir():
                errors.append("prepared component missing: " + component["path"])
                continue
            current = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=component_root, text=True).strip()
            if current != component["revision"]:
                errors.append("prepared component revision changed: " + component["path"])
    result = {"schema": "single-scene-review-handoff-v1",
              "status": "ready_for_review" if not errors else "repair_required",
              "scene_id": request.get("scene", {}).get("id"),
              "execution_exit_code": receipt.get("exit_code"),
              "receipt_sha256": sha(receipt_path) if receipt_path.is_file() else None,
              "errors": errors}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False))
    return 0 if not errors else 2


if __name__ == "__main__":
    sys.exit(main())
