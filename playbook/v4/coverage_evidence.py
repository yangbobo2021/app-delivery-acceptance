"""Freeze optional same-run per-line coverage from a project-supplied collector."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
from datetime import datetime

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "v3"))
from portable import parse_line_report  # noqa: E402


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def freeze_coverage(spec, root, execution_dir, receipt_path, destination):
    spec = spec or {"policy": "unavailable", "reason": "No project coverage collector was supplied"}
    policy = spec.get("policy")
    if policy in ("off", "unavailable"):
        result = {"status": policy, "reason": spec.get("reason", "Collection explicitly skipped" if policy == "off" else "Collector unavailable")}
    elif policy == "required":
        sources = spec.get("source_paths")
        if not isinstance(sources, list) or not sources:
            raise ValueError("required coverage needs a complete non-test source inventory")
        raw_path = spec.get("line_report_path")
        parser = spec.get("line_parser")
        if not raw_path or parser not in ("lcov", "coveragepy-json"):
            raise ValueError("required coverage needs a line report path and supported parser")
        raw_path = raw_path.replace("{project}", str(root)).replace("{artifacts}", str(execution_dir))
        report = Path(raw_path)
        if not report.is_absolute():
            report = Path(root) / report
        report = report.resolve()
        if not report.is_file() or report.is_symlink():
            raise ValueError("same-run line report missing or unsafe")
        receipt = json.loads(Path(receipt_path).read_text())
        start = datetime.fromisoformat(receipt["start_utc"]).timestamp()
        if report.stat().st_mtime < start:
            raise ValueError("line report predates frozen execution")
        if report.stat().st_size > int(spec.get("max_report_bytes", 20000000)):
            raise ValueError("line report exceeds configured size limit")
        destination = Path(destination)
        destination.mkdir(parents=True, exist_ok=True)
        frozen = destination / ("line-report.json" if parser == "coveragepy-json" else "line-report.lcov")
        shutil.copy2(report, frozen)
        rows = parse_line_report(frozen, parser, sources)
        result = {"status": "measured", "line_files": rows, "source_scope": sources,
                  "line_parser": parser, "line_raw_path": str(frozen), "line_raw_sha256": sha(frozen),
                  "collection_relation": "same_run", "execution_sha256": sha(receipt_path)}
    else:
        raise ValueError("coverage policy must be required, unavailable or off")
    path = Path(destination).parent / (Path(destination).name + ".json")
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return result, path
