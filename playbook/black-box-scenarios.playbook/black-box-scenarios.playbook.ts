// SPDX-License-Identifier: Apache-2.0
// FSM: ./black-box-scenarios.fsm.ts; source-only TypeScript host.
// Definition: @sublang/playbook/slc/link.md; schema 3, ABI 1.
// Strategies: shared LLM adjudication/classification and natural rejection;
// literal quoted relays, typed discussion evidence and typed field extraction.
// Materializer profiles do not support the direct-Captain actor or structured
// discussion evidence. START and BOSS_TASK both carry typed path fields;
// neither is a sole textual entry, so the shared classifier is retained.
// Repository authority: every delegated outcome is explicitly unchanged.
// The root failure terminal incomplete leaves this procedure unfinished.
import machine from './black-box-scenarios.fsm.ts';
import {
  createXStatePlaybookRuntime, snapshotJsonValue, composePlayerContinuation,
  defaultExtractRequiredFields, type PlaybookPlayerInput, type PlaybookCaptainInput,
  type XStatePromptIdentity, type XStatePlaybookRuntimeConstruction,
  type XStatePlaybookRuntimeFactory, type XStatePlaybookRuntimeSpecV3,
} from '@sublang/playbook/xstate-runtime';
export type {
  PlayerResult, PlayerCallOptions, PlayerSessionStore, CaptainResult,
  CaptainCallOptions, PlaybookPorts, PlaybookSession, PlaybookTraceEvent,
  PlaybookCallRequest, PlaybookCallResult, PlaybookCallStart, PlaybookStateValue,
  PlaybookState, PlaybookRunResult, PlaybookRuntime, PlaybookRuntimeFactory,
} from '@sublang/playbook/runtime';
export interface PlaybookRuntimeOptions { readonly cwd?: string }
export type PlaybookHostCapabilities = XStatePlaybookRuntimeConstruction<
  PlaybookRuntimeOptions, { readonly authority: object }
>['hostCapabilities'];
export function validateOptions(value: unknown): PlaybookRuntimeOptions {
  const captured = snapshotJsonValue(value === undefined ? {} : value, 'BLACK-BOX-SCENARIOS options');
  if (captured === null || typeof captured !== 'object' || Array.isArray(captured)) throw new TypeError('Options must be an object');
  const fields = captured as Readonly<Record<string, unknown>>;
  for (const key of Object.keys(fields)) {
    if (key !== 'cwd') throw new TypeError('Undeclared option: ' + key);
  }
  if (Object.hasOwn(fields, 'cwd') && typeof fields.cwd !== 'string') throw new TypeError('cwd must be a string');
  return captured as PlaybookRuntimeOptions;
}
// These two arms declare failureDetails in the exported PlayerOutput type.
const TYPED_RESULT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  "Analyst repairs named gaps at ORGANIZATION-REPAIR while fewer than three organization review rounds have occurred; otherwise finish incomplete with exact failureDetails. This counter is separate from scenario/coverage rounds and never reset by recovery.": [
    "failureDetails"
  ],
  "genuine business ambiguity remains; finish incomplete with exact failureDetails.": [
    "failureDetails"
  ]
};
function extractRequiredFields(description: string): string[] {
  return Object.hasOwn(TYPED_RESULT_FIELDS, description)
    ? [...TYPED_RESULT_FIELDS[description]!]
    : defaultExtractRequiredFields(description);
}

// One callback pass over the original template; inserted tokens stay literal.
function composeBody(input: PlaybookPlayerInput | PlaybookCaptainInput): string {
  const fields = input as unknown as Readonly<Record<string, unknown>>;
  const body = input.prompt.replace(
    /^> <(#|[A-Za-z_$][A-Za-z0-9_$-]*)>(\r?\n|$)|<(#|[A-Za-z_$][A-Za-z0-9_$-]*)>/gm,
    (literal: string, relay: string | undefined, ending: string | undefined, inline: string | undefined) => {
      const token = relay ?? inline!;
      const field = token === '#' ? 'irNumber' : token.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
      const value = fields[field];
      if (typeof value !== 'string') return literal;
      if (relay === undefined) return value;
      if (value === '') return '';
      return value.replace(/^([^\r\n]+)/gm, '> $1') + (ending ?? '');
    },
  );
  if (fields.bossDiscussion === undefined) return body;
  const discussion = snapshotJsonValue(fields.bossDiscussion, 'bossDiscussion');
  if (!Array.isArray(discussion)) throw new TypeError('bossDiscussion must be an array');
  const history = discussion.map(item => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('Invalid Boss discussion');
    const pair = item as Readonly<Record<string, unknown>>;
    if (Object.keys(pair).length !== 2 || typeof pair.question !== 'string' || typeof pair.answer !== 'string') {
      throw new TypeError('Boss discussion requires exactly question and answer strings');
    }
    return { answer: pair.answer, question: pair.question };
  });
  return history.length ? 'Boss discussion:\n' + JSON.stringify(history) + '\n\n' + body : body;
}
function composePlayerPrompt(input: PlaybookPlayerInput, _identity?: XStatePromptIdentity, resuming = false): string {
  return composePlayerContinuation(input, composeBody(input), resuming);
}
function composeCaptainPrompt(input: PlaybookCaptainInput): string {
  return composePlayerContinuation(input, composeBody(input), false);
}

const RESUMABLE_STATE_IDS: ReadonlySet<string> = new Set([
  "entry",
  "sourceAnalysis",
  "analysisGate",
  "organizationDesign",
  "organizationReview",
  "organizationRepair",
  "organizationGate",
  "scenarioDesign",
  "unitAdvance",
  "generationGate",
  "scenarioReview",
  "scenarioRepair",
  "blackBoxGate",
  "completion"
]);
const UNFINISHED_FINAL_STATE_IDS: ReadonlySet<string> = new Set(['incomplete']);
const VERBATIM_PAYLOAD_FIELDS: ReadonlySet<string> = new Set();
const spec: XStatePlaybookRuntimeSpecV3<PlaybookRuntimeOptions> = {
  ...{
  "label": "BLACK-BOX-SCENARIOS",
  "compat": {
    "artifactSchema": 3,
    "runtimeAbi": 1
  },
  "bossEvents": [
    {
      "type": "START",
      "fields": {
        "project": {
          "source": "judge",
          "required": true
        },
        "testDir": {
          "source": "judge",
          "required": true
        },
        "requirementsFile": {
          "source": "judge",
          "required": true
        },
        "skill": {
          "source": "judge",
          "required": true
        }
      }
    },
    {
      "type": "BOSS_TASK",
      "fields": {
        "project": {
          "source": "judge",
          "required": true
        },
        "testDir": {
          "source": "judge",
          "required": true
        },
        "requirementsFile": {
          "source": "judge",
          "required": true
        },
        "skill": {
          "source": "judge",
          "required": true
        }
      }
    },
    {
      "type": "BOSS_INTERRUPT",
      "fields": {
        "targetId": {
          "source": "judge",
          "required": true,
          "values": [
            "entry",
            "sourceAnalysis",
            "analysisGate",
            "organizationDesign",
            "organizationReview",
            "organizationRepair",
            "organizationGate",
            "scenarioDesign",
            "unitAdvance",
            "generationGate",
            "scenarioReview",
            "scenarioRepair",
            "blackBoxGate",
            "completion"
          ]
        }
      }
    }
  ],
  "roleStates": {
    "entry": {
      "role": "analyst",
      "label": "Analyst validates and initializes the confirmed requirements file."
    },
    "sourceAnalysis": {
      "role": "analyst",
      "label": "Analyst analyzes all confirmed source requirements before acceptance organization."
    },
    "organizationDesign": {
      "role": "analyst",
      "label": "Analyst generates the complete acceptance organization before any scenario."
    },
    "organizationReview": {
      "role": "reviewer",
      "label": "Reviewer independently reviews and publishes the acceptance organization."
    },
    "organizationRepair": {
      "role": "analyst",
      "label": "Analyst repairs the named acceptance-organization candidate gaps."
    },
    "scenarioDesign": {
      "role": "analyst",
      "label": "Analyst generates the next unit’s scenarios with embedded acceptance in the fixed design stage."
    },
    "scenarioReview": {
      "role": "reviewer",
      "label": "Reviewer independently checks requirement coverage and scenario meaning."
    },
    "scenarioRepair": {
      "role": "analyst",
      "label": "Analyst repairs the named scenario gaps or the black-box stage failure."
    }
  },
  "outcomeAuthority": {
    "governedPlayerStates": {
      "entry": {
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
      "scenarioDesign": {
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
      "scenarioReview": {
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
      "scenarioRepair": {
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
  "placeholderFields": {},
  "transitionEventFields": [
    "project",
    "testDir",
    "requirementsFile",
    "skill",
    "targetId",
    "answer",
    "questionId"
  ],
  "controlContextFields": []
},
  snapshotOptions: validateOptions,
  machineInput: () => ({}),
  composePlayerPrompt, composeCaptainPrompt, extractRequiredFields,
  resumableStateIds: RESUMABLE_STATE_IDS,
  unfinishedFinalStateIds: UNFINISHED_FINAL_STATE_IDS,
  verbatimPayloadFields: VERBATIM_PAYLOAD_FIELDS,
} satisfies XStatePlaybookRuntimeSpecV3<PlaybookRuntimeOptions>;
export const _internal = {
  composePlayerPrompt, composeCaptainPrompt, extractRequiredFields,
  RESUMABLE_STATE_IDS, UNFINISHED_FINAL_STATE_IDS, VERBATIM_PAYLOAD_FIELDS,
};
const createPlaybookRuntime: XStatePlaybookRuntimeFactory<
  XStatePlaybookRuntimeConstruction<PlaybookRuntimeOptions, PlaybookHostCapabilities>, 3
> = createXStatePlaybookRuntime<PlaybookRuntimeOptions, PlaybookHostCapabilities>(machine, spec);
export default createPlaybookRuntime;
