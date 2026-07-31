export const TASK_SIZE_ORDER = ["small", "medium", "large"] as const;
export const TASK_RISK_ORDER = ["low", "medium", "high"] as const;
export const TASK_REVIEW_TIER_ORDER = [
  "none",
  "correctness",
  "specialist",
] as const;

export const MAX_TASK_GOVERNANCE_REASONS = 4;
export const MAX_TASK_GOVERNANCE_REASON_CHARS = 72;

export type TaskSize = (typeof TASK_SIZE_ORDER)[number];
export type TaskRisk = (typeof TASK_RISK_ORDER)[number];
export type TaskReviewTier = (typeof TASK_REVIEW_TIER_ORDER)[number];

export interface TaskGovernance {
  size: TaskSize;
  risk: TaskRisk;
  reviewTier: TaskReviewTier;
  reasons: string[];
}

function boundedReason(value: string): string {
  return value
    .trim()
    .replace(/[\u0000-\u001f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .slice(0, MAX_TASK_GOVERNANCE_REASON_CHARS)
    .trimEnd();
}

function normalizeReasons(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("Task governance reasons must be an array.");
  }
  if (value.some((reason) => typeof reason !== "string")) {
    throw new Error("Task governance reasons must contain only strings.");
  }
  return [
    ...new Set(
      value
        .map((reason) => reason as string)
        .map(boundedReason)
        .filter(Boolean),
    ),
  ].slice(0, MAX_TASK_GOVERNANCE_REASONS);
}

/** Normalizes caller input into the compact persisted governance contract. */
export function normalizeTaskGovernance(value: TaskGovernance): TaskGovernance {
  if (
    !value ||
    typeof value !== "object" ||
    !TASK_SIZE_ORDER.includes(value.size) ||
    !TASK_RISK_ORDER.includes(value.risk) ||
    !TASK_REVIEW_TIER_ORDER.includes(value.reviewTier)
  ) {
    throw new Error("Task governance classification is invalid.");
  }
  return {
    size: value.size,
    risk: value.risk,
    reviewTier: value.reviewTier,
    reasons: normalizeReasons(value.reasons),
  };
}

/** Persisted values must already be canonical; validation never rewrites state. */
export function isTaskGovernance(value: unknown): value is TaskGovernance {
  try {
    const normalized = normalizeTaskGovernance(value as TaskGovernance);
    return JSON.stringify(normalized) === JSON.stringify(value);
  } catch {
    return false;
  }
}

function assertNotLower<T extends string>(
  label: string,
  order: readonly T[],
  existing: T,
  incoming: T,
): void {
  if (order.indexOf(incoming) < order.indexOf(existing)) {
    throw new Error(
      `Task governance cannot lower ${label} from ${existing} to ${incoming}.`,
    );
  }
}

function mergeReasons(existing: string[], incoming: string[]): string[] {
  const merged = [...existing];
  for (const reason of incoming) {
    if (merged.includes(reason)) continue;
    merged.push(reason);
    if (merged.length > MAX_TASK_GOVERNANCE_REASONS) merged.shift();
  }
  return merged;
}

/**
 * Establishes or escalates governance. A lower caller classification is an
 * error instead of a silent rewrite, while reasons accumulate within budget.
 */
export function mergeTaskGovernance(
  existing: TaskGovernance | undefined,
  incoming: TaskGovernance | undefined,
): TaskGovernance | undefined {
  if (incoming === undefined) {
    return existing ? normalizeTaskGovernance(existing) : undefined;
  }
  const next = normalizeTaskGovernance(incoming);
  if (!existing) return next;
  const current = normalizeTaskGovernance(existing);
  assertNotLower("size", TASK_SIZE_ORDER, current.size, next.size);
  assertNotLower("risk", TASK_RISK_ORDER, current.risk, next.risk);
  assertNotLower(
    "review tier",
    TASK_REVIEW_TIER_ORDER,
    current.reviewTier,
    next.reviewTier,
  );
  return {
    size: next.size,
    risk: next.risk,
    reviewTier: next.reviewTier,
    reasons: mergeReasons(current.reasons, next.reasons),
  };
}
