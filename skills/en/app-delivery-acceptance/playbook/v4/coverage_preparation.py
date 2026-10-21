#!/usr/bin/env python3
"""Run and verify project-owned coverage probes against a frozen runtime.

The project chooses the commands and tool. This gate only executes argv through
the prepared runtime, freezes evidence, and checks tool/adapter agreement.
"""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from runtime_preparation import validate_runtime


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _bound(path, digest, mapping=None):
    original = Path(path)
    if original.is_file() and sha(original) == digest:
        return original
    item = (mapping or {}).get(str(path) + "#" + digest) or (mapping or {}).get(str(path))
    if item and item.get("sha256") == digest and sha(item["path"]) == digest:
        return Path(item["path"])
    raise ValueError("coverage probe bound artifact missing or changed: " + str(path))


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def _runtime(manifest, digest, verify=True):
    path = Path(manifest).resolve()
    if not path.is_file() or sha(path) != digest:
        raise ValueError("coverage runtime manifest missing or changed")
    if verify:
        checked = validate_runtime(path, resmoke=True)
        if checked.get("status") != "ready":
            raise ValueError("coverage runtime is not ready")
    runtime = json.loads(path.read_text())
    if runtime.get("schema") != "project-runtime-preparation-v1" or runtime.get("status") != "ready":
        raise ValueError("invalid coverage runtime manifest")
    return runtime


def _command(argv, runtime, substitutions):
    if not isinstance(argv, list) or not argv or not all(isinstance(x, str) and x for x in argv):
        raise ValueError("coverage probe command must be an argv array")
    command = [part.format_map(substitutions) for part in argv]
    allowed = {str(Path(item[key]).resolve()) for item in runtime["executables"]
               for key in ("path", "resolved_path") if item.get(key)}
    if str(Path(command[0]).resolve()) not in allowed:
        raise ValueError("coverage probe bypasses prepared runtime executable")
    return command


def _execute(argv, runtime, substitutions, cwd, output):
    command = _command(argv, runtime, substitutions)
    result = subprocess.run(command, cwd=cwd, capture_output=True, text=True,
                            timeout=180, check=False)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    (output / "stdout.txt").write_text(result.stdout)
    (output / "stderr.txt").write_text(result.stderr)
    receipt = {"command": command, "cwd": str(cwd), "exit_code": result.returncode,
               "stdout": {"path": str(output / "stdout.txt"), "sha256": sha(output / "stdout.txt")},
               "stderr": {"path": str(output / "stderr.txt"), "sha256": sha(output / "stderr.txt")}}
    write(output / "receipt.json", receipt)
    return receipt


def _normalized(value, expected_sources):
    if value.get("schema") != "coverage-probe-normalized-v1" or not isinstance(value.get("components"), list):
        raise ValueError("coverage probe normalized output missing")
    seen = set()
    measured_sources = set()
    for component in value["components"]:
        if not component.get("id") or not component.get("source_paths") or not isinstance(component.get("metrics"), dict):
            raise ValueError("coverage probe component incomplete")
        for source in component["source_paths"]:
            if source not in expected_sources:
                raise ValueError("coverage probe reported source outside route")
            seen.add(source)
        for metric in component["metrics"].values():
            if metric.get("status") == "measured":
                covered, total = metric.get("covered"), metric.get("total")
                if type(covered) is not int or type(total) is not int or not 0 <= covered <= total:
                    raise ValueError("coverage probe counts invalid")
                if total > 0:
                    measured_sources.update(component["source_paths"])
            elif metric.get("status") == "unavailable":
                if not metric.get("reason"):
                    raise ValueError("coverage probe unavailable metric lacks reason")
            else:
                raise ValueError("coverage probe metric status invalid")
    if seen != set(expected_sources):
        raise ValueError("coverage probe omitted route source")
    if measured_sources != set(expected_sources):
        raise ValueError("coverage probe has no measured units for a declared source")
    return [metric for c in value["components"] for metric in c["metrics"].values()
            if metric["status"] == "measured"]


def _probe(mode, route, plan, runtime, output):
    root = Path(runtime["workspace"]).resolve()
    folder = output / route["id"] / mode
    raw = folder / "raw"
    raw.mkdir(parents=True, exist_ok=False)
    substitutions = {"raw_dir": str(raw), "probe_dir": str(folder), "workspace": str(root)}
    commands = route[mode]
    if commands["adapter"] == commands["direct"]:
        raise ValueError("adapter and direct-tool probes must use distinct commands")
    receipts = {}
    for name in ("collect", "adapter", "direct"):
        receipts[name] = _execute(commands[name], runtime, substitutions, root, folder / name)
        if receipts[name]["exit_code"]:
            raise ValueError("coverage " + name + " probe failed")
        if name == "collect":
            native = {str(path): sha(path) for path in raw.rglob("*") if path.is_file()}
            if not native:
                raise ValueError("coverage probe produced no native data")
    if native != {str(path): sha(path) for path in raw.rglob("*") if path.is_file()}:
        raise ValueError("coverage probe readers changed native data")
    adapter = json.loads(Path(receipts["adapter"]["stdout"]["path"]).read_text())
    direct = json.loads(Path(receipts["direct"]["stdout"]["path"]).read_text())
    metrics = _normalized(adapter, route["source_paths"])
    _normalized(direct, route["source_paths"])
    if adapter != direct:
        raise ValueError("coverage adapter differs from direct tool result")
    if not metrics or not any(x["total"] > 0 for x in metrics):
        raise ValueError("coverage probe has no nonempty tool-owned units")
    if mode == "zero" and any(x["covered"] != 0 for x in metrics):
        raise ValueError("zero-hit native probe reported covered units")
    if mode == "nonzero" and not any(x["covered"] > 0 for x in metrics):
        raise ValueError("nonzero probe did not exercise measured source")
    return {"status": "passed", "receipts": {name: {"path": str(folder / name / "receipt.json"),
             "sha256": sha(folder / name / "receipt.json")} for name in receipts},
            "native": [{"path": path, "sha256": digest} for path, digest in sorted(native.items())],
            "normalized_sha256": sha(receipts["adapter"]["stdout"]["path"])}


def run_plan(plan_path, output):
    plan_path, output = Path(plan_path).resolve(), Path(output).resolve()
    plan = json.loads(plan_path.read_text())
    if plan.get("schema") != "project-coverage-probe-plan-v1":
        raise ValueError("invalid coverage probe plan")
    runtime = _runtime(plan["runtime_manifest"], plan["runtime_sha256"])
    if Path(plan["workspace"]).resolve() != Path(runtime["workspace"]).resolve() or plan["revision"] != runtime["revision"]:
        raise ValueError("coverage probe is bound to another runtime workspace/revision")
    if output.exists():
        raise FileExistsError("coverage probe output already exists")
    output.mkdir(parents=True)
    report = {"schema": "project-coverage-probe-report-v1", "plan": str(plan_path),
              "plan_sha256": sha(plan_path), "runtime_manifest": plan["runtime_manifest"],
              "runtime_sha256": plan["runtime_sha256"], "workspace": plan["workspace"],
              "revision": plan["revision"], "routes": [],
              "status": "ready" if plan.get("routes") else "partial"}
    seen = set()
    for route in plan["routes"]:
        if (not route.get("id") or route["id"] in seen or
                not route["id"].replace("-", "").replace("_", "").isalnum() or
                not route.get("source_paths")):
            raise ValueError("coverage route ID/source paths invalid")
        seen.add(route["id"])
        item = {"id": route["id"], "source_paths": route["source_paths"], "probes": {}}
        for mode in ("zero", "nonzero"):
            try:
                item["probes"][mode] = _probe(mode, route, plan, runtime, output)
            except Exception as exc:
                item["probes"][mode] = {"status": "failed", "reason": str(exc)}
                report["status"] = "partial"
        report["routes"].append(item)
    write(output / "coverage-probes.json", report)
    return report


def verify_report(path, runtime_manifest, runtime_sha256, measured_sources, verify_runtime=True, mapping=None):
    report = json.loads(Path(path).read_text())
    runtime = _runtime(runtime_manifest, runtime_sha256, verify=verify_runtime)
    if report.get("schema") != "project-coverage-probe-report-v1" or report.get("runtime_sha256") != runtime_sha256:
        raise ValueError("coverage probe report/runtime binding invalid")
    if Path(report.get("workspace", "")).resolve() != Path(runtime["workspace"]).resolve() or report.get("revision") != runtime["revision"]:
        raise ValueError("coverage probe report binds another workspace/revision")
    _bound(report["plan"], report["plan_sha256"], mapping)
    covered = set()
    all_passed = bool(report.get("routes"))
    for route in report.get("routes", []):
        if all(route.get("probes", {}).get(mode, {}).get("status") == "passed" for mode in ("zero", "nonzero")):
            covered.update(route["source_paths"])
        else:
            all_passed = False
        for mode, probe in route.get("probes", {}).items():
            if probe.get("status") != "passed":
                continue
            for ref in [*probe["receipts"].values(), *probe["native"]]:
                _bound(ref["path"], ref["sha256"], mapping)
            receipts = {name: json.loads(_bound(ref["path"], ref["sha256"], mapping).read_text())
                        for name, ref in probe["receipts"].items()}
            if set(receipts) != {"collect", "adapter", "direct"} or any(
                    item.get("exit_code") != 0 for item in receipts.values()):
                raise ValueError("coverage probe command receipt is incomplete")
            for receipt in receipts.values():
                _bound(receipt["stdout"]["path"], receipt["stdout"]["sha256"], mapping)
                _bound(receipt["stderr"]["path"], receipt["stderr"]["sha256"], mapping)
            adapter = json.loads(_bound(receipts["adapter"]["stdout"]["path"],
                                        receipts["adapter"]["stdout"]["sha256"], mapping).read_text())
            direct = json.loads(_bound(receipts["direct"]["stdout"]["path"],
                                       receipts["direct"]["stdout"]["sha256"], mapping).read_text())
            metrics = _normalized(adapter, route["source_paths"])
            _normalized(direct, route["source_paths"])
            if adapter != direct or probe.get("normalized_sha256") != receipts["adapter"]["stdout"]["sha256"]:
                raise ValueError("coverage probe direct-tool comparison changed")
            if mode == "zero" and any(item["covered"] != 0 for item in metrics):
                raise ValueError("coverage zero-hit probe changed")
            if mode == "nonzero" and not any(item["covered"] > 0 for item in metrics):
                raise ValueError("coverage nonzero probe changed")
    if report.get("status") != ("ready" if all_passed else "partial"):
        raise ValueError("coverage probe status differs from route evidence")
    if not set(measured_sources).issubset(covered):
        raise ValueError("measured source lacks passing zero/nonzero route probes")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="operation", required=True)
    run = sub.add_parser("run"); run.add_argument("plan"); run.add_argument("output")
    check = sub.add_parser("verify"); check.add_argument("report"); check.add_argument("runtime_manifest")
    check.add_argument("runtime_sha256"); check.add_argument("sources", nargs="*")
    args = parser.parse_args()
    result = run_plan(args.plan, args.output) if args.operation == "run" else verify_report(
        args.report, args.runtime_manifest, args.runtime_sha256, args.sources)
    print(json.dumps(result, ensure_ascii=False))
