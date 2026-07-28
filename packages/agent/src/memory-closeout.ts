export const MEMORY_CLOSEOUT_STATUSES = [
  "none",
  "canonical-candidate",
  "canonical-stored",
  "local-only",
  "declined",
] as const;

export const MEMORY_CANDIDATE_TYPES = [
  "decision",
  "convention",
  "constraint",
  "integration",
  "known-issue",
  "lesson",
] as const;

export type MemoryCloseoutStatus = (typeof MEMORY_CLOSEOUT_STATUSES)[number];
export type MemoryCandidateType = (typeof MEMORY_CANDIDATE_TYPES)[number];

export interface MemoryCandidate {
  type: MemoryCandidateType;
  title: string;
  summary: string;
  evidence: string[];
  scope: "canonical";
  confidence: number;
}

export interface MemoryCloseout {
  status: MemoryCloseoutStatus;
  summary: string;
  candidates: MemoryCandidate[];
  localOutcome?: {
    summary: string;
    evidence: string[];
  };
  confirmationRequired: boolean;
  confirmationPrompt: string;
}

export type MemoryCloseoutAction = "confirm-canonical" | "decline";

export const MEMORY_CLOSEOUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: MEMORY_CLOSEOUT_STATUSES,
    },
    summary: { type: "string", maxLength: 1_000 },
    candidates: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            enum: MEMORY_CANDIDATE_TYPES,
          },
          title: { type: "string", maxLength: 300 },
          summary: { type: "string", maxLength: 1_000 },
          evidence: {
            type: "array",
            maxItems: 6,
            items: { type: "string", maxLength: 600 },
          },
          scope: { type: "string", enum: ["canonical"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: [
          "type",
          "title",
          "summary",
          "evidence",
          "scope",
          "confidence",
        ],
      },
    },
    localOutcome: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string", maxLength: 1_000 },
        evidence: {
          type: "array",
          maxItems: 6,
          items: { type: "string", maxLength: 600 },
        },
      },
      required: ["summary", "evidence"],
    },
    confirmationRequired: { type: "boolean" },
    confirmationPrompt: { type: "string", maxLength: 1_000 },
  },
  required: [
    "status",
    "summary",
    "candidates",
    "confirmationRequired",
    "confirmationPrompt",
  ],
} as const;

export const MEMORY_CLOSEOUT_PROMPT_RULES = [
  "- End every completed task with the shared structured `memoryCloseout` result. The GUI renders this same result and must not reclassify it.",
  "- Use `none` when no durable knowledge was found, `local-only` for an episodic result, `canonical-candidate` for novel reusable knowledge awaiting explicit confirmation, `canonical-stored` only after an explicitly authorized canonical write succeeds, and `declined` after the user rejects or omits it.",
  "- A canonical candidate must include concise evidence, canonical scope, confidence, and one explicit confirmation prompt. Do not create a proposal, record an outcome, or write memory until the user explicitly authorizes that exact write.",
  "- Check relevant existing memory before presenting a canonical candidate. Do not create duplicates; propose an update or supersession only when new evidence materially changes existing knowledge.",
] as const;

function stringArray(value: unknown, maximum = 6): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every((item) => typeof item === "string")
  );
}

export function parseMemoryCloseout(value: unknown): MemoryCloseout {
  if (!value || typeof value !== "object") {
    throw new Error("Memory closeout must be an object.");
  }
  const closeout = value as Record<string, unknown>;
  if (
    !MEMORY_CLOSEOUT_STATUSES.includes(
      closeout.status as MemoryCloseoutStatus,
    ) ||
    typeof closeout.summary !== "string" ||
    closeout.summary.length > 1_000 ||
    !Array.isArray(closeout.candidates) ||
    closeout.candidates.length > 3 ||
    typeof closeout.confirmationRequired !== "boolean" ||
    typeof closeout.confirmationPrompt !== "string" ||
    closeout.confirmationPrompt.length > 1_000
  ) {
    throw new Error("Memory closeout fields are invalid.");
  }
  const candidates = closeout.candidates.map((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error("Memory candidate must be an object.");
    }
    const item = candidate as Record<string, unknown>;
    if (
      !MEMORY_CANDIDATE_TYPES.includes(item.type as MemoryCandidateType) ||
      typeof item.title !== "string" ||
      !item.title ||
      item.title.length > 300 ||
      typeof item.summary !== "string" ||
      !item.summary ||
      item.summary.length > 1_000 ||
      !stringArray(item.evidence) ||
      item.scope !== "canonical" ||
      typeof item.confidence !== "number" ||
      item.confidence < 0 ||
      item.confidence > 1
    ) {
      throw new Error("Memory candidate fields are invalid.");
    }
    return item as unknown as MemoryCandidate;
  });
  const localOutcome =
    closeout.localOutcome === undefined
      ? undefined
      : (() => {
          if (!closeout.localOutcome || typeof closeout.localOutcome !== "object") {
            throw new Error("Local memory outcome must be an object.");
          }
          const outcome = closeout.localOutcome as Record<string, unknown>;
          if (
            typeof outcome.summary !== "string" ||
            !outcome.summary ||
            outcome.summary.length > 1_000 ||
            !stringArray(outcome.evidence)
          ) {
            throw new Error("Local memory outcome fields are invalid.");
          }
          return {
            summary: outcome.summary,
            evidence: outcome.evidence,
          };
        })();

  if (
    closeout.status === "canonical-candidate" &&
    (candidates.length === 0 ||
      closeout.confirmationRequired !== true ||
      closeout.confirmationPrompt.trim().length === 0 ||
      localOutcome !== undefined)
  ) {
    throw new Error(
      "Canonical memory candidates require one explicit confirmation.",
    );
  }
  if (
    closeout.status === "canonical-stored" &&
    (candidates.length === 0 ||
      closeout.confirmationRequired !== false ||
      closeout.confirmationPrompt !== "" ||
      localOutcome !== undefined)
  ) {
    throw new Error("Stored canonical memory cannot request confirmation again.");
  }
  if (
    closeout.status === "local-only" &&
    (candidates.length > 0 ||
      closeout.confirmationRequired !== false ||
      closeout.confirmationPrompt !== "" ||
      localOutcome === undefined)
  ) {
    throw new Error("Local-only closeout requires one local outcome and no prompt.");
  }
  if (
    ["none", "declined"].includes(String(closeout.status)) &&
    (candidates.length > 0 ||
      closeout.confirmationRequired !== false ||
      closeout.confirmationPrompt !== "" ||
      localOutcome !== undefined)
  ) {
    throw new Error("Empty or declined memory closeout cannot contain a write.");
  }

  return {
    status: closeout.status as MemoryCloseoutStatus,
    summary: closeout.summary,
    candidates,
    ...(localOutcome ? { localOutcome } : {}),
    confirmationRequired: closeout.confirmationRequired,
    confirmationPrompt: closeout.confirmationPrompt,
  };
}

export function memoryCloseoutActionMessage(
  closeout: MemoryCloseout,
  action: MemoryCloseoutAction,
): string {
  if (
    closeout.status !== "canonical-candidate" ||
    !closeout.confirmationRequired ||
    closeout.candidates.length === 0
  ) {
    throw new Error("This memory closeout has no pending canonical candidate.");
  }
  const titles = closeout.candidates.map((candidate) => candidate.title).join("; ");
  return action === "confirm-canonical"
    ? `I explicitly authorize the canonical Project Memory write for: ${titles}. Use the reviewed evidence and report whether the canonical write succeeds.`
    : `I decline the Project Memory candidate: ${titles}. Do not store it and return the shared memoryCloseout status as declined.`;
}
