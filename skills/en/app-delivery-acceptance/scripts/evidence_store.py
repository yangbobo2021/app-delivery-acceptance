"""Resolve immutable acceptance artifacts; imports are data, never active workflows."""
import json
from pathlib import Path
import re

from acceptance_store import digest, inside, locations, read

HASH = re.compile(r"[0-9a-f]{64}\Z")
_verified = {}
_indexes = {}
_snapshots = {}


def index(project, acceptance_id):
    _, shared, _ = locations(project, acceptance_id)
    path = shared / "evidence-index.json"
    if not path.is_file():
        return {}
    marker = (str(path), path.stat().st_mtime_ns, path.stat().st_size)
    if marker in _indexes:
        return _indexes[marker]
    value = read(path)
    if value.get("schema") != "acceptance-evidence-index-v1" or value.get("acceptance_id") != acceptance_id:
        raise ValueError("invalid acceptance evidence index")
    _indexes[marker] = value.get("artifacts", {})
    return _indexes[marker]


def resolve(project, acceptance_id, reference):
    key = reference.removeprefix("artifact:")
    if not HASH.fullmatch(key):
        raise ValueError("invalid artifact reference")
    item = index(project, acceptance_id).get(key)
    if item is None or item.get("sha256") != key:
        raise ValueError("unregistered artifact")
    _, shared, local = locations(project, acceptance_id)
    storage = item["storage"]
    kind, relative = storage.split(":", 1)
    if kind not in {"local", "shared"}:
        raise ValueError("unsupported artifact storage")
    file = inside(local if kind == "local" else shared, relative)
    if not file.is_file():
        return None, item
    stat = file.stat()
    marker = (str(file), stat.st_size, stat.st_mtime_ns)
    if marker not in _verified:
        if stat.st_size != item["size"] or digest(file) != key:
            raise ValueError("imported artifact changed: " + key)
        _verified[marker] = True
    return file, item


def verify_import_trace(project, acceptance_id, trace):
    """A migration projection must match its unchanged source snapshot exactly."""
    binding = trace.get("import_source")
    if not binding:
        return True
    file, _ = resolve(project, acceptance_id, binding["snapshot_ref"])
    if file is None:
        # Other checkouts may only carry the shared projection. Disclose the gap.
        return False
    marker = (str(file), file.stat().st_mtime_ns, file.stat().st_size)
    if marker not in _snapshots:
        _snapshots[marker] = json.loads(file.read_text())
    value = _snapshots[marker]
    for part in binding["json_pointer"].strip("/").split("/"):
        part = part.replace("~1", "/").replace("~0", "~")
        value = value[int(part)] if isinstance(value, list) else value[part]
    for name in ("scenarios", "judgment", "judgment_confirmed_at", "judgment_source", "execution_known", "generated_at", "coverage_actual_revision", "review_mode", "scope_correction"):
        if trace.get(name) != value.get(name):
            raise ValueError("migration altered a confirmed result/source field: " + name)
    if trace.get("project", {}).get("revision") != value.get("project", {}).get("revision"):
        raise ValueError("migration altered actual execution revision")
    return True
