"""Validate opt-in code-coverage evidence; standard acceptance never reads it."""

import hashlib
import json
import re
import subprocess
from pathlib import Path

MODES = ("standard", "coverage")
HASH = re.compile(r"^[a-f0-9]{64}$")
REVISION = re.compile(r"^(?:[a-f0-9]{40}|[a-f0-9]{64})$")


def selected_mode(value):
    if value not in MODES:
        raise ValueError("coverage mode must be standard or coverage")
    return value



def pinned_source_bytes(project, revision, path):
    """Resolve original bytes through only gitlinks pinned by the tested tree."""
    relative = Path(path)
    if relative.is_absolute() or ".." in relative.parts or not REVISION.fullmatch(revision):
        raise ValueError("invalid pinned source reference")
    root = Path(project).resolve()
    parts = relative.parts
    for index in range(1, len(parts) + 1):
        prefix = "/".join(parts[:index])
        result = subprocess.run(["git", "-C", str(root), "ls-tree", "-z", revision, "--", prefix], capture_output=True, check=True)
        records = [entry for entry in result.stdout.split(b"\0") if entry]
        for record in records:
            meta, name = record.split(b"\t", 1)
            mode, kind, object_id = meta.decode().split()
            if name.decode() != prefix or mode != "160000" or kind != "commit":
                continue
            child = (root / prefix).resolve()
            if not child.is_relative_to(root) or index == len(parts):
                raise ValueError("source is not a file inside the pinned gitlink")
            return pinned_source_bytes(child, object_id, "/".join(parts[index:]))
    return subprocess.run(["git", "-C", str(root), "cat-file", "blob", f"{revision}:{path}"], capture_output=True, check=True).stdout


def errors_for_run(project, ledger, run_dir, run):
    errors = []

    def require(ok, message):
        if not ok:
            errors.append(message)

    def read(path):
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(value, dict):
                raise ValueError("expected object")
            return value
        except (OSError, ValueError) as exc:
            errors.append(f"invalid or missing code coverage file {path.name}: {exc}")
            return {}

    def evidence(record, label):
        if not isinstance(record, dict):
            errors.append(f"{label} needs path and sha256")
            return
        ref = record.get("path")
        if not isinstance(ref, str) or not ref.strip():
            errors.append(f"{label} needs path")
            return
        path = (run_dir / ref).resolve()
        if not path.is_relative_to(run_dir.resolve()):
            errors.append(f"{label} escapes run directory")
            return
        require(path.is_file() and path.stat().st_size > 0, f"{label} missing or empty")
        if path.is_file():
            require(hashlib.sha256(path.read_bytes()).hexdigest() == record.get("sha256"), f"{label} sha256 mismatch")

    hashes = run.get("ledger_hashes", {})
    for name in ("project.json", "requirements.json", "resources.json", "scenarios.json", "coverage_review.json", *(("white_box_rules.json",) if (ledger / "white_box_rules.json").exists() or "white_box_rules.json" in hashes else ())):
        path = ledger / name
        require(path.is_file() and isinstance(hashes, dict) and hashes.get(name) == hashlib.sha256(path.read_bytes()).hexdigest(), f"coverage inputs changed after run creation: {name}")

    measurement_path = run_dir / "code-coverage" / "measurement.json"
    measurement = read(measurement_path)
    review = read(run_dir / "code-coverage" / "review.json")
    for label, value in (("measurement", measurement), ("review", review)):
        require(value.get("run_id") == run_dir.name, f"coverage {label} run_id mismatch")
        require(value.get("revision") == run.get("revision"), f"coverage {label} revision mismatch")
        require(value.get("ledger_hashes") == run.get("ledger_hashes") and bool(run.get("ledger_hashes")), f"coverage {label} ledger hashes mismatch")
    require(measurement.get("status") == "measured", "coverage measurement blocked or incomplete")
    if measurement_path.is_file():
        require(review.get("measurement_sha256") == hashlib.sha256(measurement_path.read_bytes()).hexdigest(), "coverage review is stale for measurement")
    require(review.get("status") == "sufficient", "coverage review has gaps, failed behavior or blocked measurement")
    require(review.get("reviewer_kind") == "independent_ai" and isinstance(review.get("review_reference"), str) and bool(review["review_reference"].strip()), "code coverage needs independent review")
    require(isinstance(review.get("reason"), str) and bool(review["reason"].strip()), "coverage review needs substantive reason")
    require(review.get("recommendations") == [], "coverage has unresolved testing recommendations")

    scope = measurement.get("scope", {})
    scope = scope if isinstance(scope, dict) else {}
    targets = scope.get("targets")
    require(isinstance(targets, list) and bool(targets) and all(isinstance(x, str) and x for x in targets), "coverage scope needs source targets")
    targets = targets if isinstance(targets, list) and all(isinstance(x, str) for x in targets) else []
    require(len(targets) == len(set(targets)), "coverage scope has duplicate targets")
    require(isinstance(scope.get("basis"), str) and bool(scope["basis"].strip()), "coverage scope needs inventory basis")
    exclusions = scope.get("exclusions")
    require(isinstance(exclusions, list) and all(isinstance(x, dict) and isinstance(x.get("path"), str) and bool(x["path"].strip()) and isinstance(x.get("reason"), str) and bool(x["reason"].strip()) for x in exclusions), "coverage exclusions need explicit reasons (or empty list)")
    require(review.get("scope_reviewed") is True, "coverage scope/exclusions not independently reviewed")
    require(review.get("raw_counters_verified") is True, "coverage raw counters not independently verified")
    tools = measurement.get("tools")
    require(isinstance(tools, list) and bool(tools) and all(isinstance(x, dict) and all(isinstance(x.get(k), str) and x[k].strip() for k in ("name", "version", "command")) for x in tools), "coverage needs actual tool/version/command")
    require(bool(measurement.get("environment")), "coverage needs actual environment")
    raw = measurement.get("raw_evidence")
    require(isinstance(raw, list) and bool(raw), "coverage needs raw reports")
    for index, record in enumerate(raw if isinstance(raw, list) else []):
        evidence(record, f"raw coverage report[{index}]")
    proofs = review.get("evidence")
    require(isinstance(proofs, list) and bool(proofs), "coverage review needs independent evidence")
    for index, record in enumerate(proofs if isinstance(proofs, list) else []):
        evidence(record, f"coverage review evidence[{index}]")

    sources = measurement.get("sources")
    require(isinstance(sources, list) and bool(sources), "coverage needs original source metrics")
    sources = sources if isinstance(sources, list) else []
    source_map = {}
    deficits = {}
    revision = run.get("revision")
    valid_revision = isinstance(revision, str) and bool(REVISION.fullmatch(revision))
    require(valid_revision, "enhanced coverage needs an exact full Git revision")
    for source in sources:
        if not isinstance(source, dict) or not isinstance(source.get("path"), str):
            errors.append("invalid coverage source record")
            continue
        path = source["path"]
        require(path not in source_map, f"duplicate coverage source {path}")
        source_map[path] = source
        candidate = (project / path).resolve()
        if Path(path).is_absolute() or not candidate.is_relative_to(project.resolve()) or ".." in Path(path).parts:
            errors.append(f"coverage source escapes project: {path}")
            continue
        declared = source.get("sha256", "")
        require(isinstance(declared, str) and bool(HASH.fullmatch(declared)), f"invalid source sha256: {path}")
        require(candidate.is_file(), f"original source missing: {path}")
        if candidate.is_file():
            require(hashlib.sha256(candidate.read_bytes()).hexdigest() == declared, f"working source differs: {path}")
        if valid_revision:
            try:
                pinned = pinned_source_bytes(project, revision, path)
                bound = hashlib.sha256(pinned).hexdigest() == declared
            except (OSError, ValueError, subprocess.CalledProcessError):
                bound = False
            require(bound, f"source not bound to tested Git revision: {path}")
        metrics = source.get("metrics", {})
        metrics = metrics if isinstance(metrics, dict) else {}
        for kind in ("lines", "branches"):
            metric = metrics.get(kind, {})
            metric = metric if isinstance(metric, dict) else {}
            covered, total = metric.get("covered"), metric.get("total")
            valid = type(covered) is int and type(total) is int and 0 <= covered <= total
            require(valid, f"coverage {path}/{kind} needs measured integer counters")
            if valid:
                deficits[(path, "line" if kind == "lines" else "branch")] = total - covered
        for kind in ("functions", "statements"):
            if kind not in metrics:
                continue
            metric = metrics[kind]
            metric = metric if isinstance(metric, dict) else {}
            covered, total = metric.get("covered"), metric.get("total")
            require(type(covered) is int and type(total) is int and 0 <= covered <= total, f"coverage {path}/{kind} needs valid integer counters")
    require(set(source_map) == set(targets), "coverage source inventory differs from selected targets")
    uncovered = measurement.get("uncovered")
    require(isinstance(uncovered, list), "coverage needs uncovered path list (or empty list)")
    uncovered_map = {}
    counted = {}
    for item in uncovered if isinstance(uncovered, list) else []:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"]:
            errors.append("uncovered path needs stable id")
            continue
        require(item["id"] not in uncovered_map, "duplicate uncovered path id")
        uncovered_map[item["id"]] = item
        if not isinstance(item.get("file"), str) or not isinstance(item.get("kind"), str):
            errors.append("uncovered path needs source file and kind")
            continue
        key = (item["file"], item["kind"])
        require(key in deficits and isinstance(item.get("location"), str) and bool(item["location"].strip()), f"uncovered path outside inventory: {item['id']}")
        counted[key] = counted.get(key, 0) + 1
    require(all(counted.get(key, 0) == n for key, n in deficits.items()), "uncovered path list does not account for counter deficits")
    dispositions = review.get("dispositions")
    require(isinstance(dispositions, list), "coverage needs reviewed path dispositions")
    seen = set()
    scenario_ids = {x.get("id") for x in json.loads((ledger / "scenarios.json").read_text()).get("items", []) if isinstance(x, dict)}
    for item in dispositions if isinstance(dispositions, list) else []:
        if not isinstance(item, dict):
            errors.append("invalid coverage disposition")
            continue
        identifier = item.get("path_id")
        if not isinstance(identifier, str):
            errors.append("coverage disposition needs path_id")
            continue
        require(identifier in uncovered_map and identifier not in seen, "unknown or duplicate coverage disposition")
        seen.add(identifier)
        require(item.get("decision") in ("covered_by_existing", "defensive_unreachable", "out_of_scope"), "coverage path still needs testing")
        require(isinstance(item.get("reason"), str) and bool(item["reason"].strip()), "coverage disposition needs reason")
        if item.get("decision") == "covered_by_existing":
            links = item.get("scenario_ids")
            require(isinstance(links, list) and bool(links) and all(isinstance(x, str) and x in scenario_ids for x in links), "coverage disposition needs current linked scenarios")
    require(seen == set(uncovered_map), "not every uncovered path independently assessed")
    probes = review.get("state_probes")
    require(isinstance(probes, list) and bool(probes), "coverage needs semantic state/transition challenge")
    for probe in probes if isinstance(probes, list) else []:
        require(isinstance(probe, dict) and all(isinstance(probe.get(k), str) and probe[k].strip() for k in ("state", "plausible_fault", "failure_signal")) and isinstance(probe.get("scenario_ids"), list) and bool(probe["scenario_ids"]) and all(isinstance(x, str) and x in scenario_ids for x in probe["scenario_ids"]), "coverage state probe needs fault, observable failure and current scenario links")
    return errors
