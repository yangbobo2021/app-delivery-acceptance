// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
// FSM: ./delivery-acceptance.fsm.ts (deliveryAcceptanceMachine).
// Linked under slc/link.md: shared schema-3 runtime, deterministic BOSS_TASK entry,
// shared Boss classification and LLM adjudication, natural rejection on abort.
// Custom composition: literal standalone quoted relays; typed required-field exceptions.
// Source-only package: the host loads erasable TypeScript directly.
import machine from './delivery-acceptance.fsm.ts';
import {
  createXStatePlaybookRuntime, snapshotJsonValue, composePlayerContinuation,
  defaultExtractRequiredFields,
  type PlaybookPlayerInput, type PlaybookCaptainInput, type XStatePromptIdentity,
  type XStatePlaybookRuntimeConstruction, type XStatePlaybookRuntimeFactory,
  type XStatePlaybookRuntimeSpecV3,
} from '@sublang/playbook/xstate-runtime';
import type { JsonValue } from '@sublang/playbook/runtime';
export type {
  PlayerResult, PlayerCallOptions, PlayerSessionStore, CaptainResult,
  CaptainCallOptions, JsonValue, NormalizedError, PlaybookPorts, PlaybookSession,
  PlaybookTraceEvent, PlaybookTraceType, PlaybookCallRequest, PlaybookCallResult,
  PlaybookCallStart, PlaybookStateValue, PlaybookState, PlaybookRunResult,
  PlaybookRuntime, PlaybookRuntimeFactory, PlaybookRuntimeSnapshot,
  PlaybookControlView, PlaybookControlReceipt,
} from '@sublang/playbook/runtime';

export interface PlaybookRuntimeOptions {
  readonly project: string;
  readonly testDir: string;
  readonly requirementsFile: string;
  readonly skill: string;
  readonly coverageMode?: 'standard' | 'coverage';
  readonly cwd?: string;
}
// Live authority is validated by the Captain host; it is never an FSM option.
export type PlaybookHostCapabilities = XStatePlaybookRuntimeConstruction<
  PlaybookRuntimeOptions, { readonly authority: object }
>['hostCapabilities'];

export function validateOptions(value: unknown): PlaybookRuntimeOptions {
  const captured = snapshotJsonValue(value === undefined ? {} : value, 'DELIVERY-ACCEPTANCE runtime options');
  if (captured === null || typeof captured !== 'object' || Array.isArray(captured)) {
    throw new TypeError('DELIVERY-ACCEPTANCE runtime options must be an object');
  }
  const fields = captured as Readonly<Record<string, JsonValue>>;
  const required = ['project', 'testDir', 'requirementsFile', 'skill'] as const;
  for (const key of Object.keys(fields)) {
    if (![...required, 'coverageMode', 'cwd'].includes(key)) throw new TypeError('Undeclared runtime option: ' + key);
  }
  for (const key of required) {
    if (typeof fields[key] !== 'string') throw new TypeError('Runtime option ' + key + ' must be a string');
  }
  if (Object.hasOwn(fields, 'coverageMode') && fields.coverageMode !== 'standard' && fields.coverageMode !== 'coverage') {
    throw new TypeError('coverageMode must be standard or coverage');
  }
  if (Object.hasOwn(fields, 'cwd') && typeof fields.cwd !== 'string') throw new TypeError('cwd must be a string');
  return captured as unknown as PlaybookRuntimeOptions;
}

const VERBATIM_PAYLOAD_FIELDS: ReadonlySet<string> = new Set([
  "scenarioFindings",
  "reviewFindings",
  "coverageFindings"
]);
const UNFINISHED_FINAL_STATE_IDS: ReadonlySet<string> = new Set(['incomplete']);
const RESUMABLE_STATE_IDS: ReadonlySet<string> = new Set([
  "entry1",
  "sourceAnalysis",
  "organizationDesign",
  "organizationReview",
  "organizationRepair",
  "resource1",
  "scenario1",
  "scenario2",
  "scenario3",
  "scenario5",
  "execution1",
  "executionPrepare",
  "executionOperate",
  "executionEvaluate",
  "executionRecordRepair",
  "execution2",
  "execution4",
  "execution5",
  "coverage1",
  "coverage2",
  "coverage4",
  "completion1"
]);
// These descriptions name failureDetails without an Output-shall-include clause.
// PlayerOutput and validResult explicitly require it for both arms.
const REQUIRED_FIELD_EXCEPTIONS: Readonly<Record<string, readonly string[]>> = {
  "Analyst repairs named gaps at ORGANIZATION-REPAIR while fewer than three organization review rounds have occurred; otherwise finish incomplete with exact failureDetails. This counter is separate from scenario/coverage rounds and never reset by recovery.": [
    "failureDetails"
  ],
  "genuine business ambiguity remains; finish incomplete with exact failureDetails.": [
    "failureDetails"
  ]
};
function extractRequiredFields(description: string): string[] {
  return Object.hasOwn(REQUIRED_FIELD_EXCEPTIONS, description)
    ? [...REQUIRED_FIELD_EXCEPTIONS[description]!]
    : defaultExtractRequiredFields(description);
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  const record = value as Readonly<Record<string, JsonValue>>;
  return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + stableJson(record[key]!)).join(',') + '}';
}
function composeBody(input: PlaybookPlayerInput | PlaybookCaptainInput, structured: boolean): string {
  const fields = input as unknown as Readonly<Record<string, unknown>>;
  // Match only the original template. Inserted text is never processed again.
  return input.prompt.replace(
    /^> <(#|[A-Za-z_$][A-Za-z0-9_$-]*)>(\r?\n|$)|<(#|[A-Za-z_$][A-Za-z0-9_$-]*)>/gm,
    (match: string, quoted: string | undefined, ending: string | undefined, inline: string | undefined): string => {
      const token = quoted ?? inline!;
      const key = token === '#' ? 'irNumber' : token.replace(/-([A-Za-z0-9])/g, (_match: string, next: string) => next.toUpperCase());
      if (!Object.hasOwn(fields, key)) return match;
      const raw = fields[key];
      const value = typeof raw === 'string' ? raw
        : structured && raw !== null && typeof raw === 'object'
          ? stableJson(snapshotJsonValue(raw, 'Captain prompt field ' + key)) : undefined;
      if (value === undefined) return match;
      if (quoted === undefined) return value;
      if (value === '') return '';
      return value.split(/(\r?\n)/).map((part, index) => index % 2 === 0 && part !== '' ? '> ' + part : part).join('') + (ending ?? '');
    },
  );
}
function composePlayerPrompt(input: PlaybookPlayerInput, _identity?: XStatePromptIdentity, resuming = false): string {
  return composePlayerContinuation(input, composeBody(input, false), resuming);
}
function composeCaptainPrompt(input: PlaybookCaptainInput): string {
  return composePlayerContinuation(input, composeBody(input, true), false);
}

const runtimeSpec = {
  ...{
  "label": "DELIVERY-ACCEPTANCE",
  "compat": {
    "artifactSchema": 3,
    "runtimeAbi": 1
  },
  "entryEvent": {
    "type": "BOSS_TASK",
    "textField": "bossIntent",
    "contextField": "bossIntent"
  },
  "bossEvents": [],
  "placeholderFields": {},
  "roleStates": {
    "entry1": {
      "role": "analyst",
      "label": "Check confirmed requirement IDs and initialize or import the ledger."
    },
    "sourceAnalysis": {
      "role": "analyst",
      "label": "Analyze the original requirements and material source rules."
    },
    "organizationDesign": {
      "role": "analyst",
      "label": "Build the complete acceptance organization before scene generation."
    },
    "organizationReview": {
      "role": "reviewer",
      "label": "Independently review and publish the acceptance organization."
    },
    "organizationRepair": {
      "role": "analyst",
      "label": "Repair the named acceptance organization gaps."
    },
    "resource1": {
      "role": "analyst",
      "label": "Verify and record resources, integration evidence, and required decisions."
    },
    "scenario1": {
      "role": "analyst",
      "label": "Map requirements and material implementation branches to acceptance scenarios."
    },
    "scenario2": {
      "role": "reviewer",
      "label": "Independently challenge scenario coverage and record the review."
    },
    "scenario3": {
      "role": "analyst",
      "label": "Repair the independently identified scenario gaps."
    },
    "scenario5": {
      "role": "analyst",
      "label": "Repair the failed pre-execution structural gate."
    },
    "execution1": {
      "role": "tester",
      "label": "Select the next scenario or close and record the frozen execution scope."
    },
    "executionPrepare": {
      "role": "tester",
      "label": "Choose and prepare only this scenario tests in project locations."
    },
    "executionOperate": {
      "role": "tester",
      "label": "Execute one scenario and persist real evidence."
    },
    "executionEvaluate": {
      "role": "reviewer",
      "label": "Independently evaluate this scenario and record issues without product repair."
    },
    "executionRecordRepair": {
      "role": "reviewer",
      "label": "Independently diagnose and reopen the current scenario for recording repair."
    },
    "execution2": {
      "role": "reviewer",
      "label": "Independently review the run’s actual evidence and script reports."
    },
    "execution4": {
      "role": "analyst",
      "label": "Repair the evidence-recording definitions before a new full run."
    },
    "execution5": {
      "role": "analyst",
      "label": "Repair the run’s structural gate issues before a new full run."
    },
    "coverage1": {
      "role": "tester",
      "label": "Collect actual code coverage for the current enhanced run."
    },
    "coverage2": {
      "role": "reviewer",
      "label": "Independently review enhanced coverage and residual testing gaps."
    },
    "coverage4": {
      "role": "analyst",
      "label": "Repair enhanced testing gaps and prepare a new design review."
    }
  },
  "outcomeAuthority": {
    "governedPlayerStates": {
      "entry1": {
        "ready": {
          "fields": {},
          "repositoryDisposition": "unchanged"
        },
        "requirementsGap": {
          "fields": {
            "failureDetails": "semantic"
          },
          "repositoryDisposition": "unchanged"
        },
        "needsBossReply": {
          "fields": {
            "question": "presentation"
          },
          "repositoryDisposition": "unchanged"
        }
      },
      "sourceAnalysis": {
        "done": {
          "fields": {},
          "repositoryDisposition": "unchanged"
        },
        "requirementsGap": {
          "fields": {
            "failureDetails": "semantic"
          },
          "repositoryDisposition": "unchanged"
        },
        "needsBossReply": {
          "fields": {
            "question": "presentation"
          },
          "repositoryDisposition": "unchanged"
        }
      },
      "organizationDesign": {
        "done": {
          "fields": {},
          "repositoryDisposition": "unchanged"
        },
        "needsBossReply": {
          "fields": {
            "question": "presentation"
          },
          "repositoryDisposition": "unchanged"
        }
      },
      "organizationReview": {
        "passed": {
          "fields": {},
          "repositoryDisposition": "unchanged"
        },
        "gaps": {
          "fields": {
            "failureDetails": "semantic"
          },
          "repositoryDisposition": "unchanged"
        },
        "needsBossReply": {
          "fields": {
            "question": "presentation"
          },
          "repositoryDisposition": "unchanged"
        }
      },
      "organizationRepair": {
        "done": {
          "fields": {},
          "repositoryDisposition": "unchanged"
        },
        "requirementsGap": {
          "fields": {
            "failureDetails": "semantic"
          },
          "repositoryDisposition": "unchanged"
        },
        "needsBossReply": {
          "fields": {
            "question": "presentation"
          },
          "repositoryDisposition": "unchanged"
        }
      },
      "resource1": {
        "ready": {
          "fields": {},
          "repositoryDisposition": "unchanged"
        },
        "environmentBlocked": {
          "fields": {
            "failureDetails": "semantic"
          },
          "repositoryDisposition": "unchanged"
        },
        "needsBossReply": {
          "fields": {
            "question": "presentation"
          },
          "repositoryDisposition": "unchanged"
        }
      },
      "scenario1": {
        "more": {
          "fields": {},
          "repositoryDisposition": "unchanged"
        },
        "done": {
          "fields": {},
          "repositoryDisposition": "unchanged"
        },
        "needsBossReply": {
          "fields": {
            "question": "presentation"
          },
          "repositoryDisposition": "unchanged"
        }
      },
      "scenario2": {
        "passed": {
          "fields": {},
          "repositoryDisposition": "unchanged"
        },
        "gaps": {
          "fields": {
            "scenarioFindings": "presentation"
          },
          "repositoryDisposition": "unchanged"
        },
        "needsBossReply": {
          "fields": {
            "question": "presentation"
          },
          "repositoryDisposition": "unchanged"
        }
      },
      "scenario3": {
        "done": {
          "fields": {},
          "repositoryDisposition": "unchanged"
        },
        "needsBossReply": {
          "fields": {
            "question": "presentation"
          },
          "repositoryDisposition": "unchanged"
        }
      },
      "scenario5": {
        "done": {
          "fields": {},
          "repositoryDisposition": "unchanged"
        },
        "needsBossReply": {
          "fields": {
            "question": "presentation"
          },
          "repositoryDisposition": "unchanged"
        }
      },
      "execution1": {
        "selected": {
          "fields": {
            "runId": "semantic",
            "scenarioId": "semantic"
          },
          "repositoryDisposition": "unchanged"
        },
        "recorded": {
          "fields": {
            "runId": "semantic"
          },
          "repositoryDisposition": "unchanged"
        },
        "partialRecorded": {
          "fields": {
            "runId": "semantic"
          },
          "repositoryDisposition": "unchanged"
        },
        "needsBossReply": {
          "fields": {
            "question": "presentation"
          },
          "repositoryDisposition": "unchanged"
        }
      },
      "executionPrepare": {
        "ready": {
          "fields": {},
          "repositoryDisposition": "unchanged"
        },
        "testsPrepared": {
          "fields": {},
          "repositoryDisposition": "one-descendant-commit"
        },
        "blockedRecorded": {
          "fields": {},
          "repositoryDisposition": "unchanged"
        },
        "needsBossReply": {
          "fields": {
            "question": "presentation"
          },
          "repositoryDisposition": "deferred"
        }
      },
      "executionOperate": {
        "observed": {
          "fields": {},
          "repositoryDisposition": "unchanged"
        },
        "needsBossReply": {
          "fields": {
            "question": "presentation"
          },
          "repositoryDisposition": "unchanged"
        }
      },
      "executionEvaluate": {
        "evaluated": {
          "fields": {},
          "repositoryDisposition": "unchanged"
        },
        "repairRequired": {
          "fields": {
            "executionFindings": "semantic"
          },
          "repositoryDisposition": "unchanged"
        },
        "needsBossReply": {
          "fields": {
            "question": "presentation"
          },
          "repositoryDisposition": "unchanged"
        }
      },
      "executionRecordRepair": {
        "repairRequired": {
          "fields": {
            "executionFindings": "semantic"
          },
          "repositoryDisposition": "unchanged"
        },
        "invalidated": {
          "fields": {
            "failureDetails": "semantic"
          },
          "repositoryDisposition": "unchanged"
        },
        "needsBossReply": {
          "fields": {
            "question": "presentation"
          },
          "repositoryDisposition": "unchanged"
        }
      },
      "execution2": {
        "sufficient": {
          "fields": {},
          "repositoryDisposition": "unchanged"
        },
        "repairable": {
          "fields": {
            "reviewFindings": "presentation"
          },
          "repositoryDisposition": "unchanged"
        },
        "partial": {
          "fields": {
            "reviewFindings": "presentation"
          },
          "repositoryDisposition": "unchanged"
        },
        "productFailed": {
          "fields": {
            "reviewFindings": "presentation"
          },
          "repositoryDisposition": "unchanged"
        },
        "needsBossReply": {
          "fields": {
            "question": "presentation"
          },
          "repositoryDisposition": "unchanged"
        }
      },
      "execution4": {
        "done": {
          "fields": {},
          "repositoryDisposition": "unchanged"
        },
        "needsBossReply": {
          "fields": {
            "question": "presentation"
          },
          "repositoryDisposition": "unchanged"
        }
      },
      "execution5": {
        "done": {
          "fields": {},
          "repositoryDisposition": "unchanged"
        },
        "needsBossReply": {
          "fields": {
            "question": "presentation"
          },
          "repositoryDisposition": "unchanged"
        }
      },
      "coverage1": {
        "measured": {
          "fields": {},
          "repositoryDisposition": "unchanged"
        },
        "blocked": {
          "fields": {
            "failureDetails": "semantic"
          },
          "repositoryDisposition": "unchanged"
        },
        "needsBossReply": {
          "fields": {
            "question": "presentation"
          },
          "repositoryDisposition": "unchanged"
        }
      },
      "coverage2": {
        "sufficient": {
          "fields": {},
          "repositoryDisposition": "unchanged"
        },
        "gaps": {
          "fields": {
            "coverageFindings": "presentation"
          },
          "repositoryDisposition": "unchanged"
        },
        "productFailed": {
          "fields": {
            "failureDetails": "semantic"
          },
          "repositoryDisposition": "unchanged"
        },
        "blocked": {
          "fields": {
            "failureDetails": "semantic"
          },
          "repositoryDisposition": "unchanged"
        },
        "needsBossReply": {
          "fields": {
            "question": "presentation"
          },
          "repositoryDisposition": "unchanged"
        }
      },
      "coverage4": {
        "done": {
          "fields": {},
          "repositoryDisposition": "unchanged"
        },
        "needsBossReply": {
          "fields": {
            "question": "presentation"
          },
          "repositoryDisposition": "unchanged"
        }
      }
    }
  },
  "transitionEventFields": [
    "bossIntent",
    "targetId",
    "answer",
    "questionId"
  ],
  "controlContextFields": []
},
  snapshotOptions: validateOptions,
  machineInput: (options: PlaybookRuntimeOptions) => ({
    project: options.project, testDir: options.testDir,
    requirementsFile: options.requirementsFile, skill: options.skill,
    ...(options.coverageMode === undefined ? {} : { coverageMode: options.coverageMode }),
  }),
  composePlayerPrompt,
  composeCaptainPrompt,
  extractRequiredFields,
  verbatimPayloadFields: VERBATIM_PAYLOAD_FIELDS,
  unfinishedFinalStateIds: UNFINISHED_FINAL_STATE_IDS,
  resumableStateIds: RESUMABLE_STATE_IDS,
} satisfies XStatePlaybookRuntimeSpecV3<PlaybookRuntimeOptions>;

export const _internal = {
  composePlayerPrompt, composeCaptainPrompt, extractRequiredFields,
  VERBATIM_PAYLOAD_FIELDS, UNFINISHED_FINAL_STATE_IDS, RESUMABLE_STATE_IDS,
};
const createPlaybookRuntime: XStatePlaybookRuntimeFactory<
  XStatePlaybookRuntimeConstruction<PlaybookRuntimeOptions, PlaybookHostCapabilities>, 3
> = createXStatePlaybookRuntime<PlaybookRuntimeOptions, PlaybookHostCapabilities>(machine, runtimeSpec);
export default createPlaybookRuntime;
