#!/usr/bin/env python3
"""Prepare and verify one acceptance-bound project runtime.

The Agent supplies project commands and tools in a frozen spec.  This host has
no language or package-manager choices.  A successful manifest is immutable;
retries use a new workflow attempt so failed setup evidence remains available.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import time

from acceptance_store import digest, guard, inside, locations, owned_path, read, require_current, save, validate
from acceptance_workspace import ensure_workspace, workspace_lease


SCHEMA = "project-runtime-preparation-v1"


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _git(root, *args):
    return subprocess.check_output(["git", *args], cwd=root, text=True).strip()


def _argv(value):
    if not isinstance(value, list) or not value or not all(isinstance(x, str) and x for x in value):
        raise ValueError("command must be a nonempty argv string array")
    return value


def _expand(value, workspace, runtime_root):
    if not isinstance(value, str):
        raise ValueError("runtime command values must be strings")
    return value.replace("{workspace}", str(workspace)).replace("{runtime_root}", str(runtime_root))


def _command(item, workspace, runtime_root):
    if not isinstance(item, dict):
        raise ValueError("runtime command must be an object")
    argv = [_expand(x, workspace, runtime_root) for x in _argv(item.get("command"))]
    cwd = Path(_expand(item.get("cwd", "{workspace}"), workspace, runtime_root)).resolve()
    if not (cwd == workspace or cwd.is_relative_to(workspace) or
            cwd == runtime_root or cwd.is_relative_to(runtime_root)):
        raise ValueError("runtime command cwd escapes acceptance workspace/runtime root")
    if not cwd.is_dir():
        raise ValueError("runtime command cwd is missing: " + str(cwd))
    changes = item.get("env", {})
    if not isinstance(changes, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in changes.items()):
        raise ValueError("runtime command env must have string keys and values")
    env = {k: _expand(v, workspace, runtime_root) for k, v in changes.items()}
    timeout = item.get("timeout_seconds", 120)
    if not isinstance(timeout, int) or not 1 <= timeout <= 1800:
        raise ValueError("runtime command timeout_seconds must be 1..1800")
    return {"command": argv, "cwd": str(cwd), "env": env, "timeout_seconds": timeout}


def _observe(item):
    """Run a repeatable check without writing into the frozen runtime directory."""
    try:
        result = subprocess.run(item["command"], cwd=item["cwd"],
                                env={**os.environ, **item["env"]},
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                timeout=item["timeout_seconds"], check=False)
        raw, exit_code = result.stdout, result.returncode
    except subprocess.TimeoutExpired as error:
        raw, exit_code = (error.stdout or b"") + b"\nTIMEOUT\n", 124
    return raw, exit_code


def _run(item, log_path):
    started = time.monotonic()
    raw, exit_code = _observe(item)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_bytes(raw)
    return {**item, "exit_code": exit_code, "seconds": round(time.monotonic() - started, 3),
            "log": str(log_path), "output_sha256": _sha(raw)}


def _check_receipt(record):
    path = Path(record["log"])
    if not path.is_file() or digest(path) != record["output_sha256"]:
        raise ValueError("runtime execution receipt/log changed: " + str(path))
    if record["exit_code"] != 0:
        raise ValueError("runtime command did not succeed: " + str(path))


def _executable(item, workspace, runtime_root, log):
    if (not isinstance(item, dict) or not isinstance(item.get("name"), str) or
            not re.fullmatch(r"[A-Za-z0-9_-]+", item["name"])):
        raise ValueError("executable requires a name")
    path = Path(_expand(item.get("path", ""), workspace, runtime_root))
    if not path.is_absolute() or not path.is_file() or not os.access(path, os.X_OK):
        raise ValueError("executable path must be an existing executable file: " + str(path))
    resolved = path.resolve()
    version = _command({"command": item.get("version_command"), "cwd": "{workspace}",
                        "timeout_seconds": 30}, workspace, runtime_root)
    if version["command"][0] != str(path):
        raise ValueError("version command must invoke the recorded executable")
    receipt = _run(version, log)
    _check_receipt(receipt)
    return {"name": item["name"], "path": str(path), "resolved_path": str(resolved),
            "sha256": digest(resolved), "version_command": version["command"],
            "version_output": Path(receipt["log"]).read_text(errors="replace").strip(),
            "version_receipt": receipt}


def prepare(spec_path, output):
    spec_path, output = Path(spec_path).resolve(), Path(output).resolve()
    spec = read(spec_path)
    if spec.get("schema") != "project-runtime-spec-v1":
        raise ValueError("unsupported runtime spec schema")
    binding = guard(spec, [output])
    if output.exists() and any(output.iterdir()):
        raise ValueError("runtime preparation output is immutable; use a new workflow attempt")
    root, _, local = locations(binding["project_root"], binding["id"])
    receipt = read(binding["knowledge_receipt"])
    knowledge_used = spec.get("knowledge_used", ["INDEX.md"])
    if not isinstance(knowledge_used, list) or not knowledge_used or any(
            name not in receipt["read_files"] for name in knowledge_used):
        raise ValueError("runtime knowledge_used must name actually read indexed assets")
    if "INDEX.md" not in knowledge_used:
        raise ValueError("runtime preparation must read the knowledge root index")
    candidate = spec.get("recipe_candidate")
    if not isinstance(candidate, str) or not candidate.strip():
        raise ValueError("runtime preparation needs a reusable recipe candidate")
    output.mkdir(parents=True, exist_ok=False) if not output.exists() else None
    runtime_root = output / "runtime"
    runtime_root.mkdir()
    (output / "recipe-candidate.md").write_text(candidate.strip() + "\n")
    with workspace_lease(spec, output):
        workspace = ensure_workspace(spec, spec.get("source_checkout", root), spec["revision"],
                                     spec.get("components", []), spec.get("component_sources"))
        if _git(workspace, "rev-parse", "HEAD") != spec["revision"]:
            raise ValueError("runtime workspace revision mismatch")
        before = _git(workspace, "diff", "--name-only", "HEAD")
        dependency_hashes = {}
        for name in spec.get("dependency_files", []):
            file = inside(workspace, name)
            if not file.is_file():
                raise ValueError("dependency file missing: " + name)
            dependency_hashes[name] = digest(file)
        setup = []
        try:
            for index, item in enumerate(spec.get("setup_commands", [])):
                receipt = _run(_command(item, workspace, runtime_root), output / f"setup-{index:02}.log")
                setup.append(receipt)
                _check_receipt(receipt)
            executables = []
            for index, item in enumerate(spec.get("executables", [])):
                executables.append(_executable(item, workspace, runtime_root, output / f"version-{index:02}.log"))
            if not executables:
                raise ValueError("runtime preparation needs at least one verified executable")
            smoke = _run(_command(spec.get("smoke"), workspace, runtime_root), output / "smoke.log")
            _check_receipt(smoke)
            if before != _git(workspace, "diff", "--name-only", "HEAD"):
                raise ValueError("runtime setup changed tracked project files")
            if any(digest(inside(workspace, name)) != expected for name, expected in dependency_hashes.items()):
                raise ValueError("runtime setup changed frozen dependency files")
            manifest = {"schema": SCHEMA, "status": "ready", "acceptance": binding,
                        "workspace": str(workspace), "runtime_root": str(runtime_root),
                        "revision": spec["revision"], "components": spec.get("components", []),
                        "test_roots": spec.get("test_roots", []),
                        "platform": {"system": platform.system(),
                        "machine": platform.machine()}, "dependency_hashes": dependency_hashes,
                        "knowledge_receipt": binding["knowledge_receipt"],
                        "knowledge_read_sha256": digest(Path(binding["knowledge_receipt"])),
                        "knowledge_used": knowledge_used, "spec_path": str(spec_path),
                        "spec_sha256": digest(spec_path),
                        "recipe_candidate": str(output / "recipe-candidate.md"),
                        "recipe_candidate_sha256": digest(output / "recipe-candidate.md"),
                        "setup": setup, "executables": executables, "smoke": smoke}
            save(output / "runtime.json", manifest, exclusive=True)
        except Exception as error:
            save(output / "failure.json", {"schema": "project-runtime-failure-v1",
                 "reason": str(error), "spec_sha256": digest(spec_path), "setup": setup}, exclusive=True)
            raise
    return validate_runtime(output / "runtime.json", expected_acceptance=binding, resmoke=True)


def bootstrap(request_path, output):
    """Create/reuse the frozen workspace before the runtime Agent inspects it."""
    request = read(Path(request_path).resolve())
    if request.get("schema") != "project-runtime-agent-request-v1":
        raise ValueError("unsupported runtime Agent request schema")
    binding = guard(request, [Path(output).resolve()])
    root, _, _ = locations(binding["project_root"], binding["id"])
    with workspace_lease(request, Path(output).resolve()):
        workspace = ensure_workspace(request, request.get("source_checkout", root),
                                     request["revision"], request.get("components", []),
                                     request.get("component_sources"))
    return {"status": "ready", "workspace": str(workspace), "revision": request["revision"]}


def validate_runtime(path, expected_acceptance=None, resmoke=True):
    path = Path(path).resolve()
    manifest = read(path)
    if manifest.get("schema") != SCHEMA or manifest.get("status") != "ready":
        raise ValueError("runtime manifest is not ready")
    binding = manifest["acceptance"]
    root, _, local = locations(binding["project_root"], binding["id"])
    require_current(root, binding["id"])
    if binding.get("scope_sha256") != validate(root, binding["id"], check_knowledge=False)["scope"]["sha256"]:
        raise ValueError("runtime acceptance scope changed")
    owned_path(local / "workflows", path)
    if path.name != "runtime.json":
        raise ValueError("runtime manifest must be runtime.json under this acceptance workflow")
    if expected_acceptance is not None:
        for key in ("project_root", "id", "scope_sha256"):
            if binding.get(key) != expected_acceptance.get(key):
                raise ValueError("runtime manifest belongs to another acceptance or scope")
    workspace = Path(manifest["workspace"])
    if workspace != local / "workspace" or not workspace.is_dir():
        raise ValueError("runtime workspace is missing or belongs to another acceptance")
    runtime_root = Path(manifest["runtime_root"])
    if runtime_root != path.parent / "runtime" or not runtime_root.is_dir():
        raise ValueError("runtime root is missing or changed")
    if _git(workspace, "rev-parse", "HEAD") != manifest["revision"]:
        raise ValueError("runtime source revision changed")
    for component in manifest.get("components", []):
        part = inside(workspace, component["path"])
        if not part.is_dir() or _git(part, "rev-parse", "HEAD") != component["revision"]:
            raise ValueError("runtime component revision changed: " + component["path"])
    if manifest["platform"] != {"system": platform.system(), "machine": platform.machine()}:
        raise ValueError("runtime was prepared on another platform")
    for name, expected in manifest["dependency_hashes"].items():
        file = inside(workspace, name)
        if not file.is_file() or digest(file) != expected:
            raise ValueError("runtime dependency changed: " + name)
    test_prefixes = tuple(name.rstrip("/") + "/" for name in manifest.get("test_roots", []))
    for changed in _git(workspace, "diff", "--name-only", "HEAD").splitlines():
        if not changed.startswith(test_prefixes):
            raise ValueError("runtime product source changed: " + changed)
    knowledge_receipt = Path(manifest["knowledge_receipt"])
    owned_path(local / "knowledge-reads", knowledge_receipt)
    if not knowledge_receipt.is_file() or digest(knowledge_receipt) != manifest["knowledge_read_sha256"]:
        raise ValueError("runtime knowledge read receipt changed")
    spec_path = Path(manifest["spec_path"])
    owned_path(local, spec_path)
    if not spec_path.is_file() or digest(spec_path) != manifest["spec_sha256"]:
        raise ValueError("runtime frozen Agent spec changed")
    candidate = Path(manifest["recipe_candidate"])
    if (candidate != path.parent / "recipe-candidate.md" or not candidate.is_file() or
            digest(candidate) != manifest["recipe_candidate_sha256"]):
        raise ValueError("runtime reusable recipe candidate changed")
    for record in manifest["setup"]:
        owned_path(path.parent, record["log"])
        _check_receipt(record)
    for item in manifest["executables"]:
        executable = Path(item["path"])
        resolved = executable.resolve()
        if (not executable.is_file() or not os.access(executable, os.X_OK) or
                str(resolved) != item["resolved_path"] or digest(resolved) != item["sha256"]):
            raise ValueError("runtime executable changed: " + item["name"])
        owned_path(path.parent, item["version_receipt"]["log"])
        _check_receipt(item["version_receipt"])
        if item["version_command"][0] != str(executable):
            raise ValueError("runtime version command no longer binds executable")
        raw, exit_code = _observe({"command": item["version_command"], "cwd": str(workspace),
                                   "env": {}, "timeout_seconds": 30})
        if exit_code != 0 or raw.decode(errors="replace").strip() != item["version_output"]:
            raise ValueError("runtime executable version changed: " + item["name"])
    owned_path(path.parent, manifest["smoke"]["log"])
    _check_receipt(manifest["smoke"])
    if resmoke:
        smoke = manifest["smoke"]
        raw, exit_code = _observe({key: smoke[key] for key in ("command", "cwd", "env", "timeout_seconds")})
        if exit_code != 0:
            raise ValueError(f"runtime smoke no longer passes (exit {exit_code}): " +
                             raw.decode(errors="replace")[-2000:])
    return {"status": "ready", "runtime_manifest": str(path), "runtime_sha256": digest(path),
            "workspace": str(workspace), "revision": manifest["revision"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    prepare_parser = sub.add_parser("prepare")
    prepare_parser.add_argument("spec", type=Path)
    prepare_parser.add_argument("output", type=Path)
    bootstrap_parser = sub.add_parser("bootstrap")
    bootstrap_parser.add_argument("request", type=Path)
    bootstrap_parser.add_argument("output", type=Path)
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("manifest", type=Path)
    verify_parser.add_argument("--no-resmoke", action="store_true")
    args = parser.parse_args()
    try:
        if args.command == "prepare":
            result = prepare(args.spec, args.output)
        elif args.command == "bootstrap":
            result = bootstrap(args.request, args.output)
        else:
            result = validate_runtime(args.manifest, resmoke=not args.no_resmoke)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        print(json.dumps({"status": "blocked", "reason": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
