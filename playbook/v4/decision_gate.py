"""Structural consistency gate for an independent scene execution judgment."""
import json
import hashlib
from pathlib import Path


IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


def validate(answer, review_input, metrics=None):
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
    correction = review_input.get("decision_gate_correction")
    if correction:
        previous = correction.get("previous_review", {})
        if any(item not in findings for item in previous.get("findings", [])):
            errors.append("decision correction must retain every original finding unchanged")
    receipt = json.loads(Path(review_input["frozen_execution_receipt"]).read_text())
    ui_contract = review_input.get("ui_acceptance")
    ui_review = answer.get("ui_review")
    visual_bug = False
    if isinstance(ui_contract, dict):
        if not isinstance(ui_review, dict) or not isinstance(ui_review.get("reason"), str) or not ui_review["reason"].strip():
            errors.append("UI review missing")
            ui_review = {}
        required = ui_contract.get("required") is True
        expected_statuses = ({"passed", "failed", "unverified"} if required else {"not_applicable"})
        if ui_review.get("status") not in expected_statuses:
            errors.append("UI review status contradicts scene binding")
        screenshots = ui_review.get("screenshot_paths")
        if not isinstance(screenshots, list) or any(not isinstance(p, str) for p in screenshots):
            errors.append("UI screenshot references invalid")
            screenshots = []
        if required and ui_review.get("status") in {"passed", "failed"}:
            manifest = json.loads(Path(review_input["frozen_evidence_manifest"]).read_text())
            frozen_images = {item["path"]: item["sha256"] for item in manifest.get("files", [])
                             if Path(item.get("path", "")).suffix.lower() in IMAGE_SUFFIXES}
            if not screenshots or any(path not in frozen_images for path in screenshots):
                errors.append("UI conclusion lacks bound frozen screenshots")
            attached_hashes = {item.get("sha256") for item in (metrics or {}).get("image_inputs", [])
                               if isinstance(item, dict) and frozen_images.get(item.get("path")) == item.get("sha256")}
            if not screenshots or any(frozen_images.get(path) not in attached_hashes for path in screenshots):
                errors.append("UI conclusion lacks matching multimodal image input")
            if any(not Path(path).is_file() or hashlib.sha256(Path(path).read_bytes()).hexdigest() != sha
                   for path, sha in frozen_images.items()):
                errors.append("frozen UI screenshot changed after review")
        if required and ui_review.get("status") == "unverified" and status == "passed":
            errors.append("UI evidence unverified cannot pass")
        if required and ui_review.get("status") == "failed" and status == "passed":
            errors.append("failed UI check cannot pass")
        visual_bug = required and ui_review.get("status") == "failed" and bool(screenshots) and not any(
            error.startswith("UI conclusion lacks") or error == "frozen UI screenshot changed after review"
            for error in errors)
    if status == "passed" and (receipt.get("exit_code") != 0 or findings):
        errors.append("pass contradicts execution exit or findings")
    if status == "repair_required" and not findings:
        errors.append("repair requires a concrete finding")
    if status == "product_bug" and ((receipt.get("exit_code") == 0 and not visual_bug) or
                                    not any(item.get("kind") == "product" for item in findings)):
        errors.append("product BUG needs failed execution or frozen visual failure, and product finding")
    return {"status": "valid" if not errors else "invalid", "errors": errors,
            "review_status": status, "execution_exit_code": receipt.get("exit_code")}
