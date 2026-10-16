#!/usr/bin/env python3
"""Freeze one self-checked scene into an isolated case-run request."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def read(path):
    return json.loads(Path(path).read_text())


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: bind_case.py template.json NEW-handoff-dir")
    template_path = Path(sys.argv[1]).resolve()
    template = read(template_path)
    out = Path(sys.argv[2]).resolve()
    if out.exists():
        raise ValueError("handoff directory already exists")
    scene_dir = Path(template["scenario_run_path"]).resolve()
    request_path = scene_dir / "request.frozen.json"
    scenes_path = scene_dir / "scenarios.current.json"
    terminal = read(scene_dir / "terminal.json")
    request, scenes = read(request_path), read(scenes_path)
    if (terminal.get("final_state") != "done" or
            terminal.get("review_kind") != "internal_self_check" or
            terminal.get("request_sha256") != sha(request_path) or
            terminal.get("scenarios_sha256") != sha(scenes_path) or
            read(scene_dir / "draft-gate.json").get("status") != "ready"):
        raise ValueError("scenario list has no valid self-check/structure gate")
    scene = next((item for item in scenes["scenarios"] if item["id"] == template["scene_id"]), None)
    if not scene or scene["requirement_id"] != request["target_requirement_id"]:
        raise ValueError("selected scene absent from frozen target list")
    root = Path(template["source_checkout"]).resolve()
    if root != Path(request["project_root"]).resolve():
        raise ValueError("scenario and case project roots differ")
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    catalog = read(template["template_catalog"])
    if catalog.get("revision") != revision:
        raise ValueError("catalog and project revision differ")
    if request["scenario_kind"] == "WHITE_BOX" and request["source_evidence"]["revision"] != revision:
        raise ValueError("white-box source binding differs from case revision")
    target = next((item for item in request["requirements"]["items"]
                   if item["id"] == scene["requirement_id"]), None)
    if target is None:
        target = next((item for item in request.get("reverse_rules", [])
                       if item["id"] == scene["requirement_id"] and item.get("status") == "supported"), None)
    if target is None:
        raise ValueError("scene owner has no original requirement or supported reverse rule")
    groups = [group for group in request["analysis"].get("requirement_groups", [])
              if scene["requirement_id"] in group.get("requirement_ids", [])]
    related_ids = {id for group in groups for id in group["requirement_ids"]} - {target["id"]}
    related = [item for item in request["requirements"]["items"] if item["id"] in related_ids]
    case_input = {"requirement": target, "scene": scene,
                  "business_goal": request["analysis"]["business_goal"],
                  "confirmed_scope": request["analysis"]["confirmed_scope"],
                  "related_requirements": related,
                  "scenario_source_path": str(scenes_path),
                  "scenario_source_sha256": sha(scenes_path),
                  "scenario_self_check": "internal",
                  "local_loopback_required": bool(template.get("local_loopback_required", False))}
    coverage = template.get("coverage", {"policy": "unavailable",
                                        "reason": "No project coverage collector was supplied"})
    case_input["coverage"] = coverage
    if request["scenario_kind"] == "WHITE_BOX":
        case_input["source_evidence"] = request["source_evidence"]
        case_input["reviewed_reverse_path"] = request["reviewed_reverse_path"]
        case_input["reviewed_reverse_sha256"] = request["reviewed_reverse_sha256"]
    elif request.get("pr_reviewed_reverse_path"):
        case_input["pr_reviewed_reverse_path"] = request["pr_reviewed_reverse_path"]
        case_input["pr_reviewed_reverse_sha256"] = request["pr_reviewed_reverse_sha256"]
    config = {"schema": "isolated-scene-pipeline-v1", "source_checkout": str(root),
              "revision": revision, "component_sources": template.get("component_sources", {}),
              "template_catalog": str(Path(template["template_catalog"]).resolve()),
              "case_input": str(out / "case-input.json"),
              "guide": str(Path(template["guide"]).resolve()),
              "allowed_test_roots": template.get("allowed_test_roots", catalog.get("test_roots", [])),
              "coverage": coverage,
              "output_dir": str(Path(template["case_run_dir"]).resolve())}
    for key in ("fresh_env_root_key", "fresh_env_paths", "evidence_env_dir_keys",
                "evidence_log_prefix", "evidence_relative_paths", "evidence_globs",
                "evidence_max_bytes", "rerun_safe_after_interruption", "max_review_repairs",
                "resume_safe_after_local_loopback", "scope_note"):
        if key in template:
            config[key] = template[key]
    out.mkdir(parents=True)
    (out / "case-input.json").write_text(json.dumps(case_input, ensure_ascii=False, indent=2) + "\n")
    (out / "config.json").write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n")
    (out / "terminal.json").write_text(json.dumps({"status": "bound", "template_sha256": sha(template_path),
        "scenario_sha256": sha(scenes_path), "case_input_sha256": sha(out / "case-input.json"),
        "config_sha256": sha(out / "config.json")}, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"config": str(out / "config.json"), "scene_id": scene["id"]}))


if __name__ == "__main__":
    main()
