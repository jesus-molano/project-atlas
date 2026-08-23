import { createHash } from "node:crypto";
import { canonicalJson } from "./change-surface-fingerprint.js";
import type {
  TaskContinuationBundle,
  TaskCriterionProgress,
  TaskEvidenceContract,
  TaskEvidenceCriterion,
  TaskEvidenceDecision,
} from "./task-evidence-contract.js";

const CONTRACT_HANDLE_PATTERN = /^contract:([A-Za-z0-9_.:-]{1,160}):([a-f0-9]{16})$/u;
const CONTINUATION_HANDLE_PATTERN = /^continuation:([A-Za-z0-9_.:-]{1,160}):([a-f0-9]{16})$/u;

export function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function normalizedText(value: string, maximum: number, label: string): string {
  const normalized = value.trim().replace(/[\u0000-\u001f]+/gu, " ");
  if (!normalized || normalized.length > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

export function normalizedList(
  values: string[],
  maximumItems: number,
  maximumChars: number,
  label: string,
): string[] {
  if (!Array.isArray(values) || values.length > maximumItems) {
    throw new Error(`${label} is invalid.`);
  }
  return [
    ...new Set(values.map((value) => normalizedText(value, maximumChars, label))),
  ];
}

export function normalizedReferences(
  values: string[],
  maximumItems: number,
  label: string,
): string[] {
  return normalizedList(values, maximumItems, 320, label);
}

export function checkedTimestamp(value: string, label: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid.`);
  return value;
}

export function checkedRevision(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 10_000) {
    throw new Error("Task artifact revision is invalid.");
  }
  return value;
}

export function contractIntegrityPayload(
  contract: Omit<TaskEvidenceContract, "handle" | "hash" | "createdAt">,
): Omit<TaskEvidenceContract, "handle" | "hash" | "createdAt"> {
  return contract;
}

export function continuationIntegrityPayload(
  bundle: Omit<TaskContinuationBundle, "handle" | "hash" | "createdAt">,
): Omit<TaskContinuationBundle, "handle" | "hash" | "createdAt"> {
  return bundle;
}

export function parseContractHandle(handle: string): { taskId: string; prefix: string } {
  const match = CONTRACT_HANDLE_PATTERN.exec(handle);
  if (!match) throw new Error("Task evidence contract handle is invalid.");
  return { taskId: match[1]!, prefix: match[2]! };
}

export function parseContinuationHandle(handle: string): {
  taskId: string;
  prefix: string;
} {
  const match = CONTINUATION_HANDLE_PATTERN.exec(handle);
  if (!match) throw new Error("Task continuation handle is invalid.");
  return { taskId: match[1]!, prefix: match[2]! };
}

export function normalizeCriteria(criteria: TaskEvidenceCriterion[]): TaskEvidenceCriterion[] {
  if (!Array.isArray(criteria) || criteria.length === 0 || criteria.length > 64) {
    throw new Error("A task evidence contract requires 1 to 64 criteria.");
  }
  const normalized = criteria.map((criterion) => ({
    id: normalizedText(criterion.id, 120, "Criterion ID"),
    statement: normalizedText(criterion.statement, 1_000, "Criterion statement"),
    required: criterion.required === true,
    sourceRefs: normalizedReferences(
      criterion.sourceRefs ?? [],
      16,
      "Criterion source reference",
    ),
  }));
  if (new Set(normalized.map((criterion) => criterion.id)).size !== normalized.length) {
    throw new Error("Task evidence criterion IDs must be unique.");
  }
  return normalized;
}

export function normalizeDecisions(
  decisions: TaskEvidenceDecision[],
): TaskEvidenceDecision[] {
  if (!Array.isArray(decisions) || decisions.length > 64) {
    throw new Error("A task evidence contract supports at most 64 decisions.");
  }
  const normalized = decisions.map((decision) => {
    if (!(["open", "resolved", "deferred"] as const).includes(decision.status)) {
      throw new Error("Task evidence decision status is invalid.");
    }
    if (decision.status === "resolved" && !decision.answer?.trim()) {
      throw new Error("A resolved task decision requires an answer.");
    }
    if (decision.status === "open" && decision.answer !== undefined) {
      throw new Error("An open task decision cannot contain an answer.");
    }
    return {
      id: normalizedText(decision.id, 120, "Decision ID"),
      question: normalizedText(decision.question, 1_000, "Decision question"),
      status: decision.status,
      ...(decision.answer !== undefined
        ? { answer: normalizedText(decision.answer, 2_000, "Decision answer") }
        : {}),
      sourceRefs: normalizedReferences(
        decision.sourceRefs ?? [],
        16,
        "Decision source reference",
      ),
    };
  });
  if (new Set(normalized.map((decision) => decision.id)).size !== normalized.length) {
    throw new Error("Task evidence decision IDs must be unique.");
  }
  return normalized;
}

export function normalizeCriterionProgress(
  progress: TaskCriterionProgress[],
): TaskCriterionProgress[] {
  if (!Array.isArray(progress) || progress.length === 0 || progress.length > 64) {
    throw new Error("Task continuation criterion progress is invalid.");
  }
  const normalized = progress.map((criterion) => {
    if (
      !(["pending", "satisfied", "blocked", "deferred"] as const).includes(
        criterion.status,
      )
    ) {
      throw new Error("Task continuation criterion status is invalid.");
    }
    const evidenceRefs = normalizedReferences(
      criterion.evidenceRefs ?? [],
      24,
      "Criterion evidence reference",
    );
    const validationRefs = normalizedReferences(
      criterion.validationRefs ?? [],
      16,
      "Criterion validation reference",
    );
    if (criterion.status === "satisfied" && evidenceRefs.length === 0 && validationRefs.length === 0) {
      throw new Error("A satisfied criterion requires evidence or validation.");
    }
    return {
      criterionId: normalizedText(criterion.criterionId, 120, "Criterion progress ID"),
      status: criterion.status,
      evidenceRefs,
      validationRefs,
      ...(criterion.note !== undefined
        ? { note: normalizedText(criterion.note, 1_000, "Criterion progress note") }
        : {}),
    };
  });
  if (
    new Set(normalized.map((criterion) => criterion.criterionId)).size !==
    normalized.length
  ) {
    throw new Error("Task continuation criterion IDs must be unique.");
  }
  return normalized;
}
