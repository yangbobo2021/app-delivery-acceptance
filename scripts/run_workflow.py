#!/usr/bin/env python3
"""Run a precompiled scenario-design or delivery-acceptance Playbook."""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from storage import asset_directory, test_directory
import execution_coverage
from code_coverage import MODES
import priorities
import acceptance_plan
import design_pipeline

if os.name == "posix":
    import fcntl


SKILL_ROOT = Path(__file__).resolve().parents[1]
ENTRIES = {
    "white-box": ("black-box-scenarios", SKILL_ROOT / "playbook" / "black-box-scenarios.ts"),
    "black-box": ("black-box-scenarios", SKILL_ROOT / "playbook" / "black-box-scenarios.ts"),
    "acceptance": ("delivery-acceptance", SKILL_ROOT / "playbook" / "delivery-acceptance.ts"),
}
PLAYBOOK_VERSION = "16.0.0"
LANGUAGE_POLICY_NAME = "output-language-policy.json"
def language_guidance(language=None):
    selected = language.strip() if isinstance(language, str) and language.strip() else None
    if selected:
        prefix = f"用户明确指定输出语言为 {selected}；所有业务可读文本必须使用该语言。"
    else:
        prefix = "用户未指定输出语言；每个场景、用例和审查记录必须继承其关联需求条目的主要语言，不得自行切换语言。"
    return (
        prefix + "请将此语言策略传递给全部工作流角色，并在结构校验失败时修正后再提交。"
    "JSON 字段名、枚举、稳定 ID、路径、技术标识及应用消息原文保持不变；"
    "已确认的需求快照保留原文，不因输出语言偏好翻译或重写业务需求。"
    )
SCOPE_GUIDANCE = (
    "读取references/acceptance-organization.md和完整requirements.json；即使只验收一条也须保留全部需求作为全局背景。"
    "原始需求原文/ID不变。先完成原始需求和白盒逆向规则分析，complete-analysis封存源清单；再生成全部验收组织及逐行为/条件/不变量映射，独立审查并publish-plan；最后用design-next/start-unit/complete-unit逐个组织生成场景，check-generation通过才能进入场景审查和执行。"
    "acceptance-plan.json及scope-decisions.json是统一范围依据；恢复先核对内容版本及最新人类决定，不得重放旧范围。"
    "每场景scope逐判据说明direct/necessary_related/affected_regression纳入依据；合同成立不等于本轮适用。"
    "范围外建议和未确认候选另存，不进入scenarios.json、资源门禁或执行队列；严禁换名/ID重新加入已排除功能。"
    "全部工作流角色读取references/scenario-priority.md并共用同一标准，启动、设计修正和恢复均适用。"
    "基于全部原始需求、正式整体目标及跨组织核心链路统一分级；P0集合共同覆盖本轮核心业务闭环和重大风险。"
    "核心关键步骤或结果无法完成即可用critical_consequence=core_blocked，并用materiality_basis说明整体目标的必要性；不额外要求不可逆、大规模或重大资金损失。"
    "risk写具体因果链、影响主体、真实保护及替代路径；失败后修代码、部署、回滚、人工修数据或改变有效配置是补救，不能据此自动降为P1。"
    "只有实现中已可用、受影响主体可访问、保持业务结果及不变量且代价可接受的替代路径，才可作为降级依据，必须写实际路径与可核验理由。"
    "Reviewer从同一全部需求和整体目标独立复核P0的核心闭环/重大风险覆盖及替代路径，逐场景核查，拒绝模板化恢复理由；保存acceptance_scope_review及跨单元校准。不要求每需求一个P0，不按固定比例或数量凑任何等级。"
    "新范围或整体规则变化只重审受影响部分；未变记录必须保留原始审查出处和依赖哈希，禁止换哈希冒充复审。"
    "新计划只经publish-plan比较版本发布；角色不得覆盖正式范围。运行中变更范围先停止工作并abort-run，保留证据后新轮执行。"
)
OUTPUT_QUALITY_GUIDANCE = (
    SCOPE_GUIDANCE +
    "白盒设计和审查读取references/white-box-rules.md：源分析阶段已有需求用requirement_ids；缺少且有独立约束的规则先另存white_box_rules.json，全部组织审查前完成适用性判断；场景阶段只引用组织已准入的reverse_rule_ids，禁止边生成场景边新增规则；代码不能自证正确，待确认规则只设计不执行或判BUG。白盒根design_standard/design_basis及coverage_items/check_points与黑盒相同；独立设计审查design_reviews使用同样coverage_results/scenario_coverage/covered_point_ids、五项criteria_checks、findings、scope、limitations。rule_reviews仅核查来源和确认，不另写check_items/coverage_checks。候选范围充分不等于业务确认，确认后更新判据边界并复审。独立审查绑定全部规则哈希，冻结规则快照。"
    "场景必须内嵌唯一acceptance对象(description/preconditions/actions/criteria/evidence_expected)，不生成methods.json、method_ids或独立方法ID；检查项及审查贡献仅关联scenario_id。执行观察通过scenario_id绑定冻结的完整场景，不另填方法ID。故障探针仅内部审查材料，视图不得展示或计数；发现遗漏须落实为检查项和场景验收说明。"
    "Analyst与Reviewer都必须读取references/design-quality.md，按design-quality-v4共同标准生成及审查。"
    "scenarios.json保存design_standard和逐需求design_basis（范围/技术理由/具体覆盖项及场景方法关联/限制）；"
    "coverage_review.json保存相同design_standard及逐需求coverage_results、五项criteria_checks、findings、scope、limitations。"
    "审查主表按需求检查项展示合计覆盖、尚缺及重复范围，识别依据用白话，场景列显示可点击完整标题。第一列将condition标为检查操作、expected标为预期结果；说明准备状态、主体、对象、操作与可观察判据，不能依赖A2/δ等方法内简称或独立初态等术语；简化不遗漏条件及记录保持要求。coverage_items必须含identification_basis和check_points(id/text)；coverage_results含scenario_coverage(scenario_id/covered_point_ids/reason)，status按检查点并集为covered/partial/gap，不能按场景数量推断。Reviewer独立挑战遗漏；coverage_gap必须有需求依据、漏出错误、现有方法为何漏过和补充后可见差异；"
    "requirement_clarification与非阻断suggestion分开；等效合并/拆分设计均认可，不增加审查者独有条件。"
    "全部角色必须读取已安装 Skill 的 references/output-standards.md，按对应产物标准撰写与独立审查。"
    "新设计使用分项 acceptance 方法；场景写清条件、可见结果和风险。设计审查必须保存逐类 output_quality，"
    "包括审查scenarios及acceptance的完整场景record_ids 和具体理由；白盒审查同样记录。"
    "可读性是交付要求，状态重复、占位摘要、技术长文和只有退出码/检查数量的结论不能代替业务事实。"
    "全部新写入记录必须满足标准；缺失结构或内容不准确/难懂要在原设计或当前场景修正，不登记为产品BUG。"
)
EXECUTION_RECORD_GUIDANCE = (
    "执行准备与取证时读取已安装 Skill 的 references/scenario-execution.md 中 Readable execution records。"
    "新绑定为每个用例/人工任务写四部分procedure和case_design检查点对应，不复制场景operation_plan；保留准备与输入引用和evidence_details。"
    "本轮coverage_policy=required时，prepared绑定coverage_collection逐项目能力/范围/工具或无法采集原因及尝试证据；实际执行采集，observe纳入原始JSON，保存execution_coverage.py收据；独立assessment.execution_coverage逐项目核实。遗漏必须同场景修正，无法采集原因在覆盖关系展示。"
    "执行者按 Readable execution observations 保存短 summary 和 step_results（step、actual、evidence，"
    "可选 action），逐项记录真实观察，证据引用来自同一观察记录；保留 actual 原始结果。"
    "独立 Reviewer 按同一参考中的 Readable independent assessments 写短 summary 和结构化 assessment："
    "scope、checks（criterion/expected/actual/status/evidence）、basis、limitations；每项判据对照实际证据，"
    "并读取references/independent-assessment.md：execution_audit核查场景一致性、实际用例/操作实现、真实执行和证据充分性；"
    "测试自身有问题必须修正。最终passed/failed还要explanation，写业务结论、原始需求依据、实际前置和操作、"
    "逐判据对照、带精确locator和supports的决定性证据、推理及边界，用户能据此理解为什么通过或BUG。"
    "保留 reason、身份、证据引用和结果哈希。将此记录要求传递给独立 Reviewer。"
    "prepared/observe/evaluate均强制检查上述结构；evidence_details必须覆盖每份证据。"
    "Reviewer的assessment必须包含output_quality，分别检查operation_plan/execution/evidence并写具体理由；"
    "内容问题用repair_required修正同场景。最终review.json还需summary、scope、recommendations和全产物output_quality。"
    "不得自动拆句、猜测补写或把准备方案当作执行结果。"
)


def playbook_package() -> Path:
    executable = shutil.which("playbook")
    if executable:
        resolved = Path(executable).resolve()
        for directory in (resolved.parent, *resolved.parents):
            manifest = directory / "package.json"
            if manifest.is_file():
                try:
                    package = json.loads(manifest.read_text(encoding="utf-8"))
                except (OSError, UnicodeError, json.JSONDecodeError):
                    continue
                if package.get("name") == "@sublang/playbook":
                    return directory
    npm = shutil.which("npm")
    if npm:
        root = subprocess.run([npm, "root", "-g"], capture_output=True, text=True, check=False)
        if root.returncode == 0:
            candidate = Path(root.stdout.strip()) / "@sublang" / "playbook"
            if candidate.is_dir():
                return candidate
    raise ValueError("cannot locate the installed @sublang/playbook package used by the playbook CLI")


def ensure_runtime_modules() -> None:
    """Resolve module imports inside the shared Skill without shipping host paths."""
    package_root = playbook_package()
    package = json.loads((package_root / "package.json").read_text(encoding="utf-8"))
    if package.get("version") != PLAYBOOK_VERSION:
        raise ValueError(f"this Skill needs @sublang/playbook {PLAYBOOK_VERSION}; found {package.get('version')}")
    xstate = package_root / "node_modules" / "xstate"
    if not (xstate / "package.json").is_file():
        raise ValueError(f"xstate is missing from the Playbook runtime at {package_root}")
    modules = SKILL_ROOT / "playbook" / "node_modules"
    targets = {modules / "@sublang" / "playbook": package_root, modules / "xstate": xstate}
    for link, target in targets.items():
        if link.resolve() == target.resolve() and link.is_dir():
            continue
        link.parent.mkdir(parents=True, exist_ok=True)
        if link.is_symlink():
            link.unlink()
        elif link.exists():
            raise ValueError(f"incompatible bundled module at {link}; remove it before running this Skill")
        try:
            link.symlink_to(target, target_is_directory=True)
        except OSError as error:
            try:
                shutil.copytree(target, link)
            except OSError as copy_error:
                raise ValueError(f"cannot bind Playbook runtime in the installed Skill at {link}: {error}; copy failed: {copy_error}") from copy_error


def terminal_failure_response(session_id: str, playbook_id: str = "delivery-acceptance") -> str | None:
    """Read the pinned Playbook 16 terminal output when Captain summarizes it vaguely."""
    path = session_directory() / f"{session_id}.records.jsonl"
    if not path.is_file():
        return None
    latest_turn = None
    terminal_by_turn = {}
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            record = json.loads(line).get("record", {})
            turn = record.get("turnId")
            if record.get("type") == "captain_reply":
                latest_turn = turn
            if record.get("type") != "captain_telemetry" or record.get("topic") != "playbook.trace":
                continue
            trace = record.get("payload") or {}
            if trace.get("playbookId") != playbook_id or trace.get("type") != "boss.input.settled":
                continue
            settled = trace.get("payload") or {}
            response = (settled.get("output") or {}).get("response")
            if (settled.get("terminal") or {}).get("kind") == "failure" and isinstance(response, str) and response.strip():
                terminal_by_turn[turn] = response
    except (OSError, UnicodeError, json.JSONDecodeError, AttributeError):
        return None
    return terminal_by_turn.get(latest_turn)


def session_directory() -> Path:
    configured = os.environ.get("DELIVERY_ACCEPTANCE_SESSIONS_DIR")
    spex_home = Path(os.environ.get("SPEX_HOME") or Path.home() / ".spex")
    return Path(configured) if configured else spex_home / "sessions"


def started_session(prompt: str, previous: set[str]) -> str | None:
    """Identify this launch if Playbook 16 omits its promised terminal JSON."""
    for path in session_directory().glob("*.records.jsonl"):
        if path.name in previous:
            continue
        try:
            with path.open(encoding="utf-8") as records:
                for line in records:
                    record = json.loads(line).get("record", {})
                    if record.get("type") == "turn_started":
                        if (record.get("turn") or {}).get("prompt") == prompt:
                            return path.name.removesuffix(".records.jsonl")
                        break
        except (OSError, UnicodeError, json.JSONDecodeError):
            continue
    return None


def recorded_reply(session_id: str) -> str | None:
    path = session_directory() / f"{session_id}.records.jsonl"
    replies = []
    try:
        with path.open(encoding="utf-8") as records:
            for line in records:
                record = json.loads(line).get("record", {})
                if record.get("type") == "captain_reply":
                    replies.append(record.get("text"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    return replies[-1] if replies and isinstance(replies[-1], str) and replies[-1].strip() else None


def prepare_storage(project: Path, selected: Path) -> None:
    """Ignore only generated assets; leave existing project tests trackable."""
    assets = asset_directory(project, selected)
    metadata = assets / "project.json"
    if metadata.is_file():
        bound = json.loads(metadata.read_text(encoding="utf-8")).get("project_root")
        if bound and Path(bound).resolve() != project:
            raise ValueError(f"test assets belong to a different project: {bound}")
    repository = subprocess.run(["git", "-C", str(project), "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True)
    root = Path(repository.stdout.strip()).resolve()
    if not assets.is_relative_to(root):
        return
    relative = assets.relative_to(root).as_posix()
    tracked = subprocess.run(["git", "-C", str(root), "ls-files", "--", ":(literal)" + relative], capture_output=True, text=True, check=True)
    if tracked.stdout.strip():
        raise ValueError(f"generated test assets are tracked at {assets}; choose another test directory for this run")
    ignored = subprocess.run(["git", "-C", str(root), "check-ignore", "-q", "--no-index", str(assets / "__playbook_preflight__")], check=False)
    if ignored.returncode == 0:
        return
    exclude_result = subprocess.run(["git", "-C", str(project), "rev-parse", "--git-path", "info/exclude"], capture_output=True, text=True, check=True)
    exclude = Path(exclude_result.stdout.strip())
    if not exclude.is_absolute():
        exclude = project / exclude
    exclude.parent.mkdir(parents=True, exist_ok=True)
    pattern = "/" + "".join("\\" + char if char in "\\*?[" else char for char in relative) + "/"
    existing = exclude.read_text(encoding="utf-8") if exclude.exists() else ""
    with exclude.open("a", encoding="utf-8") as output:
        output.write(("\n" if existing and not existing.endswith("\n") else "") + pattern + "\n")
    verified = subprocess.run(["git", "-C", str(root), "check-ignore", "-q", "--no-index", str(assets / "__playbook_preflight__")], check=False)
    if verified.returncode != 0:
        raise ValueError(f"cannot Git-ignore generated assets at {assets}; configure this subdirectory's ignore rule before launch")


def session_bindings(project: Path, selected: Path) -> dict:
    path = asset_directory(project, selected) / "workflow-sessions.json"
    bindings = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    if not isinstance(bindings, dict):
        raise ValueError(f"invalid workflow session bindings at {path}")
    return bindings


def stream_playbook(command: list[str], project: Path, env: dict[str, str], session_id: str | None = None, playbook_id: str = "delivery-acceptance", test_dir: Path | None = None, coverage_mode: str = "standard", requirements_file: Path | None = None, execution_policy: dict | None = None, execution_coverage_mode: str = "required", language: str | None = None, workspace: Path | None = None) -> int:
    original_input_hash = acceptance_plan.file_hash(requirements_file) if requirements_file else None
    previous = {path.name for path in session_directory().glob("*.records.jsonl")}
    final = None
    identified_id = session_id
    with subprocess.Popen(command, cwd=workspace or project, env=env, stdout=subprocess.PIPE, text=True, bufsize=1) as process:
        assert process.stdout is not None
        for line in process.stdout:
            try:
                parsed = json.loads(line)
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, dict) and isinstance(parsed.get("sessionId"), str) and isinstance(parsed.get("reply"), str):
                final = parsed
                identified_id = parsed["sessionId"]
            else:
                print(line, end="", flush=True)
        code = process.wait()
    if final is None:
        recovered_id = session_id or started_session(command[-1], previous)
        if recovered_id:
            identified_id = recovered_id
            reply = terminal_failure_response(recovered_id, playbook_id) or recorded_reply(recovered_id)
            if reply:
                final = {"sessionId": recovered_id, "reply": reply}
    if identified_id and test_dir is not None:
        assets = asset_directory(project, test_dir)
        bindings = session_bindings(project, test_dir)
        bindings[identified_id] = {"project": str(project), "test_dir": str(test_dir), "playbook": playbook_id, "coverage_mode": coverage_mode, "execution_coverage": execution_coverage_mode, "language": language, "requirements_file": str(requirements_file) if requirements_file else None, "execution_policy": execution_policy or dict(priorities.DEFAULT_POLICY), "scope_contract": acceptance_plan.STANDARD, "scope_binding": acceptance_plan.binding(assets), "requirements_input_sha256": original_input_hash}
        assets.mkdir(parents=True, exist_ok=True)
        (assets / "workflow-sessions.json").write_text(json.dumps(bindings, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if final is not None:
        exact = terminal_failure_response(final["sessionId"], playbook_id)
        if exact is not None:
            final["reply"] = exact
        if test_dir is not None:
            assets = asset_directory(project, test_dir)
            final.update({"testDir": str(test_dir), "assets": str(assets)})
        print(json.dumps(final, ensure_ascii=False), flush=True)
    elif code == 0:
        print("Playbook completed without a recoverable session reply", file=sys.stderr)
        return 2
    return code


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path, help="target application project")
    parser.add_argument("--test-dir", type=Path, required=True, help="user-selected test directory; ask the user first, suggesting <project>/tests")
    parser.add_argument("--requirements", type=Path, help="confirmed requirements JSON")
    parser.add_argument("--session", help="resume a Playbook session ID")
    parser.add_argument("--reply", help="answer or follow-up when resuming a session")
    parser.add_argument("--stage", choices=ENTRIES, default="acceptance", help="black-box/white-box scenario design or full acceptance")
    parser.add_argument("--coverage-mode", choices=MODES, default=None, help="standard (default) or opt-in coverage enhancement; resumes inherit the saved mode")
    parser.add_argument("--execution-coverage", choices=execution_coverage.POLICIES, help="live code coverage policy; acceptance defaults to required and explicit off disables it")
    parser.add_argument("--language", help="explicit output language; omitted means inherit each linked requirement item's language")
    parser.add_argument("--max-priority", choices=priorities.PRIORITIES, help="test P0 through this grade; default P3 (full scope); resumes inherit the saved scope")
    parser.add_argument("--time-limit-minutes", type=float, help="positive execution time limit per run; checked between scenarios; resumes inherit it")
    args = parser.parse_args()
    try:
        execution_policy = priorities.policy({"max_priority": args.max_priority or "P3", "time_limit_minutes": args.time_limit_minutes})
    except ValueError as error:
        parser.error(str(error))
    if args.stage in ("black-box","white-box") and (args.max_priority is not None or args.time_limit_minutes is not None):
        parser.error("execution priority scope and time limit apply only to acceptance; design always covers all requirements")
    live_coverage = args.execution_coverage or ("required" if args.stage == "acceptance" else "off")
    language = args.language
    if args.stage in ("black-box","white-box") and args.execution_coverage is not None:
        parser.error("execution coverage applies only to acceptance")
    mode = args.coverage_mode or "standard"
    if args.stage in ("black-box","white-box") and mode == "coverage":
        parser.error("--coverage-mode coverage applies only to --stage acceptance")

    project = args.project.resolve()
    try:
        selected = test_directory(project, args.test_dir)
    except ValueError as error:
        parser.error(str(error))
    playbook_id, entry = ENTRIES[args.stage]
    if not project.is_dir():
        parser.error(f"project does not exist: {project}")
    if not entry.is_file():
        parser.error(f"compiled workflow is missing: {entry}")
    if not shutil.which("playbook"):
        parser.error("Playbook runtime is not installed (install @sublang/playbook and the Codex SDK)")
    if not shutil.which("git"):
        parser.error("Git is required to identify the target revision and preflight the ledger")
    if not args.session and not args.requirements:
        parser.error("--requirements is required for a new session")
    if args.reply and not args.session:
        parser.error("--reply requires --session")

    requirements = args.requirements.resolve() if args.requirements else None
    if requirements and not requirements.is_file():
        parser.error(f"requirements file does not exist: {requirements}")
    if requirements and not args.session:
        try:
            supplied = json.loads(requirements.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            parser.error(f"requirements file is not valid UTF-8 JSON: {error}")
        if not isinstance(supplied, dict) or not isinstance(supplied.get("source"), str) or not supplied["source"].strip() or not isinstance(supplied.get("version"), str) or not supplied["version"].strip():
            parser.error("confirmed requirements need nonempty source and version")
        rows = supplied.get("items")
        if not isinstance(rows, list) or not rows:
            parser.error("confirmed requirements list is empty; provide at least one approved requirement with a stable ID")
        seen = set()
        for index, row in enumerate(rows):
            if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not row["id"].strip() or not isinstance(row.get("text"), str) or not row["text"].strip():
                parser.error(f"requirement[{index}] needs a nonempty stable ID and text")
            if row["id"] in seen:
                parser.error(f"duplicate requirement ID: {row['id']}")
            seen.add(row["id"])
    if os.environ.get("DELIVERY_ACCEPTANCE_ACTIVE"):
        parser.error("an acceptance Playbook is already active; use its checker, not this session launcher")
    if args.session:
        try:
            binding = session_bindings(project, selected).get(args.session)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            parser.error(f"cannot read the test-directory session binding: {error}")
        expected = {"project": str(project), "test_dir": str(selected), "playbook": playbook_id}
        if not isinstance(binding, dict) or any(binding.get(k) != v for k, v in expected.items()):
            parser.error("resume with the same --test-dir, project and --stage used to start this session; no matching session binding exists here")
        saved_mode = binding.get("coverage_mode", "standard")
        if saved_mode not in MODES or (args.coverage_mode is not None and args.coverage_mode != saved_mode):
            parser.error("resume with the same --coverage-mode; mode cannot change within a session")
        mode = saved_mode
        saved_live = binding.get("execution_coverage", "required")
        if saved_live not in execution_coverage.POLICIES or args.execution_coverage is not None and args.execution_coverage != saved_live:
            parser.error("execution coverage policy cannot change within a session")
        live_coverage = saved_live
        saved_language = binding.get("language")
        if saved_language and args.language and args.language != saved_language:
            parser.error("output language cannot change within a session")
        language = saved_language or args.language
        language_path = asset_directory(project, selected) / LANGUAGE_POLICY_NAME
        expected_language_policy = {"mode": "explicit", "language": language} if language else {"mode": "requirement"}
        if args.stage in ("black-box", "white-box", "acceptance") and (not language_path.exists() or json.loads(language_path.read_text(encoding="utf-8")) != expected_language_policy):
            parser.error("saved output language policy missing or changed")
        live_path = asset_directory(project, selected) / execution_coverage.POLICY_NAME
        if args.stage == "acceptance" and "execution_coverage" in binding and (not live_path.exists() or execution_coverage.policy(live_path.parent)["mode"] != saved_live):
            parser.error("saved execution coverage policy missing or changed")
        try:
            saved_policy = priorities.policy(binding.get("execution_policy", dict(priorities.DEFAULT_POLICY)))
        except ValueError as error:
            parser.error(str(error))
        if (args.max_priority is not None and args.max_priority != saved_policy["max_priority"]) or (args.time_limit_minutes is not None and args.time_limit_minutes != saved_policy["time_limit_minutes"]):
            parser.error("execution priority scope and time limit cannot change within a session")
        execution_policy = saved_policy
        policy_path = asset_directory(project, selected) / "execution-policy.json"
        if args.stage == "acceptance" and policy_path.exists():
            try:
                if priorities.read_policy(policy_path.parent) != saved_policy:
                    parser.error("saved execution policy changed; resume with the original assets and policy")
            except (ValueError, OSError) as error:
                parser.error(str(error))

        assets = asset_directory(project, selected)
        if binding.get('scope_contract') != acceptance_plan.STANDARD:
            parser.error('session does not use the current design pipeline; start a new analyzed and organized session')
        if binding.get('scope_binding') != acceptance_plan.binding(assets):
            parser.error('confirmed scope or original content changed since this session; do not replay old instructions; start a reviewed new session/run')
        if (assets / design_pipeline.ANALYSIS).exists():
            analysis_issues = design_pipeline.analysis_errors(assets) + design_pipeline.current_code_errors(project, acceptance_plan.load(assets / design_pipeline.ANALYSIS))
            if analysis_issues:
                parser.error('analyzed sources changed; do not resume old scope: ' + '; '.join(analysis_issues))
        if (assets / acceptance_plan.NAME).exists():
            try:
                acceptance_plan.assert_current(assets, expected=binding['scope_binding'])
            except ValueError as error:
                parser.error(str(error))
        saved_requirements = binding.get("requirements_file")
        if saved_requirements:
            if requirements and str(requirements) != saved_requirements:
                parser.error("resume with the same requirements file")
            requirements = Path(saved_requirements)
            if not requirements.is_file():
                parser.error("saved requirements file is missing")
            if binding.get("requirements_input_sha256") != acceptance_plan.file_hash(requirements):
                parser.error("original requirements content changed at the same path; start a new reviewed session")
        if args.stage == "acceptance" and not requirements:
            parser.error("legacy session needs its original --requirements to restore runtime options")


    repository = subprocess.run(
        ["git", "-C", str(project), "rev-parse", "--show-toplevel"],
        capture_output=True, text=True, check=False,
    )
    if repository.returncode != 0:
        parser.error("Playbook 16 requires the target project to be a Git repository")
    try:
        prepare_storage(project, selected)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.error(str(error))

    writable_assets = asset_directory(project, selected)
    # Place both the Git project and selected assets inside Playbook's workspace.
    # Codex grants must be relative to that workspace, including when testDir
    # is outside the Git repository.
    workspace = Path(os.path.commonpath((str(project), str(writable_assets)))).resolve()
    writable_path = writable_assets.relative_to(workspace).as_posix()
    codex_agent = {"adapter": "codex", "permissions": {"mode": "auto", "writablePaths": [writable_path]}}
    role_agents = {"analyst": "acceptance.analyst", "reviewer": "acceptance.reviewer"}
    player_agents = {"acceptance.analyst": codex_agent, "acceptance.reviewer": codex_agent}
    if args.stage == "acceptance":
        role_agents["tester"] = "acceptance.tester"
        player_agents["acceptance.tester"] = codex_agent
    playbook_config = {"from": str(entry), "roles": role_agents}
    if args.stage == "acceptance" and requirements:
        playbook_config.update({
            "project": str(project), "requirementsFile": str(requirements), "skill": str(SKILL_ROOT), "testDir": str(selected), "coverageMode": mode,
        })
    overlay = {
        "captain": codex_agent,
        "players": player_agents,
        "playbooks": {playbook_id: playbook_config},
    }
    lock_name = hashlib.sha256(str(project).encode()).hexdigest()[:24]
    lock_path = Path(tempfile.gettempdir()) / f"delivery-acceptance-{lock_name}.lock"
    with lock_path.open("a+") as lock:
        if os.name == "posix":
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                parser.error("an acceptance Playbook is already running for this project")
        if args.stage == "acceptance":
            policy_path = asset_directory(project, selected) / "execution-policy.json"
            policy_path.parent.mkdir(parents=True, exist_ok=True)
            if args.session and "execution_policy" in binding and not policy_path.exists():
                parser.error("saved execution-policy.json is missing; do not recreate a changed session scope")
            policy_path.write_text(json.dumps(execution_policy, ensure_ascii=False, indent=2) + "\n")
            (policy_path.parent / execution_coverage.POLICY_NAME).write_text(json.dumps({"mode": live_coverage}) + "\n")
        # A selected test directory may be new on the first run. Establish the
        # generated ledger directory before writing the fixed session policies.
        asset_directory(project, selected).mkdir(parents=True, exist_ok=True)
        scope_assets = asset_directory(project, selected)
        if not args.session:
            (scope_assets / "design-stage-policy.json").write_text(json.dumps({"stage":args.stage}) + "\n")
            lifecycle_policy = {"standard": acceptance_plan.STANDARD, "required": True}
            (scope_assets / acceptance_plan.POLICY).write_text(json.dumps(lifecycle_policy) + "\n")
            if not (scope_assets / acceptance_plan.DECISIONS).exists():
                (scope_assets / acceptance_plan.DECISIONS).write_text(json.dumps({"version": 1, "items": []}) + "\n")
        language_policy = {"mode": "explicit", "language": language} if language else {"mode": "requirement"}
        (asset_directory(project, selected) / LANGUAGE_POLICY_NAME).write_text(json.dumps(language_policy, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        with tempfile.TemporaryDirectory(prefix="delivery-acceptance-") as temp_dir:
            try:
                ensure_runtime_modules()
            except (OSError, ValueError, json.JSONDecodeError) as error:
                parser.error(str(error))
            overlay_path = Path(temp_dir) / "playbook-overlay.yaml"
            overlay_path.write_text(json.dumps(overlay), encoding="utf-8")
            command = ["playbook", "run", "--with", str(overlay_path), "--json"]
            if args.session:
                command += ["--session", args.session, (args.reply or "continue") + "\n\n" + language_guidance(language) + "\n" + OUTPUT_QUALITY_GUIDANCE + ("\n" + EXECUTION_RECORD_GUIDANCE if args.stage == "acceptance" else "")]
            else:
                task = (
                    f"Generate and review {args.stage} delivery scenarios for the confirmed requirements at {requirements}. "
                    "Design only; no execution resources, application operation or delivery-pass claims. Follow the fixed design-stage-policy.json and stop after the design gate. "
                    if args.stage in ("black-box","white-box") else
                    f"Verify the app at {project} against the confirmed requirements at {requirements}. "
                )
                command.append(
                    f"/{playbook_id} {task}The project is at {project}. The installed skill is at {SKILL_ROOT}. "
                    f"The user-selected test directory (testDir) is at {selected}. All test assets belong at {asset_directory(project, selected)}. "
                    f"The fixed live execution coverage policy is {live_coverage}; read execution-coverage-policy.json. required means every selected scene records measured counters or independently verified unavailability; missing collection requires same-scene repair. "
                    f"The fixed acceptance coverageMode is {mode}. Do not enable coverage enhancement in standard mode. "
                    f"The fixed execution policy is {json.dumps(execution_policy)}; read execution-policy.json, preserve all scenarios, execute the priority queue, and never claim full acceptance for a partial run. "
                    "You are starting the workflow now; roles inside it must never launch this workflow again."
                    "\n\n" + language_guidance(language) + "\n" + OUTPUT_QUALITY_GUIDANCE + ("\n" + EXECUTION_RECORD_GUIDANCE if args.stage == "acceptance" else "")
                )
            child_env = os.environ.copy()
            child_env["DELIVERY_ACCEPTANCE_SCOPE_REQUIRED"] = "1"
            child_env["DELIVERY_ACCEPTANCE_ACTIVE"] = str(project)
            child_env["DELIVERY_ACCEPTANCE_TEST_DIR"] = str(selected)
            child_env["DELIVERY_ACCEPTANCE_COVERAGE_MODE"] = mode
            child_env["DELIVERY_ACCEPTANCE_EXECUTION_COVERAGE"] = live_coverage
            return stream_playbook(command, project, child_env, args.session, playbook_id, selected, mode, requirements, execution_policy, live_coverage, language, workspace)


if __name__ == "__main__":
    sys.exit(main())
