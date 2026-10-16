#!/usr/bin/env python3
"""Local, dependency-free structural gates for app delivery acceptance."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import shutil
import subprocess
from urllib.parse import quote
import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent
GATES = json.loads((SKILL_ROOT / "playbook" / "gates.json").read_text(encoding="utf-8"))["gates"]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from storage import asset_directory, test_directory
from code_coverage import MODES, selected_mode, errors_for_run
import priorities
import white_box_rules
import output_quality
import design_quality
import acceptance_plan
import design_pipeline
import scenario_execution as lifecycle
import execution_coverage
RUN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")


def fail(message):
    raise ValueError(message)


def verify_project_binding(ledger, project_root):
    project = read_json(ledger / "project.json")
    bound = project.get("project_root") if isinstance(project, dict) else None
    if bound and Path(bound).resolve() != project_root.resolve():
        fail(f"test assets belong to a different project: {bound}")


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"missing file: {path}")
    except json.JSONDecodeError as error:
        fail(f"invalid JSON in {path}: {error}")


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    lifecycle.atomic_json(path, value)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def coverage_scope_hashes(ledger):
    """Pin requirement-derived complete scenarios including embedded acceptance."""
    scenarios = [item for item in items(read_json(ledger / "scenarios.json")) if isinstance(item, dict) and item.get("kind") == "black_box"]
    def hash_json(value):
        return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    document = obj(read_json(ledger / "scenarios.json"))
    design = {"items": scenarios, "design_standard": document.get("design_standard"), "design_basis": document.get("design_basis")}
    result = {"requirements_sha256": digest(ledger / "requirements.json"), "scenarios_sha256": hash_json(design)}
    if acceptance_plan.required(ledger):
        result["acceptance_plan_sha256"] = acceptance_plan.file_hash(ledger / acceptance_plan.NAME)
    return result


def filled(value):
    return isinstance(value, str) and bool(value.strip())


def filled_basis(value):
    return filled(value) or (isinstance(value, list) and bool(value) and all(filled(item) for item in value))


def items(value, key="items"):
    return value.get(key) if isinstance(value, dict) and isinstance(value.get(key), list) else []


def obj(value):
    return value if isinstance(value, dict) else {}


def language_override(ledger):
    """Return an explicit session language, if the launcher fixed one."""
    policy = obj(read_json(ledger / 'output-language-policy.json')) if (ledger / 'output-language-policy.json').is_file() else {}
    value = output_quality.explicit_language(policy.get('language')) if policy.get('mode') == 'explicit' else None
    return value


def unique_ids(records, label, errors):
    found = {}
    for position, record in enumerate(records):
        identifier = record.get("id") if isinstance(record, dict) else None
        if not filled(identifier):
            errors.append(f"{label}[{position}] needs an id")
        elif identifier in found:
            errors.append(f"duplicate {label} id: {identifier}")
        else:
            found[identifier] = record
    return found


def evidence_file(root, reference, label, errors):
    if not filled(reference):
        errors.append(f"{label} needs an evidence path")
        return
    base = root.resolve()
    candidate = (base / reference).resolve()
    try:
        candidate.relative_to(base)
    except ValueError:
        errors.append(f"{label} evidence escapes its directory: {reference}")
        return
    if not candidate.is_file() or candidate.stat().st_size == 0:
        errors.append(f"{label} evidence is missing or empty: {reference}")


def gate(result, name, errors):
    result[name] = {"status": "passed" if not errors else "blocked", "issues": errors}


def coverage_review_errors(ledger, requirement_map, scenario_map):
    """Validate the independent counterfactual review's traceable structure."""
    errors = []
    path = ledger / "coverage_review.json"
    if not path.is_file():
        return ["independent coverage_review.json is missing"]
    review = obj(read_json(path))
    errors.extend(design_quality.review_errors(review, obj(read_json(ledger / "scenarios.json")), requirement_map, scenario_map))
    if review.get("status") != "passed" or not filled(review.get("basis")):
        errors.append("independent coverage review needs passed status and a concrete basis")
    for field, expected in coverage_scope_hashes(ledger).items():
        if review.get(field) != expected:
            errors.append(f"coverage review is stale for {field}")
    reviewed = {}
    reviewed_scenarios = set()
    for position, item in enumerate(items(review)):
        if not isinstance(item, dict) or not filled(item.get("requirement_id")):
            errors.append(f"coverage review[{position}] needs requirement_id")
            continue
        identifier = item["requirement_id"]
        if identifier in reviewed:
            errors.append(f"duplicate coverage review for {identifier}")
        reviewed[identifier] = item
        if identifier not in requirement_map:
            errors.append(f"coverage review links unknown requirement {identifier}")
            continue
        if item.get("verdict") != "sufficient" or not filled(item.get("reason")):
            errors.append(f"requirement {identifier} lacks a reasoned sufficient verdict")
        if item.get("uncovered_paths") != []:
            errors.append(f"requirement {identifier} has uncovered paths or omits an empty uncovered_paths list")
        modes = item.get("operation_modes")
        states = item.get("user_states")
        if not isinstance(modes, list) or not modes or any(not filled(value) for value in modes) or len(modes) != len(set(modes)):
            errors.append(f"requirement {identifier} needs distinct important operation modes")
            modes = []
        if not isinstance(states, list) or not states or any(not filled(value) for value in states) or len(states) != len(set(states)):
            errors.append(f"requirement {identifier} needs distinct important user states")
            states = []
        probes = item.get("fault_probes")
        if not isinstance(probes, list) or not probes:
            errors.append(f"requirement {identifier} needs counterfactual fault probes")
            probes = []
        covered_modes, covered_states = set(), set()
        for index, probe in enumerate(probes):
            if not isinstance(probe, dict):
                errors.append(f"requirement {identifier} fault probe[{index}] is invalid")
                continue
            mode, state = probe.get("mode"), probe.get("state")
            if not filled(mode) or mode not in modes or not filled(state) or state not in states:
                errors.append(f"requirement {identifier} fault probe[{index}] needs a declared mode and state")
            else:
                covered_modes.add(mode)
                covered_states.add(state)
            if not filled(probe.get("plausible_fault")) or not filled(probe.get("failure_signal")):
                errors.append(f"requirement {identifier} fault probe[{index}] needs a plausible fault and observable failure signal")
            scenario_ids = probe.get("scenario_ids")
            if not isinstance(scenario_ids, list) or not scenario_ids:
                errors.append(f"requirement {identifier} fault probe[{index}] needs linked scenarios")
                continue
            for scenario_id in scenario_ids:
                if not filled(scenario_id):
                    errors.append(f"requirement {identifier} fault probe[{index}] has an invalid scenario ID")
                    continue
                scenario = scenario_map.get(scenario_id)
                if not scenario or identifier not in scenario.get("requirement_ids", []):
                    errors.append(f"requirement {identifier} fault probe[{index}] links unrelated scenario {scenario_id}")
                else:
                    reviewed_scenarios.add(scenario_id)
        for mode in set(modes) - covered_modes:
            errors.append(f"requirement {identifier} has no fault probe for operation mode {mode}")
        for state in set(states) - covered_states:
            errors.append(f"requirement {identifier} has no fault probe for user state {state}")
    for identifier in requirement_map:
        if identifier not in reviewed:
            errors.append(f"requirement {identifier} has no independent coverage review")
    for identifier in scenario_map:
        if identifier not in reviewed_scenarios:
            errors.append(f"scenario {identifier} has no independent counterfactual review")
    errors.extend(output_quality.review_errors(review.get("output_quality"), {"scenarios": set(scenario_map), "acceptance": set(scenario_map)}, "black-box output quality review"))
    errors.extend(priorities.review_errors(review.get("priority_reviews"), scenario_map))
    return errors


def validate_black_box(project_root, test_dir=None):
    """Check requirement-derived scenarios without requiring an implemented app."""
    root = project_root.resolve()
    ledger = asset_directory(root, test_dir)
    verify_project_binding(ledger, root)
    project = read_json(ledger / "project.json")
    requirements = read_json(ledger / "requirements.json")
    scenarios = read_json(ledger / "scenarios.json")
    report = {"test_dir": str(test_directory(root, test_dir)), "assets": str(ledger), "project": str(root), "stage": "black-box", "gates": {}, "status": "blocked"}

    errors = []
    if not isinstance(project, dict) or not filled(project.get("requirements_sha256")):
        errors.append("project.json needs requirements_sha256")
    elif digest(ledger / "requirements.json") != project["requirements_sha256"]:
        errors.append("requirements snapshot changed without import-requirements")
    if not isinstance(requirements, dict) or not filled(requirements.get("source")) or not filled(requirements.get("version")):
        errors.append("requirements need source and version from the confirmation stage")
    requirement_map = unique_ids(items(requirements), "requirement", errors)
    if not requirement_map:
        errors.append("confirmed requirements list is empty")
    for identifier, requirement in requirement_map.items():
        if not filled(requirement.get("text")):
            errors.append(f"requirement {identifier} needs text")
    if acceptance_plan.required(ledger):
        errors.extend(acceptance_plan.definition_errors(ledger))
    gate(report["gates"], "requirements", errors)
    requirement_map = acceptance_plan.selected_requirements(ledger, requirement_map)

    errors = []
    if not isinstance(scenarios, dict) or scenarios.get("black_box_complete") is not True:
        errors.append("black-box scenario review is incomplete")
    black_box_items = [item for item in items(scenarios) if isinstance(item, dict) and item.get("kind") == "black_box"]
    scenario_map = unique_ids(black_box_items, "scenario", errors)
    method_map = design_quality.acceptance_map(scenario_map)
    errors.extend(output_quality.design_errors(scenario_map, method_map, requirement_map, language_override(ledger)))
    errors.extend(design_quality.basis_errors(obj(scenarios), requirement_map, scenario_map, method_map))
    black_box_reqs = set()
    for identifier, scenario in scenario_map.items():
        errors.extend(priorities.classification_errors(identifier, scenario))
        if scenario.get("kind") != "black_box":
            continue
        if not filled(scenario.get("title")) or not filled(scenario.get("expected")):
            errors.append(f"black-box scenario {identifier} needs title and expected result")
        req_ids = scenario.get("requirement_ids")
        if not isinstance(req_ids, list) or not req_ids:
            errors.append(f"scenario {identifier} has no requirement or reverse-rule link")
            req_ids = []
        for req_id in req_ids:
            if not filled(req_id) or req_id not in requirement_map:
                errors.append(f"scenario {identifier} links unknown requirement {req_id}")
            else:
                black_box_reqs.add(req_id)

    for identifier in requirement_map:
        if identifier not in black_box_reqs:
            errors.append(f"requirement {identifier} has no black-box scenario")
    gate(report["gates"], "black_box_scenarios", errors)
    review_errors = coverage_review_errors(ledger, requirement_map, scenario_map)
    if acceptance_plan.required(ledger):
        review_errors.extend(design_pipeline.generation_errors(ledger))
        review_errors.extend(acceptance_plan.scenario_errors(ledger, list(scenario_map.values()), obj(read_json(ledger / "coverage_review.json")), stage="black-box"))
    gate(report["gates"], "coverage_review", review_errors)
    if all(value["status"] == "passed" for value in report["gates"].values()):
        report["status"] = "black_box_ready"
    return report


def validate_white_box(project_root, test_dir=None):
    ledger = asset_directory(project_root, test_dir)
    verify_project_binding(ledger, project_root)
    req = obj(read_json(ledger / 'requirements.json'))
    requirement_map = {r['id']: r for r in items(req)}
    project = obj(read_json(ledger / 'project.json'))
    requirement_errors = acceptance_plan.plan_review_errors(ledger)
    if project.get('requirements_sha256') != digest(ledger / 'requirements.json'):
        requirement_errors.append('requirements snapshot changed without import-requirements')
    document = obj(read_json(ledger / 'scenarios.json'))
    scenes = items(document)
    errors = design_pipeline.generation_errors(ledger)
    scene_map = unique_ids(scenes, 'white-box scenario', errors)
    if document.get('white_box_complete') is not True:
        errors.append('white-box design is incomplete')
    if any(s.get('kind') != 'white_box' for s in scenes):
        errors.append('white-box-only design cannot contain black-box scenes')
    errors.extend(white_box_rules.definitions_errors(project_root.resolve(), ledger, scenes, set(requirement_map)))
    errors.extend(output_quality.design_errors(scene_map, design_quality.acceptance_map(scene_map), requirement_map, language_override(ledger)))
    for sid, scene in scene_map.items():
        errors.extend(priorities.classification_errors(sid, scene))
        if not filled(scene.get('target_condition')) or not filled(scene.get('expected')):
            errors.append(f'white-box scenario {sid} needs actual target condition and expected result')
    review = obj(read_json(ledger / 'coverage_review.json'))
    white_review = obj(review.get('white_box_priority_review'))
    errors.extend(priorities.white_box_review_errors(ledger, scenes, review))
    errors.extend(white_box_rules.review_errors(ledger, scenes, white_review))
    errors.extend(output_quality.review_errors(white_review.get('output_quality'), {'scenarios':set(scene_map),'acceptance':set(scene_map)}, 'white-box output quality review'))
    errors.extend(acceptance_plan.scenario_errors(ledger, scenes, review, stage='white-box'))
    report = {'project':str(project_root.resolve()),'assets':str(ledger),'gates':{},'status':'blocked'}
    gate(report['gates'],'requirements',requirement_errors)
    gate(report['gates'],'white_box_scenarios',errors)
    if not requirement_errors and not errors:report['status']='white_box_ready'
    return report


def validate(project_root, run_id=None, test_dir=None, coverage_mode=None):
    root = project_root.resolve()
    ledger = asset_directory(root, test_dir)
    verify_project_binding(ledger, root)
    report = {"test_dir": str(test_directory(root, test_dir)), "assets": str(ledger), "project": str(root), "run_id": run_id, "gates": {}, "status": "blocked"}
    required = ["project.json", "requirements.json", "resources.json", "scenarios.json", "coverage_review.json"]
    files = {name: read_json(ledger / name) for name in required}
    project = files["project.json"]
    requirements = files["requirements.json"]
    resources = files["resources.json"]
    scenarios = files["scenarios.json"]

    errors = []
    if not isinstance(project, dict) or not filled(project.get("requirements_sha256")):
        errors.append("project.json needs requirements_sha256")
    elif digest(ledger / "requirements.json") != project["requirements_sha256"]:
        errors.append("requirements snapshot changed without import-requirements")
    if not isinstance(requirements, dict) or not filled(requirements.get("source")) or not filled(requirements.get("version")):
        errors.append("requirements need source and version from the confirmation stage")
    requirement_map = unique_ids(items(requirements), "requirement", errors)
    if not requirement_map:
        errors.append("confirmed requirements list is empty")
    for identifier, requirement in requirement_map.items():
        if not filled(requirement.get("text")):
            errors.append(f"requirement {identifier} needs text")
    if acceptance_plan.required(ledger):
        errors.extend(acceptance_plan.definition_errors(ledger))
    gate(report["gates"], "requirements", errors)
    requirement_map = acceptance_plan.selected_requirements(ledger, requirement_map)

    errors = []
    if not isinstance(resources, dict) or resources.get("discovery_complete") is not True:
        errors.append("dependency discovery is not marked complete")
    if not isinstance(resources, dict) or not filled(resources.get("discovery_basis")):
        errors.append("dependency discovery needs a source/basis description")
    if acceptance_plan.required(ledger):
        errors.extend(acceptance_plan.resource_errors(ledger, resources, files["coverage_review.json"]))
    decision_map = unique_ids([d for d in items(resources, "decisions") if not acceptance_plan.required(ledger) or d.get("scope", {}).get("status") != "out_of_scope"], "dependency", errors)
    for identifier, decision in decision_map.items():
        kind = decision.get("kind")
        if kind not in ("local", "third_party") or not filled(decision.get("description")):
            errors.append(f"dependency {identifier} needs kind and description")
        verification = obj(decision.get("verification"))
        if verification.get("status") != "passed":
            errors.append(f"dependency {identifier} has no passed preflight verification")
        evidence_file(ledger, verification.get("evidence"), f"dependency {identifier} verification", errors)
        if kind != "third_party":
            continue
        mock_available = decision.get("mock_available")
        mode = decision.get("mode")
        if not isinstance(mock_available, bool) or mode not in ("mock", "real", "blocked"):
            errors.append(f"third-party dependency {identifier} needs Mock availability and mode")
        elif mock_available and mode != "mock":
            errors.append(f"third-party dependency {identifier}: viable Mock requires Mock E2E")
        elif mode == "mock" and not filled(decision.get("mock_ref")):
            errors.append(f"third-party dependency {identifier}: Mock reference is missing")
        elif mode == "real" and (mock_available or decision.get("credential_reusable") is not True or not filled(decision.get("credential_ref"))):
            errors.append(f"third-party dependency {identifier}: real E2E needs no viable Mock and reusable credentials")
        elif mode == "blocked":
            errors.append(f"third-party dependency {identifier} is blocked")
        if not filled(decision.get("reason")):
            errors.append(f"third-party dependency {identifier} needs a decision reason")
        if acceptance_plan.required(ledger) and decision.get("scope", {}).get("integration_scope") == "excluded":
            continue
        integration = obj(decision.get("integration"))
        if integration.get("status") != "passed" or not filled(integration.get("tested_version")):
            errors.append(f"third-party dependency {identifier}: real integration is not verified for a version")
        evidence_file(ledger, integration.get("evidence"), f"dependency {identifier} integration", errors)
    gate(report["gates"], "resources", errors)

    errors = []
    if not isinstance(scenarios, dict) or scenarios.get("black_box_complete") is not True:
        errors.append("black-box scenario review is incomplete")
    errors.extend(white_box_rules.definitions_errors(root, ledger, items(scenarios), set(requirement_map)))
    if not isinstance(scenarios, dict) or scenarios.get("white_box_complete") is not True:
        errors.append("white-box scenario review is incomplete")
    scenario_map = unique_ids(items(scenarios), "scenario", errors)
    method_map = design_quality.acceptance_map(scenario_map)
    errors.extend(output_quality.design_errors(scenario_map, method_map, requirement_map, language_override(ledger)))
    errors.extend(design_quality.basis_errors(obj(scenarios), requirement_map, {sid: s for sid, s in scenario_map.items() if s.get("kind") == "black_box"}, method_map))
    black_box_reqs = set()
    for identifier, scenario in scenario_map.items():
        errors.extend(priorities.classification_errors(identifier, scenario))
        kind = scenario.get("kind")
        if kind not in ("black_box", "white_box") or not filled(scenario.get("title")) or not filled(scenario.get("expected")):
            errors.append(f"scenario {identifier} needs kind, title, and expected result")
        req_ids = scenario.get("requirement_ids")
        if not isinstance(req_ids, list) or not req_ids and not (kind == "white_box" and scenario.get("reverse_rule_ids")):
            errors.append(f"scenario {identifier} has no requirement or reverse-rule link")
            req_ids = []
        for req_id in req_ids:
            if not filled(req_id) or req_id not in requirement_map:
                errors.append(f"scenario {identifier} links unknown requirement {req_id}")
            elif kind == "black_box":
                black_box_reqs.add(req_id)
        if kind == "white_box" and not filled(scenario.get("target_condition")):
            errors.append(f"white-box scenario {identifier} needs target_condition")
    for identifier in requirement_map:
        if identifier not in black_box_reqs:
            errors.append(f"requirement {identifier} has no black-box scenario")
    errors.extend(coverage_review_errors(ledger, requirement_map, {identifier: item for identifier, item in scenario_map.items() if item.get("kind") == "black_box"}))
    errors.extend(priorities.white_box_review_errors(ledger, list(scenario_map.values()), obj(read_json(ledger / "coverage_review.json"))))
    white_scenes = {sid: v for sid, v in scenario_map.items() if v.get("kind") == "white_box"}
    white_review = obj(obj(read_json(ledger / "coverage_review.json")).get("white_box_priority_review"))
    errors.extend(white_box_rules.review_errors(ledger, list(scenario_map.values()), white_review))
    errors.extend(output_quality.review_errors(white_review.get("output_quality"), {"scenarios": set(white_scenes), "acceptance": set(white_scenes)}, "white-box output quality review"))
    if acceptance_plan.required(ledger):
        errors.extend(design_pipeline.generation_errors(ledger))
        errors.extend(acceptance_plan.scenario_errors(ledger, list(scenario_map.values()), files["coverage_review.json"]))
    gate(report["gates"], "scenarios", errors)

    if acceptance_plan.required(ledger):
        report["acceptance_scope"] = acceptance_plan.conclusion(ledger)
    if run_id is None:
        if all(gate_data["status"] == "passed" for gate_data in report["gates"].values()):
            report["status"] = "ready_for_run"
        return report
    if not RUN_ID.fullmatch(run_id):
        fail("run id must contain only letters, numbers, dots, underscores, or hyphens")
    run_dir = ledger / "runs" / run_id
    run = obj(read_json(run_dir / "run.json"))
    recorded_mode = selected_mode(run.get("acceptance_mode", "standard"))
    requested_mode = coverage_mode or os.environ.get("DELIVERY_ACCEPTANCE_COVERAGE_MODE") or recorded_mode
    requested_mode = selected_mode(requested_mode)
    report["acceptance_mode"] = requested_mode
    errors = []
    if recorded_mode != requested_mode:
        errors.append("run acceptance mode differs from selected mode; create a new run")
    if not isinstance(run, dict) or not filled(run.get("revision")) or not filled(run.get("environment")):
        errors.append("run needs revision and environment")
    ledger_hashes = obj(run.get("ledger_hashes"))
    if acceptance_plan.required(ledger) or acceptance_plan.NAME in ledger_hashes:
        required += [acceptance_plan.NAME, acceptance_plan.REVIEW, acceptance_plan.DECISIONS, acceptance_plan.POLICY]
        try:
            acceptance_plan.assert_current(ledger, run)
        except ValueError as error:
            errors.append(str(error))
    if (ledger / white_box_rules.NAME).exists() or white_box_rules.NAME in ledger_hashes:
        required = [*required, white_box_rules.NAME]
    for name in required:
        if not (ledger / name).is_file() or ledger_hashes.get(name) != digest(ledger / name):
            errors.append(f"{name} changed after run creation; create a new run")
    plan = None
    plan_valid = True
    try:
        plan = priorities.load_plan(run_dir, run, list(scenario_map.values()), ledger)
    except (ValueError, TypeError, KeyError, OSError) as error:
        plan_valid = False
        errors.append(f"invalid execution plan: {error}")
    errors.extend(priorities.execution_errors(plan, list(scenario_map.values()), items(run, "results")))
    dependency_checks = items(run, "dependency_checks")
    check_map = {entry["dependency_id"]: entry for entry in dependency_checks if isinstance(entry, dict) and filled(entry.get("dependency_id"))}
    for identifier in decision_map:
        entry = check_map.get(identifier)
        if not entry or entry.get("status") != "passed":
            errors.append(f"dependency {identifier} was not checked for this run")
        else:
            evidence_file(ledger, entry.get("evidence"), f"run dependency {identifier}", errors)
    result_map = {}
    for entry in items(run, "results"):
        if not isinstance(entry, dict) or not filled(entry.get("scenario_id")):
            errors.append("run result needs scenario_id")
            continue
        identifier = entry["scenario_id"]
        if identifier in result_map:
            errors.append(f"duplicate run result for {identifier}")
        result_map[identifier] = entry
        if identifier not in scenario_map:
            errors.append(f"run result has unknown scenario {identifier}")
            continue
        if entry.get("status") not in ("passed", "failed", "unproven", "blocked", "not_run"):
            errors.append(f"scenario {identifier} needs a valid run status")
        elif entry["status"] != "passed":
            errors.append(f"scenario {identifier} is {entry['status']}")
        if entry.get("status") == "not_run":
            continue
        if not filled(entry.get("actual")):
            errors.append(f"scenario {identifier} needs actual observations")
        evidence = entry.get("evidence")
        if not isinstance(evidence, list) or not evidence:
            errors.append(f"scenario {identifier} has no run evidence")
        else:
            for reference in evidence:
                evidence_file(run_dir, reference, f"scenario {identifier}", errors)
    for identifier in scenario_map:
        if identifier not in result_map:
            errors.append(f"scenario {identifier} has no run result")
    errors.extend(lifecycle.completion_errors(root, ledger, run_dir, run))
    gate(report["gates"], "execution", errors)

    errors = []
    review = {}
    review_path = run_dir / "review.json"
    if not review_path.exists():
        errors.append("review.json is missing")
    else:
        review = obj(read_json(review_path))
        if review.get("revision") != run.get("revision"):
            errors.append("review revision does not match run revision")
        reviewer_kind = review.get("reviewer_kind")
        if reviewer_kind not in ("playbook", "independent_ai", "self"):
            errors.append("reviewer_kind must identify playbook, independent_ai, or self")
        if reviewer_kind in ("playbook", "independent_ai") and not filled(review.get("review_reference")):
            errors.append("independent review needs a review_reference")
        errors.extend(output_quality.summary_errors(review.get("summary"), "final review"))
        scope = obj(review.get("scope"))
        for field in ("included", "excluded", "limitations"):
            if not isinstance(scope.get(field), list) or (field == "included" and not scope[field]) or not all(output_quality.meaningful(v) for v in scope.get(field, [])):
                errors.append("final review scope needs substantive included/excluded/limitations lists")
        if not isinstance(review.get("recommendations"), list) or not all(output_quality.meaningful(v) for v in review.get("recommendations", [])):
            errors.append("final review needs a substantive recommendations list (empty only when no action remains)")
        quality_artifacts = dict.fromkeys(("project", "resources", "execution", "evidence", "issues"))
        if recorded_mode == "coverage": quality_artifacts["code_coverage"] = None
        errors.extend(output_quality.review_errors(review.get("output_quality"), quality_artifacts, "final output quality review"))
        coverage = obj(review.get("coverage"))
        if coverage.get("status") != "passed" or not filled(coverage.get("reason")):
            errors.append("coverage review is not passed with a reason")
        reviewed_requirements = coverage.get("requirements_reviewed")
        if not isinstance(reviewed_requirements, list) or any(not filled(value) for value in reviewed_requirements) or set(reviewed_requirements) != set(requirement_map):
            errors.append("coverage review does not enumerate every confirmed requirement")
        if not filled_basis(coverage.get("white_box_basis")):
            errors.append("coverage review needs the design/code basis for white-box assessment")
        uncovered = coverage.get("uncovered_branches")
        if not isinstance(uncovered, list) or uncovered:
            errors.append("coverage review has unassessed or uncovered branches")
        reviewed = {}
        for entry in items(review, "results"):
            if not isinstance(entry, dict) or not filled(entry.get("scenario_id")):
                errors.append("scenario review needs scenario_id")
                continue
            identifier = entry["scenario_id"]
            if identifier in reviewed:
                errors.append(f"duplicate scenario review for {identifier}")
            reviewed[identifier] = entry
            if identifier not in scenario_map:
                errors.append(f"review has unknown scenario {identifier}")
                continue
            if entry.get("status") != "passed" or not filled(entry.get("reason")):
                errors.append(f"scenario {identifier} lacks a passed, reasoned evidence review")
            references = entry.get("evidence")
            run_evidence = (result_map.get(identifier) or {}).get("evidence") or []
            if not isinstance(references, list) or not references or any(ref not in run_evidence for ref in references):
                errors.append(f"scenario {identifier} review does not cite its run evidence")
        for identifier in scenario_map:
            if identifier not in reviewed:
                errors.append(f"scenario {identifier} has no evidence review")
    errors.extend(lifecycle.completion_errors(root, ledger, run_dir, run, review))
    gate(report["gates"], "review", errors)
    if acceptance_plan.required(ledger):
        report["acceptance_result"] = "selected_scope_only" if not report["acceptance_scope"]["original_requirements_complete"] else "full_original_scope"
    report["priority_summary"] = priorities.summary(list(scenario_map.values()), items(run, "results"), items(review, "results"), run=run, review_record=review, evidence_root=run_dir, binding_current=plan_valid and all((ledger / name).is_file() and ledger_hashes.get(name) == digest(ledger / name) for name in required))
    report["execution_policy"] = plan["policy"] if plan else priorities.DEFAULT_POLICY
    if requested_mode == "coverage" or recorded_mode == "coverage":
        gate(report["gates"], "code_coverage", errors_for_run(root, ledger, run_dir, run))
    if all(result["status"] == "passed" for result in report["gates"].values()):
        report["status"] = "passed"
    return report


def render_markdown(report, run, scenarios, review=None):
    review = obj(review)
    def cell(value):
        return str(value or "").replace("\r", " ").replace("\n", " ").replace("|", "\\|").replace("<", "&lt;").replace(">", "&gt;")
    status_names = {"passed": "通过", "failed": "发现产品 BUG", "execution_error": "AI 无法完成执行", "unproven": "未证明", "blocked": "阻断", "not_run": "未执行", "unreviewed": "未评估"}
    names = {"passed": "全部验收门禁通过", "blocked": "尚未满足交付验收", "incomplete": "部分执行，验收未完成"}
    lines = ["# 交付验收报告", "", "## 验收结论", "", names.get(report["status"], report["status"]), ""]
    if review.get("summary"): lines.extend([review["summary"], ""])
    scope = obj(review.get("scope"))
    lines.extend(["## 验证范围与边界", ""])
    for key, label in (("included", "已纳入"), ("excluded", "未纳入"), ("limitations", "适用限制")):
        values = scope.get(key, [])
        if values:
            lines.append("**" + label + "**")
            lines.extend("- " + str(v) for v in values)
            lines.append("")
    grouped = report.get("priority_summary") or priorities.summary(items(scenarios), items(run, "results"), items(review, "results"))
    policy = report.get("execution_policy", priorities.DEFAULT_POLICY)
    selection = run.get("selected_scenario_ids")
    scope_label = f"指定 {len(selection)} 个场景，按重要度顺序执行" if selection is not None else f"P0 至 {policy['max_priority']}"
    lines.extend([f"执行范围：{scope_label}；本轮时间上限：{policy['time_limit_minutes'] or '未设置'} 分钟。", "",
                  "## 按重要度统计", "", "| 等级 | 总数 | 执行通过 | 独立审查通过 | 产品失败 | 阻塞 | 未证明 | 未测 | AI 执行异常 |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"])
    for priority, counts in grouped["by_priority"].items():
        if priority == "unclassified" and not counts["total"]: continue
        priority = "未分级" if priority == "unclassified" else priority
        lines.append("| " + " | ".join(str(v) for v in [priority, *[counts[k] for k in ("total", "passed", "reviewed", "failed", "blocked", "unproven", "not_run", "execution_error")]]) + " |")
    lines.extend(["", "执行通过与独立审查通过分别统计；部分范围验证不代表完整交付验收。", "", "## 场景结果", "", "| 等级 | 场景 | 执行观察 | 独立判定 | 证据 |", "| --- | --- | --- | --- | --- |"])
    results = {v.get("scenario_id"): v for v in items(run, "results") if isinstance(v, dict)}
    reviews = {v.get("scenario_id"): v for v in items(review, "results") if isinstance(v, dict)}
    # Per-scene reviews are the source of independent conclusions during execution.
    reviews.update({v.get("scenario_id"): v for v in items(run, "scenario_reviews") if isinstance(v, dict)})
    ordered = priorities.ordered(items(scenarios))
    for index, scene in enumerate(ordered):
        sid = scene.get("id", "?"); result = results.get(sid, {}); verdict = reviews.get(sid, {})
        execution = {"passed": "执行通过", "failed": "执行失败", "blocked": "执行受阻", "unproven": "尚未证明", "not_run": "未执行", "execution_error": "执行异常"}.get(result.get("status"), "待执行") + "：" + (result.get("summary") or result.get("reason") or "尚无业务观察摘要")
        judgment = status_names.get(verdict.get("status"), "尚未评估") + ("：" + verdict["summary"] if verdict.get("summary") else "")
        count = len(result.get("evidence", []))
        lines.append(f"| {cell(scene.get('priority', '未分级'))} | {cell(scene.get('title', sid))}（{cell(sid)}） | {cell(execution)} | {cell(judgment)} | [{count}份](#scenario-{index + 1}) |")
    lines.extend(["", "## 发现的问题与剩余风险", ""])
    if grouped["p0_risk_unresolved"]: lines.extend(["**P0关键风险尚未排除。**", ""])
    issue_scenes = {v.get("scenario_id") for v in items(run, "issues")}
    for issue in items(run, "issues"):
        lines.append("- " + cell(issue.get("summary") or issue.get("reason")) + "（" + cell(issue.get("scenario_id")) + "）")
    for risk in grouped["remaining_risks"]:
        if risk["scenario_id"] in issue_scenes: continue
        lines.append(f"- {risk['priority']} / {risk['scenario_id']}：{risk['risk']}；{risk['reason']}")
    if not grouped["remaining_risks"] and not items(run, "issues"): lines.append("本轮记录中没有尚未通过独立证据审查的场景；完整验收仍以全部门禁为准。")
    lines.extend(["", "## 后续建议", ""])
    actions = review.get("recommendations", [])
    lines.extend("- " + str(v) for v in actions)
    if not actions: lines.append("本轮没有记录额外建议；未解决的门禁问题及剩余风险仍须处理。")
    lines.extend(["", "## 证据索引", ""])
    for index, scene in enumerate(ordered):
        sid = scene.get("id", "?"); result = results.get(sid, {})
        lines.extend([f'<a id="scenario-{index + 1}"></a>', "", "### " + scene.get("title", sid), "", "场景：`" + sid + "`；需求：" + ", ".join(scene.get("requirement_ids", [])), ""])
        details = {v.get("path"): v for v in result.get("evidence_details", []) if isinstance(v, dict)}
        refs = result.get("evidence", [])
        if len(refs) > 20:
            lines.extend([f"已登记{len(refs)}份证据；按步骤与判据关联详见查看器的“已收集证据”及run.json。", ""])
        else:
            for ref in refs:
                info = details.get(ref, {})
                lines.append("- [" + info.get("name", "原始证据") + "](" + quote(ref, safe="/") + ")" + ("；证明：" + info['criterion'] if info.get('criterion') else ""))
            if not refs: lines.append("尚无本轮执行证据。")
            lines.append("")
    lines.extend(["## 技术门禁与运行追踪", "", f"修订：`{run.get('revision', '')}`；环境：{run.get('environment', '')}；审查角色：{review.get('reviewer_kind', 'unreviewed')}。", ""])
    for name, result in report["gates"].items():
        definition = next((v for v in GATES if v['id'] == name), {'purpose': '可选代码覆盖率检查'})
        lines.append(f"- **{name} — {result['status']}**：{definition['purpose']}")
        if result.get("issues"):
            lines.extend(["", "<details><summary>" + str(len(result['issues'])) + "项原始诊断</summary>", ""])
            lines.extend("- " + cell(v) for v in result['issues'])
            lines.extend(["", "</details>", ""])
    lines.extend(["", "本报告仅描述本轮保存记录和门禁检查；完整判断可追溯至本轮run.json、review.json及原始证据。", ""])
    return "\n".join(lines)


def import_requirements(project_root, source, initialize=False, test_dir=None):
    source = source.resolve()
    source_data = read_json(source)
    if not isinstance(source_data, dict) or not filled(source_data.get("source")) or not filled(source_data.get("version")) or not items(source_data):
        fail("confirmed requirements JSON needs source, version, and nonempty items")
    ledger = asset_directory(project_root, test_dir)
    if initialize:
        if not project_root.is_dir():
            fail(f"project directory does not exist: {project_root}")
        managed = ("project.json", "resources.json", "scenarios.json", "coverage_review.json", "runs")
        if any((ledger / name).exists() for name in managed):
            fail(f"ledger already exists or contains conflicting assets: {ledger}")
        if (ledger / "requirements.json").exists() and source != (ledger / "requirements.json").resolve():
            fail(f"requirements snapshot already exists: {ledger / 'requirements.json'}")
        ledger.mkdir(parents=True, exist_ok=True)
        if os.environ.get("DELIVERY_ACCEPTANCE_SCOPE_REQUIRED") == "1":
            write_json(ledger / acceptance_plan.POLICY, {"standard": acceptance_plan.STANDARD, "required": True})
            write_json(ledger / acceptance_plan.DECISIONS, {"version": 1, "items": []})
        write_json(ledger / "project.json", {"name": project_root.name, "project_root": str(project_root.resolve()), "test_dir": str(test_directory(project_root, test_dir)), "app_start": "", "test_commands": [], "device_targets": [], "requirements_source": source_data["source"], "requirements_sha256": ""})
        write_json(ledger / "resources.json", {"discovery_complete": False, "discovery_basis": "", "decisions": []})
        write_json(ledger / "white_box_rules.json", {"version": 1, "items": []})
        write_json(ledger / "scenarios.json", {"black_box_complete": False, "white_box_complete": False, "items": []})
        write_json(ledger / "coverage_review.json", {"status": "unreviewed", "basis": "", "requirements_sha256": "", "scenarios_sha256": "", "items": []})
        (ledger / "runs").mkdir()
    elif not ledger.is_dir():
        fail("initialize this project before importing requirements")
    verify_project_binding(ledger, project_root)
    if source != (ledger / "requirements.json").resolve():
        shutil.copyfile(source, ledger / "requirements.json")
    project = read_json(ledger / "project.json")
    project["requirements_source"] = source_data["source"]
    project["requirements_sha256"] = digest(ledger / "requirements.json")
    write_json(ledger / "project.json", project)
    if not initialize:
        scenarios = read_json(ledger / "scenarios.json")
        scenarios["black_box_complete"] = False
        scenarios["white_box_complete"] = False
        write_json(ledger / "scenarios.json", scenarios)
        write_json(ledger / "coverage_review.json", {"status": "unreviewed", "basis": "", "requirements_sha256": "", "scenarios_sha256": "", "items": []})
    print(str(ledger))


def new_run(project_root, run_id, revision, environment, test_dir=None, coverage_mode=None, scenario_loop=False, scenario_ids=None, execution_coverage_mode=None, first_scenario_ids=None, order_basis=None):
    mode = selected_mode(coverage_mode or os.environ.get("DELIVERY_ACCEPTANCE_COVERAGE_MODE", "standard"))
    if not RUN_ID.fullmatch(run_id):
        fail("invalid run id")
    if not (asset_directory(project_root, test_dir) / "project.json").is_file():
        fail("initialize the project ledger before creating a run")
    verify_project_binding(asset_directory(project_root, test_dir), project_root)
    run_dir = asset_directory(project_root, test_dir) / "runs" / run_id
    if run_dir.exists():
        fail(f"run already exists: {run_dir}")
    ledger = asset_directory(project_root, test_dir)
    if acceptance_plan.required(ledger) or os.environ.get("DELIVERY_ACCEPTANCE_SCOPE_REQUIRED") == "1":
        scope_errors = design_pipeline.generation_errors(ledger) + acceptance_plan.scenario_errors(ledger, items(read_json(ledger / "scenarios.json")), obj(read_json(ledger / "coverage_review.json")))
        if scope_errors:
            fail("acceptance scope gate: " + "; ".join(scope_errors))
    coverage_policy = execution_coverage.policy(ledger, execution_coverage_mode or os.environ.get('DELIVERY_ACCEPTANCE_EXECUTION_COVERAGE'))
    if coverage_policy['mode'] == 'required' and not scenario_loop:
        fail('live execution coverage requires the independently reviewed scenario loop')
    if coverage_policy['mode'] == 'required':
        try:
            subjects = execution_coverage.coverage_subjects.validate_definition(read_json(ledger / 'project.json'), read_json(ledger / 'coverage_review.json'))
            sources = [source for name in ('scenarios.json', 'white_box_rules.json') if (ledger / name).exists()
                       for item in items(read_json(ledger / name)) for source in item.get('code_sources', [])]
            for subject in subjects:
                root = Path(subject['project_root']).resolve()
                versions = {revision} if root == project_root.resolve() else {
                    source.get('revision') for source in sources
                    if source.get('root') and Path(source['root']).resolve() == root}
                if subject['revision'] not in versions:
                    raise ValueError('覆盖率范围的版本/项目必须属于本轮冻结的被测对象')
        except (ValueError, KeyError, TypeError, OSError, subprocess.CalledProcessError) as error:
            fail('覆盖率范围准备问题：' + str(error))
    created_at = datetime.now(timezone.utc).isoformat()
    plan = priorities.make_plan(items(read_json(ledger / "scenarios.json")), priorities.read_policy(ledger), created_at, scenario_ids, first_scenario_ids, order_basis)
    plan['coverage_policy'] = coverage_policy
    run_dir.mkdir(parents=True)
    (run_dir / "evidence").mkdir()
    binding_files = ("project.json", "requirements.json", "resources.json", "scenarios.json", "coverage_review.json")
    if (ledger / white_box_rules.NAME).exists():
        binding_files += (white_box_rules.NAME,)
    if acceptance_plan.required(ledger):
        binding_files += (acceptance_plan.NAME, acceptance_plan.REVIEW, acceptance_plan.DECISIONS, acceptance_plan.POLICY, design_pipeline.ANALYSIS, design_pipeline.PROGRESS)
    hashes = {name: digest(ledger / name) for name in binding_files}
    # Preserve exact design bytes for later cross-run comparison; never reconstruct old designs.
    for name in ("scenarios", "white_box_rules") if (ledger / white_box_rules.NAME).exists() else ("scenarios",):
        shutil.copyfile(ledger / f"{name}.json", run_dir / f"{name}.snapshot.json")
    if acceptance_plan.required(ledger):
        for name in (acceptance_plan.NAME, acceptance_plan.REVIEW, acceptance_plan.DECISIONS, "requirements.json", design_pipeline.ANALYSIS, design_pipeline.PROGRESS):
            shutil.copyfile(ledger / name, run_dir / name.replace(".json", ".snapshot.json"))
    write_json(run_dir / "execution-plan.json", plan)
    run = {"revision": revision, "environment": environment, "acceptance_mode": mode, "created_at": created_at, "execution_plan_sha256": digest(run_dir / "execution-plan.json"), "ledger_hashes": hashes, "dependency_checks": [], "results": []}
    run['coverage_policy'] = coverage_policy
    if first_scenario_ids is not None:
        run.update(first_scenario_ids=first_scenario_ids, order_basis=order_basis)
    if scenario_ids is not None:
        run['selected_scenario_ids'] = list(scenario_ids)
    if scenario_loop:
        lifecycle.initialize(project_root.resolve(), ledger, items(read_json(ledger / "scenarios.json")), run)
        plan["execution_schema"] = 2
        write_json(run_dir / "execution-plan.json", plan)
        run["execution_plan_sha256"] = digest(run_dir / "execution-plan.json")
    write_json(run_dir / "run.json", run)
    print(str(run_dir))


def execution_step(project, run_id, test_dir=None, finish=False, stopped=False):
    if not RUN_ID.fullmatch(run_id):
        fail("invalid run id")
    ledger = asset_directory(project, test_dir)
    verify_project_binding(ledger, project)
    folder = ledger / "runs" / run_id
    run = obj(read_json(folder / "run.json"))
    acceptance_plan.assert_current(ledger, run)
    if run.get("ledger_hashes", {}).get("scenarios.json") != digest(ledger / "scenarios.json"):
        fail("scenarios changed after run creation; create a new run")
    scenarios = items(read_json(ledger / "scenarios.json"))
    plan = priorities.load_plan(folder, run, scenarios, ledger)
    if not plan:
        fail("historical run has no execution plan; create a new run")
    if run.get("execution_schema") == 2:
        lifecycle.verify_product(project.resolve(), run)
        for progress in run['progress']:
            if progress['phase'] == 'completed':
                errors = lifecycle.completion_errors(project.resolve(), ledger, folder, run, identifier=progress['scenario_id'])
                if errors:
                    fail('; '.join(errors))
    result = lifecycle.next_item(plan, run) if run.get("execution_schema") == 2 else priorities.next_scenario(plan, items(run, "results"))
    if finish:
        if result["scenario_id"] and not stopped:
            fail("selected scenarios remain within the time limit; execute the next scenario first")
        if run.get("execution_schema") == 2:
            lifecycle.verify_product(project.resolve(), run)
            if any(p['phase'] not in ('pending', 'completed', 'not_run') for p in run['progress']):
                fail("finish current scenario observation and independent evaluation before closing the run")
        recorded = {r.get("scenario_id") for r in items(run, "results")}
        selected = set(plan["ordered_scenario_ids"])
        run.setdefault("results", [])
        for scenario in priorities.ordered(scenarios):
            identifier = scenario["id"]
            if identifier in recorded:
                continue
            outside_explicit = 'selected_scenario_ids' in plan and identifier not in plan['selected_scenario_ids']
            reason = 'outside_scenario_scope' if outside_explicit else "outside_priority_scope" if identifier not in selected else "stopped" if stopped else "time_limit"
            explanations = {"outside_scenario_scope": "本轮仅执行明确选中的场景；该场景未选中，尚未验证其业务风险。", "outside_priority_scope": f"本轮范围为P0至{plan['policy']['max_priority']}；该{scenario.get('priority', '未分级')}场景在范围之外，未执行。", "time_limit": f"本轮{plan['policy']['time_limit_minutes']}分钟测试时间上限已到，该场景未执行。", "stopped": "本轮执行提前停止，该场景未执行；业务风险尚未验证。"}
            run["results"].append({"scenario_id": identifier, "status": "not_run", "not_run_reason": reason, "reason": explanations[reason], "summary": explanations[reason], "remaining_risk": scenario.get("priority_reason"), "evidence": []})
        if run.get("execution_schema") == 2:
            for progress in run['progress']:
                if progress['phase'] == 'pending':
                    progress['phase'] = 'not_run'
            run.update(lifecycle='completed', updated_at=lifecycle.stamp())
        write_json(folder / "run.json", run)
    return {**result, "run_id": run_id, "policy": plan["policy"], "deadline_at": plan["deadline_at"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    initialize = commands.add_parser("init", help="start a project ledger from confirmed requirements")
    initialize.add_argument("project", type=Path)
    initialize.add_argument("--requirements", type=Path, required=True)
    update = commands.add_parser("import-requirements", help="replace the approved requirements snapshot")
    update.add_argument("project", type=Path)
    update.add_argument("--requirements", type=Path, required=True)
    create = commands.add_parser("new-run", help="create an evidence run")
    create.add_argument("project", type=Path)
    create.add_argument("--id", required=True)
    create.add_argument("--revision", required=True)
    create.add_argument("--environment", required=True)
    create.add_argument("--scenario-loop", action="store_true", help="use incremental independent per-scenario evaluation (required by the workflow)")
    create.add_argument('--scenario', action='append', dest='scenario_ids', help='explicit user-selected scenario ID; repeat for a partial run')
    create.add_argument("--first-scenario", action="append", dest="first_scenario_ids", help="explicit representative-first order; changes ordering, never grades")
    create.add_argument("--order-reference", help="actual user request authorizing representative-first order")
    create.add_argument("--coverage-mode", choices=MODES, help="acceptance mode; default standard or active session mode")
    create.add_argument('--execution-coverage', choices=execution_coverage.POLICIES, help='fixed live coverage collection policy; independent of enhancement')
    review_hashes = commands.add_parser("review-hashes", help="print hashes for the independent black-box review")
    review_hashes.add_argument("project", type=Path)
    white_hashes = commands.add_parser("white-box-priority-hashes", help="pin the independent white-box priority review")
    white_hashes.add_argument("project", type=Path)
    next_step = commands.add_parser("next-scenario", help="read the next permitted scenario from the frozen execution plan")
    finish = commands.add_parser("finish-run", help="record all unexecuted scenarios and their reasons")
    for step in (next_step, finish):
        step.add_argument("project", type=Path)
        step.add_argument("--run", required=True)
    finish.add_argument("--stopped", action="store_true", help="record an early stop without claiming the budget expired")
    abort = commands.add_parser('abort-run', help='close a superseded run after stopping its workers; retain all original records')
    abort.add_argument('project', type=Path)
    abort.add_argument('--run', required=True)
    abort.add_argument('--reason', required=True)
    progress = commands.add_parser("scenario-step", help="persist one lifecycle transition atomically")
    progress.add_argument("project", type=Path)
    progress.add_argument("--run", required=True)
    progress.add_argument("--scenario", required=True)
    progress.add_argument("--action", choices=('begin', 'prepared', 'case-result', 'observe', 'evaluate', 'reopen'), required=True)
    progress.add_argument("--input", type=Path, help="JSON payload; omit for begin")
    dependency = commands.add_parser('run-dependency', help='record a run dependency check atomically')
    dependency.add_argument('project', type=Path)
    dependency.add_argument('--run', required=True)
    dependency.add_argument('--input', required=True, type=Path)
    scenario_check = commands.add_parser("check-scenario", help="gate an independently evaluated scenario without requiring a passing product verdict")
    scenario_check.add_argument("project", type=Path)
    scenario_check.add_argument("--run", required=True)
    scenario_check.add_argument("--scenario", required=True)
    coverage_check = commands.add_parser("check-code-coverage", help="validate opt-in coverage measurement and independent review only")
    coverage_check.add_argument("project", type=Path)
    coverage_check.add_argument("--run", required=True)
    check = commands.add_parser("check", help="check Playbook gates")
    check.add_argument("project", type=Path)
    check.add_argument("--run")
    check.add_argument("--require-scenario-loop", action="store_true", help="workflow terminal gate rejects legacy/nonincremental runs")
    check.add_argument("--coverage-mode", choices=MODES, help="must match recorded run mode; does not enable enhancement on an old run")
    check.add_argument("--stage", choices=("black-box", "white-box", "design", "acceptance"), default="acceptance")
    for command in (initialize, update, create, review_hashes, white_hashes, next_step, finish, abort, progress, dependency, scenario_check, check, coverage_check):
        command.add_argument("--test-dir", type=Path, help="user-selected test directory; project-relative or absolute (default: tests, or active workflow selection)")
    plan_check = commands.add_parser('check-plan', help='validate complete requirement organization and scope')
    plan_check.add_argument('project', type=Path)
    plan_check.add_argument('--draft', action='store_true', help='check candidate structure before independent review')
    plan_check.add_argument('--input', type=Path, help='candidate acceptance plan')
    plan_publish = commands.add_parser('publish-plan', help='publish independently reviewed next plan version')
    plan_publish.add_argument('project', type=Path)
    plan_publish.add_argument('--input', type=Path, required=True)
    plan_publish.add_argument('--review', type=Path, required=True)
    plan_publish.add_argument('--expected-version', type=int, required=True)
    decision = commands.add_parser('scope-decision', help='append an actual user scope decision before resuming')
    decision.add_argument('project', type=Path)
    decision.add_argument('--input', type=Path, required=True)
    restore_scope = commands.add_parser("restore-scope", help="restore latest published formal files without reverting newer user decisions")
    restore_scope.add_argument("project", type=Path)
    archive_scope = commands.add_parser("archive-scope-review", help="preserve valid original per-scenario review provenance before local changes")
    archive_scope.add_argument("project", type=Path)
    scope_hashes = commands.add_parser('scope-review-hashes', help='pin per-scenario applicability and global risk dependencies')
    scope_hashes.add_argument('project', type=Path)
    for command in (plan_check, plan_publish, decision, scope_hashes, archive_scope, restore_scope):
        command.add_argument('--test-dir', type=Path)
    pipeline_commands = ('complete-analysis', 'check-analysis', 'design-next', 'start-unit', 'complete-unit', 'reopen-units', 'check-generation', 'restore-design-progress', 'advance-unit')
    for name in pipeline_commands:
        command = commands.add_parser(name, help='ordered source analysis and acceptance-unit generation')
        command.add_argument('project', type=Path)
        command.add_argument('--test-dir', type=Path)
        if name == 'complete-analysis':
            command.add_argument('--input', type=Path, required=True)
        if name in ('start-unit', 'complete-unit'):
            command.add_argument('--unit', required=True)
        if name == 'reopen-units':
            command.add_argument('--unit', action='append', required=True)
    args = parser.parse_args()
    try:
        if args.command in pipeline_commands:
            ledger = asset_directory(args.project, args.test_dir)
            verify_project_binding(ledger, args.project)
            if args.command == 'complete-analysis':
                design_pipeline.complete_analysis(args.project, ledger, read_json(args.input))
                result = read_json(ledger / design_pipeline.ANALYSIS)
            elif args.command == 'advance-unit':
                result = design_pipeline.advance_unit(ledger)
            elif args.command == 'design-next':
                result = {'unit': design_pipeline.next_unit(ledger)}
            elif args.command == 'start-unit':
                result = design_pipeline.start_unit(ledger, args.unit)
            elif args.command == 'complete-unit':
                result = design_pipeline.complete_unit(ledger, args.unit)
            elif args.command == 'restore-design-progress':
                result = design_pipeline.restore_progress(ledger)
            elif args.command == 'reopen-units':
                result = design_pipeline.reopen_units(ledger, args.unit)
            else:
                problems = design_pipeline.generation_errors(ledger) if args.command == 'check-generation' else design_pipeline.analysis_errors(ledger) + design_pipeline.current_code_errors(args.project, read_json(ledger / design_pipeline.ANALYSIS))
                print(json.dumps({'status': 'blocked' if problems else 'passed', 'issues': problems}, ensure_ascii=False))
                return 2 if problems else 0
            print(json.dumps(result, ensure_ascii=False))
        elif args.command in ('check-plan', 'publish-plan', 'scope-decision', 'scope-review-hashes', 'archive-scope-review', 'restore-scope'):
            ledger = asset_directory(args.project, args.test_dir)
            verify_project_binding(ledger, args.project)
            if args.command == 'restore-scope':
                print(json.dumps(acceptance_plan.restore_scope(ledger), ensure_ascii=False))
            elif args.command == 'archive-scope-review':
                print(json.dumps(acceptance_plan.archive_reviews(ledger), ensure_ascii=False))
            elif args.command == 'scope-decision':
                acceptance_plan.append_decision(ledger, read_json(args.input))
                print(json.dumps(acceptance_plan.decisions(ledger), ensure_ascii=False))
            elif args.command == 'publish-plan':
                acceptance_plan.publish_plan(ledger, read_json(args.input), read_json(args.review), args.expected_version)
                print(json.dumps(acceptance_plan.binding(ledger), ensure_ascii=False))
            elif args.command == 'scope-review-hashes':
                scenes = items(read_json(ledger / 'scenarios.json'))
                print(json.dumps({'plan_sha256': acceptance_plan.digest(read_json(ledger / acceptance_plan.NAME)), 'items': [{'scenario_id': s['id'], 'scenario_sha256': acceptance_plan.digest(s), 'dependencies_sha256': acceptance_plan.scoped_hash(ledger, s)} for s in scenes]}, ensure_ascii=False))
            else:
                candidate = read_json(args.input) if args.input else None
                problems = acceptance_plan.definition_errors(ledger, candidate) if args.draft else acceptance_plan.plan_review_errors(ledger, candidate)
                print(json.dumps({'status': 'blocked' if problems else 'passed', 'issues': problems}, ensure_ascii=False))
                return 2 if problems else 0
        elif args.command == "init":
            os.environ["DELIVERY_ACCEPTANCE_SCOPE_REQUIRED"] = "1"
            import_requirements(args.project, args.requirements, initialize=True, test_dir=args.test_dir)
        elif args.command == "import-requirements":
            import_requirements(args.project, args.requirements, test_dir=args.test_dir)
        elif args.command == "new-run":
            if not acceptance_plan.required(asset_directory(args.project, args.test_dir)):
                fail("legacy ledger has no organized scope contract; publish an independently reviewed acceptance plan before a new run")
            new_run(args.project, args.id, args.revision, args.environment, test_dir=args.test_dir, coverage_mode=args.coverage_mode, scenario_loop=args.scenario_loop, scenario_ids=args.scenario_ids, execution_coverage_mode=args.execution_coverage, first_scenario_ids=args.first_scenario_ids, order_basis={"source_reference": args.order_reference, "reason": "按用户请求先验证代表场景，再执行剩余分级队列；原重要度不变。"} if args.first_scenario_ids else None)
        elif args.command == 'abort-run':
            if not RUN_ID.fullmatch(args.run):
                fail('invalid run id')
            ledger = asset_directory(args.project, args.test_dir)
            verify_project_binding(ledger, args.project)
            folder = ledger / 'runs' / args.run
            with lifecycle.lock(folder):
                print(json.dumps(lifecycle.abort_run(folder, read_json(folder / 'run.json'), args.reason), ensure_ascii=False))
        elif args.command in ("next-scenario", "finish-run"):
            folder = asset_directory(args.project, args.test_dir) / 'runs' / args.run
            if not RUN_ID.fullmatch(args.run):
                fail('invalid run id')
            with lifecycle.lock(folder):
                print(json.dumps(execution_step(args.project, args.run, args.test_dir, args.command == "finish-run", getattr(args, "stopped", False)), ensure_ascii=False, indent=2))
        elif args.command in ('scenario-step', 'check-scenario', 'run-dependency'):
            if not RUN_ID.fullmatch(args.run):
                fail('invalid run id')
            ledger = asset_directory(args.project, args.test_dir)
            verify_project_binding(ledger, args.project)
            folder = ledger / 'runs' / args.run
            with lifecycle.lock(folder):
                run = read_json(folder / 'run.json')
                acceptance_plan.assert_current(ledger, run)
                if (ledger / white_box_rules.NAME).exists() != (white_box_rules.NAME in run['ledger_hashes']):
                    fail('reverse rule definitions changed; create a new run')
                for name, expected in run['ledger_hashes'].items():
                    if digest(ledger / name) != expected:
                        fail('reviewed definitions changed; create a new run')
                scenarios = items(read_json(ledger / 'scenarios.json'))
                plan = priorities.load_plan(folder, run, scenarios, ledger)
                if run.get('execution_schema') != 2:
                    fail('historical run has no scenario lifecycle; create a scenario-loop run')
                if args.command == 'run-dependency':
                    payload = read_json(args.input)
                    decisions = {d['id'] for d in items(read_json(ledger / 'resources.json'), 'decisions') if not acceptance_plan.required(ledger) or d.get('scope', {}).get('status') != 'out_of_scope'}
                    if payload.get('dependency_id') not in decisions or payload.get('status') not in ('passed', 'failed'):
                        fail('dependency check needs a known decision and status')
                    errors = []
                    evidence_file(ledger, payload.get('evidence'), 'run dependency', errors)
                    if errors:
                        fail('; '.join(errors))
                    if run.get('lifecycle') != 'running':
                        fail('cannot modify a closed run')
                    lifecycle.verify_product(args.project.resolve(), run)
                    run['dependency_checks'] = [d for d in run['dependency_checks'] if d.get('dependency_id') != payload['dependency_id']] + [payload]
                    run['updated_at'] = lifecycle.stamp()
                    write_json(folder / 'run.json', run)
                    print(json.dumps(payload, ensure_ascii=False, indent=2))
                elif args.command == 'scenario-step':
                    payload = read_json(args.input) if args.input else {}
                    value = lifecycle.advance(args.project.resolve(), ledger, folder, run, plan, args.scenario, args.action, payload)
                    print(json.dumps(value, ensure_ascii=False, indent=2))
                else:
                    if args.scenario not in {s['id'] for s in scenarios}:
                        fail('unknown scenario')
                    errors = lifecycle.completion_errors(args.project.resolve(), ledger, folder, run, identifier=args.scenario)
                    print(json.dumps({'status': 'blocked' if errors else 'passed', 'issues': errors}, ensure_ascii=False, indent=2))
                    return 2 if errors else 0
        elif args.command == "white-box-priority-hashes":
            ledger = asset_directory(args.project, args.test_dir)
            verify_project_binding(ledger, args.project)
            print(json.dumps(priorities.white_box_hashes(ledger, items(read_json(ledger / "scenarios.json"))), ensure_ascii=False, indent=2))
        elif args.command == "check-code-coverage":
            if not RUN_ID.fullmatch(args.run):
                fail("invalid run id")
            ledger = asset_directory(args.project, args.test_dir)
            verify_project_binding(ledger, args.project)
            run_dir = ledger / "runs" / args.run
            run = read_json(run_dir / "run.json")
            if run.get("acceptance_mode", "standard") != "coverage":
                fail("code coverage gate requires an explicitly enhanced run")
            errors = errors_for_run(args.project.resolve(), ledger, run_dir, run)
            print(json.dumps({"status": "blocked" if errors else "passed", "issues": errors}, ensure_ascii=False, indent=2))
            return 2 if errors else 0
        elif args.command == "review-hashes":
            verify_project_binding(asset_directory(args.project, args.test_dir), args.project)
            print(json.dumps(coverage_scope_hashes(asset_directory(args.project, args.test_dir)), ensure_ascii=False, indent=2))
        else:
            if args.stage in ("black-box","white-box","design") and args.coverage_mode == "coverage":
                fail("code coverage enhancement applies only to acceptance")
            if args.stage in ("black-box","white-box","design") and args.run:
                fail("--run cannot be combined with --stage black-box")
            if args.run and not RUN_ID.fullmatch(args.run):
                fail("invalid run id")
            selected_stage = args.stage
            if selected_stage == 'design':
                selected_stage = read_json(asset_directory(args.project,args.test_dir)/design_pipeline.ANALYSIS).get('stage')
                if selected_stage not in ('black-box','white-box'):fail('design gate requires a fixed black-box or white-box design stage')
            report = validate_white_box(args.project,args.test_dir) if selected_stage=='white-box' else validate_black_box(args.project, args.test_dir) if selected_stage == "black-box" else validate(args.project, args.run, args.test_dir, args.coverage_mode)
            if args.require_scenario_loop:
                if not args.run:
                    fail('--require-scenario-loop needs --run')
                selected_run = read_json(asset_directory(args.project, args.test_dir) / 'runs' / args.run / 'run.json')
                if selected_run.get('execution_schema') != 2:
                    report['gates']['execution']['status'] = 'blocked'
                    report['gates']['execution']['issues'].append('current workflow requires independently evaluated scenario-loop execution; historical records cannot substitute')
                    report['status'] = 'incomplete'
            if args.run:
                run_dir = asset_directory(args.project, args.test_dir) / "runs" / args.run
                write_json(run_dir / "gate-report.json", report)
            print(json.dumps(report, ensure_ascii=False, indent=2))
            if any(gate_data["status"] != "passed" for gate_data in report["gates"].values()):
                return 2
    except ValueError as error:
        print(f"Playbook error: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
