#!/usr/bin/env python3
"""Serve the selected acceptance JSON ledger through a read-only local viewer."""

import argparse
from datetime import datetime, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import sys
from threading import Condition, Lock
from urllib.parse import urlsplit, unquote, quote, parse_qs
import webbrowser

sys.path.insert(0, str(Path(__file__).resolve().parent))
import playbook
import white_box_rules
import execution_coverage
import viewer_coverage
import acceptance_plan
import design_pipeline
from storage import asset_directory, test_directory

UI = Path(__file__).resolve().parents[1] / "assets" / "ledger-viewer"
CORE = ("project.json", "requirements.json", "scenarios.json", "coverage_review.json")
DOCUMENTS = (*CORE, "resources.json", "black-box-gate.json", "scenario-gate.json",
             "workflow-sessions.json", "pending-business-inputs.json", "repair-summary.json", "execution-policy.json", "white_box_rules.json", acceptance_plan.NAME, acceptance_plan.REVIEW, acceptance_plan.DECISIONS, acceptance_plan.POLICY, design_pipeline.ANALYSIS, design_pipeline.PROGRESS, "acceptance-plan.candidate.json")
RUN_HASH_FILES = ("white_box_rules.json", "project.json", "requirements.json", "resources.json", "scenarios.json", "coverage_review.json")
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
COVERAGE_FILES = ("code-coverage/measurement.json", "code-coverage/review.json", "code-coverage/gate-report.json")
MAX_FILE = 32 * 1024 * 1024
TEXT_LIMIT = 1024 * 1024
INVENTORY_LIMIT = 5000
FILE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
              ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8"}
TEXT_TYPES = {".txt", ".log", ".md", ".json", ".xml", ".csv", ".py", ".js", ".cjs", ".mjs", ".ts", ".tsx", ".jsx", ".yaml", ".yml", ".sh", ".go", ".java", ".rs", ".sql", ".toml", ".ini", ".cfg"}


def reject_constant(value):
    raise ValueError(f"non-JSON numeric constant: {value}")


class Ledger:
    def __init__(self, project, selected, background_coverage=False):
        self.project = Path(project).resolve()
        self.test_dir = test_directory(self.project, selected)
        self.assets = asset_directory(self.project, self.test_dir)
        if not self.project.is_dir() or not self.assets.is_dir():
            raise ValueError("project and selected delivery-acceptance directory must exist")
        self.lock = Lock()
        self.refresh_condition = Condition()
        self.refresh_pending = None
        self.coverage_cache = viewer_coverage.CoverageCache() if background_coverage else None
        project_record = self.read("project.json", [], {}) or {}
        bound = project_record.get("project_root")
        if bound and (not isinstance(bound, str) or Path(bound).resolve() != self.project):
            raise ValueError("test assets belong to a different project")

    def read(self, relative, errors, hashes, required=False):
        path = self.assets / relative
        if not path.resolve().is_relative_to(self.assets):
            errors.append({"file": relative, "code": "outside_assets", "message": "File resolves outside selected assets"})
            return None
        try:
            if path.stat().st_size > MAX_FILE:
                raise ValueError("JSON exceeds viewer size limit")
            raw = path.read_bytes()
            hashes[relative] = hashlib.sha256(raw).hexdigest()
            value = json.loads(raw.decode("utf-8"), parse_constant=reject_constant)
            if not isinstance(value, dict):
                raise ValueError("expected a JSON object")
            return value
        except FileNotFoundError:
            if required:
                errors.append({"file": relative, "code": "missing", "message": "File is not available yet"})
        except (OSError, UnicodeError, ValueError) as error:
            errors.append({"file": relative, "code": "invalid", "message": str(error)})
        return None

    def allowed_artifact(self, relative):
        """Only selected ledger assets; optional coverage is selected by the run's mode."""
        if not isinstance(relative, str) or not relative or "\\" in relative or "\x00" in relative:
            return None
        parts = relative.split("/")
        if any(part in {"", ".", "..", "node_modules", "__pycache__", ".slc"} or part.startswith(".") for part in parts):
            return None
        candidate = self.assets.joinpath(*parts)
        try:
            if not candidate.resolve().is_relative_to(self.assets) or any(self.assets.joinpath(*parts[:i]).is_symlink() for i in range(1, len(parts) + 1)):
                return None
            if len(parts) >= 3 and parts[0] == "runs" and parts[2] == "code-coverage":
                run = self.read(f"runs/{parts[1]}/run.json", [], {}) or {}
                if run.get("acceptance_mode", "standard") != "coverage":
                    return None
            if parts[0] == "code-coverage-resources.json":
                records = self.collection("runs", ("run.json",), [], {})
                if not any((r["documents"].get("run.json") or {}).get("acceptance_mode") == "coverage" for r in records):
                    return None
            return candidate
        except (OSError, ValueError):
            return None

    def artifacts(self, run_id=None):
        files, notices = [], []
        budget = [0]

        def walk(directory, depth=0):
            if budget[0] >= INVENTORY_LIMIT:
                return
            if depth > 16:
                notices.append("Directory depth limit reached: " + str(directory.relative_to(self.assets)))
                return
            try:
                entries = sorted(directory.iterdir(), key=lambda p: p.name)
                for path in entries:
                    budget[0] += 1
                    if budget[0] > INVENTORY_LIMIT:
                        message = f"Artifact inventory limited to {INVENTORY_LIMIT} entries; select a run or open a known reference directly"
                        if message not in notices:
                            notices.append(message)
                        break
                    relative = path.relative_to(self.assets).as_posix()
                    safe = self.allowed_artifact(relative)
                    if safe is None:
                        continue
                    if safe.is_dir():
                        walk(safe, depth + 1)
                    elif safe.is_file():
                        suffix = safe.suffix.lower()
                        kind = "html" if suffix in {".html", ".htm"} else "image" if FILE_TYPES.get(suffix, "").startswith("image/") else "text" if suffix in TEXT_TYPES or suffix == ".css" else "download"
                        files.append({"path": relative, "size": safe.stat().st_size, "kind": kind,
                                      "url": "/artifacts/" + quote(relative, safe="/"), "run_id": relative.split("/")[1] if relative.startswith("runs/") and len(relative.split("/")) > 2 else None})
            except OSError as error:
                notices.append(str(error))
        if run_id is not None:
            if not SAFE_NAME.fullmatch(run_id):
                raise ValueError("invalid run id")
            selected = self.allowed_artifact("runs/" + run_id)
            if selected is None or not selected.is_dir():
                raise ValueError("run not available in selected ledger")
            walk(selected)
        else:
            walk(self.assets)
        return {"files": files, "notices": notices, "max_download_bytes": MAX_FILE, "text_preview_bytes": TEXT_LIMIT}

    def collection(self, folder, names, errors, hashes):
        base = self.assets / folder
        if not base.resolve().is_relative_to(self.assets):
            errors.append({"file": folder, "code": "outside_assets", "message": "Directory resolves outside selected assets"})
            return []
        if not base.is_dir():
            return []
        records = []
        for directory in sorted(base.iterdir(), key=lambda p: p.name):
            if not SAFE_NAME.fullmatch(directory.name) or not directory.is_dir():
                continue
            if not directory.resolve().is_relative_to(self.assets):
                errors.append({"file": str(directory.relative_to(self.assets)), "code": "outside_assets", "message": "Directory resolves outside selected assets"})
                continue
            data = {name: self.read(f"{folder}/{directory.name}/{name}", errors, hashes) for name in names}
            if any(value is not None for value in data.values()):
                records.append({"id": directory.name, "documents": data})
        return records

    def snapshot(self):
        if not self.coverage_cache:
            return self._snapshot()
        # Overlapping tabs share this in-flight read, not a timed stale cache.
        # The next non-overlapping refresh reads the actual ledger again.
        with self.refresh_condition:
            pending = self.refresh_pending
            if pending is not None:
                self.refresh_condition.wait_for(lambda: 'value' in pending or 'error' in pending)
                if 'error' in pending:
                    raise pending['error']
                return pending['value']
            pending = {}
            self.refresh_pending = pending
        try:
            value = self._snapshot()
            with self.refresh_condition:
                pending['value'] = value
            return value
        except BaseException as error:
            with self.refresh_condition:
                pending['error'] = error
            raise
        finally:
            with self.refresh_condition:
                self.refresh_pending = None
                self.refresh_condition.notify_all()

    def _snapshot(self):
        with self.lock:
            errors, hashes = [], {}
            documents = {name: self.read(name, errors, hashes, name in CORE) for name in DOCUMENTS}
            runs = self.collection("runs", ("run.json", "execution-plan.json", "review.json", "gate-report.json", "scenarios.snapshot.json", "white_box_rules.snapshot.json", "acceptance-plan.snapshot.json", "acceptance-plan-review.snapshot.json", "scope-decisions.snapshot.json", "requirements.snapshot.json", "source-analysis.snapshot.json", "design-progress.snapshot.json", execution_coverage.NAME), errors, hashes)
            for record in runs:
                run = record["documents"].get("run.json") or {}
                record["acceptance_mode"] = run.get("acceptance_mode", "standard")
                summarize = self.coverage_cache.get if self.coverage_cache else execution_coverage.summarize
                pinned = run.get("ledger_hashes")
                stale = isinstance(pinned, dict) and any(pinned.get(name) != hashes.get(name) for name in (*RUN_HASH_FILES, *((acceptance_plan.NAME, acceptance_plan.REVIEW, acceptance_plan.DECISIONS, acceptance_plan.POLICY, design_pipeline.ANALYSIS, design_pipeline.PROGRESS) if acceptance_plan.required(self.assets) or acceptance_plan.NAME in pinned else ())))
                if self.coverage_cache and stale:
                    record["execution_coverage"] = viewer_coverage.pending(run, '该运行对应旧版测试台账，不计入当前覆盖率。', 'stale')
                else:
                    record["execution_coverage"] = summarize(self.project, self.assets, self.assets / 'runs' / record['id'], run, record['documents'].get(execution_coverage.NAME))
                if record["acceptance_mode"] == "coverage":
                    for name in COVERAGE_FILES:
                        record["documents"][name] = self.read(f"runs/{record['id']}/{name}", errors, hashes)
            if any(record["acceptance_mode"] == "coverage" for record in runs):
                documents["code-coverage-resources.json"] = self.read("code-coverage-resources.json", errors, hashes)
            history = self.collection("review-history", ("coverage_review.json", "scenarios.json"), errors, hashes)
            freshness = {"status": "unavailable", "mismatched_hashes": []}
            current_check = {"status": "unavailable", "gates": {}}
            if all(documents[name] is not None for name in CORE):
                try:
                    current_hashes = playbook.coverage_scope_hashes(self.assets)
                    review = documents["coverage_review.json"]
                    mismatched = [key for key, value in current_hashes.items() if review.get(key) != value]
                    freshness = {"status": "unreviewed" if review.get("status") == "unreviewed" else "stale" if mismatched else "current",
                                 "mismatched_hashes": mismatched, "current_hashes": current_hashes}
                    # This checker function is read-only: no new run, gate file, or report is written.
                    current_check = (playbook.validate_white_box(self.project, self.test_dir) if (documents.get(design_pipeline.ANALYSIS) or {}).get('stage') == 'white-box' else playbook.validate_black_box(self.project, self.test_dir))
                except (OSError, UnicodeError, ValueError, TypeError, KeyError, AttributeError) as error:
                    errors.append({"file": "ledger", "code": "check_unavailable", "message": str(error)})
            rule_freshness = {"status": "unavailable", "issues": []}
            if documents.get("white_box_rules.json") is not None:
                try:
                    scenes = playbook.items(documents.get("scenarios.json"))
                    rules_review = (documents.get("coverage_review.json") or {}).get("white_box_priority_review", {})
                    rule_errors = white_box_rules.definitions_errors(self.project, self.assets, scenes, {r["id"] for r in playbook.items(documents.get("requirements.json"))})
                    rule_errors += white_box_rules.review_errors(self.assets, scenes, rules_review, require_resolved=False)
                    mismatch = [k for k, v in playbook.priorities.white_box_hashes(self.assets, scenes).items() if rules_review.get(k) != v]
                    rule_freshness = {"status": "stale" if mismatch or any("code source changed" in e for e in rule_errors) else "unavailable" if rule_errors else "current", "issues": rule_errors, "mismatched_hashes": mismatch}
                except (OSError, ValueError, TypeError, KeyError) as error:
                    rule_freshness["issues"] = [str(error)]
            # Do not certify a mixture of files read while another role is writing them.
            changed = []
            for name in (*documents, *[f"runs/{record['id']}/{name}" for record in runs for name in record["documents"]]):
                path = self.assets / name
                try:
                    if not path.resolve().is_relative_to(self.assets):
                        continue
                    now = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
                    if now != hashes.get(name):
                        changed.append(name)
                except OSError:
                    changed.append(name)
            if changed:
                errors.append({"file": "ledger", "code": "changing", "message": "Files changed while reading: " + ", ".join(changed)})
                freshness = {"status": "unavailable", "mismatched_hashes": []}
                current_check = {"status": "unavailable", "gates": {}}
                rule_freshness = {"status": "unavailable", "issues": ["Files changed while reading"]}
            for record in runs:
                run = record["documents"].get("run.json") or {}
                pinned = run.get("ledger_hashes")
                record["ledger_match"] = "unavailable" if not isinstance(pinned, dict) else (
                    "current" if all(hashes.get(name) and pinned.get(name) == hashes[name] for name in (*RUN_HASH_FILES, *((acceptance_plan.NAME, acceptance_plan.REVIEW, acceptance_plan.DECISIONS, acceptance_plan.POLICY, design_pipeline.ANALYSIS, design_pipeline.PROGRESS) if acceptance_plan.required(self.assets) or acceptance_plan.NAME in pinned else ()), *((white_box_rules.NAME,) if documents.get(white_box_rules.NAME) is not None or white_box_rules.NAME in pinned else ()))) else "stale")
                if "execution-plan.json" in record["documents"] and record["documents"]["execution-plan.json"] is not None or "execution_plan_sha256" in run:
                    try:
                        playbook.priorities.load_plan(self.assets / "runs" / record["id"], run, playbook.items(documents.get("scenarios.json")), self.assets)
                        record["plan_match"] = "current"
                    except (ValueError, OSError, KeyError, TypeError) as error:
                        record["plan_match"] = "stale"
                        record["ledger_match"] = "stale"
                        record["plan_issue"] = str(error)
                record["file_hashes"] = {name: hashes.get(f"runs/{record['id']}/{name}") for name in record["documents"]}
                record["scope_snapshot_valid"] = isinstance(pinned, dict) and bool(pinned.get(acceptance_plan.NAME)) and hashes.get(f"runs/{record['id']}/acceptance-plan.snapshot.json") == pinned.get(acceptance_plan.NAME)
                record["read_consistent"] = not any(name.startswith(f"runs/{record['id']}/") for name in changed)
            scope_status = {"status": "legacy", "issues": [], "conclusion": None}
            if acceptance_plan.required(self.assets):
                try:
                    scope_errors = acceptance_plan.plan_review_errors(self.assets)
                    if not scope_errors and documents.get("scenarios.json") and documents.get("coverage_review.json"):
                        stage = (documents.get(design_pipeline.ANALYSIS) or {}).get('stage','black-box')
                        scope_scenes = [s for s in playbook.items(documents['scenarios.json']) if stage != 'black-box' or s.get('kind') == 'black_box']
                        scope_errors += acceptance_plan.scenario_errors(self.assets, scope_scenes, documents['coverage_review.json'], stage=stage)
                    scope_status = {"status": "invalid" if scope_errors or changed else "current", "issues": scope_errors, "conclusion": acceptance_plan.conclusion(self.assets)}
                except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
                    scope_status = {"status": "invalid", "issues": [str(error)], "conclusion": None}
            try:
                pipeline_status = design_pipeline.view(self.assets, runs)
            except (ValueError, TypeError, KeyError, AttributeError) as error:
                pipeline_status = {'stages': [], 'units': [], 'generated_units':0, 'total_units':0, 'issues':[str(error)]}
            return {"pipeline_status": pipeline_status, "scope_status": scope_status, "project_root": str(self.project), "test_dir": str(self.test_dir), "assets": str(self.assets),
                    "loaded_at": datetime.now(timezone.utc).isoformat(), "documents": documents,
                    "errors": errors, "file_hashes": hashes, "review_freshness": freshness,
                    "current_check": current_check, "white_box_rule_freshness": rule_freshness, "runs": runs, "history": history, "artifacts":
                    {"files": [], "notices": [], "deferred": True, "max_download_bytes": MAX_FILE, "text_preview_bytes": TEXT_LIMIT}
                    if self.coverage_cache else self.artifacts()}


def handler_for(ledger):
    class Handler(BaseHTTPRequestHandler):
        def reply(self, status, content, content_type, artifact=False, filename=None):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'" if artifact else "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
            if filename:
                self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(filename, safe=""))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(content)

        def do_GET(self):
            port = self.server.server_address[1]
            if self.headers.get("Host") not in {f"127.0.0.1:{port}", f"localhost:{port}"}:
                self.reply(403, b"Local host required", "text/plain; charset=utf-8")
                return
            path = urlsplit(self.path).path
            if path == "/api/ledger":
                body = json.dumps(ledger.snapshot(), ensure_ascii=False, allow_nan=False).encode("utf-8")
                self.reply(200, body, "application/json; charset=utf-8")
                return
            if path == "/api/artifacts":
                selected = parse_qs(urlsplit(self.path).query).get("run", [None])[0]
                try:
                    body = json.dumps(ledger.artifacts(selected), ensure_ascii=False, allow_nan=False).encode("utf-8")
                    self.reply(200, body, "application/json; charset=utf-8")
                except ValueError:
                    self.reply(404, b"Run unavailable", "text/plain")
                return
            if path.startswith("/artifacts/") or path.startswith("/api/artifact-text/"):
                is_text = path.startswith("/api/artifact-text/")
                relative = unquote(path[len("/api/artifact-text/") if is_text else len("/artifacts/"):])
                target = ledger.allowed_artifact(relative)
                if target is None or not target.is_file():
                    self.reply(404, b"Artifact unavailable in selected ledger", "text/plain; charset=utf-8")
                    return
                try:
                    suffix = target.suffix.lower()
                    if is_text:
                        if suffix not in TEXT_TYPES and suffix != ".css":
                            self.reply(415, b"Use the artifact download or isolated HTML preview", "text/plain")
                            return
                        with target.open("rb") as stream:
                            raw = stream.read(TEXT_LIMIT + 1)
                        body = json.dumps({"path": relative, "text": raw[:TEXT_LIMIT].decode("utf-8", errors="replace"), "truncated": len(raw) > TEXT_LIMIT}, ensure_ascii=False).encode("utf-8")
                        self.reply(200, body, "application/json; charset=utf-8")
                        return
                    if target.stat().st_size > MAX_FILE:
                        self.reply(413, b"Artifact exceeds 32 MiB viewer download limit; open the local file", "text/plain")
                        return
                    with target.open("rb") as stream:
                        body = stream.read(MAX_FILE + 1)
                    if len(body) > MAX_FILE:
                        self.reply(413, b"Artifact exceeds viewer limit", "text/plain")
                        return
                    mime = FILE_TYPES.get(suffix, "text/plain; charset=utf-8" if suffix in TEXT_TYPES else "application/octet-stream")
                    download = "download" in parse_qs(urlsplit(self.path).query, keep_blank_values=True) or suffix not in FILE_TYPES and suffix not in TEXT_TYPES
                    self.reply(200, body, mime, artifact=True, filename=target.name if download else None)
                except OSError:
                    self.reply(404, b"Artifact unavailable", "text/plain")
                return
            static = {"/": ("index.html", "text/html"), "/viewer.js": ("viewer.js", "text/javascript"), "/scope.js": ("scope.js", "text/javascript"),
                      "/traceability.js": ("traceability.js", "text/javascript"),
                      "/coverage.js": ("coverage.js", "text/javascript"),
                      "/results.js": ("results.js", "text/javascript"),
                      "/viewer.css": ("viewer.css", "text/css")}
            if path in static:
                name, kind = static[path]
                self.reply(200, (UI / name).read_bytes(), kind + "; charset=utf-8")
            elif path == "/favicon.ico":
                self.reply(204, b"", "image/x-icon")
            else:
                self.reply(404, b"Not found", "text/plain; charset=utf-8")

        do_HEAD = do_GET

        def do_POST(self):
            self.reply(405, b"Read-only viewer", "text/plain; charset=utf-8")

        do_PUT = do_PATCH = do_DELETE = do_POST

        def log_message(self, format, *args):
            pass
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    parser.add_argument("--test-dir", type=Path, required=True, help="use the already chosen test directory")
    parser.add_argument("--port", type=int, default=0, help="local port (default: choose an available port)")
    parser.add_argument("--open", action="store_true", help="open the URL in the default browser")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("port must be between 0 and 65535")
    try:
        ledger = Ledger(args.project, args.test_dir, background_coverage=True)
        server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(ledger))
    except (ValueError, OSError) as error:
        parser.error(str(error))
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    print(json.dumps({"url": url, "assets": str(ledger.assets), "read_only": True}, ensure_ascii=False), flush=True)
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
