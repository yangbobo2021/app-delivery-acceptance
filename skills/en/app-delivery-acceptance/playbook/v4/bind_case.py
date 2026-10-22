#!/usr/bin/env python3
"""Freeze one self-checked scene into an isolated case-run request."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

# Shared project-owned storage and knowledge gate.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from acceptance_store import guard as acceptance_guard
from acceptance_workspace import POLICY, workspace_path
from acceptance_definitions import load_binding, scene_input


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
    acceptance_guard(template, [out, template["case_run_dir"]])
    if out.exists():
        raise ValueError("handoff directory already exists")
    definitions = load_binding(template)
    if definitions:
        case_input = {"acceptance": template['acceptance'], **scene_input(template, template['scene_id'])}
        scene = case_input['scene']
        scenes_path = Path(template['definitions']['path'])
        request = {"project_root": template['source_checkout']}
    else:
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
    if root != workspace_path(template):
        raise ValueError("case source_checkout must use the single acceptance workspace")
    scenario_root = Path(request["project_root"]).resolve()
    acceptance_root = Path(template["acceptance"]["project_root"]).resolve()
    if scenario_root != root and not (request.get("scenario_kind") == "BLACK_BOX" and
                                     not request.get("pr_reviewed_reverse_path") and
                                     scenario_root == acceptance_root):
        raise ValueError("scenario and case project roots differ")
    for upstream in ([read(template["template_catalog"])] if definitions else [request, read(template["template_catalog"])]):
        if any(upstream.get("acceptance", {}).get(k) != template["acceptance"].get(k)
               for k in ("project_root", "id", "scope_sha256")):
            raise ValueError("scenario/catalog belongs to another acceptance or scope")
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    catalog = read(template["template_catalog"])
    if catalog.get("workspace_policy") != POLICY or Path(catalog["project_root"]).resolve() != root:
        raise ValueError("prepare a new single-workspace catalog before binding cases")
    if catalog.get("revision") != revision:
        raise ValueError("catalog and project revision differ")
    if catalog.get("preparation_protocol") == "two-agent-v1" and not catalog.get("runtime"):
        raise ValueError("catalog lost its runtime Agent result")
    if catalog.get("runtime"):
        from acceptance_workspace import verify_frozen_workspace
        verify_frozen_workspace(template, catalog)
    if definitions:
        from acceptance_store import inside
        relevant = {r['id'] for r in [case_input.get('requirement'), *case_input['related_requirements']] if r}
        sources = [source for rule in definitions['reverse_rules'] if rule['id'] in relevant
                   for source in rule['code_sources']]
        for source in sources:
            if source['revision'] != revision or sha(inside(root, source['path'])) != source['sha256']:
                raise ValueError('reverse rule source differs from frozen project version')
        if sources:
            case_input['source_evidence'] = {'revision': revision, 'items': sources}
    if request.get("scenario_kind") == "WHITE_BOX" and request["source_evidence"]["revision"] != revision:
        raise ValueError("white-box source binding differs from case revision")
    if not definitions:
        case_input = legacy_input(request, scene, scenes_path, template)
    if request.get("scenario_selfcheck_protocol") == "v4-target-check-v1":
        selfcheck_path = scene_dir / "selfcheck.current.json"
        if terminal.get("selfcheck_sha256") != sha(selfcheck_path):
            raise ValueError("Scenario self-check changed after generation")
        if request.get("scenario_ui_protocol") == "v4-ui-acceptance-v1":
            checked = read(selfcheck_path)
            check = next((x for x in checked.get('scene_checks', []) if x['scene_id'] == scene['id']), None)
            if check is None or type(checked.get('ui_requirement', {}).get('required')) is not bool:
                raise ValueError('UI scene binding missing')
            case_input['ui_acceptance'] = {'required': checked['ui_requirement']['required'],
                'visual_expectation': check.get('ui_visual_expectation', ''), 'source_sha256': sha(selfcheck_path)}
    if case_input.get('ui_acceptance', {}).get('required'):
        declared, keys = template.get('evidence_execution_relative_paths', []), template.get('evidence_env_dir_keys', [])
        if not isinstance(declared, list) or not isinstance(keys, list) or not (declared or keys):
            raise ValueError('UI case template must declare frozen screenshot output binding')
        case_input['ui_acceptance'].update(evidence_execution_relative_paths=declared, evidence_env_dir_keys=keys)
    if catalog.get('runtime'):
        case_input['runtime'] = catalog['runtime']
    case_input['local_loopback_required'] = bool(template.get('local_loopback_required', False))
    coverage = template.get("coverage", catalog.get("coverage", {"policy": "unavailable",
                                        "reason": "No project coverage collector was supplied"}))
    if catalog.get('coverage', {}).get('policy') == 'required':
        coverage = catalog['coverage']
    from coverage_registry import project_coverage
    coverage=project_coverage(root,coverage if catalog.get('coverage',{}).get('policy')=='required' else template.get('coverage',catalog.get('coverage'))) or coverage
    if coverage.get('policy')=='required':
        coverage = {**coverage, 'scene_id': scene['id'], 'revision': revision}
    case_input["coverage"] = coverage
    case_input['debug_environment'] = {key: template[key] for key in
        ('fresh_env_root_key', 'fresh_env_paths', 'evidence_env_dir_keys') if key in template}
    if request.get("scenario_kind") == "WHITE_BOX":
        case_input["source_evidence"] = request["source_evidence"]
        case_input["reviewed_reverse_path"] = request["reviewed_reverse_path"]
        case_input["reviewed_reverse_sha256"] = request["reviewed_reverse_sha256"]
    elif request.get("pr_reviewed_reverse_path"):
        case_input["pr_reviewed_reverse_path"] = request["pr_reviewed_reverse_path"]
        case_input["pr_reviewed_reverse_sha256"] = request["pr_reviewed_reverse_sha256"]
    config = {"acceptance": template["acceptance"],"schema": "isolated-scene-pipeline-v1", "workspace_policy": POLICY, "source_checkout": str(root),
              "revision": revision, "component_sources": template.get("component_sources", {}),
              "template_catalog": str(Path(template["template_catalog"]).resolve()),
              "case_input": str(out / "case-input.json"),
              "guide": str(Path(template["guide"]).resolve()),
              "allowed_test_roots": template.get("allowed_test_roots", catalog.get("test_roots", [])),
              "coverage": coverage,
              "output_dir": str(Path(template["case_run_dir"]).resolve())}
    if definitions:
        config['definitions'] = template['definitions']
    for key in ("fresh_env_root_key", "fresh_env_paths", "evidence_env_dir_keys",
                "evidence_log_prefix", "evidence_relative_paths", "evidence_execution_relative_paths", "evidence_globs",
                "evidence_max_bytes", "rerun_safe_after_interruption", "max_review_repairs",
                "resume_safe_after_local_loopback", "scope_note"):
        if key in template:
            config[key] = template[key]
    strategy = template.get('case_strategy', 'implement')
    if strategy not in ('implement', 'existing_only'):
        raise ValueError('case_strategy must be implement or existing_only')
    config['case_strategy'] = strategy
    case_input['case_strategy'] = strategy
    config['case_evaluation'] = template.get('case_evaluation', True)
    if type(config['case_evaluation']) is not bool:
        raise ValueError('case_evaluation must be boolean')
    out.mkdir(parents=True)
    (out / "case-input.json").write_text(json.dumps(case_input, ensure_ascii=False, indent=2) + "\n")
    (out / "config.json").write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n")
    (out / "terminal.json").write_text(json.dumps({"status": "bound", "template_sha256": sha(template_path),
        "scenario_sha256": sha(scenes_path), "case_input_sha256": sha(out / "case-input.json"),
        "config_sha256": sha(out / "config.json")}, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"config": str(out / "config.json"), "scene_id": scene["id"]}))


def legacy_input(request, scene, scenes_path, template):
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
    case_input = {"acceptance": template["acceptance"],"requirement": target, "scene": scene,
                  "business_goal": request["analysis"]["business_goal"],
                  "confirmed_scope": request["analysis"]["confirmed_scope"],
                  "related_requirements": related,
                  "scenario_source_path": str(scenes_path),
                  "scenario_source_sha256": sha(scenes_path),
                  "scenario_self_check": "internal",
                  "local_loopback_required": bool(template.get("local_loopback_required", False))}
    return case_input


if __name__ == "__main__":
    main()
