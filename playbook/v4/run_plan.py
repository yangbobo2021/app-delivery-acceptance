#!/usr/bin/env python3
"""Project-neutral sequential host for frozen v4 scenario and case jobs."""
import hashlib
import fcntl
import json
from pathlib import Path
import re
import subprocess
import sys

# Shared project-owned storage and knowledge gate.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from acceptance_store import guard as acceptance_guard


HERE = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def write_once(path, value):
    path = Path(path)
    payload = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    if path.exists():
        if path.read_text() != payload:
            raise ValueError("frozen handoff changed: " + str(path))
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(payload)


def slug(value):
    label = re.sub(r"[^A-Za-z0-9_-]+", "-", str(value)).strip("-")
    return (label[:50] or "target") + "-" + hashlib.sha256(str(value).encode()).hexdigest()[:8]


def launch(argv, log):
    result = subprocess.run(argv, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, check=False)
    Path(log).parent.mkdir(parents=True, exist_ok=True)
    Path(log).write_text(result.stdout)
    if result.returncode:
        raise RuntimeError(f"job failed ({result.returncode}): {argv[1]}: {result.stdout[-1200:]}")


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: run_plan.py plan.json")
    plan_path = Path(sys.argv[1]).resolve()
    plan = read(plan_path)
    if plan.get("schema") != "acceptance-v4-plan-v1" or not plan.get("scenario_requests"):
        raise ValueError("invalid v4 plan")
    acceptance_guard(plan, [plan["run_dir"]])
    if any(plan.get("acceptance", {}).get(k) != plan["case_template"].get("acceptance", {}).get(k)
           for k in ("project_root", "id", "scope_sha256")):
        raise ValueError("plan and case template acceptance differ")
    run_dir = Path(plan["run_dir"]).resolve()
    run_dir.mkdir(parents=True, exist_ok=True)
    lock = (run_dir / "plan.lock").open("a+")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as exc:
        raise RuntimeError("acceptance plan already running") from exc
    bindings = {"plan_sha256": sha(plan_path),
                "request_sha256": {str(Path(p).resolve()): sha(p) for p in plan["scenario_requests"]},
                "catalog_sha256": sha(plan["case_template"]["template_catalog"]),
                "guide_sha256": sha(plan["case_template"]["guide"])}
    write_once(run_dir / "plan.binding.json", bindings)
    summary = []
    for index, request_path in enumerate(plan["scenario_requests"]):
        acceptance_guard(plan, [run_dir])
        request = read(request_path)
        if any(request.get("acceptance", {}).get(k) != plan["acceptance"].get(k)
               for k in ("project_root", "id", "scope_sha256")):
            raise ValueError("scenario request belongs to another acceptance or scope")
        key = f"{index:03d}-{slug(request['target_requirement_id'])}"
        scenario_dir = run_dir / "scenarios" / key
        scenario_command = ["node", str(HERE / "run_scenarios.mjs"),
                            str(Path(request_path).resolve()), str(scenario_dir)]
        if scenario_dir.exists():
            scenario_command.append("--resume")
        launch(scenario_command, run_dir / "logs" / (key + "-scenario.log"))
        scenes = read(scenario_dir / "scenarios.current.json")["scenarios"]
        requested = plan.get("selected_scene_ids", {}).get(request["target_requirement_id"])
        if requested is not None:
            missing = set(requested) - {scene["id"] for scene in scenes}
            if missing:
                raise ValueError("selected scenes absent from new list: " + repr(sorted(missing)))
            scenes = [scene for scene in scenes if scene["id"] in requested]
        for scene in scenes:
            scene_key = f"{key}-{slug(scene['id'])}"
            template = {**plan["case_template"],
                        "scenario_run_path": str(scenario_dir), "scene_id": scene["id"],
                        "case_run_dir": str(run_dir / "cases" / scene_key)}
            template_path = run_dir / "templates" / (scene_key + ".json")
            write_once(template_path, template)
            handoff = run_dir / "handoffs" / scene_key
            if not handoff.exists():
                launch([sys.executable, str(HERE / "bind_case.py"), str(template_path), str(handoff)],
                       run_dir / "logs" / (scene_key + "-bind.log"))
            terminal = read(handoff / "terminal.json")
            if terminal.get("template_sha256") != sha(template_path) or \
                    terminal.get("scenario_sha256") != sha(scenario_dir / "scenarios.current.json") or \
                    terminal.get("case_input_sha256") != sha(handoff / "case-input.json") or \
                    terminal.get("config_sha256") != sha(handoff / "config.json"):
                raise ValueError("case handoff changed: " + scene["id"])
            launch([sys.executable, str(HERE / "scene_pipeline.py"), str(handoff / "config.json")],
                   run_dir / "logs" / (scene_key + "-case.log"))
            result = read(template["case_run_dir"] + "/summary.json")
            summary.append({"target_id": request["target_requirement_id"], "scene_id": scene["id"],
                            "status": result["review_status"], "summary_path": str(Path(template["case_run_dir"]) / "summary.json")})
            write_once(run_dir / "results" / (scene_key + ".json"), summary[-1])
    result = {"schema": "acceptance-v4-plan-result-v1", "scenes": summary,
              "status": "completed" if summary and all(x["status"] in ("passed", "product_bug", "needs_scope_or_contract", "inconclusive") for x in summary) else "incomplete",
              "scope": "selected scenes only" if plan.get("selected_scene_ids") else "all generated scenes for listed targets"}
    write_once(run_dir / "result.json", result)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"status": "parked", "reason": str(exc)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(2)
