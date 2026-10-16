"""Shared design contract: structural consistency, not semantic sufficiency."""
import output_quality

STANDARD = "design-quality-v3"  # historical contract, kept for existing records
CURRENT_STANDARD = "design-quality-v4"
SUPPORTED_STANDARDS = {STANDARD, CURRENT_STANDARD}
CRITERIA = {"requirement_alignment", "coverage_completeness", "method_discrimination", "fault_detection", "scope_boundaries"}


def records(value):
    return value if isinstance(value, list) else []


def content(value):
    return output_quality.meaningful(value)


def text_list(value, nonempty=False):
    return isinstance(value, list) and (bool(value) or not nonempty) and all(content(v) for v in value)


def basis_errors(document, requirements, scenarios, methods):
    errors, seen, linked = [], set(), set()
    if document.get("design_standard") not in SUPPORTED_STANDARDS:
        errors.append(f"scenario generation requires shared design_standard {STANDARD}")
    bases = document.get("design_basis")
    if not isinstance(bases, list):
        errors.append("scenario generation needs per-requirement design_basis")
    for position, basis in enumerate(records(bases)):
        if not isinstance(basis, dict) or not isinstance(basis.get("requirement_id"), str):
            errors.append(f"design_basis[{position}] needs requirement_id"); continue
        rid = basis["requirement_id"]
        if rid not in requirements or rid in seen:
            errors.append(f"design_basis has unknown or duplicate requirement {rid}")
        seen.add(rid)
        for field in ("scope", "exclusions", "limitations"):
            if not text_list(basis.get(field), field == "scope"):
                errors.append(f"design_basis {rid} needs {field} as substantive list")
        techniques = basis.get("techniques")
        if not isinstance(techniques, list) or not techniques or any(not isinstance(t, dict) or not content(t.get("name")) or not content(t.get("reason")) for t in techniques):
            errors.append(f"design_basis {rid} needs applicable techniques with reasons")
        covers, ids = basis.get("coverage_items"), set()
        if not isinstance(covers, list) or not covers:
            errors.append(f"design_basis {rid} needs concrete coverage_items")
        for cover in records(covers):
            if not isinstance(cover, dict) or not isinstance(cover.get("id"), str) or not cover["id"].strip():
                errors.append(f"design_basis {rid} has invalid coverage item"); continue
            cid = cover["id"]
            if cid in ids:
                errors.append(f"design_basis {rid} duplicate coverage item {cid}")
            ids.add(cid)
            if not content(cover.get("condition")) or not content(cover.get("expected")):
                errors.append(f"coverage item {cid} needs concrete condition and expected behavior")
            if not content(cover.get("identification_basis")):
                errors.append(f"coverage item {cid} needs plain identification_basis")
            points, point_ids = cover.get("check_points"), set()
            if not isinstance(points, list) or not points:
                errors.append(f"coverage item {cid} needs concrete check_points")
            for point in records(points):
                if not isinstance(point, dict) or not isinstance(point.get("id"), str) or not point["id"].strip() or not content(point.get("text")):
                    errors.append(f"coverage item {cid} has invalid check point"); continue
                if point["id"] in point_ids:
                    errors.append(f"coverage item {cid} duplicate check point {point['id']}")
                point_ids.add(point["id"])
            scene_ids = cover.get("scenario_ids")
            if not isinstance(scene_ids, list) or not scene_ids:
                errors.append(f"coverage item {cid} needs scenario_ids")
            for sid in records(scene_ids):
                scene = scenarios.get(sid) if isinstance(sid, str) else None
                if not scene or rid not in records(scene.get("requirement_ids")):
                    errors.append(f"coverage item {cid} links unrelated scenario {sid}")
                else:
                    linked.add(sid)
    for rid in set(requirements) - seen:
        errors.append(f"requirement {rid} has no generation design_basis")
    for sid in set(scenarios) - linked:
        errors.append(f"scenario {sid} has no generation coverage item")
    return errors


def review_errors(review, document, requirements, scenarios):
    errors = []
    if review.get("design_standard") not in SUPPORTED_STANDARDS or review.get("design_standard") != document.get("design_standard"):
        errors.append("generation and independent review must use the same current design_standard")
    bases = {b["requirement_id"]: b for b in records(document.get("design_basis")) if isinstance(b, dict) and isinstance(b.get("requirement_id"), str)}
    for item in records(review.get("items")):
        if not isinstance(item, dict): continue
        rid = item.get("requirement_id")
        if not isinstance(rid, str): continue
        prefix = f"design review {rid}"
        errors.extend(output_quality.summary_errors(item.get("reason"), prefix + " reason"))
        for field in ("scope", "limitations"):
            if not text_list(item.get(field), field == "scope"):
                errors.append(f"{prefix} needs {field} as substantive list")
        covers = {c["id"]: c for c in records(bases.get(rid, {}).get("coverage_items")) if isinstance(c, dict) and isinstance(c.get("id"), str)}
        expected_ids = set(covers)
        results, found = item.get("coverage_results"), set()
        if not isinstance(results, list): errors.append(f"{prefix} needs coverage_results")
        for result in records(results):
            if not isinstance(result, dict) or not isinstance(result.get("coverage_id"), str):
                errors.append(f"{prefix} has invalid coverage result"); continue
            cid = result["coverage_id"]
            if cid not in expected_ids or cid in found:
                errors.append(f"{prefix} unknown or duplicate coverage result {cid}")
            found.add(cid)
            if result.get("status") not in {"covered", "partial", "gap"} or not content(result.get("reason")):
                errors.append(f"{prefix} coverage result {cid} needs status and substantive reason")
            cover = covers.get(cid, {})
            point_ids = {p["id"] for p in records(cover.get("check_points")) if isinstance(p, dict) and isinstance(p.get("id"), str)}
            contributions, scene_ids, covered = result.get("scenario_coverage"), set(), set()
            if not isinstance(contributions, list):
                errors.append(f"{prefix} coverage result {cid} needs scenario_coverage")
            for contribution in records(contributions):
                if not isinstance(contribution, dict):
                    errors.append(f"{prefix} {cid} has invalid scenario contribution"); continue
                sid = contribution.get("scenario_id")
                scene = scenarios.get(sid) if isinstance(sid, str) else None
                if not scene or rid not in records(scene.get("requirement_ids")) or sid not in records(cover.get("scenario_ids")) or sid in scene_ids:
                    errors.append(f"{prefix} {cid} unknown, unrelated or duplicate contribution {sid}")
                if isinstance(sid, str): scene_ids.add(sid)
                points = contribution.get("covered_point_ids")
                if not text_list(points, True) or len(records(points)) != len(set(p for p in records(points) if isinstance(p, str))) or any(not isinstance(p, str) or p not in point_ids for p in records(points)):
                    errors.append(f"{prefix} {cid} contribution {sid} has invalid covered_point_ids")
                covered.update(p for p in records(points) if isinstance(p, str) and p in point_ids)
                if not content(contribution.get("reason")):
                    errors.append(f"{prefix} {cid} contribution {sid} needs concrete method reason")
            aggregate = "covered" if point_ids and covered == point_ids else "partial" if covered else "gap"
            if result.get("status") != aggregate:
                errors.append(f"{prefix} {cid} status must match union of check points ({aggregate})")
            if item.get("verdict") == "sufficient" and result.get("status") != "covered":
                errors.append(f"{prefix} cannot be sufficient with uncovered item {cid}")
        if found != expected_ids:
            errors.append(f"{prefix} must assess exactly the generated coverage items")
        checks, checked = item.get("criteria_checks"), set()
        if not isinstance(checks, list): errors.append(f"{prefix} needs five shared criteria_checks")
        for check in records(checks):
            if not isinstance(check, dict) or not isinstance(check.get("criterion"), str):
                errors.append(f"{prefix} has invalid criterion check"); continue
            criterion = check["criterion"]
            if criterion not in CRITERIA or criterion in checked:
                errors.append(f"{prefix} unknown or duplicate criterion {criterion}")
            checked.add(criterion)
            if check.get("status") not in {"passed", "gap", "needs_clarification"} or not content(check.get("reason")):
                errors.append(f"{prefix} criterion {criterion} needs status and substantive reason")
            if item.get("verdict") == "sufficient" and check.get("status") != "passed":
                errors.append(f"{prefix} cannot be sufficient with unresolved criterion {criterion}")
        if checked != CRITERIA: errors.append(f"{prefix} must check exactly the five shared criteria")
        findings, kinds = item.get("findings"), set()
        if not isinstance(findings, list): errors.append(f"{prefix} needs findings list")
        for finding in records(findings):
            if not isinstance(finding, dict): errors.append(f"{prefix} has invalid finding"); continue
            kind = finding.get("kind")
            if not isinstance(kind, str) or kind not in {"coverage_gap", "requirement_clarification", "suggestion"}:
                errors.append(f"{prefix} finding needs a recognized kind"); continue
            kinds.add(kind)
            if "coverage_id" in finding and (not isinstance(finding["coverage_id"], str) or finding["coverage_id"] not in expected_ids):
                errors.append(f"{prefix} finding links unknown coverage item")
            fields = ["requirement_basis", "condition"]
            fields += {"coverage_gap": ["escaping_fault", "why_existing_misses", "expected_detection"], "requirement_clarification": ["question"], "suggestion": ["recommendation", "reason_nonblocking"]}[kind]
            for field in fields:
                if not content(finding.get(field)): errors.append(f"{prefix} {kind} needs {field}")
            if kind == "coverage_gap":
                ids = finding.get("scenario_ids")
                if not isinstance(ids, list): errors.append(f"{prefix} coverage_gap needs scenario_ids")
                for sid in records(ids):
                    scene = scenarios.get(sid) if isinstance(sid, str) else None
                    if not scene or rid not in records(scene.get("requirement_ids")):
                        errors.append(f"{prefix} finding links unrelated scenario {sid}")
        verdict = item.get("verdict")
        if verdict == "sufficient" and kinds - {"suggestion"}:
            errors.append(f"{prefix} sufficient verdict has unresolved findings")
        if verdict == "gap" and "coverage_gap" not in kinds:
            errors.append(f"{prefix} gap verdict requires a concrete counterexample finding")
        if verdict == "needs_clarification" and "requirement_clarification" not in kinds:
            errors.append(f"{prefix} clarification verdict requires a concrete question")
        if verdict not in {"sufficient", "gap", "needs_clarification"}:
            errors.append(f"{prefix} needs a recognized design verdict")
    return errors


def acceptance_map(scenarios):
    """Validate each scenario's own acceptance instructions, keyed by scenario ID."""
    return {sid: scene.get("acceptance") if isinstance(scene.get("acceptance"), dict) else {} for sid, scene in scenarios.items()}
