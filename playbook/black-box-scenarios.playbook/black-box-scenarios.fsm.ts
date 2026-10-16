import { setup, assign, fromPromise } from 'xstate';
import { resolve } from 'node:path';

// Link authority: every delegated-player outcome, including needsBossReply, has
// repositoryDisposition "unchanged" — Git HEAD and the Git-visible working tree
// stay fixed and the `<test-dir>/delivery-acceptance` ledger is Git-ignored. The
// needsBossReply.question field is presentation-owned. No outcome is deferred
// or requires a Git commit, and this workflow creates no Git commits.

const prompts = {
  "ENTRY-1": "Read the fixed design-stage-policy.json and preserve its black-box/white-box stage on recovery; never change stage from old context.\nPreserve all original requirement text/IDs and genuine scope decisions. Initialization/import only: do not generate units or scenarios in ENTRY-1. On ready proceed to ANALYSIS-1.\nVerify that the supplied requirements file contains a confirmed version with source and stable, unique IDs with nonempty text.\nIf it is absent or ambiguous, report the exact gap; do not invent or approve requirements.\nOtherwise run `python3 <skill>/scripts/playbook.py init <project> --test-dir <test-dir> --requirements <requirements-file>` on first use, or `import-requirements` when the approved source changed.\nIf an initialized ledger already has the same requirements snapshot, reuse it without deleting prior decisions.\nA changed approved requirements snapshot invalidates prior scenario completeness.\nNever put real credentials in the ledger.\nDo not invoke `run_workflow.py`, `/black-box-scenarios`, or another Playbook from inside this session.\nKeep the user-selected test directory fixed; the outer launcher already obtained it, with suggested default `<project>/tests`.\nKeep requirements snapshots, resource decisions, scenarios with embedded acceptance, reviews, results, screenshots and reports under `<test-dir>/delivery-acceptance/`. Executable cases, reusable Mocks, fixtures and harnesses follow project test conventions outside this ledger; precise case bindings are chosen only during scenario execution.\nUse `--test-dir <test-dir>` for every checker operation; relative paths resolve against the project.\n> <project>\n> <test-dir>\n> <requirements-file>\n> <skill>",
  "ANALYSIS-1": "Read fixed design-stage-policy.json and references/design-pipeline.md and references/white-box-rules.md. Analyze the complete original requirements first. Read the fixed design-stage-policy.json. The stage is black-box or white-box design-only; if no policy is present the explicit current task determines the stage.\nFor black-box stage, write an explicit empty reverse-rule inventory and explain that no implementation analysis is requested. For white-box stage, inspect the actual implementation and record all material reverse rules before any acceptance organization. Use existing confirmed requirements when sufficient; separately assess supplemental-rule correctness and current-change applicability. Persist out-of-scope/pending candidates visibly, with reasons; never expand the agreed scope.\nWrite source-analysis.candidate.json with stage, complete original and discovered rule IDs, actual inspected code paths/hashes and substantive analysis bases. Run complete-analysis --input then check-analysis. Do not create units, scenarios, tests or resources in this phase. A newly discovered required business ambiguity needs the real user answer; never invent approval.\nUse playbook.py directly, keep fixed paths and confirmed exclusions, and never start another Playbook session.\n<project>\n<test-dir>\n<skill>",
  "ANALYSIS-GATE": "python3 '<skill>'/scripts/playbook.py check-analysis '<project>' --test-dir '<test-dir>' > '<test-dir>'/delivery-acceptance/analysis-gate.json",
  "ORGANIZATION-DESIGN": "Read the fixed design-stage-policy.json and preserve its black-box/white-box stage on recovery; never change stage from old context.\nGenerate the entire acceptance-plan.candidate.json from frozen source-analysis.json, full original requirements and all reverse rules. Read references/acceptance-organization.md and references/design-pipeline.md. Include all original check dispositions and all active reverse-rule ownership via units[].rule_ids; pending/outside rules remain candidates outside units.\nBuild every acceptance unit and all global journeys before generating any scenario. Bind source_analysis_sha256 and semantic rules_sha256. Run check-plan --draft --input. Reuse an unchanged already published organization only after current check-plan; do not silently republish it.\nReturn done only with the entire candidate ready for independent review. Preserve current user scope and actual decisions.\n<project>\n<test-dir>\n<skill>",
  "ORGANIZATION-1": "Read the fixed design-stage-policy.json and preserve its black-box/white-box stage on recovery; never change stage from old context.\nRead references/design-pipeline.md and references/acceptance-organization.md, completed source-analysis.json, complete original requirements, all white_box_rules.json items and acceptance-plan.candidate.json. Independently reconstruct behavior/conditions/recovery/invariants from original text, then verify original-to-unit and unit-to-original mapping, overall business context and selected boundaries.\nWrite acceptance-plan-review.candidate.json with all five independent judgments including rule_provenance, every original requirement ID and every discovered rule ID (including out-of-scope/pending rules), plan_sha256 and actual independent reviewer identity. Independently check rule contract/invariant provenance, current-scope applicability and full rule-to-unit ownership. Regrouping must not invent or omit rules. Ordinary organization needs no Boss approval.\nIf sufficient, run publish-plan with the candidate, independent review and actual expected-version. Never overwrite formal scope directly. Reuse an unchanged published plan only after check-plan; do not increment unchanged plans. Confirmed exclusions apply across names and IDs.\nReturn passed only after substantive review and successful publication/check. On repairable gaps return gaps with exact failureDetails. Ask Boss only about genuine missing business decisions; persist the real answer before revalidation.\n<project>\n<test-dir>\n<skill>",
  "ORGANIZATION-REPAIR": "Read the fixed design-stage-policy.json and preserve its black-box/white-box stage on recovery; never change stage from old context.\nRepair only named organization gaps without changing original requirements or user decisions. If a genuine new source rule is required, return requirementsGap with exact reason and restart through source analysis in a new session; do not edit the frozen rule inventory in scene generation. Run check-plan --draft --input before returning done to ORGANIZATION-1. Never author independent review or overwrite the formal plan.\n<project>\n<test-dir>\n<skill>\n<failure-details>",
  "ORGANIZATION-GATE": "python3 '<skill>'/scripts/playbook.py check-plan '<project>' --test-dir '<test-dir>' > '<test-dir>'/delivery-acceptance/organization-gate.json",
  "DESIGN-1": "Read the fixed design-stage-policy.json (black-box or white-box) and references/design-pipeline.md, acceptance-organization.md, design-quality.md, output-standards.md and scenario-priority.md. Preserve full original sources, the published plan and confirmed user exclusions.\nCall design-next, then start-unit --unit ID for exactly that next unit. Generate only this unit's scenes, each with generation_unit_id and admitted scope.unit_ids; preserve every other unit's scene bytes. Persist each complete scene atomically as produced so live progress remains visible. Each scene embeds acceptance(description/preconditions/actions/criteria/evidence_expected), exact per-criterion scope admission and structured global business risk. Assign concrete P0/P1/P2/P3 consequences against all requirements and business journeys, never grade quotas or execution-order preferences.\nIn black-box mode create only kind=black_box scenes from included original checks, with requirement_ids and scenarios.json.design_basis. No implementation/resources are required. Set black_box_complete only after all units are generated and assessed; do not set white_box_complete.\nIn white-box mode create only kind=white_box scenes from this unit's original checks and admitted rule_ids. Read actual source to design target_condition and code_sources, but do not add or modify frozen reverse rules. Save white_box_rules.json root design_standard/design_basis and scenarios.json.white_box_complete only after all units are generated and assessed. Do not require or generate black-box scenes or execution resources.\nComplete-unit --unit ID must pass after this unit's actual scenes cover all its checks/rules. Then call design-next: return more if another unit remains, otherwise done. Never claim global completion early. New source/required policy changes require renewed analysis and organization review in a new session; do not expand scope here.\nDo not create executable test code, methods.json, method_ids, cases or execution observations. Do not author the independent coverage_review.json. Use playbook.py directly with fixed project/test-dir/skill paths, keep ledger Git-ignored, and never invoke another Playbook.\n> <project>\n> <test-dir>\n> <skill>",
  "UNIT-ADVANCE": "python3 '<skill>'/scripts/playbook.py advance-unit '<project>' --test-dir '<test-dir>' > '<test-dir>'/delivery-acceptance/unit-advance-gate.json",
  "GENERATION-GATE": "python3 '<skill>'/scripts/playbook.py check-generation '<project>' --test-dir '<test-dir>' > '<test-dir>'/delivery-acceptance/generation-gate.json",
  "REVIEW-1": "Read the fixed design-stage-policy.json and the same design-pipeline/organization/design-quality/output-standards/scenario-priority contracts. Review current scope before coverage and global risk; suggestions outside scope are nonblocking. Independently inspect all exact scenario criteria, challenge escaping wrong implementations in every important operation/state, and compare importance across units.\nWrite acceptance_scope_review in coverage_review.json with actual independent identity/reference, plan_sha256, per-scene scenario/dependency hashes from scope-review-hashes, scope_reason, priority_reason, causal_chain_review and global_priority_calibration. Original unchanged judgments may be retained only with archive-scope-review provenance and matching current dependencies. Never modify Analyst's scenes or invent scope.\nIn black-box mode independently review scenarios.json.design_basis against every selected requirement using the full v4 coverage_results/check_points/scenario_coverage/five criteria/findings/scope/limitations contract. Write one priority_reviews entry per black scene, root design_standard/output_quality and exact review-hashes. No implementation or white-box review is required.\nIn white-box mode inspect actual code_sources and target_condition, frozen original requirements and all discovered reverse rules. Write white_box_priority_review with actual white-box-priority-hashes, one grade judgment per white scene, rule_reviews for every discovered rule (out-of-scope/pending remains visible and nonblocking), and v4 design_reviews for precisely the active linked original requirements/rules against white_box_rules.json root design_basis. Include output_quality for every white scene/acceptance. No black-box coverage, resources or execution evidence is required.\nRun check-generation, then playbook.py check --stage design; return passed only if the substantive independent review and exact current design gate pass. Otherwise return gaps with exact failureDetails. Never self-approve Analyst artifacts, request ordinary user list approval or start another Playbook.\n> <project>\n> <test-dir>\n> <skill>",
  "GATE-1": "python3 '<skill>'/scripts/playbook.py check '<project>' --test-dir '<test-dir>' --stage design > '<test-dir>'/delivery-acceptance/black-box-gate.json",
  "REPAIR-1": "Read the fixed design-stage-policy.json and preserve its black-box/white-box stage on recovery; never change stage from old context.\nArchive-scope-review and reopen-units for affected owners, then regenerate one unit at a time with start-unit/complete-unit and pass check-generation. Repair only the named gaps in the ignored ledger files, preserving confirmed requirement IDs and existing valid scenarios.\nRead the black-box gate report at `<test-dir>/delivery-acceptance/black-box-gate.json` when the stage checker failed.\nLeave Git HEAD and the Git-visible worktree unchanged.\nDo not invoke `run_workflow.py`, `/black-box-scenarios`, or another Playbook from inside this session.\nKeep the user-selected test directory fixed; the outer launcher already obtained it, with suggested default `<project>/tests`.\nKeep requirements snapshots, resource decisions, scenarios with embedded acceptance, reviews, results, screenshots and reports under `<test-dir>/delivery-acceptance/`. Executable cases, reusable Mocks, fixtures and harnesses follow project test conventions outside this ledger; precise case bindings are chosen only during scenario execution.\nUse `--test-dir <test-dir>` for every checker operation; relative paths resolve against the project.\nEvery black-box and white-box scenario needs `priority` (P0/P1/P2/P3) and a concrete `priority_reason` describing failure consequences.\nUse `<skill>/references/scenario-priority.md` for the grading criteria; assess business risk, likelihood and affected users, not execution cost or dependency scheduling.\nKeep the complete design regardless of the selected execution scope.\nDo not automatically grade every happy path high or every exceptional/boundary path low, and do not impose a quota per grade.\nA priority or reason change invalidates its scoped review and prior run bindings.\nLegacy unclassified scenarios need explicit grading and fresh independent review before a new design/acceptance gate can pass.\n> <project>\n> <test-dir>\n> <skill>\n> <failureDetails>",
  "COMPLETION-1": "Read the fixed design-stage-policy.json and preserve its black-box/white-box stage on recovery; never change stage from old context.\nReport `scenariosReady` with a nonempty `response` naming the scenario ledger path, the number of black-box scenarios and P0/P1/P2/P3 counts plus unclassified gaps, the requirement coverage, and the black-box gate report.\nCompletion is read-only: do not edit any file, including tracked documentation or ledger files, or run more design or checker work.\nExplicitly state that no App behavior was executed or accepted.\nA `scenariosReady` result is a successful design deliverable, not full application acceptance.\nOtherwise report `incomplete` with the exact failure details.\nNever declare application delivery accepted here.\n> <project>\n> <test-dir>\n> <failureDetails>"
} as const;
const results = {
  "ENTRY-1": {
    "ready": "The requirements file contains a confirmed version with source and stable, unique IDs with nonempty text, and the successful first-use initialization or changed-source import is complete.",
    "requirementsGap": "The requirements file is absent or ambiguous; do not invent or approve requirements. Output shall include `failureDetails: <exact requirements gap>`.",
    "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
  },
  "ANALYSIS-1": {
    "done": "The source analysis was completed and persisted; proceed to ANALYSIS-GATE.",
    "requirementsGap": "Actual required business/source gap prevents analysis. Output shall include `failureDetails: <exact gap>`; finish incomplete.",
    "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
  },
  "ANALYSIS-GATE": {
    "passed": "Zero exit verifies current complete source analysis; proceed to ORGANIZATION-DESIGN.",
    "failed": "Nonzero exit reports exact analysis-gate.json path and returns to ANALYSIS-1 while fewer than three attempts have occurred; otherwise finish incomplete. Increment sourceAnalysisRounds once per ANALYSIS-1; suspension/recovery never resets it. Captain claims cannot set analysisGatePassed."
  },
  "ORGANIZATION-DESIGN": {
    "done": "Entire organization is generated; proceed to ORGANIZATION-1 for independent review.",
    "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
  },
  "ORGANIZATION-1": {
    "passed": "organization independently reviewed and published; proceed to ORGANIZATION-GATE.",
    "gaps": "Analyst repairs named gaps at ORGANIZATION-REPAIR while fewer than three organization review rounds have occurred; otherwise finish incomplete with exact failureDetails. This counter is separate from scenario/coverage rounds and never reset by recovery.",
    "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
  },
  "ORGANIZATION-REPAIR": {
    "done": "candidate repaired; return to ORGANIZATION-1.",
    "requirementsGap": "genuine business ambiguity remains; finish incomplete with exact failureDetails.",
    "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
  },
  "ORGANIZATION-GATE": {
    "passed": "Zero exit verifies current organization and independent review; proceed to DESIGN-1.",
    "failed": "Nonzero exit sets failureDetails exactly to \"Organization gate failed; inspect <test-dir>/delivery-acceptance/organization-gate.json\" and enters ORGANIZATION-REPAIR while fewer than three organization review rounds have occurred, otherwise finish incomplete. Never replace script execution with a Captain assertion. Increment the separate organization counter once per ORGANIZATION-1, maximum three; recovery never resets it."
  },
  "DESIGN-1": {
    "more": "Current unit was completed and another pending unit exists; proceed to UNIT-ADVANCE without incrementing scenario review rounds.",
    "done": "No generation units remain; proceed to GENERATION-GATE.",
    "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
  },
  "UNIT-ADVANCE": {
    "passed": "Actual zero exit verifies the prior unit completed and a next pending unit exists; return to scene design. Never repeat a stale completion as forward progress.",
    "failed": "Nonzero exit finishes incomplete with the exact unit-advance-gate.json path, without generating another unit."
  },
  "GENERATION-GATE": {
    "passed": "Zero exit proves every published unit generated its bound scenario set; proceed to independent scene review.",
    "failed": "Nonzero exit terminates incomplete with exact generation-gate.json findings; do not enter scene review or execution and do not manufacture completion from agent output."
  },
  "REVIEW-1": {
    "passed": "Independent review finds every selected requirement sufficient and no important path uncovered, all current-stage scene priorities, sources and criteria have passed independent review with no grade disagreement, and the direct design-stage checker passes.",
    "gaps": "Independent review finds a plausible important fault that a linked scenario could not expose, a method that cannot produce its claimed failure signal, a requirement too ambiguous to know the intended outcome, a priority or reason disagreement, an unclassified scenario lacking explicit grading and fresh independent review, or any failure of the requirements, black-box-scenarios, or coverage-review checker gates. Output shall include `failureDetails: <exact gaps, including applicable requirement IDs, missing modes/states, counterexamples, scenario references, priority disagreements, and checker failures>`.",
    "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
  },
  "GATE-1": {
    "passed": "The stage checker exited with status zero and its black-box gate report is written; `scenariosReady` may follow only on this zero exit.",
    "failed": "The stage checker exited with a nonzero status; do not report `scenariosReady`, and return to Analyst for repair while review rounds remain."
  },
  "REPAIR-1": {
    "done": "The acting agent completed the behavior.",
    "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
  },
  "COMPLETION-1": {
    "scenariosReady": "The Reviewer verdict and the black-box stage gate both pass. Output shall include `response: <nonempty report naming the scenario ledger path, the number of black-box scenarios and P0/P1/P2/P3 counts plus unclassified gaps, requirement coverage, and the black-box gate report>`.",
    "incomplete": "A black-box gate fails after the allowed repairs, material gaps remain after three rounds, or the requirements are unavailable. Output shall include `response: <nonempty report of the exact failure details>`.",
    "needsBossReply": "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`."
  }
} as const;
export type MachineInput = Record<string, never>;
export type MachineOutput = { response: string };
export type PendingBossQuestion = {
  questionId: WorkingStateId;
  resumeStateId: WorkingStateId;
  sourceItem: string;
  asker: { kind: 'captain' } | { kind: 'role'; roleId: 'analyst' | 'reviewer' };
  question: string;
};
type WorkingStateId = 'sourceAnalysis' | 'organizationDesign' | 'entry' | 'organizationReview' | 'organizationRepair' | 'scenarioDesign' | 'scenarioReview' | 'scenarioRepair' | 'completion';
type JumpableStateId = WorkingStateId | 'unitAdvance' | 'analysisGate' | 'generationGate' | 'organizationGate' | 'blackBoxGate';
type Context = {
  project: string;
  testDir: string;
  requirementsFile: string;
  skill: string;
  failureDetails: string;
  unitAdvanceReady: boolean;
  sourceAnalysisRounds: number;
  sourceAnalysisComplete: boolean;
  analysisGatePassed: boolean;
  organizationCandidateReady: boolean;
  generationGatePassed: boolean;
  requirementsReady: boolean;
  incompleteReady: boolean;
  scenariosReady: boolean;
  scenarioRounds: number;
  organizationRounds: number;
  organizationReviewPassed: boolean;
  organizationGatePassed: boolean;
  bossDiscussion: readonly { question: string; answer: string }[];
  scenarioReviewPassed: boolean;
  blackBoxGatePassed: boolean;
  response: string;
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
  lastError?: { name: string; message: string; stack?: string };
};
type Events =
  | { type: 'START' | 'BOSS_TASK'; project: string; testDir: string; requirementsFile: string; skill: string }
  | { type: 'BOSS_INTERRUPT'; targetId: JumpableStateId }
  | { type: 'BOSS_REPLY'; answer: string; questionId?: string };
type ActorCommon = {
  stateId: WorkingStateId;
  sourceItem: string;
  prompt: string;
  result: Readonly<Record<string, string>>;
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
  bossDiscussion: readonly { question: string; answer: string }[];
};
export type CaptainInput = ActorCommon & {
  stateId: 'completion';
  sourceItem: 'COMPLETION-1';
  project: string;
  testDir: string;
  failureDetails: string;
  result: typeof results['COMPLETION-1'];
};
export type PlayerInput = ActorCommon & {
  project: string;
  testDir: string;
  skill: string;
} & (
  | { stateId: 'sourceAnalysis'; sourceItem: 'ANALYSIS-1'; role: 'analyst'; result: typeof results['ANALYSIS-1'] }
  | { stateId: 'organizationDesign'; sourceItem: 'ORGANIZATION-DESIGN'; role: 'analyst'; result: typeof results['ORGANIZATION-DESIGN'] }
  | { stateId: 'entry'; sourceItem: 'ENTRY-1'; role: 'analyst'; requirementsFile: string; result: typeof results['ENTRY-1'] }
  | { stateId: 'organizationReview'; sourceItem: 'ORGANIZATION-1'; role: 'reviewer'; result: typeof results['ORGANIZATION-1'] }
  | { stateId: 'organizationRepair'; sourceItem: 'ORGANIZATION-REPAIR'; role: 'analyst'; failureDetails: string; result: typeof results['ORGANIZATION-REPAIR'] }
  | { stateId: 'scenarioDesign'; sourceItem: 'DESIGN-1'; role: 'analyst'; result: typeof results['DESIGN-1'] }
  | { stateId: 'scenarioReview'; sourceItem: 'REVIEW-1'; role: 'reviewer'; result: typeof results['REVIEW-1'] }
  | { stateId: 'scenarioRepair'; sourceItem: 'REPAIR-1'; role: 'analyst'; failureDetails: string; result: typeof results['REPAIR-1'] }
);
export type ScriptInput = { command: string } & (
  | { stateId: 'unitAdvance'; sourceItem: 'UNIT-ADVANCE'; result: typeof results['UNIT-ADVANCE'] }
  | { stateId: 'analysisGate'; sourceItem: 'ANALYSIS-GATE'; result: typeof results['ANALYSIS-GATE'] }
  | { stateId: 'generationGate'; sourceItem: 'GENERATION-GATE'; result: typeof results['GENERATION-GATE'] }
  | { stateId: 'blackBoxGate'; sourceItem: 'GATE-1'; result: typeof results['GATE-1'] }
  | { stateId: 'organizationGate'; sourceItem: 'ORGANIZATION-GATE'; result: typeof results['ORGANIZATION-GATE'] }
);
export type ScriptOutput =
  | { guard: 'passed'; exitStatus: number }
  | { guard: 'failed'; exitStatus: number };
export type CaptainOutput =
  | { guard: 'needsBossReply'; question: string }
  | { guard: 'scenariosReady'; response: string }
  | { guard: 'incomplete'; response: string };
export type PlayerOutput =
  | { guard: 'more' }
  | { guard: 'done' }
  | { guard: 'needsBossReply'; question: string }
  | { guard: 'ready' }
  | { guard: 'requirementsGap'; failureDetails: string }
  | { guard: 'passed' }
  | { guard: 'gaps'; failureDetails: string };
export const concurrentRoleSets: readonly (readonly string[])[] = [];

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

function isJsonValue(value: unknown, active = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || active.has(value)) return false;
  active.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return false;
      const length = Object.getOwnPropertyDescriptor(value, 'length');
      if (!length || !('value' in length) || length.enumerable || length.configurable ||
          length.value !== value.length || keys.length !== value.length + 1) return false;
      for (let i = 0; i < value.length; i += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor?.enumerable || !('value' in descriptor) || !isJsonValue(descriptor.value, active)) return false;
      }
      return true;
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return keys.every((key) => {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !!descriptor?.enumerable && 'value' in descriptor && isJsonValue(descriptor.value, active);
    });
  } catch {
    return false;
  } finally {
    active.delete(value);
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) return undefined;
  }
  return value as Record<string, unknown>;
}
function output(event: unknown): Record<string, unknown> | undefined {
  const value = record(event)?.output;
  return isJsonValue(value) ? record(value) : undefined;
}
function field(event: unknown, name: string): string | undefined {
  const value = output(event)?.[name];
  return typeof value === 'string' ? value : undefined;
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function result(event: unknown, guard: string): boolean {
  return output(event)?.guard === guard;
}
function resultWith(event: unknown, guard: string, name: string): boolean {
  return result(event, guard) && nonempty(field(event, name));
}
function scriptResult(event: unknown, guard: 'passed' | 'failed'): boolean {
  const value = output(event);
  return value?.guard === guard && typeof value.exitStatus === 'number' &&
    Number.isInteger(value.exitStatus) && (guard === 'passed' ? value.exitStatus === 0 : value.exitStatus !== 0);
}
function shellWord(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
function scriptCommand(template: string, context: Context): string {
  const values: Readonly<Record<string, string>> = {
    skill: context.skill, project: context.project, 'test-dir': context.testDir,
  };
  return template.replace(/'<(skill|project|test-dir)>'/g, (literal, key: string) => {
    const value = values[key];
    return nonempty(value) ? shellWord(value) : literal;
  });
}
function normalizedError(event: unknown): { name: string; message: string; stack?: string } {
  const error = record(event)?.error;
  if (error instanceof Error) {
    return { name: error.name, message: error.message, ...(typeof error.stack === 'string' ? { stack: error.stack } : {}) };
  }
  return { name: 'Error', message: typeof error === 'string' ? error : 'Actor failed.' };
}
function actorFields(context: Context, stateId: WorkingStateId): Pick<ActorCommon, 'pendingBossQuestion' | 'bossReply' | 'bossDiscussion'> {
  return {
    bossDiscussion: context.bossDiscussion,
    ...(context.pendingBossQuestion?.resumeStateId === stateId ? {
      pendingBossQuestion: context.pendingBossQuestion,
      ...(context.bossReply !== undefined ? { bossReply: context.bossReply } : {}),
    } : {}),
  };
}
function canEnter(id: JumpableStateId, context: Context): boolean {
  switch (id) {
    case 'entry': return nonempty(context.project) && nonempty(context.testDir) && nonempty(context.requirementsFile) && nonempty(context.skill) && context.sourceAnalysisRounds < 3;
    case 'sourceAnalysis': return context.requirementsReady && context.sourceAnalysisRounds < 3;
    case 'analysisGate': return context.sourceAnalysisComplete;
    case 'organizationDesign': return context.analysisGatePassed && context.organizationRounds < 3;
    case 'organizationReview': return context.analysisGatePassed && context.organizationCandidateReady && context.organizationRounds < 3;
    case 'organizationRepair': return context.analysisGatePassed && nonempty(context.failureDetails) && context.organizationRounds < 3;
    case 'organizationGate': return context.analysisGatePassed && context.organizationReviewPassed;
    case 'scenarioDesign': return context.organizationGatePassed;
    case 'unitAdvance': return context.organizationGatePassed && context.unitAdvanceReady;
    case 'generationGate': return context.organizationGatePassed && context.scenariosReady;
    case 'scenarioReview': return context.generationGatePassed && context.scenariosReady && context.scenarioRounds < 3;
    case 'scenarioRepair': return context.generationGatePassed && context.scenariosReady && nonempty(context.failureDetails) && context.scenarioRounds < 3;
    case 'blackBoxGate': return context.generationGatePassed && context.scenarioReviewPassed;
    case 'completion': return nonempty(context.project);
  }
}

function bossInterrupts(ids: readonly JumpableStateId[]) {
  return ids.map((id) => ({
    guard: ({ context, event }: { context: Context; event: Events }) =>
      event.type === 'BOSS_INTERRUPT' && event.targetId === id && canEnter(id, context),
    target: `#${id}` as const,
    reenter: true,
    actions: id === 'entry' ? ['clearBossReplyContext', 'clearLastError', 'resetFlow'] as const :
      id === 'sourceAnalysis' ? ['clearBossReplyContext', 'nextAnalysisRound'] as const :
      id === 'organizationReview' ? ['clearBossReplyContext', 'nextOrganizationRound'] as const :
      id === 'scenarioReview' ? ['clearBossReplyContext', 'nextScenarioRound'] as const :
      'clearBossReplyContext' as const,
  }));
}
function resumableStates(ids: readonly WorkingStateId[]) {
  return ids.map((id) => ({
    guard: ({ context, event }: { context: Context; event: Events }) =>
      event.type === 'BOSS_REPLY' && nonempty(event.answer) &&
      context.pendingBossQuestion?.resumeStateId === id &&
      (event.questionId === undefined || event.questionId === id),
    target: `#${id}` as const,
    actions: 'setBossReply' as const,
  }));
}
function replyArm(stateId: WorkingStateId, sourceItem: string, role?: 'analyst' | 'reviewer') {
  return {
    guard: ({ event }: { event: unknown }) => resultWith(event, 'needsBossReply', 'question'),
    target: 'awaitBossReply',
    actions: role
      ? [accepted(stateId, 'awaitBossReply', 'needsBossReply'), 'clearReply' as const, { type: 'setPendingBossQuestion' as const, params: { stateId, sourceItem, role } }]
      : ['clearReply' as const, { type: 'setPendingBossQuestion' as const, params: { stateId, sourceItem } }],
  } as const;
}
const malformed = { target: 'failed', actions: ['clearBossReplyContext', 'rememberMalformedOutput'] } as const;
const actorError = { target: 'failed', actions: ['clearBossReplyContext', 'rememberActorError'] } as const;
const accepted = (source: WorkingStateId, target: string, acceptedOutcome: string) =>
  ({ type: 'playbook.acceptedOutcome', params: { source, target, acceptedOutcome } } as const);
const admission = {
  guard: ({ context, event }: { context: Context; event: Events }) => {
    if (event.type !== 'START' && event.type !== 'BOSS_TASK') return false;
    if (![event.project, event.testDir, event.requirementsFile, event.skill].every(nonempty)) return false;
    return (!context.project || context.project === resolve(event.project)) &&
      (!context.testDir || context.testDir === resolve(event.project, event.testDir)) &&
      (!context.skill || context.skill === resolve(event.skill)) &&
      (!context.requirementsFile || context.requirementsFile === resolve(event.project, event.requirementsFile)) &&
      context.sourceAnalysisRounds < 3 && context.organizationRounds < 3 && context.scenarioRounds < 3;
  },
  target: '#entry',
  actions: ['clearBossReplyContext', 'clearLastError', 'start'],
} as const;
export const blackBoxScenariosMachine = setup({
  types: {} as { context: Context; events: Events; input: MachineInput; output: MachineOutput },
  actors: {
    captain: fromPromise<CaptainOutput, CaptainInput>(async () => { throw new Error('captain actor must be provided by the runner'); }),
    player: fromPromise<PlayerOutput, PlayerInput>(async () => { throw new Error('player actor must be provided by the runner'); }),
    script: fromPromise<ScriptOutput, ScriptInput>(async () => { throw new Error('script actor must be provided by the runner'); }),
  },
  actions: {
    'playbook.acceptedOutcome': (_args, _params: { source: string; target: string; acceptedOutcome: string }) => {},
    start: assign(({ context, event }) => (event.type === 'START' || event.type === 'BOSS_TASK') ? {
      project: context.project || resolve(event.project), testDir: context.testDir || resolve(event.project, event.testDir), requirementsFile: context.requirementsFile || resolve(context.project || event.project, event.requirementsFile), skill: context.skill || resolve(event.skill),
      unitAdvanceReady: false, sourceAnalysisComplete: false, analysisGatePassed: false, organizationCandidateReady: false, generationGatePassed: false,
      failureDetails: '', requirementsReady: false, incompleteReady: false, scenariosReady: false, scenarioRounds: context.scenarioRounds,
      scenarioReviewPassed: false, blackBoxGatePassed: false, response: '',
      organizationReviewPassed: false, organizationGatePassed: false,
    } : {}),
    resetFlow: assign(({ context }) => ({ unitAdvanceReady: false, sourceAnalysisComplete: false, analysisGatePassed: false, organizationCandidateReady: false, generationGatePassed: false, failureDetails: '', requirementsReady: false, incompleteReady: false, scenariosReady: false, scenarioRounds: context.scenarioRounds, scenarioReviewPassed: false, blackBoxGatePassed: false, response: '', organizationReviewPassed: false, organizationGatePassed: false })),
    setPendingBossQuestion: assign(({ event }, params: { stateId: WorkingStateId; sourceItem: string; role?: 'analyst' | 'reviewer' }) => ({
      pendingBossQuestion: {
        questionId: params.stateId,
        resumeStateId: params.stateId,
        sourceItem: params.sourceItem,
        asker: params.role ? { kind: 'role' as const, roleId: params.role } : { kind: 'captain' as const },
        question: field(event, 'question') ?? '',
      },
    })),
    setBossReply: assign(({ context, event }) => event.type === 'BOSS_REPLY' && context.pendingBossQuestion ? {
      bossReply: event.answer,
      bossDiscussion: [...context.bossDiscussion, { question: context.pendingBossQuestion.question, answer: event.answer }],
    } : {}),
    clearBossReplyContext: assign(({ context }) => {
      // Remove optional members instead of persisting non-JSON undefined values.
      delete context.pendingBossQuestion;
      delete context.bossReply;
      return {};
    }),
    clearLastError: assign(({ context }) => { delete context.lastError; return {}; }),
    clearReply: assign(({ context }) => { delete context.bossReply; return {}; }),
    rememberFailureDetails: assign(({ event }) => ({ failureDetails: field(event, 'failureDetails') ?? '' })),
    rememberResponse: assign(({ event }) => ({ response: field(event, 'response') ?? '' })),
    rememberActorError: assign(({ event }) => ({ lastError: normalizedError(event) })),
    rememberMalformedOutput: assign(() => ({ lastError: { name: 'MalformedActorOutput', message: 'Actor output did not match a declared result.' } })),
    rememberMalformedReply: assign(() => ({ lastError: { name: 'MalformedBossReply', message: 'Boss reply is empty or does not name the pending question.' } })),
    rememberScriptFailure: assign(({ context }) => ({
      failureDetails: `Black-box stage checker failed; inspect ${context.testDir}/delivery-acceptance/black-box-gate.json`,
      blackBoxGatePassed: false,
    })),
    nextAnalysisRound: assign(({ context }) => ({ sourceAnalysisRounds: context.sourceAnalysisRounds + 1 })),
    invalidateAnalysis: assign(() => ({ sourceAnalysisComplete: false, analysisGatePassed: false, organizationCandidateReady: false, scenariosReady: false, organizationReviewPassed: false, organizationGatePassed: false, generationGatePassed: false, scenarioReviewPassed: false, blackBoxGatePassed: false, incompleteReady: false })),
    invalidateAnalysisGate: assign(() => ({ analysisGatePassed: false, organizationCandidateReady: false, scenariosReady: false, organizationReviewPassed: false, organizationGatePassed: false, generationGatePassed: false, scenarioReviewPassed: false, blackBoxGatePassed: false, incompleteReady: false })),
    invalidateOrganizationGate: assign(() => ({ organizationGatePassed: false, scenariosReady: false, generationGatePassed: false, scenarioReviewPassed: false, blackBoxGatePassed: false, incompleteReady: false })),
    invalidateBlackBoxGate: assign(() => ({ blackBoxGatePassed: false, incompleteReady: false })),
    analysisComplete: assign(() => ({ sourceAnalysisComplete: true })),
    analysisPassed: assign(() => ({ analysisGatePassed: true, failureDetails: '' })),
    organizationBuilt: assign(() => ({ organizationCandidateReady: true })),
    invalidateOrganizationCandidate: assign(() => ({ organizationCandidateReady: false, scenariosReady: false, organizationReviewPassed: false, organizationGatePassed: false, generationGatePassed: false, scenarioReviewPassed: false, blackBoxGatePassed: false, incompleteReady: false })),
    generationPassed: assign(() => ({ generationGatePassed: true, failureDetails: '' })),
    invalidateGeneration: assign(() => ({ generationGatePassed: false })),
    invalidateDraft: assign(() => ({ scenariosReady: false, unitAdvanceReady: false })),
    unitCompleted: assign(() => ({ unitAdvanceReady: true })),
    unitAdvanced: assign(() => ({ unitAdvanceReady: false })),
    rememberUnitAdvanceFailure: assign(({ context }) => ({ unitAdvanceReady: false, failureDetails: `Unit advance gate failed; inspect ${context.testDir}/delivery-acceptance/unit-advance-gate.json` })),
    rememberAnalysisGateFailure: assign(({ context }) => ({ analysisGatePassed: false, failureDetails: `Source analysis gate failed; inspect ${context.testDir}/delivery-acceptance/analysis-gate.json` })),
    rememberGenerationGateFailure: assign(({ context }) => ({ generationGatePassed: false, failureDetails: `Generation gate failed; inspect ${context.testDir}/delivery-acceptance/generation-gate.json` })),
    rememberAnalysisLimit: assign(() => ({ failureDetails: 'Source analysis cannot continue after three attempts.' })),
    rememberOrganizationLimit: assign(() => ({ failureDetails: 'Organization review cannot continue after three rounds.' })),
    rememberScenarioLimit: assign(() => ({ failureDetails: 'Scenario review cannot continue after three rounds.' })),
    nextOrganizationRound: assign(({ context }) => ({ organizationRounds: context.organizationRounds + 1, scenariosReady: false, organizationReviewPassed: false, organizationGatePassed: false, generationGatePassed: false, scenarioReviewPassed: false, blackBoxGatePassed: false, incompleteReady: false })),
    markIncomplete: assign(() => ({ incompleteReady: true })),
    invalidateOrganizationVerdict: assign(() => ({ scenariosReady: false, organizationReviewPassed: false, organizationGatePassed: false, generationGatePassed: false, scenarioReviewPassed: false, blackBoxGatePassed: false, incompleteReady: false })),
    organizationPassed: assign(() => ({ organizationReviewPassed: true })),
    organizationGatePassed: assign(() => ({ organizationGatePassed: true, failureDetails: '' })),
    invalidateScenarioVerdict: assign(() => ({ scenarioReviewPassed: false, blackBoxGatePassed: false, incompleteReady: false })),
    rememberOrganizationGateFailure: assign(({ context }) => ({
      failureDetails: `Organization gate failed; inspect ${context.testDir}/delivery-acceptance/organization-gate.json`,
      organizationGatePassed: false,
    })),
    requirementsPassed: assign(() => ({ requirementsReady: true })),
    scenariosBuilt: assign(() => ({ scenariosReady: true })),
    nextScenarioRound: assign(({ context }) => ({ scenarioRounds: context.scenarioRounds + 1, scenarioReviewPassed: false, blackBoxGatePassed: false, incompleteReady: false })),
    scenarioPassed: assign(() => ({ scenarioReviewPassed: true })),
    gatePassed: assign(() => ({ blackBoxGatePassed: true, failureDetails: '' })),
  },
}).createMachine({
  id: 'blackBoxScenarios',
  description: 'Designs a reviewed set of black-box delivery acceptance scenarios for a project and reports the design deliverable.',
  initial: 'ready',
  context: () => ({
    project: '', testDir: '', requirementsFile: '', skill: '', failureDetails: '',
    sourceAnalysisRounds: 0, unitAdvanceReady: false, sourceAnalysisComplete: false, analysisGatePassed: false, organizationCandidateReady: false, generationGatePassed: false,
    requirementsReady: false, incompleteReady: false, scenariosReady: false, scenarioRounds: 0,
    organizationRounds: 0, organizationReviewPassed: false, organizationGatePassed: false, bossDiscussion: [],
    scenarioReviewPassed: false, blackBoxGatePassed: false, response: '',
  }),
  output: ({ context }) => ({ response: context.response }),
  on: {
    BOSS_REPLY: { guard: ({ event }) => event.type === 'BOSS_REPLY' && !nonempty(event.answer), target: '#failed', actions: ['clearBossReplyContext', 'rememberMalformedReply'] },
    BOSS_INTERRUPT: bossInterrupts([
      'entry', 'sourceAnalysis', 'analysisGate', 'organizationDesign', 'organizationReview', 'organizationRepair', 'organizationGate', 'scenarioDesign', 'unitAdvance', 'generationGate', 'scenarioReview', 'scenarioRepair', 'blackBoxGate', 'completion',
    ]),
  },
  states: {
    ready: {
      id: 'ready', description: 'Waiting for a project, confirmed requirements file, and skill path.',
      tags: 'playbook.parked', meta: { playbook: { stateId: 'ready', description: 'Waiting for a project, confirmed requirements file, and skill path.' } },
      on: { START: admission, BOSS_TASK: admission },
    },
    entry: {
      id: 'entry', description: 'Analyst validates and initializes the confirmed requirements file.',
      tags: 'playbook.busy', meta: { playbook: { stateId: 'entry', description: 'Analyst validates and initializes the confirmed requirements file.', role: 'analyst' } },
      invoke: { src: 'player', input: ({ context }): PlayerInput => ({ stateId: 'entry', role: 'analyst', sourceItem: 'ENTRY-1', prompt: prompts['ENTRY-1'], project: context.project, testDir: context.testDir, requirementsFile: context.requirementsFile, skill: context.skill, result: results['ENTRY-1'], ...actorFields(context, 'entry') }),
        onDone: [
          { guard: ({ context, event }) => result(event, 'ready') && context.sourceAnalysisRounds < 3, target: 'sourceAnalysis', actions: [accepted('entry', 'sourceAnalysis', 'ready'), 'clearBossReplyContext', 'requirementsPassed', 'nextAnalysisRound'] },
          { guard: ({ event }) => result(event, 'ready'), target: 'completion', actions: [accepted('entry', 'completion', 'ready'), 'clearBossReplyContext', 'rememberAnalysisLimit', 'markIncomplete'] },
          { guard: ({ event }) => resultWith(event, 'requirementsGap', 'failureDetails'), target: 'completion', actions: [accepted('entry', 'completion', 'requirementsGap'), 'clearBossReplyContext', 'rememberFailureDetails', 'markIncomplete'] },
          replyArm('entry', 'ENTRY-1', 'analyst'), malformed,
        ], onError: actorError },
    },
    sourceAnalysis: {
      id: 'sourceAnalysis', description: 'Analyst analyzes all confirmed source requirements before acceptance organization.',
      entry: 'invalidateAnalysis', tags: 'playbook.busy',
      meta: { playbook: { stateId: 'sourceAnalysis', description: 'Analyst analyzes all confirmed source requirements before acceptance organization.', role: 'analyst' } },
      invoke: { src: 'player', input: ({ context }): PlayerInput => ({ stateId: 'sourceAnalysis', sourceItem: 'ANALYSIS-1', role: 'analyst', prompt: prompts['ANALYSIS-1'], result: results['ANALYSIS-1'], project: context.project, testDir: context.testDir, skill: context.skill, ...actorFields(context, 'sourceAnalysis') }),
        onDone: [
          { guard: ({ event }) => result(event, 'done'), target: 'analysisGate', actions: [accepted('sourceAnalysis', 'analysisGate', 'done'), 'clearBossReplyContext', 'analysisComplete'] },
          { guard: ({ event }) => resultWith(event, 'requirementsGap', 'failureDetails'), target: 'completion', actions: [accepted('sourceAnalysis', 'completion', 'requirementsGap'), 'clearBossReplyContext', 'rememberFailureDetails', 'markIncomplete'] },
          replyArm('sourceAnalysis', 'ANALYSIS-1', 'analyst'), malformed,
        ], onError: actorError },
    },
    analysisGate: {
      entry: 'invalidateAnalysisGate',
      id: 'analysisGate', description: 'Run the deterministic source-analysis checker.', tags: 'playbook.busy',
      meta: { playbook: { stateId: 'analysisGate', description: 'Run the deterministic source-analysis checker.' } },
      invoke: { src: 'script', input: ({ context }): ScriptInput => ({ stateId: 'analysisGate', sourceItem: 'ANALYSIS-GATE', command: scriptCommand(prompts['ANALYSIS-GATE'], context), result: results['ANALYSIS-GATE'] }),
        onDone: [
          { guard: ({ context, event }) => scriptResult(event, 'passed') && context.organizationRounds < 3, target: 'organizationDesign', actions: 'analysisPassed' },
          { guard: ({ event }) => scriptResult(event, 'passed'), target: 'completion', actions: ['analysisPassed', 'rememberOrganizationLimit', 'markIncomplete'] },
          { guard: ({ context, event }) => scriptResult(event, 'failed') && context.sourceAnalysisRounds < 3, target: 'sourceAnalysis', actions: ['rememberAnalysisGateFailure', 'nextAnalysisRound'] },
          { guard: ({ event }) => scriptResult(event, 'failed'), target: 'completion', actions: ['rememberAnalysisGateFailure', 'markIncomplete'] },
          malformed,
        ], onError: actorError },
    },
    organizationDesign: {
      id: 'organizationDesign', description: 'Analyst generates the complete acceptance organization before any scenario.',
      entry: 'invalidateOrganizationCandidate', tags: 'playbook.busy',
      meta: { playbook: { stateId: 'organizationDesign', description: 'Analyst generates the complete acceptance organization before any scenario.', role: 'analyst' } },
      invoke: { src: 'player', input: ({ context }): PlayerInput => ({ stateId: 'organizationDesign', sourceItem: 'ORGANIZATION-DESIGN', role: 'analyst', prompt: prompts['ORGANIZATION-DESIGN'], result: results['ORGANIZATION-DESIGN'], project: context.project, testDir: context.testDir, skill: context.skill, ...actorFields(context, 'organizationDesign') }),
        onDone: [
          { guard: ({ context, event }) => result(event, 'done') && context.organizationRounds < 3, target: 'organizationReview', actions: [accepted('organizationDesign', 'organizationReview', 'done'), 'clearBossReplyContext', 'organizationBuilt', 'nextOrganizationRound'] },
          replyArm('organizationDesign', 'ORGANIZATION-DESIGN', 'analyst'), malformed,
        ], onError: actorError },
    },
    unitAdvance: {
      id: 'unitAdvance', description: 'Verify completed unit progress and advance to the next pending unit.',
      tags: 'playbook.busy',
      meta: { playbook: { stateId: 'unitAdvance', description: 'Verify completed unit progress and advance to the next pending unit.' } },
      invoke: {
        src: 'script',
        input: ({ context }): ScriptInput => ({ stateId: 'unitAdvance', sourceItem: 'UNIT-ADVANCE', command: scriptCommand(prompts['UNIT-ADVANCE'], context), result: results['UNIT-ADVANCE'] }),
        onDone: [
          { guard: ({ event }) => scriptResult(event, 'passed'), target: 'scenarioDesign', actions: 'unitAdvanced' },
          { guard: ({ event }) => scriptResult(event, 'failed'), target: 'completion', actions: ['rememberUnitAdvanceFailure', 'markIncomplete'] },
          malformed,
        ],
        onError: actorError,
      },
    },
    generationGate: {
      entry: ['invalidateGeneration', 'invalidateScenarioVerdict'],
      id: 'generationGate', description: 'Run the deterministic per-unit scenario-generation checker.', tags: 'playbook.busy',
      meta: { playbook: { stateId: 'generationGate', description: 'Run the deterministic per-unit scenario-generation checker.' } },
      invoke: { src: 'script', input: ({ context }): ScriptInput => ({ stateId: 'generationGate', sourceItem: 'GENERATION-GATE', command: scriptCommand(prompts['GENERATION-GATE'], context), result: results['GENERATION-GATE'] }),
        onDone: [
          { guard: ({ context, event }) => scriptResult(event, 'passed') && context.scenarioRounds < 3, target: 'scenarioReview', actions: ['generationPassed', 'nextScenarioRound'] },
          { guard: ({ event }) => scriptResult(event, 'passed'), target: 'completion', actions: ['generationPassed', 'rememberScenarioLimit', 'markIncomplete'] },
          { guard: ({ event }) => scriptResult(event, 'failed'), target: 'completion', actions: ['rememberGenerationGateFailure', 'markIncomplete'] },
          malformed,
        ], onError: actorError },
    },
    organizationReview: {
      id: 'organizationReview', description: 'Reviewer independently reviews and publishes the acceptance organization.',
      tags: 'playbook.busy', meta: { playbook: { stateId: 'organizationReview', description: 'Reviewer independently reviews and publishes the acceptance organization.', role: 'reviewer' } },
      invoke: { src: 'player', input: ({ context }): PlayerInput => ({ stateId: 'organizationReview', sourceItem: 'ORGANIZATION-1', role: 'reviewer', prompt: prompts['ORGANIZATION-1'], result: results['ORGANIZATION-1'], project: context.project, testDir: context.testDir, skill: context.skill, ...actorFields(context, 'organizationReview') }),
        onDone: [
          { guard: ({ event }) => result(event, 'passed'), target: 'organizationGate', actions: [accepted('organizationReview', 'organizationGate', 'passed'), 'clearBossReplyContext', 'organizationPassed'] },
          { guard: ({ context, event }) => resultWith(event, 'gaps', 'failureDetails') && context.organizationRounds < 3, target: 'organizationRepair', actions: [accepted('organizationReview', 'organizationRepair', 'gaps'), 'clearBossReplyContext', 'rememberFailureDetails'] },
          { guard: ({ event }) => resultWith(event, 'gaps', 'failureDetails'), target: 'completion', actions: [accepted('organizationReview', 'completion', 'gaps'), 'clearBossReplyContext', 'rememberFailureDetails', 'markIncomplete'] },
          replyArm('organizationReview', 'ORGANIZATION-1', 'reviewer'), malformed,
        ], onError: actorError },
    },
    organizationRepair: {
      entry: 'invalidateOrganizationVerdict',
      id: 'organizationRepair', description: 'Analyst repairs the named acceptance-organization candidate gaps.',
      tags: 'playbook.busy', meta: { playbook: { stateId: 'organizationRepair', description: 'Analyst repairs the named acceptance-organization candidate gaps.', role: 'analyst' } },
      invoke: { src: 'player', input: ({ context }): PlayerInput => ({ stateId: 'organizationRepair', sourceItem: 'ORGANIZATION-REPAIR', role: 'analyst', prompt: prompts['ORGANIZATION-REPAIR'], result: results['ORGANIZATION-REPAIR'], project: context.project, testDir: context.testDir, skill: context.skill, failureDetails: context.failureDetails, ...actorFields(context, 'organizationRepair') }),
        onDone: [
          { guard: ({ context, event }) => result(event, 'done') && context.organizationRounds < 3, target: 'organizationReview', actions: [accepted('organizationRepair', 'organizationReview', 'done'), 'clearBossReplyContext', 'organizationBuilt', 'nextOrganizationRound'] },
          { guard: ({ event }) => resultWith(event, 'requirementsGap', 'failureDetails'), target: 'completion', actions: [accepted('organizationRepair', 'completion', 'requirementsGap'), 'clearBossReplyContext', 'rememberFailureDetails', 'markIncomplete'] },
          replyArm('organizationRepair', 'ORGANIZATION-REPAIR', 'analyst'), malformed,
        ], onError: actorError },
    },
    organizationGate: {
      entry: 'invalidateOrganizationGate',
      id: 'organizationGate', description: 'Run the deterministic acceptance-organization checker.',
      tags: 'playbook.busy', meta: { playbook: { stateId: 'organizationGate', description: 'Run the deterministic acceptance-organization checker.' } },
      invoke: { src: 'script', input: ({ context }): ScriptInput => ({ stateId: 'organizationGate', sourceItem: 'ORGANIZATION-GATE', command: scriptCommand(prompts['ORGANIZATION-GATE'], context), result: results['ORGANIZATION-GATE'] }),
        onDone: [
          { guard: ({ event }) => scriptResult(event, 'passed'), target: 'scenarioDesign', actions: 'organizationGatePassed' },
          { guard: ({ context, event }) => scriptResult(event, 'failed') && context.organizationRounds < 3, target: 'organizationRepair', actions: 'rememberOrganizationGateFailure' },
          { guard: ({ event }) => scriptResult(event, 'failed'), target: 'completion', actions: ['rememberOrganizationGateFailure', 'markIncomplete'] },
          malformed,
        ], onError: actorError },
    },
    scenarioDesign: {
      entry: ['invalidateDraft', 'invalidateGeneration', 'invalidateScenarioVerdict'],
      id: 'scenarioDesign', description: 'Analyst generates the next unit’s scenarios with embedded acceptance in the fixed design stage.',
      tags: 'playbook.busy', meta: { playbook: { stateId: 'scenarioDesign', description: 'Analyst generates the next unit’s scenarios with embedded acceptance in the fixed design stage.', role: 'analyst' } },
      invoke: { src: 'player', input: ({ context }): PlayerInput => ({ stateId: 'scenarioDesign', role: 'analyst', sourceItem: 'DESIGN-1', prompt: prompts['DESIGN-1'], project: context.project, testDir: context.testDir, skill: context.skill, result: results['DESIGN-1'], ...actorFields(context, 'scenarioDesign') }),
        onDone: [
          { guard: ({ event }) => result(event, 'done'), target: 'generationGate', actions: [accepted('scenarioDesign', 'generationGate', 'done'), 'clearBossReplyContext', 'scenariosBuilt'] },
          { guard: ({ event }) => result(event, 'more'), target: 'unitAdvance', actions: [accepted('scenarioDesign', 'unitAdvance', 'more'), 'clearBossReplyContext', 'unitCompleted'] },
          replyArm('scenarioDesign', 'DESIGN-1', 'analyst'), malformed,
        ], onError: actorError },
    },
    scenarioReview: {
      id: 'scenarioReview', description: 'Reviewer independently checks requirement coverage and scenario meaning.',
      tags: 'playbook.busy', meta: { playbook: { stateId: 'scenarioReview', description: 'Reviewer independently checks requirement coverage and scenario meaning.', role: 'reviewer' } },
      invoke: { src: 'player', input: ({ context }): PlayerInput => ({ stateId: 'scenarioReview', role: 'reviewer', sourceItem: 'REVIEW-1', prompt: prompts['REVIEW-1'], project: context.project, testDir: context.testDir, skill: context.skill, result: results['REVIEW-1'], ...actorFields(context, 'scenarioReview') }),
        onDone: [
          { guard: ({ event }) => result(event, 'passed'), target: 'blackBoxGate', actions: [accepted('scenarioReview', 'blackBoxGate', 'passed'), 'clearBossReplyContext', 'scenarioPassed'] },
          { guard: ({ context, event }) => resultWith(event, 'gaps', 'failureDetails') && context.scenarioRounds < 3, target: 'scenarioRepair', actions: [accepted('scenarioReview', 'scenarioRepair', 'gaps'), 'clearBossReplyContext', 'rememberFailureDetails'] },
          { guard: ({ event }) => resultWith(event, 'gaps', 'failureDetails'), target: 'completion', actions: [accepted('scenarioReview', 'completion', 'gaps'), 'clearBossReplyContext', 'rememberFailureDetails', 'markIncomplete'] },
          replyArm('scenarioReview', 'REVIEW-1', 'reviewer'), malformed,
        ], onError: actorError },
    },
    scenarioRepair: {
      entry: ['invalidateGeneration', 'invalidateScenarioVerdict'],
      id: 'scenarioRepair', description: 'Analyst repairs the named scenario gaps or the black-box stage failure.',
      tags: 'playbook.busy', meta: { playbook: { stateId: 'scenarioRepair', description: 'Analyst repairs the named scenario gaps or the black-box stage failure.', role: 'analyst' } },
      invoke: { src: 'player', input: ({ context }): PlayerInput => ({ stateId: 'scenarioRepair', role: 'analyst', sourceItem: 'REPAIR-1', prompt: prompts['REPAIR-1'], project: context.project, testDir: context.testDir, skill: context.skill, failureDetails: context.failureDetails, result: results['REPAIR-1'], ...actorFields(context, 'scenarioRepair') }),
        onDone: [
          { guard: ({ event }) => result(event, 'done'), target: 'generationGate', actions: [accepted('scenarioRepair', 'generationGate', 'done'), 'clearBossReplyContext'] },
          replyArm('scenarioRepair', 'REPAIR-1', 'analyst'), malformed,
        ], onError: actorError },
    },
    blackBoxGate: {
      entry: 'invalidateBlackBoxGate',
      id: 'blackBoxGate', description: 'Run the deterministic black-box stage checker on the reviewed scenarios.',
      tags: 'playbook.busy', meta: { playbook: { stateId: 'blackBoxGate', description: 'Run the deterministic black-box stage checker on the reviewed scenarios.' } },
      invoke: { src: 'script', input: ({ context }): ScriptInput => ({ stateId: 'blackBoxGate', sourceItem: 'GATE-1', command: scriptCommand(prompts['GATE-1'], context), result: results['GATE-1'] }),
        onDone: [
          { guard: ({ event }) => scriptResult(event, 'passed'), target: 'completion', actions: 'gatePassed' },
          { guard: ({ context, event }) => scriptResult(event, 'failed') && context.scenarioRounds < 3, target: 'scenarioRepair', actions: 'rememberScriptFailure' },
          { guard: ({ event }) => scriptResult(event, 'failed'), target: 'completion', actions: ['rememberScriptFailure', 'markIncomplete'] },
          malformed,
        ], onError: actorError },
    },
    completion: {
      id: 'completion', description: 'Captain reports the scenarios-ready design deliverable or the exact incomplete outcome.',
      tags: 'playbook.busy', meta: { playbook: { stateId: 'completion', description: 'Captain reports the scenarios-ready design deliverable or the exact incomplete outcome.' } },
      invoke: { src: 'captain', input: ({ context }): CaptainInput => ({ stateId: 'completion', sourceItem: 'COMPLETION-1', prompt: prompts['COMPLETION-1'], project: context.project, testDir: context.testDir, failureDetails: context.failureDetails, result: results['COMPLETION-1'], ...actorFields(context, 'completion') }),
        onDone: [
          { guard: ({ context, event }) => resultWith(event, 'scenariosReady', 'response') && context.scenarioReviewPassed && context.blackBoxGatePassed, target: 'terminalAnalysisProof', actions: ['clearBossReplyContext', 'rememberResponse'] },
          { guard: ({ context, event }) => resultWith(event, 'incomplete', 'response') && context.incompleteReady && nonempty(context.failureDetails), target: 'incomplete', actions: ['clearBossReplyContext', 'rememberResponse'] },
          replyArm('completion', 'COMPLETION-1'), malformed,
        ], onError: actorError },
    },
    terminalAnalysisProof: {
      id: 'terminalAnalysisProof', description: 'Verify the source-analysis script gate before successful completion.',
      meta: { playbook: { stateId: 'terminalAnalysisProof', description: 'Verify the source-analysis script gate before successful completion.' } },
      always: [
        { guard: ({ context }) => context.analysisGatePassed, target: 'terminalOrganizationProof' },
        { target: 'incomplete', actions: assign(({ context }) => ({
          incompleteReady: true,
          failureDetails: `Required script gate proof is missing; inspect ${context.testDir}/delivery-acceptance/analysis-gate.json`,
          response: `Scenario design incomplete: required script gate proof is missing; inspect ${context.testDir}/delivery-acceptance/analysis-gate.json. No App behavior was executed or accepted.`,
        })) },
      ],
    },
    terminalOrganizationProof: {
      id: 'terminalOrganizationProof', description: 'Verify the organization script gate before successful completion.',
      meta: { playbook: { stateId: 'terminalOrganizationProof', description: 'Verify the organization script gate before successful completion.' } },
      always: [
        { guard: ({ context }) => context.organizationGatePassed, target: 'terminalGenerationProof' },
        { target: 'incomplete', actions: assign(({ context }) => ({
          incompleteReady: true,
          failureDetails: `Required script gate proof is missing; inspect ${context.testDir}/delivery-acceptance/organization-gate.json`,
          response: `Scenario design incomplete: required script gate proof is missing; inspect ${context.testDir}/delivery-acceptance/organization-gate.json. No App behavior was executed or accepted.`,
        })) },
      ],
    },
    terminalGenerationProof: {
      id: 'terminalGenerationProof', description: 'Verify the generation script gate before successful completion.',
      meta: { playbook: { stateId: 'terminalGenerationProof', description: 'Verify the generation script gate before successful completion.' } },
      always: [
        { guard: ({ context }) => context.generationGatePassed, target: 'scenariosReady' },
        { target: 'incomplete', actions: assign(({ context }) => ({
          incompleteReady: true,
          failureDetails: `Required script gate proof is missing; inspect ${context.testDir}/delivery-acceptance/generation-gate.json`,
          response: `Scenario design incomplete: required script gate proof is missing; inspect ${context.testDir}/delivery-acceptance/generation-gate.json. No App behavior was executed or accepted.`,
        })) },
      ],
    },
    awaitBossReply: {
      id: 'awaitBossReply', description: "Waiting for Boss to answer the acting agent's question.",
      tags: 'playbook.parked', meta: { playbook: { stateId: 'awaitBossReply', description: "Waiting for Boss to answer the acting agent's question." } },
      on: { START: admission, BOSS_TASK: admission, BOSS_REPLY: [
        ...resumableStates(['sourceAnalysis', 'organizationDesign', 'entry', 'organizationReview', 'organizationRepair', 'scenarioDesign', 'scenarioReview', 'scenarioRepair', 'completion']),
        { target: 'failed', actions: ['clearBossReplyContext', 'rememberMalformedReply'] },
      ] },
    },
    failed: {
      id: 'failed', description: 'An actor or control error requires Boss recovery.',
      tags: 'playbook.parked', meta: { playbook: { stateId: 'failed', description: 'An actor or control error requires Boss recovery.' } },
      on: { START: admission, BOSS_TASK: admission },
    },
    scenariosReady: {
      id: 'scenariosReady', type: 'final', description: 'Scenario design completed: independent review and the source-analysis, organization, generation and design-stage script gates passed.',
      meta: { playbook: { stateId: 'scenariosReady', description: 'Scenario design completed: independent review and the source-analysis, organization, generation and design-stage script gates passed.', terminal: 'success' } },
    },
    incomplete: {
      id: 'incomplete', type: 'final', description: 'Black-box scenario design did not complete: source analysis, organization, generation or black-box verification could not complete, material gaps remained after the allowed repairs, or confirmed requirements were unavailable.',
      meta: { playbook: { stateId: 'incomplete', description: 'Black-box scenario design did not complete: source analysis, organization, generation or black-box verification could not complete, material gaps remained after the allowed repairs, or confirmed requirements were unavailable.', terminal: 'failure' } },
    },
  },
});

export default blackBoxScenariosMachine;
