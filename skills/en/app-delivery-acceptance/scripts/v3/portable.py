#!/usr/bin/env python3
"""Project-neutral, deterministic preparation and execution for one acceptance slice."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


SCHEMA = "delivery-trace-v1"
PARSERS = {"istanbul-summary", "coveragepy-json", "normalized-json"}


def stamp():
    return datetime.now(timezone.utc).isoformat()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    tmp.replace(path)


def load(path):
    return json.loads(path.read_text())


def fail(message):
    raise ValueError(message)


def relative_source(root, path):
    target = (root / path).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        fail(f"source missing or outside project: {path}")
    return target


def frozen_contract(root, contract):
    path = contract.get("path", "")
    repo = contract.get("source_repo")
    if repo:
        target = Path(path)
        source_path = contract.get("source_path", "")
        source_ref = contract.get("source_ref", "")
        if (not target.is_absolute() or not Path(repo).is_absolute() or
                not re.fullmatch(r"[0-9a-f]{40}", source_ref) or
                not source_path or Path(source_path).is_absolute() or
                any(p in ("", ".", "..") for p in source_path.split("/"))):
            fail("external contract provenance incomplete")
        if subprocess.check_output(["git", "cat-file", "-t", source_ref], cwd=repo, text=True).strip() != "commit":
            fail("external contract source ref is not a commit")
        original = subprocess.check_output(["git", "show", f"{source_ref}:{source_path}"], cwd=repo)
        if sha(original) != contract.get("sha256"):
            fail("external contract snapshot differs from declared Git source")
    else:
        target = relative_source(root, path)
    if not target.is_file() or sha(target.read_bytes()) != contract.get("sha256"):
        fail("reviewed independent contract drift")
    return target


def reverse_ready(artifact, artifact_path):
    if artifact.get("schema") == "commit-reverse-v1":
        return artifact.get("status") == "approved" and artifact.get("review", {}).get("status") == "approved"
    check = artifact.get("self_check") or {}
    if (artifact.get("schema") != "commit-reverse-selfcheck-v1" or artifact.get("status") != "completed" or
            check.get("method") != "single_agent_internal"):
        return False
    folder = artifact_path.parent
    try:
        draft = folder / "draft.current.json"
        gate = folder / "draft-gate.json"
        trace = folder / "agent-selfcheck.jsonl"
        return (sha(draft.read_bytes()) == check.get("draft_sha256") and
                load(draft) == artifact.get("draft") and
                sha(gate.read_bytes()) == check.get("gate_sha256") and
                load(gate).get("status") == "ready" and
                sha(trace.read_bytes()) == check.get("agent_trace_sha256"))
    except (OSError, ValueError, TypeError):
        return False


def command(argv, root, artifacts, manifest_path=None):
    if not isinstance(argv, list) or not argv or not all(isinstance(x, str) and x for x in argv):
        fail("commands must be nonempty argv arrays")
    values = [arg.replace("{artifacts}", str(artifacts)).replace("{project}", str(root))
              .replace("{manifest}", str(manifest_path or "")) for arg in argv]
    executable = values[0]
    if not (Path(executable).is_file() or shutil.which(executable)):
        fail(f"executable unavailable: {executable}")
    return values


def validate_manifest(manifest, path):
    if manifest.get("schema") != SCHEMA:
        fail("unsupported schema")
    project = manifest.get("project") or {}
    root = Path(project.get("root", "")).resolve()
    if not root.is_dir() or not isinstance(project.get("id"), str) or not project["id"]:
        fail("project id/root required")
    mode = project.get("revision_mode", "git")
    if mode == "git":
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    elif mode == "declared" and isinstance(project.get("revision"), str) and project["revision"] and project.get("revision_provenance"):
        revision = project.get("revision")
    else:
        fail("revision_mode must be git or declared with provenance")
    if revision != project.get("revision"):
        fail("project revision changed")
    sources = project.get("sources") or []
    if len(set(sources)) != len(sources):
        fail("unique source paths required")
    hashes = {p: sha(relative_source(root, p).read_bytes()) for p in sources}
    requirements, reverse_rules, scenarios, bindings = (manifest.get(k) or [] for k in ("requirements", "reverse_rules", "scenarios", "bindings"))
    for name, items in (("requirements", requirements), ("reverse_rules", reverse_rules), ("scenarios", scenarios), ("bindings", bindings)):
        ids = [x.get("id") for x in items]
        if any(not x for x in ids) or len(ids) != len(set(ids)):
            fail(f"{name}: unique IDs required")
    if not requirements and not reverse_rules:
        fail("at least one original requirement or reviewed reverse rule required")
    if any(not x.get("text") or not x.get("source") for x in requirements):
        fail("each requirement/rule needs text and source")
    if any(not x.get("title") or not x.get("description") for x in scenarios):
        fail("each scenario needs a title and description")
    req_ids = {x["id"] for x in requirements}
    rule_ids = {x["id"] for x in reverse_rules}
    if req_ids & rule_ids:
        fail("original requirement and reverse rule IDs must be separate")
    for rule in reverse_rules:
        if (rule.get("status") not in ("supported", "confirmed") or
                not rule.get("text") or not rule.get("basis") or
                rule.get("basis_kind") not in ("contract", "invariant", "confirmed_decision") or
                not rule.get("code_sources")):
            fail("reverse rule lacks resolved independent basis and code source")
        for source in rule["code_sources"]:
            if source.get("revision") != revision or source.get("sha256") != sha(relative_source(root, source.get("path", "")).read_bytes()):
                fail("reverse rule source revision/hash changed")
    change = manifest.get("change")
    if reverse_rules and not change:
        fail("reverse rules need reviewed commit binding")
    if change:
        if change.get("head_revision") != revision or not change.get("base_revision") or not change.get("reviewed_reverse_sha256"):
            fail("commit binding incomplete")
        approved_path = Path(change.get("reviewed_reverse_path", ""))
        if not approved_path.is_file() or sha(approved_path.read_bytes()) != change["reviewed_reverse_sha256"]:
            fail("approved reverse artifact changed")
        approved = load(approved_path)
        if (not reverse_ready(approved, approved_path) or
                approved.get("change", {}).get("head_revision") != revision or
                approved.get("change", {}).get("base_revision") != change["base_revision"] or
                approved.get("change", {}).get("diff_sha256") != change.get("diff_sha256") or
                approved.get("change", {}).get("inventory") != change.get("inventory")):
            fail("manifest reverse rules differ from frozen commit analysis")
        if reverse_rules or any(s.get("kind") == "WHITE_BOX" for s in scenarios):
            supported = [x for x in approved.get("draft", {}).get("reverse_rules", []) if x.get("status") in ("supported", "confirmed")]
            if supported != reverse_rules:
                fail("manifest reverse rules differ from executable frozen rules")
        elif scenarios and change.get("inventory"):
            inventory = change["inventory"]
            if ("BLACK_BOX" not in inventory.get("test_modes", []) or
                    any(s.get("requirement_id") not in inventory.get("pr_requirement_ids", []) for s in scenarios)):
                fail("black-box PR scene is not a confirmed PR requirement")
        if change.get("inventory"):
            inventory = change["inventory"]
            if (inventory.get("schema") != "change-inventory-v1" or inventory.get("head_revision") != revision or
                    inventory.get("base_revision") != change["base_revision"] or inventory.get("unclassified_paths") or
                    set(inventory.get("source_paths", [])) != set(sources) or inventory.get("source_hashes") != hashes):
                fail("PR source inventory incomplete or changed")
            if inventory.get("target_revision"):
                current_target = subprocess.check_output(["git", "rev-parse", inventory["base_ref"]], cwd=root, text=True).strip()
                if current_target != inventory["target_revision"]:
                    fail("PR target ref moved after review")
            for link in inventory.get("gitlinks", []):
                child = (root / link["path"]).resolve()
                if not child.is_relative_to(root) or not child.is_dir():
                    fail("reviewed submodule checkout missing: " + link["path"])
                if (subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=child, text=True).strip() != link["head_revision"] or
                        subprocess.check_output(["git", "rev-parse", f"{revision}:{link['path']}"], cwd=root, text=True).strip() != link["head_revision"]):
                    fail("reviewed submodule revision drift: " + link["path"])
        if approved.get("schema") == "commit-reverse-v1":
            accepted_rules = {x.get("rule_id") for x in approved["review"].get("rule_reviews", []) if x.get("verdict") == "accepted"}
            if any(rule["id"] not in accepted_rules for rule in reverse_rules):
                fail("reverse rule lacks independent accepted verdict")
        for source in approved["change"].get("changed_files", []):
            if source.get("sha256") != sha(relative_source(root, source.get("path", "")).read_bytes()):
                fail("reviewed changed source drift")
        contract_files = approved["change"].get("contract_files", [])
        for contract in contract_files:
            frozen_contract(root, contract)
        for rule in reverse_rules:
            if rule.get("basis_kind") == "contract":
                contract = next((c for c in contract_files if c.get("path") == rule.get("contract_source")), None)
                if contract:
                    contract_path = frozen_contract(root, contract)
                elif approved.get("schema") == "commit-reverse-v1":
                    contract_path = relative_source(root, rule.get("contract_source", ""))
                else:
                    fail("reverse rule independent contract not frozen")
                if not rule.get("contract_quote") or rule["contract_quote"] not in contract_path.read_text():
                    fail("reverse rule independent contract does not match")
        for context in approved["change"].get("context_files", []):
            if context.get("sha256") != sha(relative_source(root, context.get("path", "")).read_bytes()):
                fail("reviewed caller context drift")
        base = subprocess.check_output(["git", "rev-parse", change["base_revision"]], cwd=root, text=True).strip()
        ancestor = subprocess.check_output(["git", "merge-base", base, revision], cwd=root, text=True).strip()
        if ancestor != base:
            fail("commit base is not an ancestor")
    scene_ids = {x["id"] for x in scenarios}
    if any(x.get("requirement_id") not in req_ids | rule_ids or x.get("priority") not in ("P0", "P1", "P2", "P3") for x in scenarios):
        fail("scenario must own one known requirement and P0-P3 priority")
    if any(s.get("requirement_id") in rule_ids and s.get("kind") != "WHITE_BOX" for s in scenarios):
        fail("reverse rule scenes must be white-box")
    if any(s.get("kind") == "WHITE_BOX" for s in scenarios) and not change:
        fail("white-box scene requires a reviewed commit binding")
    if change and any(s.get("kind") == "WHITE_BOX" and s.get("requirement_id") in req_ids and
                      s["requirement_id"] not in {x["requirement_id"] for x in approved["draft"]["impacts"]} for s in scenarios):
        fail("white-box original requirement is not an approved commit impact")
    if len(scenarios) > 1 or (not scenarios and bindings):
        fail("a slice may contain one scenario or requirements only")
    if any(x.get("scenario_id") not in scene_ids for x in bindings):
        fail("binding refers to unknown scenario")
    for item in bindings:
        if item.get("kind") not in ("automated", "manual"):
            fail("binding kind must be automated/manual")
        if not item.get("title"):
            fail("binding needs a title")
        if item["kind"] == "automated":
            command(item.get("command"), root, path.parent, path)
            if not item.get("success_markers") or not all(isinstance(x, str) and x for x in item["success_markers"]):
                fail("automated binding needs concrete success markers")
            relative_source(root, item.get("test_file", ""))
        elif not item.get("procedure"):
            fail("manual binding needs a procedure")
    test_hashes = {p: sha(relative_source(root, p).read_bytes()) for p in
                   sorted({x["test_file"] for x in bindings if x["kind"] == "automated"})}
    coverage = manifest.get("coverage") or {}
    if coverage.get("policy") not in ("required", "off", "unavailable"):
        fail("coverage policy required/off/unavailable must be frozen")
    if coverage["policy"] == "unavailable" and not isinstance(coverage.get("reason"), str):
        fail("unavailable coverage requires a reason")
    if coverage["policy"] == "unavailable" and not coverage["reason"].strip():
        fail("unavailable coverage requires a reason")
    if coverage["policy"] == "required":
        if "accept_failed_case_exit" in coverage and type(coverage["accept_failed_case_exit"]) is not bool:
            fail("accept_failed_case_exit must be a boolean")
        if not scenarios:
            fail("coverage collection requires a scenario")
        if coverage.get("parser") not in PARSERS or not coverage.get("run_command") or not coverage.get("report_path"):
            fail("coverage collector and raw report path required")
        command(coverage["run_command"], root, path.parent, path)
        if coverage.get("report_command"):
            command(coverage["report_command"], root, path.parent, path)
        if not coverage.get("source_paths") or not set(coverage["source_paths"]).issubset(set(sources)):
            fail("coverage source paths must be in frozen source inventory")
        related = coverage.get("case_binding_ids") or []
        automated = {x["id"] for x in bindings if x["kind"] == "automated"}
        if not related or not set(related).issubset(automated) or len(related) != len(set(related)):
            fail("coverage must identify its automated case bindings")
        if coverage.get("collection_relation") not in ("same_run", "replay_same_cases"):
            fail("coverage collection relation must be declared")
        if coverage.get("change_line_policy", "off") not in ("required", "off"):
            fail("change line policy must be required or off")
        if coverage.get("change_line_policy") == "required" and (not change or not coverage.get("change_line_report_path")):
            fail("commit line coverage needs a change binding and line report path")
        if coverage.get("change_line_policy") == "required" and coverage.get("change_line_parser", "lcov") not in ("lcov", "coveragepy-json"):
            fail("changed-line parser must be lcov or coveragepy-json")
        if coverage.get("line_report_path") and coverage.get("line_parser", "lcov") not in ("lcov", "coveragepy-json"):
            fail("line parser must be lcov or coveragepy-json")
    return root, revision, hashes, test_hashes


def prepare(manifest_path, out):
    out = out.resolve()
    raw = manifest_path.read_bytes()
    manifest = json.loads(raw)
    root, revision, hashes, test_hashes = validate_manifest(manifest, manifest_path)
    if manifest['coverage']['policy'] == 'required':
        fail('Legacy separate coverage commands cannot certify new metrics. Use the registered provider through v4 run_evidence_v2.py --coverage-config before executing cases; retain v3 for manual/source-free work.')
    path = out / "preparation.json"
    record = {"schema": SCHEMA, "manifest_sha256": sha(raw), "project_id": manifest["project"]["id"],
              "revision": revision, "source_hashes": hashes, "test_hashes": test_hashes,
              "coverage_policy": manifest["coverage"]["policy"], "prepared_at": stamp()}
    if path.exists():
        old = load(path)
        if all(old.get(k) == record[k] for k in ("manifest_sha256", "project_id", "revision", "source_hashes", "test_hashes", "coverage_policy")):
            print(json.dumps({"status": "reused", "preparation": str(path)}))
            return
    save(path, record)
    print(json.dumps({"status": "prepared", "preparation": str(path)}))


def parse_coverage(parser, report, source_hashes, source_paths):
    raw = report.read_bytes()
    data = json.loads(raw)
    files = data.get("files", {}) if parser in ("coveragepy-json", "normalized-json") else data
    rows = []
    for source in source_paths:
        matches = [v for k, v in files.items() if k == source or k.endswith("/" + source)]
        if len(matches) != 1:
            fail(f"coverage report missing/ambiguous original source: {source}")
        item = matches[0]
        if parser == "coveragepy-json":
            summary = item["summary"]
            lines = {"covered": summary["covered_lines"], "total": summary["num_statements"]}
            branches = {"covered": summary["covered_branches"], "total": summary["num_branches"]}
        else:
            lines = {k: item["lines"][k] for k in ("covered", "total")}
            branches = {k: item["branches"][k] for k in ("covered", "total")}
        for counter in (lines, branches):
            if not all(type(v) is int and v >= 0 for v in counter.values()) or counter["covered"] > counter["total"]:
                fail("invalid measured coverage counters")
        rows.append({"path": source, "source_sha256": source_hashes[source], "lines": lines, "branches": branches})
    return {"status": "measured", "parser": parser, "raw_path": str(report), "raw_sha256": sha(raw), "files": rows}


def parse_line_report(report, parser, sources):
    hits, current = {}, None
    if parser == "lcov":
        for line in report.read_text().splitlines():
            if line.startswith("SF:"):
                current = line[3:]
                hits.setdefault(current, {})
            elif line.startswith("DA:") and current is not None:
                number, count, *_ = line[3:].split(",")
                hits[current][int(number)] = int(count)
    elif parser == "coveragepy-json":
        for path, item in json.loads(report.read_text()).get("files", {}).items():
            hits[path] = {int(n): 1 for n in item.get("executed_lines", [])}
            hits[path].update({int(n): 0 for n in item.get("missing_lines", [])})
    else:
        fail("unknown line report parser")
    rows = []
    for source in sources:
        matches = [v for k, v in hits.items() if k == source or k.endswith("/" + source)]
        if len(matches) != 1:
            fail("line report missing or ambiguous original source: " + source)
        rows.append({"path": source, "executable_lines": sorted(matches[0]),
                     "hit_lines": sorted(n for n, count in matches[0].items() if count > 0)})
    return rows


def parse_change_lines(root, base, head, sources, report, parser="lcov"):
    diff = subprocess.check_output(["git", "diff", "--unified=0", base, head, "--", *sources], cwd=root, text=True)
    changed, current = {}, None
    for line in diff.splitlines():
        if line.startswith("+++ b/"):
            current = line[6:]
        elif line.startswith("@@ ") and current in sources:
            match = re.search(r"\+(\d+)(?:,(\d+))?", line)
            if match:
                start, count = int(match.group(1)), int(match.group(2) or 1)
                changed.setdefault(current, set()).update(range(start, start + count))
    line_files = {x["path"]: x for x in parse_line_report(report, parser, sources)}
    rows = []
    for source in sources:
        physical = changed.get(source, set())
        executable = set(line_files[source]["executable_lines"])
        hit = set(line_files[source]["hit_lines"])
        lines = sorted(physical & executable)
        rows.append({"path": source, "changed_lines": lines,
                     "non_executable_changed_lines": sorted(physical - executable),
                     "hit_lines": sorted(physical & hit),
                     "unhit_lines": sorted((physical & executable) - hit)})
    return {"status": "measured", "parser": parser, "raw_path": str(report), "raw_sha256": sha(report.read_bytes()), "files": rows}


def execute(manifest_path, out):
    out = out.resolve()
    if (out / "execution.json").exists():
        fail("attempt already executed; use a new output directory")
    if (out / "execute-intent.json").exists():
        fail("previous execution has no terminal record; inspect uncertain effects and use a new attempt")
    manifest = load(manifest_path)
    if manifest.get('coverage', {}).get('policy') == 'required':
        fail('Registered continuous coverage must use the v4 common execution entry; legacy separate collection is disabled before case execution.')
    if len(manifest.get("scenarios") or []) != 1:
        fail("execution requires one scenario")
    if not manifest.get("bindings"):
        fail("execution requires at least one case or manual operation")
    root, revision, hashes, test_hashes = validate_manifest(manifest, manifest_path)
    prep = load(out / "preparation.json")
    if (prep["manifest_sha256"] != sha(manifest_path.read_bytes()) or
            prep["source_hashes"] != hashes or prep.get("test_hashes") != test_hashes):
        fail("preparation binding changed")
    evidence = out / "evidence"
    evidence.mkdir(parents=True, exist_ok=True)
    case_results = []
    manual_path = out / "manual-results.json"
    manual_items = load(manual_path) if manual_path.is_file() else []
    if not isinstance(manual_items, list):
        fail("manual results must be an array")
    manual_by_id = {x.get("binding_id"): x for x in manual_items}
    manual_ids = {x["id"] for x in manifest["bindings"] if x["kind"] == "manual"}
    if len(manual_by_id) != len(manual_items) or not set(manual_by_id).issubset(manual_ids):
        fail("manual result has duplicate or unknown binding")
    for case_id, observed in manual_by_id.items():
        log_path = Path(observed.get("evidence_path", "")).resolve()
        if (observed.get("status") not in ("passed", "failed", "blocked") or
                not observed.get("actual") or not log_path.is_relative_to(out) or not log_path.is_file()):
            fail(f"manual result lacks actual observation or local evidence: {case_id}")
    save(out / "execute-intent.json", {"schema": SCHEMA, "manifest_sha256": sha(manifest_path.read_bytes()),
                                      "started_at": stamp(), "reason": "External case execution may have side effects"})
    for case in manifest["bindings"]:
        if case["kind"] == "manual":
            observed = manual_by_id.get(case["id"])
            if not observed:
                case_results.append({"binding_id": case["id"], "scenario_id": case["scenario_id"], "status": "not_run", "reason": "Manual operation awaits an actual operator"})
                continue
            log_path = Path(observed.get("evidence_path", "")).resolve()
            case_results.append({"binding_id": case["id"], "scenario_id": case["scenario_id"],
                                 "status": observed["status"], "actual": observed["actual"],
                                 "evidence_path": str(log_path), "evidence_sha256": sha(log_path.read_bytes())})
            continue
        argv = command(case["command"], root, out, manifest_path)
        started = time.monotonic()
        proc = subprocess.run(argv, cwd=root, env={**os.environ, **case.get("env", {})},
                              capture_output=True, text=True, timeout=case.get("timeout_seconds", 120))
        log = proc.stdout + "\n" + proc.stderr
        log_path = evidence / (case["id"] + ".log")
        log_path.write_text(log)
        markers = all(marker in log for marker in case["success_markers"])
        case_results.append({"binding_id": case["id"], "scenario_id": case["scenario_id"],
                             "status": "passed" if proc.returncode == 0 and markers else "failed",
                             "exit_code": proc.returncode, "markers_seen": markers, "command": argv,
                             "seconds": round(time.monotonic() - started, 3), "evidence_path": str(log_path),
                             "evidence_sha256": sha(log.encode())})
    spec = manifest["coverage"]
    coverage = ({"status": "unavailable", "reason": spec["reason"]} if spec["policy"] == "unavailable"
                else {"status": "off"})
    if spec["policy"] == "required":
        started = time.monotonic()
        env = {**os.environ, **spec.get("env", {})}
        run = subprocess.run(command(spec["run_command"], root, out, manifest_path), cwd=root, env=env,
                             capture_output=True, text=True, timeout=spec.get("timeout_seconds", 180))
        log_path = evidence / "coverage-run.log"
        log_path.write_text(run.stdout + "\n" + run.stderr)
        if run.returncode != 0 and not spec.get("accept_failed_case_exit", False):
            coverage = {"status": "failed", "reason": "collection command failed", "exit_code": run.returncode,
                        "log_path": str(log_path)}
        else:
            report_command = spec.get("report_command")
            report = None
            if report_command:
                report = subprocess.run(command(report_command, root, out, manifest_path), cwd=root, env=env,
                                        capture_output=True, text=True, timeout=60)
                (evidence / "coverage-report.log").write_text(report.stdout + "\n" + report.stderr)
            if report and report.returncode != 0:
                coverage = {"status": "failed", "reason": "report command failed", "exit_code": report.returncode}
            else:
                report_path = Path(spec["report_path"].replace("{artifacts}", str(out)).replace("{project}", str(root)))
                if not report_path.is_file():
                    fail("collector finished without raw report")
                coverage = parse_coverage(spec["parser"], report_path, hashes, spec["source_paths"])
                coverage["collection_exit_code"] = run.returncode
                coverage["run_log_path"] = str(log_path)
                coverage["run_log_sha256"] = sha(log_path.read_bytes())
                coverage["seconds"] = round(time.monotonic() - started, 3)
                coverage["run_command"] = command(spec["run_command"], root, out, manifest_path)
                coverage["source_scope"] = spec["source_paths"]
                coverage["case_binding_ids"] = spec["case_binding_ids"]
                coverage["collection_relation"] = spec["collection_relation"]
                line_spec = spec.get("line_report_path") or spec.get("change_line_report_path")
                if line_spec:
                    line_path = Path(line_spec.replace("{artifacts}", str(out)).replace("{project}", str(root)))
                    if not line_path.is_file():
                        fail("collector finished without line report")
                    line_parser = spec.get("line_parser", spec.get("change_line_parser", "lcov"))
                    coverage["line_files"] = parse_line_report(line_path, line_parser, spec["source_paths"])
                    coverage["line_raw_path"] = str(line_path)
                    coverage["line_raw_sha256"] = sha(line_path.read_bytes())
                if spec.get("change_line_policy") == "required":
                    line_path = Path(spec["change_line_report_path"].replace("{artifacts}", str(out)).replace("{project}", str(root)))
                    if not line_path.is_file():
                        fail("collector finished without changed-line LCOV report")
                    change = manifest["change"]
                    coverage["change_lines"] = parse_change_lines(root, change["base_revision"], revision,
                                                                   spec["source_paths"], line_path,
                                                                   spec.get("change_line_parser", "lcov"))
    result = {"schema": SCHEMA, "project_id": manifest["project"]["id"], "revision": revision,
              "scenario_id": manifest["scenarios"][0]["id"], "attempt_id": out.name,
              "manifest_sha256": sha(manifest_path.read_bytes()), "source_hashes": hashes,
              "test_hashes": test_hashes,
              "manual_results_sha256": sha(manual_path.read_bytes()) if manual_path.is_file() else None,
              "case_results": case_results, "coverage": coverage, "observed_at": stamp(),
              "judgment": {"status": "pending_review", "reason": "Actual execution recorded; no independent assessment supplied"}}
    save(out / "execution.json", result)
    print(json.dumps({"status": "executed", "cases": [x["status"] for x in case_results], "coverage": coverage["status"]}))


def project(manifest_path, out):
    out = out.resolve()
    manifest = load(manifest_path)
    has_execution = (out / "execution.json").is_file()
    execution = load(out / "execution.json") if has_execution else None
    root, revision, hashes, test_hashes = validate_manifest(manifest, manifest_path)
    prep = load(out / "preparation.json")
    if (prep["manifest_sha256"] != sha(manifest_path.read_bytes()) or
            prep["source_hashes"] != hashes or prep.get("test_hashes") != test_hashes):
        fail("preparation binding changed")
    if has_execution and (execution["manifest_sha256"] != sha(manifest_path.read_bytes()) or
                          execution["source_hashes"] != hashes or execution.get("test_hashes") != test_hashes):
        fail("execution binding changed")
    binding_ids = {x["id"] for x in manifest["bindings"]}
    if has_execution and any(x["binding_id"] not in binding_ids for x in execution["case_results"]):
        fail("orphan case result")
    for result in execution["case_results"] if has_execution else []:
        if result.get("evidence_path"):
            evidence = Path(result["evidence_path"])
            if not evidence.is_relative_to(out) or not evidence.is_file() or sha(evidence.read_bytes()) != result.get("evidence_sha256"):
                fail("case evidence changed")
    raw_path = execution["coverage"].get("raw_path") if has_execution else None
    if raw_path and (not Path(raw_path).is_relative_to(out) or
                     not Path(raw_path).is_file() or
                     sha(Path(raw_path).read_bytes()) != execution["coverage"].get("raw_sha256")):
        fail("coverage evidence changed")
    line_report = execution["coverage"].get("change_lines", {}).get("raw_path") if has_execution else None
    if line_report and (not Path(line_report).is_relative_to(out) or not Path(line_report).is_file() or
                        sha(Path(line_report).read_bytes()) != execution["coverage"]["change_lines"].get("raw_sha256")):
        fail("changed-line coverage evidence changed")
    line_raw = execution["coverage"].get("line_raw_path") if has_execution else None
    if line_raw and (not Path(line_raw).is_relative_to(out) or not Path(line_raw).is_file() or
                     sha(Path(line_raw).read_bytes()) != execution["coverage"].get("line_raw_sha256")):
        fail("line coverage evidence changed")
    run_log = execution["coverage"].get("run_log_path") if has_execution else None
    if run_log and (not Path(run_log).is_relative_to(out) or not Path(run_log).is_file() or
                    sha(Path(run_log).read_bytes()) != execution["coverage"].get("run_log_sha256")):
        fail("coverage run log changed")
    assessment_path = out / "assessment.json"
    if assessment_path.is_file() and not has_execution:
        fail("assessment cannot precede execution")
    assessment = load(assessment_path) if assessment_path.is_file() else (execution["judgment"] if has_execution else
        {"status": "pending_review", "reason": "Scenario prepared; execution has not started"})
    if assessment_path.is_file() and (assessment.get("execution_sha256") != sha((out / "execution.json").read_bytes()) or
                                     assessment.get("status") not in ("passed", "product_bug", "repair_required", "blocked") or
                                     not assessment.get("reviewer") or not assessment.get("reason")):
        fail("independent assessment binding invalid")
    trace = {"schema": SCHEMA, "project": manifest["project"], "requirements": manifest.get("requirements", []),
             "reverse_rules": manifest.get("reverse_rules", []), "change": manifest.get("change"),
             "scenarios": manifest["scenarios"], "bindings": manifest["bindings"],
             "case_results": execution["case_results"] if has_execution else [],
             "coverage": execution["coverage"] if has_execution else {"status": "pending"},
             "judgment": assessment, "revision": revision, "attempt_id": execution["attempt_id"] if has_execution else out.name,
             "stage": "reviewed" if assessment_path.is_file() else "awaiting_review" if has_execution else "prepared",
             "generated_at": stamp()}
    if manifest.get("acceptance"):
        trace["acceptance"] = manifest["acceptance"]
    trace_path = out / "trace.json"
    if trace_path.is_file():
        previous = load(trace_path)
        if {k: v for k, v in previous.items() if k != "generated_at"} == {k: v for k, v in trace.items() if k != "generated_at"}:
            trace["generated_at"] = previous["generated_at"]
    save(trace_path, trace)
    print(json.dumps({"status": "projected", "trace": str(out / "trace.json")}))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=("prepare", "execute", "project"))
    ap.add_argument("manifest", type=Path)
    ap.add_argument("output", type=Path)
    args = ap.parse_args()
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from acceptance_store import guard
    guard(json.loads(args.manifest.read_text()), [args.output.resolve()])
    args.output.mkdir(parents=True, exist_ok=True)
    {"prepare": prepare, "execute": execute, "project": project}[args.action](args.manifest.resolve(), args.output.resolve())


if __name__ == "__main__":
    try:
        main()
    except (ValueError, FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        print(f"portable acceptance: {exc}", file=sys.stderr)
        raise SystemExit(2)
