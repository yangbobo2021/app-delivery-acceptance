"""Recompute cumulative line coverage with switchable frozen denominators."""
from __future__ import annotations


def summarize(traces):
    groups = {}
    for trace in traces:
        project = trace.get("project") or {}
        key = (project.get("id"), project.get("revision"))
        if all(key):
            groups.setdefault(key, []).append(trace)
    output = []
    for (project_id, revision), rows in groups.items():
        latest = {}
        for trace in rows:
            for scene in trace.get("scenarios", []):
                key = scene.get("id")
                if key and (key not in latest or latest[key].get("generated_at", "") < trace.get("generated_at", "")):
                    latest[key] = trace
        chosen = list(latest.values())
        unavailable_reasons = sorted({t.get("coverage", {}).get("reason", "") for t in chosen
                                      if t.get("coverage", {}).get("status") == "unavailable"})
        unavailable_reasons = [reason for reason in unavailable_reasons if reason]
        coverage_statuses = {t.get("coverage", {}).get("status") for t in chosen}
        scenes_without_line_report = sum(not isinstance(t.get("coverage", {}).get("line_files"), list) for t in chosen)
        source_lists = [t.get("project", {}).get("sources") or [] for t in rows]
        sources = max(source_lists, key=len, default=[])
        inventories = [t["change"]["inventory"] for t in rows if t.get("change") and t["change"].get("inventory")]
        inventory = inventories[0] if inventories else None
        inventory_conflict = any(other != inventory for other in inventories[1:])
        source_conflict = any(items and set(items) != set(sources) for items in source_lists)
        lines, hits, conflicts = {}, {}, []
        for trace in chosen:
            coverage = trace.get("coverage") or {}
            if coverage.get("status") != "measured":
                continue
            for file in coverage.get("line_files") or []:
                path = file.get("path")
                executable = set(file.get("executable_lines") or [])
                if path in lines and lines[path] != executable:
                    conflicts.append(path)
                lines[path] = executable
                hits.setdefault(path, set()).update(file.get("hit_lines") or [])
        scopes = {"project": sources}
        if inventory:
            scopes["changed_files"] = inventory.get("changed_source_paths") or []
            scopes["changed_lines"] = scopes["changed_files"]
        metrics = {}
        for scope, paths in scopes.items():
            missing = sorted(set(paths) - set(lines))
            if scope == "changed_lines":
                changes = {f["path"]: set(f.get("changed_lines") or []) for f in inventory["files"]}
                denominator = {path: lines.get(path, set()) & changes.get(path, set()) for path in paths}
            else:
                denominator = {path: lines.get(path, set()) for path in paths}
            total = sum(len(x) for x in denominator.values())
            covered = sum(len(hits.get(path, set()) & expected) for path, expected in denominator.items())
            status = "incomplete" if missing or conflicts or source_conflict or inventory_conflict or scenes_without_line_report else "measured"
            if not chosen:
                status = "pending"
            elif coverage_statuses == {"pending"}:
                status = "pending"
            elif scenes_without_line_report == len(chosen) and not lines and not (conflicts or source_conflict or inventory_conflict):
                if coverage_statuses == {"unavailable"}:
                    status = "unavailable"
                elif coverage_statuses == {"off"}:
                    status = "off"
            metrics[scope] = {"status": status,
                              "covered": covered, "total": total, "missing_paths": missing,
                              "conflicting_paths": sorted(set(conflicts)), "source_inventory_conflict": source_conflict or inventory_conflict,
                              "unavailable_reasons": unavailable_reasons,
                              "scenes_without_line_report": scenes_without_line_report}
        output.append({"project_id": project_id, "project_label": rows[0]["project"].get("label") or project_id,
                       "revision": revision, "scenes_with_coverage": sum(t.get("coverage", {}).get("line_files") is not None for t in chosen),
                       "scenes": len(chosen), "scopes": metrics})
    return output
