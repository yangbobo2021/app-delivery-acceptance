"""Independent public-tool reader. Never imports the project backend."""
import json
from pathlib import Path
import sys
import tempfile
import coverage

request = json.loads(Path(sys.argv[1]).read_text())
files = list(dict.fromkeys(item["path"] for group in request["groups"] for item in group["raw_evidence"] if item.get("role") == "native"))
config = next(item["path"] for group in request["groups"] for item in group["raw_evidence"] if item.get("role") == "config")
cov = coverage.Coverage(data_file=str(Path(request["output"]) / ".oracle"), config_file=config)
cov.combine(data_paths=files, strict=True, keep=True)
components = []
for item in request["component_sources"]:
    with tempfile.TemporaryDirectory() as folder:
        target = Path(folder) / "native.json"
        cov.json_report(morfs=[request["sources"][name] for name in item["source_paths"]], outfile=str(target))
        doc = json.loads(target.read_text())
    summary = doc["totals"]
    component = {"id": item["id"], "source_paths": item["source_paths"],
                 "line": {"status": "measured", "covered": summary["covered_lines"], "total": summary["num_statements"]},
                 "branch": {"status": "measured", "covered": summary["covered_branches"], "total": summary["num_branches"]}
                 if 'num_branches' in summary else {"status":"unavailable", "reason":"Native zero snapshot has no branch mode"}}
    if "statements" in item.get("metric_names", []):
        component["statements"] = component["line"]
        for name in ("line", "branch"):
            component[name] = {"status": "unavailable", "reason": "Controlled native-metric projection"}
    components.append(component)
print(json.dumps({"schema": "coverage-native-oracle-v1", "status": "measured", "components": components}))
