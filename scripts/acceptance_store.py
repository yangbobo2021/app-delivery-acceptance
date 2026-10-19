#!/usr/bin/env python3
"""Project-owned acceptance identities, indexed knowledge and execution guards.

This module never executes project tests, scripts from knowledge, or migrations.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.parse import unquote
from uuid import uuid4

ID = re.compile(r"AT-[A-Za-z0-9][A-Za-z0-9_-]{0,95}\Z")
LINK = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")
INDEX = """# 验收知识与工具库

## 职责
存放本项目跨验收复用的经验、脚本和流程约定。正式用例沿用项目测试体系；单次验收结果放到对应 AT 目录。

## 何时读取
每次启动、恢复验收及范围变化时从本索引开始，按适用条件逐层读取。新增内容必须同步更新本层索引；新增目录必须包含 INDEX.md 并由父级链接。

## 内容入口
当前没有已登记的可复用知识。添加 Markdown 链接，并说明用途、适用条件和验证状态。
"""


def read(path):
    value = json.loads(Path(path).read_text())
    if not isinstance(value, dict):
        raise ValueError("JSON object required: " + str(path))
    return value


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat()


def save(path, value, exclusive=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    if exclusive:
        with path.open("x") as stream:
            stream.write(raw)
    else:
        temporary = path.with_name(path.name + "." + uuid4().hex + ".tmp")
        temporary.write_text(raw)
        temporary.replace(path)


def inside(root, relative):
    """Reject absolute paths, traversal and links, even links pointing inside."""
    root = Path(root).absolute()
    relative = Path(relative)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("relative path required: " + str(relative))
    path = root
    if root.is_symlink():
        raise ValueError("symlink root is not allowed: " + str(root))
    for part in relative.parts:
        path = path / part
        if path.is_symlink():
            raise ValueError("symlink is not allowed: " + str(path))
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("path escapes root: " + str(path))
    return path


def project_root(project):
    """The personal workspace owns the store; a source worktree never does."""
    root = Path(project).resolve()
    if not root.is_dir():
        raise ValueError("user project directory must exist")
    for parent in root.parents:
        if (parent / '.acceptance').is_dir() or (parent / '.acceptance-local').is_dir():
            raise ValueError(f"acceptance store belongs to user project root {parent}; "
                             "do not initialize/read a separate store in a source checkout; "
                             f"use current {parent}")
    git_file = root / '.git'
    if git_file.is_file():
        text = git_file.read_text().strip()
        if text.startswith('gitdir:'):
            git_dir = (root / text.split(':', 1)[1].strip()).resolve()
            if (git_dir / 'commondir').is_file():
                raise ValueError("isolated Git worktree cannot be the acceptance store root; "
                                 "provide the user project root and keep source_checkout separate")
    return root


def locations(project, acceptance_id):
    if not isinstance(acceptance_id, str) or not ID.fullmatch(acceptance_id):
        raise ValueError("acceptance ID must use the stable AT- prefix")
    root = project_root(project)
    return root, inside(root, ".acceptance/" + acceptance_id), inside(root, ".acceptance-local/" + acceptance_id)


def read_current(project):
    """Read the personal project's current acceptance; never infer it from history."""
    root = project_root(project)
    path = inside(root, ".acceptance-local/current.json")
    if not path.exists():
        return None
    value = read(path)
    if set(value) != {"acceptance_id"}:
        raise ValueError("current.json must contain only acceptance_id; no conversation binding")
    acceptance_id = value["acceptance_id"]
    _, shared, _ = locations(root, acceptance_id)
    manifest = read(shared / "manifest.json")
    if manifest.get("schema") != "acceptance-manifest-v1" or manifest.get("acceptance_id") != acceptance_id:
        raise ValueError("current.json points to an invalid acceptance manifest")
    return acceptance_id


def require_current(project, acceptance_id):
    active = read_current(project)
    if active is None:
        raise ValueError("no current acceptance; explicitly start the intended ID before startup or resume")
    if active != acceptance_id:
        raise ValueError(f"current acceptance is {active}, not {acceptance_id}; cannot silently switch")
    return active


@contextmanager
def current_lock(project):
    """Serialize init/start/finish so two new conversations cannot claim different IDs."""
    root = project_root(project)
    if not root.is_dir():
        raise ValueError("project directory must exist")
    path = inside(root, ".acceptance-local/current.lock")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(stream, fcntl.LOCK_UN)


def start_acceptance(project, acceptance_id):
    root, _, _ = locations(project, acceptance_id)
    with current_lock(root):
        active = read_current(root)
        if active is not None and active != acceptance_id:
            raise ValueError(f"current acceptance is {active}; finish it before starting {acceptance_id}")
        validate(root, acceptance_id, check_knowledge=False)
        if active is None:
            save(inside(root, ".acceptance-local/current.json"), {"acceptance_id": acceptance_id})
    return {"acceptance_id": acceptance_id, "status": "current"}


def finish_acceptance(project, acceptance_id):
    root, shared, _ = locations(project, acceptance_id)
    with current_lock(root):
        active = read_current(root)
        if active is None:
            manifest = read(shared / "manifest.json")
            if manifest.get("acceptance_id") != acceptance_id:
                raise ValueError("unknown acceptance ID")
            return {"acceptance_id": acceptance_id, "status": "already_finished"}
        require_current(root, acceptance_id)
        # Only clear the pointer. This is neither a passed verdict nor deletion of evidence.
        inside(root, ".acceptance-local/current.json").unlink()
    return {"acceptance_id": acceptance_id, "status": "finished"}


def owned_path(root, path):
    """Normalize OS aliases such as macOS /var, without allowing links inside the store."""
    root = Path(root).resolve()
    path = Path(path).absolute()
    if not path.is_relative_to(root):
        path = path.resolve()
    if not path.is_relative_to(root):
        raise ValueError("path belongs to another acceptance: " + str(path))
    return inside(root, path.relative_to(root))


def validate_knowledge(project):
    root = project_root(project)
    base = inside(root, ".acceptance/knowledge")
    if not (base / "INDEX.md").is_file():
        raise ValueError("missing knowledge/INDEX.md; initialize the project acceptance store")
    inventory = {}
    for directory in [base, *sorted(p for p in base.rglob("*") if p.is_dir() and "__pycache__" not in p.parts)]:
        inside(base, directory.relative_to(base))
        index = directory / "INDEX.md"
        if not index.is_file():
            raise ValueError("missing directory index: " + str(index))
        text = index.read_text()
        for heading in ("职责", "何时读取"):
            if not re.search(r"^## " + heading + r"\s*\n+[^#\s]", text, re.M):
                raise ValueError("index needs a nonempty section: " + heading + " in " + str(index))
        listed = set()
        for href in LINK.findall(text):
            href = unquote(href.strip().strip("<>"))
            if href.startswith(("https://", "http://", "#")):
                continue
            href = href.split("#", 1)[0]
            if href.startswith("project:"):
                target = inside(root, href[8:])
                if not target.is_file():
                    raise ValueError("broken project asset reference: " + href)
                inventory["project:" + target.relative_to(root).as_posix()] = digest(target)
                continue
            target = inside(directory, href)
            if not target.is_file():
                raise ValueError("broken knowledge index link: " + href)
            parts = Path(href).parts
            if len(parts) > 1 and (len(parts) != 2 or parts[-1] != "INDEX.md"):
                raise ValueError("link immediate files or child/INDEX.md; do not skip hierarchy: " + href)
            listed.add(parts[0])
        for child in directory.iterdir():
            if child.name in {"__pycache__", ".DS_Store"}:
                continue
            inside(base, child.relative_to(base))
            if child.name != "INDEX.md" and child.name not in listed:
                raise ValueError("unindexed knowledge entry: " + str(child))
    for path in sorted(base.rglob("*")):
        if path.is_file() and "__pycache__" not in path.parts and path.name != ".DS_Store":
            inside(base, path.relative_to(base))
            inventory[path.relative_to(base).as_posix()] = digest(path)
    return inventory


def validate(project, acceptance_id, check_knowledge=True):
    root, shared, local = locations(project, acceptance_id)
    manifest = read(shared / "manifest.json")
    if (manifest.get("schema") != "acceptance-manifest-v1" or
            manifest.get("acceptance_id") != acceptance_id or not manifest.get("owner") or
            not manifest.get("project_id")):
        raise ValueError("invalid acceptance identity manifest")
    if not re.search(r"^/?\.acceptance-local/\s*$", (root / ".gitignore").read_text(), re.M):
        raise ValueError(".gitignore must contain a root .acceptance-local/ directory rule")
    git_root = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=root, capture_output=True, text=True)
    if git_root.returncode == 0:
        ignored = subprocess.run(["git", "check-ignore", "--no-index", "--", str(local / "acceptance-guard-probe")], cwd=root, capture_output=True)
        tracked = subprocess.check_output(["git", "ls-files", "-z", "--", ".acceptance-local"], cwd=root)
        if ignored.returncode != 0 or tracked:
            raise ValueError(".acceptance-local must actually be Git-ignored and contain no tracked files")
    scopes = sorted((shared / "records").glob("scope-*.json"))
    previous = None
    if not scopes:
        raise ValueError("acceptance has no scope snapshot")
    for version, path in enumerate(scopes, 1):
        inside(shared, path.relative_to(shared))
        item = read(path)
        if (path.name != f"scope-{version:04d}.json" or item.get("version") != version or
                item.get("acceptance_id") != acceptance_id or item.get("previous_sha256") != previous or
                not isinstance(item.get("scope"), dict) or not item.get("basis")):
            raise ValueError("invalid scope history: " + str(path))
        previous = digest(path)
    current = read(shared / "scope.json")
    if current != {"version": len(scopes), "path": "records/" + scopes[-1].name, "sha256": previous}:
        raise ValueError("scope pointer does not match immutable scope history")
    # Every archived record is an explicit allowlist, independently verifiable.
    for path in sorted((shared / "records").glob("*/record.json")):
        record = read(path)
        if record.get('schema') != 'acceptance-evidence-record-v1' or record.get("acceptance_id") != acceptance_id or not record.get("files"):
            raise ValueError("invalid archived evidence record")
        for name, expected in record["files"].items():
            file = inside(path.parent, name)
            if not file.is_file() or digest(file) != expected:
                raise ValueError("archived evidence changed or missing: " + str(file))
    evidence_index = shared / 'evidence-index.json'
    if evidence_index.is_file():
        value = read(evidence_index)
        if value.get('schema') != 'acceptance-evidence-index-v1' or value.get('acceptance_id') != acceptance_id:
            raise ValueError('invalid project evidence index')
        for key, item in value.get('artifacts', {}).items():
            if not re.fullmatch(r'[0-9a-f]{64}', key) or item.get('sha256') != key:
                raise ValueError('invalid artifact identity')
            kind, name = item['storage'].split(':', 1)
            if kind not in {'local', 'shared'}:raise ValueError('invalid artifact storage')
            inside(local if kind == 'local' else shared, name)
    tests = shared / "tests.json"
    if tests.exists():
        for item in read(tests).get("items", []):
            file = inside(root, item["path"])
            if file.relative_to(root).parts[0] in {".acceptance", ".acceptance-local"} or not file.is_file():
                raise ValueError("formal tests must belong to the existing project test tree")
            if not item.get("command") or not item.get("scenario_ids"):
                raise ValueError("formal test mapping needs command and stable scene IDs")
    if (shared / "scenarios.json").exists():
        current_catalog = read(shared / "scenarios.json")
        validate_catalog(current_catalog)
        histories = [read(path) for path in (shared / "records").glob("catalog-*.json")]
        if (current_catalog.get("acceptance_id") != acceptance_id or not histories or
                current_catalog != max(histories, key=lambda item: item.get("updated_at", ""))):
            raise ValueError("scenario catalog does not match its latest frozen history")
    inventory = validate_knowledge(root) if check_knowledge else {}
    return {"manifest": manifest, "scope": current, "knowledge_inventory": inventory,
            "knowledge_sha256": fingerprint(inventory)}


def validate_catalog(value):
    if (not isinstance(value, dict) or value.get("schema") != "acceptance-catalog-v1" or
            not isinstance(value.get("requirements"), list) or not isinstance(value.get("scenarios"), list)):
        raise ValueError("complete project scenario catalog required")
    project = value.get("project")
    if not isinstance(project, dict) or not project:
        raise ValueError("catalog project must be an object, for example {id, label, revision, root}")
    scene_ids = [item["id"] for item in value["scenarios"]]
    if len(scene_ids) != len(set(scene_ids)):
        raise ValueError("duplicate stable scene IDs")
    owners = {item["id"] for item in value["requirements"]}
    owners.update(item["id"] for item in value.get("reverse_rules", []) if item.get("status") != "needs_confirmation")
    for item in value["scenarios"]:
        if not item.get("id") or item.get("requirement_id") not in owners:
            raise ValueError("scene needs an original requirement or admitted rule")
    gaps = value.get("design_gaps", [])
    if not isinstance(gaps, list):
        raise ValueError("design_gaps must be a list")
    source_text = {item["id"]: item.get("text", "") for item in value["requirements"]}
    source_text.update({item["id"]: item.get("text", "") for item in value.get("reverse_rules", [])})
    for gap in gaps:
        if (not isinstance(gap, dict) or gap.get("requirement_id") not in owners or
                not isinstance(gap.get("quote"), str) or not gap["quote"].strip() or
                gap["quote"] not in source_text[gap["requirement_id"]] or
                not isinstance(gap.get("reason"), str) or not gap["reason"].strip()):
            raise ValueError("design gap needs an owner, exact source quote and reason")


def publish_catalog(project, acceptance_id, value):
    _, shared, _ = locations(project, acceptance_id)
    state = validate(project, acceptance_id)
    validate_catalog(value)
    value = {**value, "acceptance_id": acceptance_id, "scope_sha256": state["scope"]["sha256"], "updated_at": now()}
    path = shared / "records" / ("catalog-" + uuid4().hex + ".json")
    save(path, value, exclusive=True)
    save(shared / "scenarios.json", value)
    return {"catalog": str(shared / "scenarios.json"), "history": str(path), "sha256": digest(path)}


def initialize(project, acceptance_id, title, owner, scope, basis):
    root, _, _ = locations(project, acceptance_id)
    with current_lock(root):
        active = read_current(root)
        if active is not None:
            raise ValueError(f"current acceptance is {active}; finish it before creating another acceptance")
        result = _initialize(root, acceptance_id, title, owner, scope, basis)
        save(inside(root, ".acceptance-local/current.json"), {"acceptance_id": acceptance_id})
    return result


def _initialize(project, acceptance_id, title, owner, scope, basis):
    root, shared, local = locations(project, acceptance_id)
    if not title.strip() or not owner.strip() or not isinstance(scope, dict) or not scope or not basis.strip():
        raise ValueError("title, owner, nonempty scope and real decision basis required")
    if not root.is_dir() or shared.exists() or local.exists():
        raise ValueError("project must exist and acceptance ID must be new")
    knowledge = inside(root, ".acceptance/knowledge")
    knowledge.mkdir(parents=True, exist_ok=True)
    if not (knowledge / "INDEX.md").exists():
        (knowledge / "INDEX.md").write_text(INDEX)
    gitignore = root / ".gitignore"
    text = gitignore.read_text() if gitignore.exists() else ""
    if not re.search(r"^/?\.acceptance-local/\s*$", text, re.M):
        gitignore.write_text(text + ("\n" if text and not text.endswith("\n") else "") + "/.acceptance-local/\n")
    save(shared / "manifest.json", {"schema": "acceptance-manifest-v1", "acceptance_id": acceptance_id,
         "project_id": root.name, "title": title, "owner": owner, "created_at": now()}, exclusive=True)
    local.mkdir(parents=True)
    update_scope(root, acceptance_id, scope, basis, first=True)
    return {"acceptance_id": acceptance_id, "shared": str(shared), "local": str(local)}


def update_scope(project, acceptance_id, scope, basis, first=False):
    root, shared, _ = locations(project, acceptance_id)
    if not isinstance(scope, dict) or not scope or not basis.strip():
        raise ValueError("nonempty scope object and real decision basis required")
    previous = None
    version = 1
    if not first:
        require_current(root, acceptance_id)
        old = validate(root, acceptance_id)["scope"]
        previous, version = old["sha256"], old["version"] + 1
    path = shared / "records" / f"scope-{version:04d}.json"
    save(path, {"schema": "acceptance-scope-v1", "acceptance_id": acceptance_id,
         "version": version, "previous_sha256": previous, "created_at": now(),
         "basis": basis, "scope": scope}, exclusive=True)
    pointer = {"version": version, "path": "records/" + path.name, "sha256": digest(path)}
    save(shared / "scope.json", pointer)
    return pointer


def read_knowledge(project, acceptance_id, paths):
    acceptance_id = require_current(project, acceptance_id) if acceptance_id is not None else read_current(project)
    if acceptance_id is None:
        raise ValueError("no current acceptance; initialize or explicitly start an existing ID")
    root, _, local = locations(project, acceptance_id)
    state = validate(root, acceptance_id)
    base = root / ".acceptance/knowledge"
    selected = {"INDEX.md"}
    for name in paths:
        if name.startswith("project:"):
            if name not in state["knowledge_inventory"]:
                raise ValueError("project asset must be referenced by a knowledge index: " + name)
            selected.add(name)
            for index in base.rglob("INDEX.md"):
                links = {unquote(href.strip().strip("<>")).split("#", 1)[0] for href in LINK.findall(index.read_text())}
                if name in links:
                    selected.add(index.relative_to(base).as_posix())
                    for parent in index.relative_to(base).parents:
                        selected.add((parent / "INDEX.md").as_posix())
            continue
        file = inside(base, name)
        if not file.is_file() or name not in state["knowledge_inventory"]:
            raise ValueError("knowledge asset must be indexed: " + name)
        selected.add(file.relative_to(base).as_posix())
        for parent in file.relative_to(base).parents:
            selected.add((parent / "INDEX.md").as_posix())
    def asset(name):
        return inside(root, name[8:]) if name.startswith("project:") else inside(base, name)
    contents = {name: asset(name).read_text() for name in sorted(selected, key=lambda n: (n.count("/"), n))}
    receipt = local / "knowledge-reads" / (uuid4().hex + ".json")
    save(receipt, {"schema": "acceptance-knowledge-read-v1", "acceptance_id": acceptance_id,
         "project_root": str(root), "created_at": now(), "scope_sha256": state["scope"]["sha256"],
         "knowledge_sha256": state["knowledge_sha256"],
         "read_files": {name: digest(asset(name)) for name in contents}}, exclusive=True)
    return {"acceptance": {"project_root": str(root), "id": acceptance_id,
            "scope_sha256": state["scope"]["sha256"], "knowledge_receipt": str(receipt)}, "contents": contents}


def guard(config, outputs=()):
    binding = config.get("acceptance")
    if not isinstance(binding, dict):
        raise ValueError("acceptance binding required; use acceptance_store.py init/read-knowledge")
    root, shared, local = locations(binding["project_root"], binding["id"])
    require_current(root, binding["id"])
    state = validate(root, binding["id"])
    if binding.get("scope_sha256") != state["scope"]["sha256"]:
        raise ValueError("scope changed: keep acceptance ID, create new dependent frozen attempts")
    path = Path(os.environ.get("ACCEPTANCE_KNOWLEDGE_RECEIPT") or binding["knowledge_receipt"])
    if not path.is_absolute():
        raise ValueError("knowledge receipt belongs to another acceptance")
    path = owned_path(local / "knowledge-reads", path)
    effective_receipt = path
    receipt = read(path)
    if (receipt.get("schema") != "acceptance-knowledge-read-v1" or
            receipt.get("project_root") != str(root) or receipt.get("acceptance_id") != binding["id"] or
            receipt.get("scope_sha256") != binding["scope_sha256"] or
            receipt.get("knowledge_sha256") != state["knowledge_sha256"] or
            not receipt.get("read_files", {}).get("INDEX.md")):
        raise ValueError("knowledge changed or was not read; read current layered indexes before continuing")
    for name, expected in receipt["read_files"].items():
        if state["knowledge_inventory"].get(name) != expected:
            raise ValueError("knowledge read receipt changed")
    # The user's workspace can contain the source repository. Its acceptance
    # store stays at the workspace root rather than following a test checkout.
    source = config.get("source_checkout") or config.get("project_root") or config.get("project", {}).get("root")
    if source and Path(source).resolve() != root:
        for component in [Path(source).absolute(), *Path(source).absolute().parents]:
            if component.is_symlink() and component.parent.resolve().is_relative_to(root):
                raise ValueError("symlink source checkout is not allowed")
        if Path(source).absolute().is_relative_to(root) or Path(source).resolve().is_relative_to(root):
            owned_path(root, source)
        else:
            def common(p):
                result = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], cwd=p, capture_output=True, text=True)
                if result.returncode:
                    raise ValueError("source checkout belongs to another project")
                return Path(result.stdout.strip()).resolve()
            if common(source) != common(root):
                raise ValueError("source checkout belongs to another project")
    for output in outputs:
        try:
            path = owned_path(local / "workflows", output)
        except ValueError as error:
            raise ValueError("workflow output must be .acceptance-local/<AT-ID>/workflows/<attempt>") from error
        if path == local / "workflows":
            raise ValueError("workflow output must be .acceptance-local/<AT-ID>/workflows/<attempt>")
        inside(local, path.relative_to(local))
    test_roots = [*config.get("test_roots", []), *config.get("write_roots", []), *config.get("allowed_test_roots", [])]
    for name in test_roots:
        path = inside(root, name)
        relative = path.relative_to(root)
        if not relative.parts or relative.parts[0] in {".acceptance", ".acceptance-local"}:
            raise ValueError("test roots must use the existing project test tree, not acceptance storage")
    return {**binding, "knowledge_receipt": str(effective_receipt)}


def v4_result_files(source):
    """A fixed metadata profile, following the final review rather than guessed round names."""
    source = Path(source).resolve()
    request, summary = read(source / 'request.frozen.json'), read(source / 'summary.json')
    if request.get('progress_schema') != 'single-agent-scene-v1' or not summary.get('review_status'):
        raise ValueError('v4 result archive requires a completed single-scene result')

    def bound(reference):
        path = Path(reference)
        return owned_path(source, path if path.is_absolute() else source / path)

    review = bound(summary.get('review_path') or 'review/answer.json')
    review_input = read(review.with_name('input.json'))
    receipt = bound(review_input['frozen_execution_receipt'])
    answer = bound(review_input.get('agent_result_path') or 'case/answer.json')
    coverage = bound(review_input.get('coverage_result_path') or 'coverage-report.json')
    paths = [source / name for name in ['request.frozen.json', 'state.json', 'summary.json']]
    paths += [answer, review, review.with_name('input.json'), review.with_name('metrics.json'),
              review.with_name('decision-gate.json'), receipt, receipt.with_name('execution.log'), coverage]
    if review_input.get('ui_acceptance', {}).get('required'):
        manifest_path = bound(review_input['frozen_evidence_manifest'])
        manifest = read(manifest_path)
        reviewed = read(review)
        referenced = reviewed.get('ui_review', {}).get('screenshot_paths', [])
        frozen = {item['path']: item['sha256'] for item in manifest.get('files', [])}
        if reviewed.get('ui_review', {}).get('status') in {'passed', 'failed'} and not referenced:
            raise ValueError('reviewed UI conclusion has no frozen screenshot')
        paths.append(manifest_path)
        for name in referenced:
            image = bound(name)
            if image.suffix.lower() not in {'.png', '.jpg', '.jpeg', '.webp'} or frozen.get(name) != digest(image):
                raise ValueError('reviewed UI screenshot differs from frozen manifest')
            paths.append(image)
    # Only these protocol files are implicit. Raw counts, observations, environment,
    # debug attempts and session transcripts require an additional reviewed allowlist.
    for path in paths:
        if not path.is_file():
            raise ValueError('Incomplete v4 result archive; missing ' + str(path))
    return sorted({path.relative_to(source).as_posix() for path in paths})


def frozen_artifact_alias(profile, original, alias):
    """Validate one offline alias against its frozen bytes and project inventory."""
    bound_digest=None
    if isinstance(alias,dict):
        frozen=alias.get('path')
        bound_digest=alias.get('sha256')
        if not isinstance(frozen,str) or not isinstance(bound_digest,str) or digest(frozen)!=bound_digest:
            raise ValueError('Coverage publication alias descriptor is unbound or changed')
    elif isinstance(alias,str):
        frozen=alias
    else:
        raise ValueError('Coverage publication alias must name a frozen file')
    project_root=Path(profile['spec']['project_root']).resolve()
    if '..' in Path(original).parts:
        raise ValueError('Coverage publication alias escapes project')
    relative=Path(original).resolve().relative_to(project_root)
    inside(project_root,relative)
    expected=profile['adapter_files'].get(str(relative)) or profile['spec']['source_hashes'].get(str(relative))
    if expected and digest(frozen)!=expected:
        raise ValueError('Coverage publication alias differs from frozen source or adapter')
    if not expected and not bound_digest:
        raise ValueError('Coverage publication alias lacks a frozen artifact digest')
    return frozen


def coverage_archive_files(source, reports):
    """Explicit protocol publication profile, without scanning runtime folders."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'playbook/v4'))
    from coverage_protocol import verify_report, preparation
    source=Path(source).resolve();selected=set();aliases={}
    def include(path):
        path=owned_path(source,path)
        if not path.is_file():raise ValueError('Coverage publication dependency missing: '+str(path))
        name=path.relative_to(source).as_posix();selected.add(name);return name
    for name in reports:
        report_path=owned_path(source,source/name if not Path(name).is_absolute() else name)
        report=verify_report(report_path);profile=preparation(report)
        include(report_path);include(Path(report['prepared'])/'prepared.json')
        receipt=read(report['receipt_path']);include(report['receipt_path'])
        include(Path(report['receipt_path']).with_name('execution.log'))
        include(receipt['coverage_session_path']);include(profile['spec']['inventory_path'])
        for item in [*report['raw_evidence'],*profile['preparation_evidence']]:include(item['path'])
        # Project tools may bind additional run metadata (for example an
        # execution request or collector lifecycle receipt). Preserve every
        # top-level file reference with an explicit digest, regardless of its
        # project-chosen field name.
        for item in report.values():
            if isinstance(item,dict) and isinstance(item.get('path'),str) and isinstance(item.get('sha256'),str):
                extra=owned_path(source,item['path'])
                if digest(extra)!=item['sha256']:
                    raise ValueError('Coverage publication bound metadata changed: '+str(extra))
                include(extra)
        coverage_spec = profile['spec']
        if coverage_spec.get('runtime_manifest') or coverage_spec.get('probe_report'):
            if not all(coverage_spec.get(key) for key in ('runtime_manifest', 'runtime_sha256',
                                                          'probe_report', 'probe_report_sha256')):
                raise ValueError('Coverage publication has incomplete runtime/probe binding')
            runtime_path = owned_path(source, coverage_spec['runtime_manifest'])
            probe_path = owned_path(source, coverage_spec['probe_report'])
            if digest(runtime_path) != coverage_spec['runtime_sha256'] or digest(probe_path) != coverage_spec['probe_report_sha256']:
                raise ValueError('Coverage publication runtime/probe bytes changed')
            include(runtime_path);include(probe_path)
            probe = read(probe_path)
            plan = owned_path(source, probe['plan'])
            if digest(plan) != probe['plan_sha256']:
                raise ValueError('Coverage publication probe plan changed')
            include(plan)
            for route in probe.get('routes', []):
                for attempt in route.get('probes', {}).values():
                    if attempt.get('status') != 'passed':
                        continue
                    for reference in attempt.get('receipts', {}).values():
                        path = owned_path(source, reference['path'])
                        if digest(path) != reference['sha256']:
                            raise ValueError('Coverage publication probe receipt changed')
                        include(path)
                        command_receipt = read(path)
                        for stream in ('stdout', 'stderr'):
                            asset = command_receipt[stream]
                            asset_path = owned_path(source, asset['path'])
                            if digest(asset_path) != asset['sha256']:
                                raise ValueError('Coverage publication probe stream changed')
                            include(asset_path)
                    for reference in attempt.get('native', []):
                        path = owned_path(source, reference['path'])
                        if digest(path) != reference['sha256']:
                            raise ValueError('Coverage publication probe native data changed')
                        include(path)
        for original,alias in profile.get('artifact_aliases',{}).items():
            frozen=frozen_artifact_alias(profile,original,alias)
            aliases[original]=include(frozen)
        for name,expected in profile['adapter_files'].items():
            original=str(Path(profile['spec']['project_root'])/name)
            if original not in aliases:raise ValueError('Coverage publication requires frozen project adapter copies: '+name)
    return sorted(selected),aliases


def v4_scene_publication(source, scenes):
    """Select final reviewed execution and coverage together, including repairs."""
    selected=[];reports=[]
    for name in scenes:
        scene=owned_path(source,source/name if not Path(name).is_absolute() else name)
        def bound(reference):
            path=Path(reference)
            return owned_path(scene,path if path.is_absolute() else scene/path)
        selected.extend((scene/relative).relative_to(source).as_posix() for relative in v4_result_files(scene))
        summary=read(scene/'summary.json')
        review=bound(summary.get('review_path') or scene/'review/answer.json')
        review_input=read(review.with_name('input.json'))
        coverage_path=bound(review_input.get('coverage_result_path') or scene/'coverage-report.json')
        coverage=read(coverage_path)
        if coverage.get('protocol')=='project-coverage-v1':
            request=read(scene/'request.frozen.json')
            if (coverage['scene_id']!=request['scene']['id'] or coverage['revision']!=request['project']['revision']):
                raise ValueError('Final coverage differs from the archived scene/version')
            native=owned_path(source,coverage['report_path'])
            if digest(native)!=coverage['report_sha256']:
                raise ValueError('Final reviewed coverage report changed')
            if digest(bound(review_input['frozen_execution_receipt']))!=coverage['execution_sha256']:
                raise ValueError('Final coverage does not bind the reviewed execution')
            reports.append(str(native))
    return selected,reports


def archive(project, acceptance_id, source, files, basis, *, v4_result=False, coverage_reports=None, v4_scenes=None):
    """Copy only explicitly chosen, redacted publication artifacts; never scan raw evidence."""
    root, shared, local = locations(project, acceptance_id)
    state = validate(root, acceptance_id)
    source = owned_path(local / "workflows", source)
    files = [*(files or []), *(v4_result_files(source) if v4_result else [])]
    scene_files,scene_reports=v4_scene_publication(source,v4_scenes) if v4_scenes else ([],[])
    files=[*files,*scene_files]
    coverage_reports=[*(coverage_reports or []),*scene_reports]
    coverage_files,aliases=coverage_archive_files(source,coverage_reports) if coverage_reports else ([],{})
    coverage_snapshot=None
    if coverage_reports:
        from coverage_protocol import summarize_reports, verify_report, sha
        report_paths=sorted({str(owned_path(source,source/name if not Path(name).is_absolute() else name))
                             for name in coverage_reports})
        checked=[verify_report(name) for name in report_paths]
        if len({item['prepared_sha256'] for item in checked}) != 1:
            raise ValueError('Coverage publication cannot combine incompatible preparations')
        coverage_snapshot={"schema":"project-coverage-summary-snapshot-v1",
                           "reports":[{"path":name,"sha256":sha(name)} for name in report_paths],
                           "prepared_sha256":checked[0]['prepared_sha256'],
                           "summary":summarize_reports(report_paths)}
    files=[*files,*coverage_files]
    if not files or not basis.strip():
        raise ValueError("explicit reviewed file allowlist and publication basis required")
    data = {}
    for name in files:
        path = inside(source, name)
        if name == "record.json" or not path.is_file():
            raise ValueError("invalid archive file: " + name)
        if path.name.startswith(".env") or any(p in {"node_modules", ".git", "checkout", "coverage-raw", "raw-evidence"} for p in Path(name).parts):
            raise ValueError("raw/runtime assets cannot be auto-published: " + name)
        data[name] = path
    target = shared / "records" / ("evidence-" + uuid4().hex)
    target.mkdir(parents=True)
    for name, path in data.items():
        dest = target / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dest)
    snapshot_name=None
    if coverage_snapshot:
        snapshot_name='coverage-summary.json'
        if snapshot_name in data:
            raise ValueError('Coverage snapshot name collides with selected evidence')
        save(target/snapshot_name,coverage_snapshot,exclusive=True)
        data[snapshot_name]=target/snapshot_name
    save(target / "record.json", {"schema": "acceptance-evidence-record-v1", "acceptance_id": acceptance_id,
         "scope_sha256": state["scope"]["sha256"], "created_at": now(), "basis": basis,
         "files": {name: digest(path) for name, path in data.items()},
         "original_paths": {str(path): name for name, path in data.items()},
         "path_aliases": aliases,
         "coverage_summary":snapshot_name,
         "coverage_reports": [owned_path(source,source/name if not Path(name).is_absolute() else name).relative_to(source).as_posix()
                              for name in (coverage_reports or [])],
         "workflow_requests": {name: {"original_path": str(path),
             "source_mtime": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()}
             for name, path in data.items() if path.name == 'request.frozen.json'}}, exclusive=True)
    return {"record": str(target), "files": len(data)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("init", "scope", "check", "read-knowledge", "archive", "catalog", "start", "finish", "current"):
        cmd = sub.add_parser(name)
        cmd.add_argument("project", type=Path)
        if name != "current":
            cmd.add_argument("acceptance_id", nargs="?" if name == "read-knowledge" else None)
        if name in {"init", "scope"}:
            cmd.add_argument("--scope", required=True, type=Path)
            cmd.add_argument("--basis", required=True)
        if name == "init":
            cmd.add_argument("--title", required=True)
            cmd.add_argument("--owner", required=True)
        if name == "read-knowledge":
            cmd.add_argument("--paths", nargs="*", default=[])
        if name == "archive":
            cmd.add_argument("--source", type=Path, required=True)
            cmd.add_argument("--files", nargs="+", default=[])
            cmd.add_argument("--v4-result", action="store_true",
                             help="select the fixed final v4 result metadata profile; extra evidence still uses --files")
            cmd.add_argument('--coverage-report',action='append',default=[],
                             help='explicitly publish a verified project coverage report and its frozen native dependencies, relative to --source')
            cmd.add_argument('--v4-scene',action='append',default=[],
                             help='publish final reviewed v4 metadata and project coverage together; scene directory relative to common --source')
            cmd.add_argument("--basis", required=True)
        if name == "catalog":
            cmd.add_argument("--input", type=Path, required=True)
    check = sub.add_parser("guard")
    check.add_argument("config", type=Path)
    check.add_argument("--output", action="append", default=[])
    args = parser.parse_args()
    if args.command == "init":
        result = initialize(args.project, args.acceptance_id, args.title, args.owner, read(args.scope), args.basis)
    elif args.command == "scope":
        result = update_scope(args.project, args.acceptance_id, read(args.scope), args.basis)
    elif args.command == "check":
        result = validate(args.project, args.acceptance_id)
    elif args.command == "read-knowledge":
        result = read_knowledge(args.project, args.acceptance_id, args.paths)
    elif args.command == "archive":
        result = archive(args.project, args.acceptance_id, args.source, args.files, args.basis,
                         v4_result=args.v4_result,coverage_reports=args.coverage_report,v4_scenes=args.v4_scene)
    elif args.command == "catalog":
        result = publish_catalog(args.project, args.acceptance_id, read(args.input))
    elif args.command == "start":
        result = start_acceptance(args.project, args.acceptance_id)
    elif args.command == "finish":
        result = finish_acceptance(args.project, args.acceptance_id)
    elif args.command == "current":
        result = {"acceptance_id": read_current(args.project)}
    else:
        result = guard(json.load(sys.stdin) if str(args.config) == "-" else read(args.config), args.output)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, json.JSONDecodeError) as error:
        print(json.dumps({"status": "blocked", "reason": str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(2)
