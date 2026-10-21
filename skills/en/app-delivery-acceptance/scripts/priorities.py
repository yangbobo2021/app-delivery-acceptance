"""Scenario risk classification and fixed, priority-ordered execution plans."""

from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import white_box_rules
import acceptance_plan

PRIORITIES = ("P0", "P1", "P2", "P3")
DEFAULT_POLICY = {"max_priority": "P3", "time_limit_minutes": None}


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def json_hash(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def policy(value):
    if not isinstance(value, dict) or set(value) != set(DEFAULT_POLICY):
        raise ValueError("execution policy needs exactly max_priority and time_limit_minutes")
    if value["max_priority"] not in PRIORITIES:
        raise ValueError("max_priority must be P0, P1, P2 or P3")
    limit = value["time_limit_minutes"]
    if limit is not None and (isinstance(limit, bool) or not isinstance(limit, (int, float)) or not math.isfinite(limit) or limit <= 0):
        raise ValueError("time_limit_minutes must be a finite positive number or null")
    return dict(value)


def read_policy(ledger):
    path = ledger / "execution-policy.json"
    return policy(json.loads(path.read_text())) if path.exists() else dict(DEFAULT_POLICY)


def ordered(scenarios):
    return sorted(scenarios, key=lambda item: PRIORITIES.index(item.get("priority")) if item.get("priority") in PRIORITIES else len(PRIORITIES))


def classification_errors(identifier, scenario):
    errors = []
    if scenario.get("priority") not in PRIORITIES:
        errors.append(f"scenario {identifier} needs priority P0/P1/P2/P3 (legacy missing values are unclassified)")
    if not nonempty(scenario.get("priority_reason")):
        errors.append(f"scenario {identifier} needs a concrete priority_reason describing failure consequences")
    return errors


def review_errors(records, scenario_map):
    errors, seen = [], set()
    if not isinstance(records, list):
        return ["independent priority review needs a list of scenario judgments"]
    for item in records:
        if not isinstance(item, dict) or not nonempty(item.get("scenario_id")):
            errors.append("priority review needs scenario_id")
            continue
        identifier = item["scenario_id"]
        if identifier in seen:
            errors.append(f"duplicate priority review for {identifier}")
        seen.add(identifier)
        scenario = scenario_map.get(identifier)
        if not scenario:
            errors.append(f"priority review links unknown scenario {identifier}")
            continue
        if item.get("priority") != scenario.get("priority"):
            errors.append(f"priority review for {identifier} does not match scenario priority")
        if item.get("verdict") != "appropriate" or not nonempty(item.get("reason")):
            errors.append(f"scenario {identifier} lacks an independently reasoned appropriate priority verdict")
    for identifier in scenario_map.keys() - seen:
        errors.append(f"scenario {identifier} has no independent priority review")
    return errors


def white_box_hashes(ledger, scenarios):
    value = {"requirements_sha256": hashlib.sha256((ledger / "requirements.json").read_bytes()).hexdigest(),
             "scenarios_sha256": json_hash([s for s in scenarios if s.get("kind") == "white_box"])}
    if (ledger / white_box_rules.NAME).exists():
        value["white_box_rules_sha256"] = hashlib.sha256((ledger / white_box_rules.NAME).read_bytes()).hexdigest()
    if acceptance_plan.required(ledger):
        value["acceptance_plan_sha256"] = acceptance_plan.file_hash(ledger / acceptance_plan.NAME)
    return value


def white_box_review_errors(ledger, scenarios, review):
    record = review.get("white_box_priority_review")
    if not isinstance(record, dict):
        return ["independent white_box_priority_review is missing"]
    errors = []
    if record.get("status") != "passed" or not nonempty(record.get("basis")):
        errors.append("white-box priority review needs passed status and a concrete basis")
    for field, expected in white_box_hashes(ledger, scenarios).items():
        if record.get(field) != expected:
            errors.append(f"white-box priority review is stale for {field}")
    errors.extend(review_errors(record.get("items"), {s["id"]: s for s in scenarios if s.get("kind") == "white_box" and nonempty(s.get("id"))}))
    return errors


def make_plan(scenarios, selected_policy, created_at, scenario_ids=None, first_scenario_ids=None, order_basis=None):
    selected_policy = policy(selected_policy)
    if scenario_ids is not None:
        known = {s['id'] for s in scenarios}
        if not isinstance(scenario_ids, list) or not scenario_ids or not all(nonempty(s) for s in scenario_ids) or len(set(scenario_ids)) != len(scenario_ids) or set(scenario_ids) - known:
            raise ValueError('selected scenario IDs must be a nonempty, distinct list of known scenarios')
    start = datetime.fromisoformat(created_at)
    if start.tzinfo is None:
        raise ValueError("execution plan created_at needs a timezone")
    limit = selected_policy["time_limit_minutes"]
    queue = [s["id"] for s in ordered(scenarios) if s.get("priority") in PRIORITIES and PRIORITIES.index(s["priority"]) <= PRIORITIES.index(selected_policy["max_priority"])]
    if scenario_ids is not None:
        queue = [sid for sid in queue if sid in scenario_ids]
    if first_scenario_ids is not None:
        if not isinstance(first_scenario_ids, list) or not first_scenario_ids or not all(nonempty(s) for s in first_scenario_ids) or len(set(first_scenario_ids)) != len(first_scenario_ids) or set(first_scenario_ids) - set(queue) or not isinstance(order_basis, dict) or not all(nonempty(order_basis.get(k)) for k in ('source_reference', 'reason')):
            raise ValueError('representative-first ordering needs distinct selected scenarios and actual user request basis; never change grades')
        queue = list(first_scenario_ids) + [sid for sid in queue if sid not in first_scenario_ids]
    result = {"policy": selected_policy, "created_at": created_at,
            "deadline_at": (start + timedelta(minutes=limit)).isoformat() if limit is not None else None,
            "ordered_scenario_ids": queue}
    if first_scenario_ids is not None:
        result.update(first_scenario_ids=list(first_scenario_ids), order_basis=order_basis)
    if scenario_ids is not None:
        result['selected_scenario_ids'] = list(scenario_ids)
    return result


def load_plan(run_dir, run, scenarios, ledger):
    """A separate frozen file prevents dropping plan fields from run.json to downgrade scope."""
    path = run_dir / "execution-plan.json"
    if not path.exists():
        if "execution_plan_sha256" in run or (ledger / "execution-policy.json").exists():
            raise ValueError("execution-plan.json is missing; cannot downgrade a scoped run")
        return None  # Historical records remain readable; new runs always have a plan.
    plan = json.loads(path.read_text())
    if run.get("execution_plan_sha256") != hashlib.sha256(path.read_bytes()).hexdigest():
        raise ValueError("execution plan changed or lost its binding; create a new run")
    expected = make_plan(scenarios, plan.get("policy"), run.get("created_at", ""), run.get('selected_scenario_ids'), run.get('first_scenario_ids'), run.get('order_basis'))
    if 'coverage_policy' in plan:
        if plan['coverage_policy'] != run.get('coverage_policy') or plan['coverage_policy'] not in ({'mode':'off'}, {'mode':'required'}):
            raise ValueError('fixed execution coverage policy changed; cannot downgrade this run')
        expected['coverage_policy'] = plan['coverage_policy']
    if plan.get('execution_schema') == 2:
        expected['execution_schema'] = 2
        if run.get('execution_schema') != 2:
            raise ValueError('cannot downgrade a scenario-loop run')
    if plan != expected:
        raise ValueError("execution plan does not match the pinned scenario order, policy and start time")
    if plan["policy"] != read_policy(ledger):
        raise ValueError("execution policy changed after run creation; create a new run")
    return plan


def next_scenario(plan, results, now=None):
    """Return one permitted next scenario; budget is checked between scenarios, never mid-action."""
    now = now or datetime.now(timezone.utc)
    completed = {r.get("scenario_id") for r in results if r.get("status") in ("passed", "failed", "blocked", "unproven", "execution_error")}
    pending = [identifier for identifier in plan["ordered_scenario_ids"] if identifier not in completed]
    if not pending:
        return {"scenario_id": None, "reason": "selected_scope_complete"}
    if plan["deadline_at"] and now >= datetime.fromisoformat(plan["deadline_at"]):
        return {"scenario_id": None, "reason": "time_limit"}
    return {"scenario_id": pending[0], "reason": "next", "started_at": now.isoformat()}


def execution_errors(plan, scenarios, results):
    errors = []
    scenario_map = {s["id"]: s for s in scenarios}
    queue = plan["ordered_scenario_ids"] if plan else [s["id"] for s in ordered(scenarios)]
    attempted = [r.get("scenario_id") for r in results if r.get("status") != "not_run" and r.get("scenario_id") in scenario_map]
    if attempted != queue[:len(attempted)]:
        errors.append("scenario execution must follow the fixed reviewed queue without skipping its next scenario")
    if plan and plan["policy"]["max_priority"] != "P3":
        errors.append("selected priority scope is partial; it cannot establish full acceptance")
    if plan and 'selected_scenario_ids' in plan and set(queue) != set(scenario_map):
        errors.append('selected scenario scope is partial; it cannot establish full acceptance')
    if plan and plan["deadline_at"]:
        previous = datetime.fromisoformat(plan["created_at"])
        deadline = datetime.fromisoformat(plan["deadline_at"])
        for result in results:
            if result.get("status") == "not_run":
                continue
            try:
                started = datetime.fromisoformat(result.get("started_at", ""))
                if started.tzinfo is None or started < previous or started >= deadline:
                    raise ValueError("outside the permitted execution window or out of order")
                previous = started
            except (ValueError, TypeError):
                errors.append(f"scenario {result.get('scenario_id')} needs an ordered started_at before the execution deadline")
    for result in results:
        identifier = result.get("scenario_id")
        if result.get("status") != "not_run" or identifier not in scenario_map:
            continue
        reason = result.get("not_run_reason")
        if result.get("evidence") != [] or result.get("actual") not in (None, ""):
            errors.append(f"scenario {identifier} not_run must have empty evidence and no actual observations")
        if not nonempty(result.get("reason")) or reason not in ("outside_priority_scope", "outside_scenario_scope", "time_limit", "stopped"):
            errors.append(f"scenario {identifier} not_run needs a valid not_run_reason and explanation")
        if reason == "outside_priority_scope" and (not plan or identifier in queue):
            errors.append(f"scenario {identifier} is selected and cannot be marked outside_priority_scope")
        if reason == 'outside_scenario_scope' and (not plan or 'selected_scenario_ids' not in plan or identifier in plan['selected_scenario_ids']):
            errors.append(f'scenario {identifier} is not outside the explicit scenario selection')
        if reason == "time_limit" and (not plan or not plan["deadline_at"]):
            errors.append(f"scenario {identifier} has no configured time limit")
        if reason == "time_limit" and plan and plan["deadline_at"] and datetime.now(timezone.utc) < datetime.fromisoformat(plan["deadline_at"]):
            errors.append(f"scenario {identifier} time limit has not expired")
    return errors


def summary(scenarios, results, reviews, *, run=None, review_record=None, evidence_root=None, binding_current=False):
    run, review_record = run or {}, review_record or {}
    by_result = {r.get("scenario_id"): r for r in results}
    by_review = {r.get("scenario_id"): r for r in reviews}
    grouped = {p: {"total": 0, "passed": 0, "reviewed": 0, "failed": 0, "blocked": 0, "unproven": 0, "not_run": 0, "execution_error": 0} for p in (*PRIORITIES, "unclassified")}
    risks = []
    for scenario in ordered(scenarios):
        identifier = scenario["id"]
        priority = scenario.get("priority") if scenario.get("priority") in PRIORITIES else "unclassified"
        result, review = by_result.get(identifier, {}), by_review.get(identifier, {})
        status = result.get("status", "not_run")
        unique_result = sum(r.get("scenario_id") == identifier for r in results) == 1
        unique_review = sum(r.get("scenario_id") == identifier for r in reviews) == 1
        if result and (not unique_result or status not in ("passed", "failed", "blocked", "unproven", "not_run", "execution_error")):
            status = "unproven"
        counts = grouped[priority]
        counts["total"] += 1
        if status in counts:
            counts[status] += 1
        evidence, cited = result.get("evidence"), review.get("evidence")
        evidence_valid = isinstance(evidence, list) and bool(evidence) and all(nonempty(v) for v in evidence)
        if evidence_valid and evidence_root is not None:
            root = evidence_root.resolve()
            evidence_valid = all((root / v).resolve().is_relative_to(root) and (root / v).is_file() and (root / v).stat().st_size > 0 for v in evidence)
        reviewed = (binding_current and unique_result and unique_review and not classification_errors(identifier, scenario)
                    and status == "passed" and review.get("status") == "passed" and nonempty(review.get("reason"))
                    and nonempty(result.get("actual")) and evidence_valid
                    and isinstance(cited, list) and bool(cited) and all(v in evidence for v in cited)
                    and nonempty(run.get("revision")) and review_record.get("revision") == run["revision"]
                    and review_record.get("reviewer_kind") in ("playbook", "independent_ai") and nonempty(review_record.get("review_reference")))
        if reviewed:
            counts["reviewed"] += 1
        else:
            risks.append({"scenario_id": identifier, "priority": priority, "title": scenario.get("title"),
                          "status": status, "review_status": "unproven" if review.get("status") == "passed" else review.get("status", "unreviewed"),
                          "risk": scenario.get("priority_reason", "未分级，需补充分级理由"),
                          "reason": result.get("reason") or result.get("actual") or "未执行"})
    return {"by_priority": grouped, "remaining_risks": risks,
            "p0_risk_unresolved": any(r["priority"] == "P0" for r in risks)}
