#!/usr/bin/env python3
"""Freeze a complete Git change and an explicit, project-owned source inventory."""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path


def git(root, *args):
    return subprocess.check_output(["git", *args], cwd=root)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def build(request):
    root = Path(request["project_root"]).resolve()
    base_ref, head_ref = request["base_revision"], request["head_revision"]
    head = git(root, "rev-parse", head_ref).decode().strip()
    target_revision = git(root, "rev-parse", base_ref).decode().strip()
    base = git(root, "merge-base", base_ref, head).decode().strip()
    if git(root, "rev-parse", "HEAD").decode().strip() != head:
        raise ValueError("checkout HEAD differs from frozen change head")
    requirement_ids = {x["id"] for x in request.get("requirements", {}).get("items", [])}
    pr_requirement_ids = request.get("pr_requirement_ids")
    if not isinstance(pr_requirement_ids, list) or len(set(pr_requirement_ids)) != len(pr_requirement_ids) or any(x not in requirement_ids for x in pr_requirement_ids):
        raise ValueError("PR requirement IDs must be an explicit unique subset of confirmed requirements")
    test_modes = request.get("test_modes")
    if not isinstance(test_modes, list) or not test_modes or len(set(test_modes)) != len(test_modes) or any(x not in ("BLACK_BOX", "WHITE_BOX") for x in test_modes):
        raise ValueError("PR test modes must explicitly select BLACK_BOX and/or WHITE_BOX")
    groups = {name: request.get(name, []) for name in ("source_paths", "test_paths", "noncode_paths", "deleted_source_paths")}
    submodule_paths = request.get("submodule_paths", [])
    if not isinstance(submodule_paths, list) or any(
        not isinstance(p, str) or not p or "/" in p or p in (".", "..") for p in submodule_paths
    ):
        raise ValueError("submodule_paths must name direct repository gitlinks")
    if len(set(submodule_paths)) != len(submodule_paths):
        raise ValueError("submodule_paths contains duplicates")
    if any(not isinstance(paths, list) or any(not isinstance(p, str) or not p for p in paths) for paths in groups.values()):
        raise ValueError("path inventories must be arrays of nonempty strings")
    classifications = {}
    for group, kind in (("source_paths", "source"), ("deleted_source_paths", "source"),
                        ("test_paths", "test"), ("noncode_paths", "noncode")):
        for path in groups[group]:
            if path in classifications:
                raise ValueError("path classified twice: " + path)
            classifications[path] = kind
    def owner(path):
        matches = [part for part in submodule_paths if path.startswith(part + "/")]
        if len(matches) > 1:
            raise ValueError("nested submodule paths require explicit recursive inventory: " + path)
        return matches[0] if matches else None

    source_hashes = {}
    for path in groups["source_paths"]:
        target = (root / path).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            raise ValueError("project source missing/outside checkout: " + path)
        submodule = owner(path)
        if submodule:
            git(root / submodule, "ls-files", "--error-unmatch", "--", path[len(submodule) + 1:])
        else:
            git(root, "ls-files", "--error-unmatch", "--", path)
        source_hashes[path] = digest(target.read_bytes())
    names = git(root, "diff", "--name-status", "-z", "--find-renames", base, head).split(b"\0")
    files, gitlinks, index = [], [], 0
    while index < len(names) and names[index]:
        status = names[index].decode(); index += 1
        old = names[index].decode(); index += 1
        path = old
        if status[0] in "RC":
            path = names[index].decode(); index += 1
        if path in submodule_paths:
            if old != path or status[0] not in "MAD":
                raise ValueError("renamed/added/deleted submodule needs an explicit checkout: " + path)
            child = root / path
            if not child.is_dir():
                raise ValueError("submodule checkout missing: " + path)
            old_rev = git(root, "rev-parse", f"{base}:{path}").decode().strip()
            new_rev = git(root, "rev-parse", f"{head}:{path}").decode().strip()
            if git(child, "rev-parse", "HEAD").decode().strip() != new_rev:
                raise ValueError("submodule HEAD differs from parent gitlink: " + path)
            git(child, "cat-file", "-e", old_rev + "^{commit}")
            gitlinks.append({"path": path, "base_revision": old_rev, "head_revision": new_rev})
            files.append({"path": path, "old_path": None, "status": status, "kind": "submodule",
                          "sha256": None, "changed_lines": [], "base_revision": old_rev, "head_revision": new_rev})
            child_names = git(child, "diff", "--name-status", "-z", "--find-renames", old_rev, new_rev).split(b"\0")
            child_index = 0
            while child_index < len(child_names) and child_names[child_index]:
                child_status = child_names[child_index].decode(); child_index += 1
                child_old = child_names[child_index].decode(); child_index += 1
                child_path = child_old
                if child_status[0] in "RC":
                    child_path = child_names[child_index].decode(); child_index += 1
                full_path = path + "/" + child_path
                full_old = path + "/" + child_old
                child_kind = classifications.get(full_path, classifications.get(full_old, "unknown"))
                child_target = (root / full_path).resolve()
                child_hash = digest(child_target.read_bytes()) if child_target.is_relative_to(root) and child_target.is_file() else None
                child_patch = git(child, "diff", "--no-ext-diff", "--unified=0", old_rev, new_rev, "--", child_path)
                files.append({"path": full_path, "old_path": full_old if full_old != full_path else None,
                              "status": child_status, "kind": child_kind, "sha256": child_hash,
                              "changed_lines": changed_new_lines(child_patch), "repo_root": path,
                              "repo_relative_path": child_path})
            continue
        kind = classifications.get(path, classifications.get(old, "unknown"))
        target = (root / path).resolve()
        current_hash = digest(target.read_bytes()) if target.is_relative_to(root) and target.is_file() else None
        patch = git(root, "diff", "--no-ext-diff", "--unified=0", base, head, "--", path)
        files.append({"path": path, "old_path": old if old != path else None,
                      "status": status, "kind": kind, "sha256": current_hash,
                      "changed_lines": changed_new_lines(patch)})
    return {"schema": "change-inventory-v1", "project_root": str(root),
            "base_ref": base_ref, "target_revision": target_revision, "base_revision": base, "head_revision": head,
            "pr_requirement_ids": pr_requirement_ids, "test_modes": test_modes,
            "source_paths": groups["source_paths"], "source_hashes": source_hashes,
            "files": files, "gitlinks": gitlinks, "changed_source_paths": [x["path"] for x in files if x["kind"] == "source" and x["sha256"]],
            "unclassified_paths": [x["path"] for x in files if x["kind"] == "unknown"]}


def changed_new_lines(patch):
    lines = set()
    for line in patch.decode(errors="replace").splitlines():
        if line.startswith("@@ "):
            match = re.search(r"\+(\d+)(?:,(\d+))?", line)
            if match:
                start, count = int(match.group(1)), int(match.group(2) or 1)
                lines.update(range(start, start + count))
    return sorted(lines)


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: change_inventory.py request.json output.json")
    request = json.loads(Path(sys.argv[1]).read_text())
    result = build(request)
    path = Path(sys.argv[2]); path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"files": len(result["files"]), "changed_sources": len(result["changed_source_paths"]),
                      "unclassified": result["unclassified_paths"]}))


if __name__ == "__main__":
    main()
