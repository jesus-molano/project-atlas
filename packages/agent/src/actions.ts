import type { ActionCapabilityManifest } from "./types.js";

export const ACTION_MANIFEST_VERSION = 1 as const;

export const projectAtlasActions: readonly ActionCapabilityManifest[] = [
  {
    schemaVersion: ACTION_MANIFEST_VERSION,
    id: "rescan-code",
    intent: "Bring repository structure and impact evidence up to date",
    description: "Rescan changed code locally and publish one atomic snapshot.",
    runtime: "atlas",
    executionClass: "local",
    risk: "low",
    inputs: [],
    capabilities: [],
    possibleWrites: ["derived-index"],
    expectedQuestions: [],
    resultKind: "scan-summary",
    cancellable: true,
    resumable: false,
    timeoutMs: 120_000,
  },
  {
    schemaVersion: ACTION_MANIFEST_VERSION,
    id: "reindex-memory",
    intent: "Rebuild searchable project knowledge from approved Markdown",
    description: "Reindex local and canonical memory without promoting new facts.",
    runtime: "atlas",
    executionClass: "local",
    risk: "low",
    inputs: [],
    capabilities: [],
    possibleWrites: ["derived-index"],
    expectedQuestions: [],
    resultKind: "scan-summary",
    cancellable: true,
    resumable: false,
    timeoutMs: 120_000,
  },
  {
    schemaVersion: ACTION_MANIFEST_VERSION,
    id: "prepare-frontend-task",
    intent: "Prepare a frontend task with only the evidence it needs",
    description:
      "Run frontend-task read-only, using optional connected sources and bounded Atlas context.",
    runtime: "agent",
    skill: "frontend-task",
    adapter: "codex",
    executionClass: "agent-assisted",
    risk: "medium",
    inputs: [
      {
        id: "task",
        label: "Task intent",
        type: "multiline",
        required: true,
      },
      {
        id: "sources",
        label: "Source references",
        type: "reference",
        required: false,
      },
    ],
    capabilities: [
      {
        id: "project-atlas",
        importance: "optional",
        reason: "Adds compact reuse, impact, design, and memory evidence.",
      },
    ],
    possibleWrites: [],
    expectedQuestions: [
      "Material source contradiction",
      "Unconfirmed target or behavior",
    ],
    resultKind: "task-brief",
    cancellable: true,
    resumable: true,
    timeoutMs: 30 * 60_000,
    fallback: {
      label: "Copy reviewed package",
      detail: "Continue in Codex manually with the same bounded context.",
    },
  },
  {
    schemaVersion: ACTION_MANIFEST_VERSION,
    id: "implement-frontend-task",
    intent: "Implement the reviewed frontend task in the selected checkout",
    description:
      "Run frontend-task with workspace write access after project, sources, budget, and potential writes are reviewed.",
    runtime: "agent",
    skill: "frontend-task",
    adapter: "codex",
    executionClass: "agent-assisted",
    risk: "high",
    inputs: [
      {
        id: "task",
        label: "Task intent",
        type: "multiline",
        required: true,
      },
      {
        id: "sources",
        label: "Source references",
        type: "reference",
        required: false,
      },
    ],
    capabilities: [],
    possibleWrites: ["checkout"],
    expectedQuestions: [
      "High-risk behavior checkpoint",
      "Material source contradiction",
      "External or destructive action approval",
    ],
    resultKind: "task-outcome",
    cancellable: true,
    resumable: true,
    timeoutMs: 45 * 60_000,
    fallback: {
      label: "Open task in Codex",
      actionId: "prepare-frontend-task",
      detail: "Use the reviewed read-only brief and implement from Codex.",
    },
  },
  {
    schemaVersion: ACTION_MANIFEST_VERSION,
    id: "continue-frontend-task",
    intent: "Continue or correct the current task without repeating onboarding",
    description:
      "Resume the same agent thread and send only the changed intent, evidence, or answer.",
    runtime: "agent",
    skill: "frontend-task",
    adapter: "codex",
    executionClass: "agent-assisted",
    risk: "high",
    inputs: [
      {
        id: "task",
        label: "Correction or next step",
        type: "multiline",
        required: true,
      },
    ],
    capabilities: [],
    possibleWrites: ["checkout"],
    expectedQuestions: ["New behavior or source contradiction"],
    resultKind: "task-outcome",
    cancellable: true,
    resumable: true,
    timeoutMs: 45 * 60_000,
  },
  {
    schemaVersion: ACTION_MANIFEST_VERSION,
    id: "ask-codex-selection",
    intent: "Ask a focused question about selected evidence",
    description:
      "Send selected handles and a bounded question to Codex without claiming a native integration.",
    runtime: "agent",
    adapter: "codex",
    executionClass: "agent-assisted",
    risk: "medium",
    inputs: [
      {
        id: "question",
        label: "Question",
        type: "multiline",
        required: true,
      },
    ],
    capabilities: [],
    possibleWrites: [],
    expectedQuestions: ["Material ambiguity in the selection"],
    resultKind: "selection-answer",
    cancellable: true,
    resumable: true,
    timeoutMs: 15 * 60_000,
  },
] as const;

export function actionManifest(
  id: string,
): ActionCapabilityManifest | undefined {
  return projectAtlasActions.find((action) => action.id === id);
}
