"""Language-neutral binding and invocation of project-owned coverage tools.

Only the project toolchain recognizes executable units, instruments, merges or
calculates metrics. This module validates provenance, paths and frozen bytes.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile

PROTOCOL = "project-coverage-v1"


def read(path):
    return json.loads(Path(path).read_text())


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temp.replace(path)


def resolved(path, mapping=None, expected=None):
    canonical=Path(path)
    if canonical.is_file() and (expected is None or sha(canonical)==expected):
        return canonical
    item = (mapping or {}).get(str(path)+'#'+expected) if expected else None
    item = item or (mapping or {}).get(str(path))
    if item and expected and item['sha256']!=expected:item=None
    if item:
        actual = Path(item["path"])
        if sha(actual) != item["sha256"]:
            raise ValueError("coverage artifact mapping changed: " + str(path))
        return actual
    return Path(path)


def bound_file(path, expected, mapping=None):
    file = resolved(path, mapping, expected)
    if file.is_symlink() or not file.is_file() or sha(file) != expected:
        raise ValueError("coverage bound file missing or changed: " + str(path))
    return file


def invoke(profile, operation, request, output, mapping=None):
    """Invoke the frozen project entry; JSON values never become shell text."""
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    entry = profile.get("entry")
    if not isinstance(entry, list) or not entry or not all(isinstance(x, str) and x for x in entry):
        raise ValueError("project coverage entry must be an argv array")
    root = Path(profile["spec"]["project_root"])
    mapping=dict(mapping or {})
    bindings={str(root/name):digest for name,digest in
              {**profile['spec']['source_hashes'],**profile['adapter_files']}.items()}
    for original,digest in bindings.items():
        versioned=mapping.get(original+'#'+digest)
        if versioned:mapping[original]=versioned
    for name, digest in profile.get("adapter_files", {}).items():
        bound_file(root / name, digest, mapping)
    argv = [str(resolved(x,mapping,bindings.get(str(x)))) if str(x) in (mapping or {}) else x for x in entry]
    with tempfile.TemporaryDirectory(prefix="project-coverage-request-", dir=output.parent) as folder:
        path = Path(folder) / "request.json"
        save(path, {**request, "artifact_map": mapping or {}})
        result = subprocess.run([*argv, operation, str(path), str(output)],
                                cwd=root if root.is_dir() else output.parent,
                                text=True, capture_output=True, timeout=180)
        if result.returncode:
            raise ValueError("project coverage " + operation + " failed: " + (result.stderr or result.stdout)[-1800:])
    if not output.is_file():
        raise ValueError("project coverage operation produced no response: " + operation)
    return read(output)


def preparation(config, *, run_check=True, mapping=None):
    if config.get("protocol") != PROTOCOL:
        raise ValueError("required coverage needs a verified project coverage protocol; tool labels alone cannot certify metrics")
    path = resolved(Path(config["prepared"]) / "prepared.json", mapping,config.get('prepared_sha256'))
    profile = read(path)
    if profile.get("schema") != "project-coverage-preparation-v1":
        raise ValueError("invalid project coverage preparation")
    if config.get("prepared_sha256") and sha(path) != config["prepared_sha256"]:
        raise ValueError("coverage preparation changed")
    spec = profile["spec"]
    root = Path(spec["project_root"]).resolve()
    if not spec.get("source_hashes") or not spec.get("registry_path") or not spec.get("inventory_path"):
        raise ValueError("coverage needs complete source inventory and persistent evidence index")
    for name in ("inventory_path", "registry_path"):
        if not Path(spec[name]).is_absolute():
            raise ValueError(f"coverage {name} must be an absolute path usable from every execution directory")
    if not spec.get('inventory_sha256'):
        raise ValueError('coverage needs a frozen scope inventory digest')
    bound_file(spec['inventory_path'], spec['inventory_sha256'], mapping)
    for name,digest in spec['source_hashes'].items():
        if Path(name).is_absolute() or '..' in Path(name).parts:
            raise ValueError('coverage source escapes project')
        if (root/name).exists() and not (root/name).resolve().is_relative_to(root):
            raise ValueError('coverage source resolves outside project')
        bound_file(root/name,digest,mapping)
    if not profile.get("adapter_files") or not profile.get("tools"):
        raise ValueError("coverage needs frozen project adapters and actual tool versions")
    for tool in profile["tools"]:
        if not all(tool.get(k) for k in ("name", "version", "role")):
            raise ValueError("coverage tool provenance is incomplete")
    for name, digest in profile["adapter_files"].items():
        file = root / name
        if Path(name).is_absolute() or ".." in Path(name).parts:
            raise ValueError("coverage adapter escapes project")
        if file.exists() and not file.resolve().is_relative_to(root):
            raise ValueError('coverage adapter resolves outside project')
        bound_file(file, digest, mapping)
    if not any(str(root / name) in profile.get("entry", []) or name in profile.get("entry", []) for name in profile["adapter_files"]):
        raise ValueError("project coverage entry must include a frozen project adapter")
    dispositions = profile.get("source_dispositions", {})
    if set(dispositions) != set(spec["source_hashes"]):
        raise ValueError("coverage disposition must cover every frozen source")
    if any(x.get("kind") not in {"measured", "non_executable", "unsupported"} or not x.get("reason") for x in dispositions.values()):
        raise ValueError("coverage source disposition is incomplete")
    for artifact in profile.get("preparation_evidence", []):
        bound_file(artifact["path"], artifact["sha256"], mapping)
    if not profile.get("preparation_evidence"):
        raise ValueError("coverage requires actual toolchain probe evidence")
    runtime_keys = ("runtime_manifest", "runtime_sha256", "probe_report", "probe_report_sha256")
    if any(spec.get(key) for key in runtime_keys):
        if not all(spec.get(key) for key in runtime_keys):
            raise ValueError("coverage runtime/probe binding is incomplete")
        runtime_path = bound_file(spec["runtime_manifest"], spec["runtime_sha256"], mapping)
        probe_path = bound_file(spec["probe_report"], spec["probe_report_sha256"], mapping)
        runtime = read(runtime_path)
        if (runtime.get("schema") != "project-runtime-preparation-v1" or
                Path(runtime.get("workspace", "")).resolve() != root or
                runtime.get("revision") != spec["revision"]):
            raise ValueError("coverage profile binds another runtime workspace/revision")
        # Active case execution has no archive map and must revalidate this
        # machine's environment. Historical read-only archive inspection uses
        # byte-identical mapped evidence; it must not rerun a retired runtime.
        live_runtime = not mapping and runtime_path.resolve() == Path(spec["runtime_manifest"]).resolve()
        if run_check and live_runtime:
            import sys
            sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
            from runtime_preparation import validate_runtime
            validate_runtime(runtime_path, expected_acceptance=runtime["acceptance"], resmoke=True)
        from coverage_preparation import verify_report as verify_probes
        measured = [name for name, item in dispositions.items() if item["kind"] == "measured"]
        probe = verify_probes(probe_path, runtime_path, spec["runtime_sha256"], measured,
                              verify_runtime=run_check and live_runtime, mapping=mapping)
        expected_status = "ready" if (probe["status"] == "ready" and measured and
                                      not any(item["kind"] == "unsupported" for item in dispositions.values())) else "partial"
        if profile.get("preparation_status") != expected_status:
            raise ValueError("coverage readiness does not match validated probe/source limits")
    if run_check:
        with tempfile.TemporaryDirectory(prefix="coverage-verify-preparation-") as folder:
            checked = invoke(profile, "verify-preparation", {"prepared": str(path)}, Path(folder) / "checked.json", mapping)
            if checked.get("status") != "valid":
                raise ValueError("project coverage preparation verification rejected")
    return profile


def verify_report(report_path, receipt_path=None, *, run_check=True, mapping=None):
    report_path = resolved(report_path, mapping)
    report = read(report_path)
    if report.get("schema") != "project-tool-coverage-report-v1" or report.get("protocol") != PROTOCOL:
        raise ValueError("invalid project coverage report protocol")
    profile = preparation(report, run_check=run_check, mapping=mapping)
    if report.get("revision") != profile["spec"]["revision"] or report.get("source_hashes") != profile["spec"]["source_hashes"]:
        raise ValueError("coverage source version mismatch")
    if report.get("tools") != profile["tools"] or report.get("collection_relation") != "same_run":
        raise ValueError("coverage tool provenance or execution relation mismatch")
    if report.get("status") not in {"measured", "incomplete"} or not report.get("components"):
        raise ValueError("coverage report has no measured components")
    receipt_file = bound_file(report['receipt_path'], report['execution_sha256'], mapping)
    if receipt_path and sha(resolved(receipt_path, mapping, report['execution_sha256'])) != report['execution_sha256']:
        raise ValueError('coverage is bound to another execution')
    receipt = read(receipt_file)
    session_file = bound_file(receipt['coverage_session_path'], receipt['coverage_session_sha256'], mapping)
    session = read(session_file)
    if (session.get('scene_id') != report.get('scene_id') or
        session.get('prepared_sha256') != report.get('prepared_sha256') or
        session.get('prepared') != report.get('prepared') or
        session.get('cwd') != profile['spec']['project_root'] or
        session.get('revision', report['revision']) != report['revision'] or
        receipt.get('head_before') != report['revision'] or receipt.get('head_after') != report['revision']):
        raise ValueError('coverage scene/profile/source does not bind its frozen execution session')
    expected_command = [*profile['entry'], 'run', receipt['coverage_session_path'],
                        str(Path(session['output'])/'run-response.json')]
    if receipt.get('command') != expected_command or receipt.get('cwd') != session['cwd']:
        raise ValueError('coverage receipt does not bind the prepared execution entry')
    raw = report.get("raw_evidence", [])
    if not raw:
        raise ValueError("coverage report lacks native evidence")
    for item in raw:
        if not any(Path(item['path']).is_relative_to(Path(base)) for base in (session['output'],report['prepared'])):
            raise ValueError('native coverage evidence is outside its execution/preparation')
        bound_file(item["path"], item["sha256"], mapping)
    for item in report.values():
        if isinstance(item,dict) and isinstance(item.get('path'),str) and isinstance(item.get('sha256'),str):
            bound_file(item['path'], item['sha256'], mapping)
    if report['status']=='measured' and any(x['kind']=='unsupported' for x in profile['source_dispositions'].values()):
        raise ValueError('unsupported source scope cannot claim complete measured coverage')
    for component in report["components"]:
        if not component.get("id") or not component.get("source_paths"):
            raise ValueError("coverage component source binding missing")
        if not set(component['source_paths']).issubset(profile['spec']['source_hashes']):
            raise ValueError('coverage component escapes frozen source inventory')
        for metric in ("line", "branch"):
            value = component.get(metric, {})
            if value.get("status") not in {"measured", "incomplete", "unavailable"}:
                raise ValueError("coverage metric status missing")
            if value["status"] in {"measured", "incomplete"}:
                covered, total = value.get("covered"), value.get("total")
                if type(covered) is not int or type(total) is not int or not 0 <= covered <= total:
                    raise ValueError("invalid tool-owned coverage counts")
                if 'pct' in value and (type(value['pct']) not in (int,float) or not math.isfinite(value['pct']) or not 0<=value['pct']<=100):
                    raise ValueError('invalid tool-owned coverage percentage')
            elif not value.get("reason"):
                raise ValueError("unavailable coverage metric needs reason")
    represented={name for component in report['components'] for name in component['source_paths']}
    measured={name for name,value in profile['source_dispositions'].items() if value['kind']=='measured'}
    if not measured.issubset(represented):
        raise ValueError('coverage components omit frozen measured source')
    if run_check:
        with tempfile.TemporaryDirectory(prefix="coverage-verify-report-") as folder:
            checked = invoke(profile, "verify-report", {"report": str(report_path)}, Path(folder) / "checked.json", mapping)
            if checked.get("status") != "valid":
                raise ValueError("project tool rejected native coverage report")
    return report


def summarize_reports(reports, inventory=None, mapping=None):
    reports = sorted(set(map(str, reports)))
    checked = [verify_report(path, mapping=mapping) for path in reports]
    if not checked or len({r["prepared_sha256"] for r in checked}) != 1:
        raise ValueError("coverage preparations are missing or incompatible")
    profile = preparation(checked[0], run_check=False, mapping=mapping)
    frozen_inventory=read(bound_file(profile['spec']['inventory_path'],profile['spec']['inventory_sha256'],mapping))
    if inventory is not None and inventory!=frozen_inventory:
        raise ValueError('coverage summary inventory differs from its frozen preparation')
    inventory=frozen_inventory
    with tempfile.TemporaryDirectory(prefix="coverage-project-summary-") as folder:
        result = invoke(profile, "summarize", {"reports": reports, "inventory": inventory}, Path(folder) / "summary.json", mapping)
    if not isinstance(result.get("scopes"), dict) or result.get("tools") != profile["tools"]:
        raise ValueError("project coverage summary lacks scope or tool provenance")
    for name in ("project", "changed_files", "changed_lines"):
        value = result["scopes"].get(name, {})
        if value.get("status") not in {"measured", "incomplete", "unavailable"}:
            raise ValueError("project summarizer omitted coverage scope: " + name)
        if value["status"] == "unavailable" and not value.get("reason"):
            raise ValueError("unsupported coverage scope needs a concrete reason")
    return result
