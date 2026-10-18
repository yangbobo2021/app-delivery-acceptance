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
parser.add_argument("--coverage-config", help="Verified project-owned coverage protocol; same entry for every scene")
parser.add_argument("--coverage-build", help="Host-bound isolated instrumentation manifest")
parser.add_argument("--coverage-session", help="Frozen project-owned coverage invocation")
parser.add_argument("command", nargs=argparse.REMAINDER)
args = parser.parse_args()
command = args.command[1:] if args.command and args.command[0] == "--" else args.command
if not command:
    parser.error("command required after --")
if args.coverage_config:
    from run_coverage import run_coverage
    coverage = json.loads(pathlib.Path(args.coverage_config).read_text())
    changes = dict(item.split('=', 1) for item in args.env)
    command_binding = None
    if len(command)==3 and pathlib.Path(command[1]).resolve()==(pathlib.Path(__file__).parent/'run_coverage.py').resolve():
        nested_path=(pathlib.Path(args.cwd).resolve()/command[2]).resolve()
        nested=json.loads(nested_path.read_text())
        if (pathlib.Path(nested.get('cwd','')).resolve()!=pathlib.Path(args.cwd).resolve() or
            nested.get('scene_id')!=coverage['scene_id'] or nested.get('revision')!=coverage.get('revision') or
            pathlib.Path(nested.get('prepared','')).resolve()!=pathlib.Path(coverage['prepared']).resolve() or
            set(nested.get('files',[]))!=set(args.file) or not nested.get('command') or
            any(pathlib.Path(part).name in {'run_coverage.py','run_evidence_v2.py'} for part in nested['command'])):
            parser.error('Nested local collector does not bind this exact case/source/files')
        command_binding={'declared_command':command,'local_request':str(nested_path),
                         'local_request_sha256':sha(nested_path),'business_command':nested['command'],
                         'policy':'Host collects once; retain host fresh environment and directories.'}
        command=nested['command']
    sys.exit(run_coverage({'cwd': args.cwd, 'output': args.output, 'files': args.file,
                          'command': command, 'env': changes, 'fresh_dirs': args.fresh_dir,
                          'business_command_binding':command_binding,
                          'coverage':coverage,
                          'prepared': coverage['prepared'], 'scene_id': coverage['scene_id'],
                          'revision': coverage.get('revision'),
                          'inventory_path': coverage.get('inventory_path', '')}))
root = pathlib.Path(args.cwd).resolve()
from coverage_registry import project_coverage
active_coverage=project_coverage(root) or {}
if args.coverage_session:
    from run_coverage import validate_session
    validate_session(args.coverage_session,root,args.output,command)
elif not args.coverage_build:
    if active_coverage.get('policy')=='required':
        parser.error('Active project requires --coverage-config; use the registered scene entry')
elif active_coverage.get('protocol'):
    parser.error('Project coverage needs its frozen coverage session, not a legacy build')
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
instrumented_components = set()
if args.coverage_build:
    build_path = pathlib.Path(args.coverage_build).resolve()
    build = json.loads(build_path.read_text())
    prepared_path = pathlib.Path(build['prepared']) / 'prepared.json'
    if sha(prepared_path) != build['prepared_sha256']:
        parser.error('Coverage preparation binding changed')
    prepared = json.loads(prepared_path.read_text())
    for item, binding in build['product_files'].items():
        if item not in files or files[item] != binding['instrumented_sha256']:
            parser.error('Unbound instrumentation change: ' + item)
    for component, revision in prepared['spec'].get('components', {}).items():
        component_root = root / component
        if git(component_root,'rev-parse','HEAD') != revision:
            parser.error('Instrumented component revision changed')
        changed = git(component_root,'diff','--name-only','HEAD').splitlines()
        if any(component + '/' + item not in files for item in changed):
            parser.error('Unbound component source changes')
        instrumented_components.add(component)
start = datetime.now(timezone.utc).isoformat()
head_before = git(root, "rev-parse", "HEAD")
status_before = git(root, "status", "--porcelain", "--untracked-files=all")
tracked_changes_before = git(root, "diff", "--name-only", "HEAD")
unexpected_before = set(tracked_changes_before.splitlines()) - set(files) - instrumented_components
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
    **({'coverage_session_path':str(pathlib.Path(args.coverage_session).resolve()),
        'coverage_session_sha256':sha(pathlib.Path(args.coverage_session))} if args.coverage_session else {}),
    **({'coverage_build_path': str(build_path), 'coverage_build_sha256': sha(build_path)} if args.coverage_build else {}),
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
unexpected_after = set(result["tracked_changes_after"].splitlines()) - set(files) - instrumented_components
if unexpected_after:
    result["unexpected_tracked_changes"] = sorted(unexpected_after)
(out / "execution.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
sys.exit(code)
