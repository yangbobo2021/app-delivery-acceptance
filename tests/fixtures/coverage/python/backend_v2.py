"""Real coverage.py project primitives; no framework report/provenance logic."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import coverage

HERE = Path(__file__).resolve().parent
SETTINGS = json.loads((HERE / "settings.json").read_text())
ROOT, BEHAVIOR = Path(SETTINGS["root"]), SETTINGS["behavior"]


def load(file):
    return json.loads(Path(file).read_text())


def save(file, value):
    with Path(file).open("x") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")


def sha(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def main(operation, request):
    if operation == "tools":
        return {"tools": [{"name": "coverage.py", "version": coverage.__version__, "role": "English description"}]}
    if operation == "run":
        out = Path(request["output"])
        raw = out / "native"
        raw.mkdir()
        config = out / "coverage.ini"
        source = ROOT / 'src' if BEHAVIOR == 'zero-branch-mode' else ROOT
        config.write_text("[run]\nbranch = True\nparallel = True\nsource = " + str(source) + "\ndata_file = " + str(raw / ".coverage") + "\n")
        env = {**os.environ, **request.get("env", {})}
        env["PYTHONPATH"] = str(HERE / "hook") + os.pathsep + env.get("PYTHONPATH", "")
        if BEHAVIOR != "missing":
            env["COVERAGE_PROCESS_START"] = str(config)
        if BEHAVIOR == "drop-child":
            env["FIXTURE_DROP_CHILD"] = "1"
        child = subprocess.run(request["command"], cwd=request["cwd"], env=env)
        native = sorted(raw.glob(".coverage.*"))
        files = [(config, "config")] + [(file, "native") for file in native]
        return {"exit_code": child.returncode, "collection_status": "complete" if native else "incomplete",
                "raw_evidence": [{"path": str(file), "sha256": sha(file), "role": role} for file, role in files]}
    if operation != "read":
        raise ValueError("Only tools/run/read are project primitives")
    if BEHAVIOR == "broken-finish" or BEHAVIOR == "broken-summary" and len(request["groups"]) > 1:
        raise RuntimeError("controlled native reader failure")
    files = list(dict.fromkeys(item["path"] for group in request["groups"] for item in group["raw_evidence"] if item.get("role") == "native"))
    config = next(item["path"] for group in request["groups"] for item in group["raw_evidence"] if item.get("role") == "config")
    status = "measured" if files and all(group["status"] == "measured" for group in request["groups"]) else "incomplete"
    if files:
        cov = coverage.Coverage(data_file=str(Path(request["output"]) / ".combined"), config_file=config)
        cov.combine(data_paths=files, strict=True, keep=True)
        target = Path(request["output"]) / "coverage-native.json"
        cov.json_report(morfs=list(request["sources"].values()), outfile=str(target))
        document = load(target)
        if not document["meta"]["branch_coverage"] and BEHAVIOR != 'zero-branch-mode':
            raise ValueError("Native data has no branch measurements")
        summary = document["totals"]
        component = {"id": "src/calc.py", "source_paths": ["src/calc.py"],
                     "line": {"status": "measured", "covered": summary["covered_lines"], "total": summary["num_statements"]},
                     "branch": {"status": "measured", "covered": summary["covered_branches"], "total": summary["num_branches"]}
                     if 'num_branches' in summary else {"status":"unavailable", "reason":"Native zero snapshot has no branch mode"}}
        if BEHAVIOR == "native-metric":
            component["statements"] = component["line"]
            for name in ("line", "branch"):
                component[name] = {"status": "unavailable", "reason": "Controlled native-metric projection"}
        if BEHAVIOR in ("wrong-counts", "echo"):
            component["line"]["total"] += 1
        if BEHAVIOR == "mutate":
            with Path(files[0]).open("ab") as stream:
                stream.write(b"reader-mutation")
        derived = [{"path": str(target), "sha256": sha(target), "role": "native_report"}]
        meta = document["meta"]
    else:
        component = {"id": "src/calc.py", "source_paths": ["src/calc.py"], **{
            name: {"status": "unavailable", "reason": "Native snapshots missing"} for name in ("line", "branch")}}
        derived, meta = [], {}
    project = {"status": status, "components": [component]}
    unavailable = {"status": "unavailable", "reason": "Changed scope not requested"}
    return {"tools": request["tools"], "status": status, "components": [component],
            "scopes": {"project": project, "changed_files": unavailable, "changed_lines": unavailable},
            "derived_evidence": derived, "tool_metadata": meta}


if __name__ == "__main__":
    operation, request_file, response = sys.argv[1:]
    result = main(operation, load(request_file))
    save(response, result)
    if operation == "run":
        sys.exit(result["exit_code"])
