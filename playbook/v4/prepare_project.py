#!/usr/bin/env python3
"""Project-neutral, once-per-checkout test capability preparation.

The JSON spec supplies commands and paths. This program never infers a language,
test framework, or product behavior from source names.
"""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

# Shared project-owned storage and knowledge gate.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from acceptance_store import guard as acceptance_guard
from acceptance_workspace import POLICY, workspace_lease, ensure_workspace, verify_frozen_workspace
import time


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def git(root, *args):
    return subprocess.check_output(["git", *args], cwd=root, text=True).strip()


def run(root, item, timeout):
    argv = item if isinstance(item, list) else item.get("command")
    env_changes = {} if isinstance(item, list) else item.get("env", {})
    if not isinstance(argv, list) or not argv or not all(isinstance(v, str) and v for v in argv):
        raise ValueError("command must be a nonempty string array")
    if not isinstance(env_changes, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in env_changes.items()):
        raise ValueError("command env must contain string values")
    start = time.monotonic()
    process = subprocess.run(argv, cwd=root, text=True, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, timeout=timeout, check=False,
                             env={**os.environ, **env_changes})
    return {"command": argv, "env": env_changes, "exit_code": process.returncode,
            "seconds": round(time.monotonic() - start, 3),
            "output_tail": process.stdout[-3000:]}


def prepare(spec_path, out, spec, spec_bytes):
    if spec.get("schema") != "portable-project-prep-v1":
        raise ValueError("unsupported spec schema")
    acceptance_guard(spec, [out])
    root = ensure_workspace(spec, spec.get("source_checkout", spec["project_root"]),
                            spec["revision"], spec.get("components", []), spec.get("component_sources"))
    if not root.is_dir():
        raise ValueError("project root missing")
    if git(root, "rev-parse", "HEAD") != spec["revision"]:
        raise ValueError("project revision changed")
    runtime = spec.get("runtime")
    if spec.get("preparation_protocol") == "two-agent-v1" and not runtime:
        raise ValueError("two-agent project preparation requires a verified runtime Agent result")
    if spec.get("preparation_protocol") == "two-agent-v1" and spec.get("setup_commands"):
        raise ValueError("runtime setup belongs to the independent runtime Agent stage")
    if runtime:
        if not isinstance(runtime, dict) or not all(runtime.get(key) for key in ("manifest", "sha256")):
            raise ValueError("runtime binding needs manifest and sha256")
        from runtime_preparation import validate_runtime
        checked = validate_runtime(runtime["manifest"], expected_acceptance=spec["acceptance"], resmoke=True)
        if checked["runtime_sha256"] != runtime["sha256"]:
            raise ValueError("runtime manifest changed since Agent verification")
        if checked["workspace"] != str(root) or checked["revision"] != spec["revision"]:
            raise ValueError("runtime Agent verified another workspace/revision")
        runtime = {"manifest": checked["runtime_manifest"], "sha256": checked["runtime_sha256"]}
    components = []
    for item in spec.get("components", []):
        path = (root / item["path"]).resolve()
        if not path.is_relative_to(root) or git(path, "rev-parse", "HEAD") != item["revision"]:
            raise ValueError("component revision changed: " + item["path"])
        components.append({"path": item["path"], "revision": item["revision"]})
    files = {}
    for item in spec.get("binding_files", []):
        path = (root / item).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError("binding file missing: " + item)
        files[item] = sha(path.read_bytes())
    source_files = {}
    for item in spec.get("source_paths", []):
        path = (root / item).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError("declared non-test source missing: " + item)
        source_files[item] = sha(path.read_bytes())
    # Project-declared coverage adapters/owning fixtures, not language-specific guesses.
    from acceptance_store import inside
    coverage_test_files = {}
    for name in spec.get('coverage_test_files', []):
        file = inside(root, name)
        if not file.is_file() or not any(file.is_relative_to(inside(root, p)) for p in spec.get('test_roots', [])):
            raise ValueError('coverage_test_files must belong to declared test roots: ' + name)
        if name in source_files:
            raise ValueError('coverage fixture cannot also be product source: ' + name)
        coverage_test_files[name] = sha(file.read_bytes())
    from coverage_registry import project_coverage
    coverage = spec.get('coverage')
    if not coverage or coverage.get('policy')!='required':
        coverage = project_coverage(root,coverage)
    if coverage and coverage.get('policy') == 'required':
        coverage = {**coverage, 'required_test_files': coverage_test_files,
                    'acceptance': spec['acceptance']}
        from coverage_protocol import preparation
        prepared = preparation(coverage)
        if runtime and (prepared["spec"].get("runtime_manifest") != runtime["manifest"] or
                        prepared["spec"].get("runtime_sha256") != runtime["sha256"]):
            raise ValueError("coverage Agent did not use the verified runtime Agent result")
        if prepared['spec']['revision']!=spec['revision'] or prepared['spec'].get('components',{})!={item['path']:item['revision'] for item in components}:
            raise ValueError('Coverage preparation binds another product/component revision')
        if not prepared['spec'].get('registry_path') or not prepared['spec'].get('inventory_path'):
            raise ValueError('Required coverage needs a persistent registry and frozen scope inventory')
        if prepared['spec']['source_hashes'] != source_files:
            raise ValueError('Coverage preparation does not match complete project source inventory')
        if any(coverage_test_files.get(name)!=digest for name,digest in prepared['adapter_files'].items()):
            raise ValueError('Project coverage adapters must be bound coverage_test_files')
    markers = []
    for item in spec.get("ready_markers", []):
        path = (root / item).resolve()
        if not path.is_relative_to(root):
            raise ValueError("marker escapes project: " + item)
        markers.append({"path": item, "exists": path.exists()})
    out.mkdir(parents=True, exist_ok=True)
    catalog_path = out / "catalog.json"
    terminal_path = out / "terminal.json"
    fingerprint = sha(json.dumps({"spec": sha(spec_bytes), "root": str(root),
                                  "revision": spec["revision"], "components": components,
                                  "binding_files": files, "source_files": source_files,
                                  "coverage_test_files": coverage_test_files}, sort_keys=True).encode())
    if runtime:
        fingerprint = sha(json.dumps({"base": fingerprint, "runtime": runtime}, sort_keys=True).encode())
    if catalog_path.exists() and terminal_path.exists():
        old = json.loads(catalog_path.read_text())
        terminal = json.loads(terminal_path.read_text())
        if old.get("fingerprint") == fingerprint and terminal.get("catalog_sha256") == sha(catalog_path.read_bytes()) and all(x["exists"] for x in markers) and old.get('coverage')==(coverage if coverage and coverage.get('policy')=='required' else None):
            verify_frozen_workspace(spec, old)
            print(json.dumps({"state": "reused", "setup_calls": 0,
                              "fingerprint": fingerprint, "catalog": str(catalog_path)}))
            if coverage and coverage.get('policy')=='required':
                from coverage_registry import activate
                activate(coverage['prepared'],catalog_path)
            return
    if catalog_path.exists():raise ValueError('Existing project catalog is immutable; use a new output directory')
    setup = []
    if any(not x["exists"] for x in markers):
        for argv in spec.get("setup_commands", []):
            result = run(root, argv, int(spec.get("setup_timeout_seconds", 300)))
            setup.append(result)
            if result["exit_code"] != 0:
                raise RuntimeError("project setup failed: " + json.dumps(result))
        for item in markers:
            item["exists"] = (root / item["path"]).exists()
        if any(not x["exists"] for x in markers):
            raise RuntimeError("project setup did not produce ready markers")
    checks = []
    for argv in spec.get("capability_checks", []):
        result = run(root, argv, int(spec.get("check_timeout_seconds", 30)))
        checks.append(result)
        if result["exit_code"] != 0:
            raise RuntimeError("capability check failed: " + json.dumps(result))
    catalog = {"schema": "portable-project-catalog-v1", "fingerprint": fingerprint,
               "project_root": str(root), "revision": spec["revision"],
               "components": components, "binding_files": files,
               "source_paths": sorted(source_files), "source_hashes": source_files,
               "test_roots": spec.get("test_roots", []),
               "source_roots": spec.get("source_roots", []),
               "coverage_test_files": coverage_test_files,
               "runner_hints": spec.get("runner_hints", {}),
               "ready_markers": markers, "setup": setup, "capability_checks": checks}
    if runtime:
        catalog["runtime"] = runtime
        catalog["preparation_protocol"] = spec.get("preparation_protocol", "two-agent-v1")
    catalog["acceptance"] = spec["acceptance"]
    catalog["workspace_policy"] = POLICY
    verify_frozen_workspace(spec, catalog)
    if coverage and coverage.get('policy') == 'required':
        catalog['coverage'] = coverage
    raw = json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"
    catalog_path.write_text(raw)
    terminal_path.write_text(json.dumps({"state": "prepared", "fingerprint": fingerprint,
                                         "catalog_sha256": sha(raw.encode()),
                                         "setup_calls": len(setup)}, indent=2) + "\n")
    if coverage and coverage.get('policy')=='required':
        from coverage_registry import activate
        activate(coverage['prepared'],catalog_path)
    print(json.dumps({"state": "prepared", "setup_calls": len(setup),
                      "fingerprint": fingerprint, "catalog": str(catalog_path)}))


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: prepare_project.py spec.json output-dir")
    spec_path = Path(sys.argv[1]).resolve()
    spec_bytes = spec_path.read_bytes()
    spec = json.loads(spec_bytes)
    out = Path(sys.argv[2]).resolve()
    acceptance_guard(spec, [out])
    with workspace_lease(spec, out):
        prepare(spec_path, out, spec, spec_bytes)


if __name__ == "__main__":
    main()
