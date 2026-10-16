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


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: prepare_project.py spec.json output-dir")
    spec_path = Path(sys.argv[1]).resolve()
    spec_bytes = spec_path.read_bytes()
    spec = json.loads(spec_bytes)
    out = Path(sys.argv[2]).resolve()
    if spec.get("schema") != "portable-project-prep-v1":
        raise ValueError("unsupported spec schema")
    root = Path(spec["project_root"]).resolve()
    if not root.is_dir():
        raise ValueError("project root missing")
    if git(root, "rev-parse", "HEAD") != spec["revision"]:
        raise ValueError("project revision changed")
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
                                  "binding_files": files, "source_files": source_files}, sort_keys=True).encode())
    if catalog_path.exists() and terminal_path.exists():
        old = json.loads(catalog_path.read_text())
        terminal = json.loads(terminal_path.read_text())
        if old.get("fingerprint") == fingerprint and terminal.get("catalog_sha256") == sha(catalog_path.read_bytes()) and all(x["exists"] for x in markers):
            print(json.dumps({"state": "reused", "setup_calls": 0,
                              "fingerprint": fingerprint, "catalog": str(catalog_path)}))
            return
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
               "runner_hints": spec.get("runner_hints", {}),
               "ready_markers": markers, "setup": setup, "capability_checks": checks}
    raw = json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"
    catalog_path.write_text(raw)
    terminal_path.write_text(json.dumps({"state": "prepared", "fingerprint": fingerprint,
                                         "catalog_sha256": sha(raw.encode()),
                                         "setup_calls": len(setup)}, indent=2) + "\n")
    print(json.dumps({"state": "prepared", "setup_calls": len(setup),
                      "fingerprint": fingerprint, "catalog": str(catalog_path)}))


if __name__ == "__main__":
    main()
