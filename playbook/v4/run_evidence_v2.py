#!/usr/bin/env python3
"""Record a frozen local test command with its source and test-file binding."""

import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import time
from datetime import datetime, timezone


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git(root, *args):
    return subprocess.check_output(["git", *args], cwd=root, text=True).strip()


parser = argparse.ArgumentParser()
parser.add_argument("--cwd", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--file", action="append", default=[])
parser.add_argument("--env", action="append", default=[])
parser.add_argument("--fresh-dir", action="append", default=[])
parser.add_argument("command", nargs=argparse.REMAINDER)
args = parser.parse_args()
command = args.command[1:] if args.command and args.command[0] == "--" else args.command
if not command:
    parser.error("command required after --")
root = pathlib.Path(args.cwd).resolve()
out = pathlib.Path(args.output).resolve()
fresh_dirs = []
for item in args.fresh_dir:
    path = pathlib.Path(item).resolve()
    if path.exists():
        parser.error(f"fresh directory already exists: {path}")
    path.mkdir(parents=True, exist_ok=False)
    fresh_dirs.append(str(path))
out.mkdir(parents=True, exist_ok=False)
env = os.environ.copy()
env_changes = {}
for item in args.env:
    key, sep, value = item.partition("=")
    if not sep or not key:
        parser.error("--env must be KEY=VALUE")
    env[key] = value
    env_changes[key] = value
files = {}
for item in args.file:
    path = (root / item).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        parser.error(f"test file unavailable: {item}")
    files[item] = sha(path)
start = datetime.now(timezone.utc).isoformat()
head_before = git(root, "rev-parse", "HEAD")
status_before = git(root, "status", "--porcelain", "--untracked-files=all")
tracked_changes_before = git(root, "diff", "--name-only", "HEAD")
unexpected_before = set(tracked_changes_before.splitlines()) - set(files)
if unexpected_before:
    parser.error(f"unbound tracked changes before execution: {sorted(unexpected_before)}")
intent = {
    "schema": "isolated-test-execution-v1",
    "start_utc": start,
    "cwd": str(root),
    "command": command,
    "env_changes": env_changes,
    "fresh_dirs": fresh_dirs,
    "head_before": head_before,
    "tracked_changes_before": tracked_changes_before,
    "status_before": status_before,
    "test_file_sha256_before": files,
}
(out / "execution-intent.json").write_text(json.dumps(intent, ensure_ascii=False, indent=2) + "\n")
tick = time.monotonic()
with (out / "execution.log").open("wb") as log:
    process = subprocess.Popen(command, cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    intent["child_pid"] = process.pid
    (out / "execution-intent.json").write_text(json.dumps(intent, ensure_ascii=False, indent=2) + "\n")
    while True:
        chunk = process.stdout.read(4096)
        if not chunk:
            break
        log.write(chunk)
        log.flush()
        sys.stdout.buffer.write(chunk)
        sys.stdout.buffer.flush()
    code = process.wait()
result = {
    **intent,
    "end_utc": datetime.now(timezone.utc).isoformat(),
    "duration_seconds": time.monotonic() - tick,
    "exit_code": code,
    "head_after": git(root, "rev-parse", "HEAD"),
    "tracked_changes_after": git(root, "diff", "--name-only", "HEAD"),
    "status_after": git(root, "status", "--porcelain", "--untracked-files=all"),
    "test_file_sha256_after": {item: sha(root / item) for item in files},
    "log_sha256": sha(out / "execution.log"),
}
unexpected_after = set(result["tracked_changes_after"].splitlines()) - set(files)
if unexpected_after:
    result["unexpected_tracked_changes"] = sorted(unexpected_after)
(out / "execution.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
sys.exit(code)
