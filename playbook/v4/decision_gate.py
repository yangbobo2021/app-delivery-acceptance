"""Structural consistency gate for an independent scene execution judgment."""
import json
from pathlib import Path


def validate(answer, review_input):
    errors = []
    status = answer.get("status")
    if status not in ("passed", "product_bug", "repair_required", "inconclusive"):
        errors.append("unknown independent review status")
    for key in ("coverage", "oracle", "evidence", "summary"):
        if not isinstance(answer.get(key), str) or not answer[key].strip():
            errors.append("review field missing: " + key)
    findings = answer.get("findings")
    if not isinstance(findings, list):
        errors.append("findings must be an array")
        findings = []
    for item in findings:
        if (not isinstance(item, dict) or item.get("kind") not in
                ("case_code", "case_design", "evidence", "scenario", "product", "contract") or
                not isinstance(item.get("reason"), str) or not item["reason"].strip() or
                not isinstance(item.get("requested_change"), str) or not item["requested_change"].strip()):
            errors.append("review finding is incomplete")
    receipt = json.loads(Path(review_input["frozen_execution_receipt"]).read_text())
    if status == "passed" and (receipt.get("exit_code") != 0 or findings):
        errors.append("pass contradicts execution exit or findings")
    if status == "repair_required" and not findings:
        errors.append("repair requires a concrete finding")
    if status == "product_bug" and (receipt.get("exit_code") == 0 or
                                    not any(item.get("kind") == "product" for item in findings)):
        errors.append("product BUG needs failed execution and product finding")
    return {"status": "valid" if not errors else "invalid", "errors": errors,
            "review_status": status, "execution_exit_code": receipt.get("exit_code")}
