import type {
  TaskRiskAssessment,
  TaskSourceAuthorityRole,
} from "@component-atlas/core";
import {
  mergeTaskGovernance,
  normalizeTaskGovernance,
  TASK_REVIEW_TIER_ORDER,
  TASK_RISK_ORDER,
  TASK_SIZE_ORDER,
  type TaskGovernance,
  type TaskReviewTier,
  type TaskRisk,
  type TaskSize,
} from "@component-atlas/runtime";

const AUTHORITY_ROLE_ORDER = [
  "requirement",
  "visual",
  "contract",
  "implementation-reference",
] as const satisfies readonly TaskSourceAuthorityRole[];

const LARGE_OBJECTIVE_PATTERNS = [
  /\b(?:end[- ]to[- ]end|migration|migrate|replatform(?:ing)?)\b|de extremo a extremo|migraci[o\u00f3]n/iu,
  /\b(?:across|throughout) (?:multiple )?(?:packages|applications|flows|screens)\b|\b(?:varios|m[u\u00fa]ltiples) (?:paquetes|flujos|pantallas)\b/iu,
  /\b(?:entire|whole) (?:application|frontend|design system|component library)\b|\b(?:toda la|todo el) (?:aplicaci[o\u00f3]n|frontend|sistema de dise[n\u00f1]o)\b/iu,
  /\b(?:overhaul|rebuild|redesign|replace) (?:the )?(?:application|workflow|design system|component library)\b|\b(?:reconstruir|redise[n\u00f1]ar|reemplazar) (?:la |el )?(?:aplicaci[o\u00f3]n|flujo|sistema de dise[n\u00f1]o)\b/iu,
];

const MEDIUM_OBJECTIVE_PATTERNS = [
  /\b(?:shared component|public component api|component contract|design token|design system)\b|\b(?:componente compartido|api p[u\u00fa]blica|contrato de componente|sistema de dise[n\u00f1]o)\b/iu,
  /\b(?:state management|stateful|workflow|navigation|routing|responsive|accessibility|a11y)\b|\b(?:estado|flujo|navegaci[o\u00f3]n|rutas|responsiv[oa]|accesibilidad)\b/iu,
  /\b(?:integration|connector|refactor|multi[- ]file|form validation)\b|\b(?:integraci[o\u00f3]n|conector|refactorizaci[o\u00f3]n|varios archivos|validaci[o\u00f3]n de formulario)\b/iu,
];

export interface PreparedTaskGovernanceInput {
  objective: string;
  risk: TaskRiskAssessment;
  confirmedAuthorityRoles?: readonly TaskSourceAuthorityRole[];
}

export interface LockedTaskGovernanceEvidence {
  fileCount: number;
  publicApiChanged?: boolean;
  sharedSurface?: boolean;
  apiContractChanged?: boolean;
  impact?: {
    level?: "contained" | "shared" | "high";
    directConsumers?: number;
    transitiveConsumers?: number;
  };
  /** Optional core risk result; evidence classification still applies. */
  scopedRisk?: TaskRiskAssessment;
}

function orderedAuthorityRoles(
  roles: readonly TaskSourceAuthorityRole[] = [],
): TaskSourceAuthorityRole[] {
  const unique = new Set(roles);
  return AUTHORITY_ROLE_ORDER.filter((role) => unique.has(role));
}

function objectiveSize(
  objective: string,
  roles: readonly TaskSourceAuthorityRole[],
  risk: TaskRiskAssessment,
): { size: TaskSize; reason: string } {
  const normalized = objective.trim();
  if (!normalized) throw new Error("Task governance requires an objective.");
  if (LARGE_OBJECTIVE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      size: "large",
      reason: "Objective spans a workflow, system, or migration",
    };
  }
  if (
    MEDIUM_OBJECTIVE_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    roles.length > 1 ||
    roles.includes("contract") ||
    (risk.level === "medium" && risk.reasons.includes("Broad task description"))
  ) {
    return {
      size: "medium",
      reason: "Objective spans shared, stateful, or contract-bound work",
    };
  }
  return {
    size: "small",
    reason: "Localized established surface",
  };
}

function maximum<T extends string>(order: readonly T[], left: T, right: T): T {
  return order.indexOf(left) >= order.indexOf(right) ? left : right;
}

export function requiredTaskReviewTier(
  size: TaskSize,
  risk: TaskRisk,
): TaskReviewTier {
  if (size === "large" || risk === "high") return "specialist";
  if (size === "medium" || risk !== "low") return "correctness";
  return "none";
}

/**
 * Reconciles a fresh prepare classification with persisted governance without
 * ever presenting a lower axis to the runtime's strict monotonic merge.
 */
export function reconcilePreparedTaskGovernance(
  current: TaskGovernance | undefined,
  prepared: TaskGovernance,
): TaskGovernance {
  if (!current) return normalizeTaskGovernance(prepared);
  const size = maximum(TASK_SIZE_ORDER, current.size, prepared.size);
  const risk = maximum(TASK_RISK_ORDER, current.risk, prepared.risk);
  const reviewTier = maximum(
    TASK_REVIEW_TIER_ORDER,
    current.reviewTier,
    requiredTaskReviewTier(size, risk),
  );
  return mergeTaskGovernance(current, {
    size,
    risk,
    reviewTier,
    reasons: prepared.reasons,
  })!;
}

/** Establishes the deterministic prepare-time governance classification. */
export function classifyPreparedTaskGovernance(
  input: PreparedTaskGovernanceInput,
): TaskGovernance {
  if (!TASK_RISK_ORDER.includes(input.risk.level)) {
    throw new Error("Task governance risk assessment is invalid.");
  }
  const roles = orderedAuthorityRoles(input.confirmedAuthorityRoles);
  const classifiedSize = objectiveSize(input.objective, roles, input.risk);
  const reasons = [classifiedSize.reason];
  if (input.risk.level !== "low") {
    reasons.push(
      `Risk: ${input.risk.reasons.find((reason) => reason.trim()) ?? input.risk.level}`,
    );
  }
  if (roles.length > 1) {
    reasons.push(`Multiple source authorities: ${roles.join(", ")}`);
  } else if (roles.includes("contract")) {
    reasons.push("Contract authority shapes implementation");
  }
  return normalizeTaskGovernance({
    size: classifiedSize.size,
    risk: input.risk.level,
    reviewTier: requiredTaskReviewTier(classifiedSize.size, input.risk.level),
    reasons,
  });
}

function assertedCount(value: number | undefined, label: string): number {
  const count = value ?? 0;
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`Task governance ${label} must be a non-negative integer.`);
  }
  return count;
}

/** Escalates prepare-time governance with the concrete locked surface. */
export function escalateLockedTaskGovernance(
  current: TaskGovernance,
  evidence: LockedTaskGovernanceEvidence,
): TaskGovernance {
  const fileCount = assertedCount(evidence.fileCount, "file count");
  const directConsumers = assertedCount(
    evidence.impact?.directConsumers,
    "direct consumer count",
  );
  const transitiveConsumers = assertedCount(
    evidence.impact?.transitiveConsumers,
    "transitive consumer count",
  );
  const highImpact =
    evidence.impact?.level === "high" || transitiveConsumers > 10;
  const sharedImpact =
    highImpact ||
    evidence.impact?.level === "shared" ||
    directConsumers > 2 ||
    evidence.sharedSurface === true;

  let size = current.size;
  let risk = current.risk;
  const reasons: string[] = [];
  if (highImpact) {
    size = maximum(TASK_SIZE_ORDER, size, "large");
    risk = maximum(TASK_RISK_ORDER, risk, "high");
    reasons.push("High-impact shared surface");
  } else if (sharedImpact) {
    size = maximum(TASK_SIZE_ORDER, size, "medium");
    risk = maximum(TASK_RISK_ORDER, risk, "medium");
    reasons.push("Shared component consumers");
  }
  if (fileCount > 8) {
    size = maximum(TASK_SIZE_ORDER, size, "large");
    risk = maximum(TASK_RISK_ORDER, risk, "high");
    reasons.push(`Broad implementation surface: ${fileCount} files`);
  } else if (fileCount > 3) {
    size = maximum(TASK_SIZE_ORDER, size, "medium");
    risk = maximum(TASK_RISK_ORDER, risk, "medium");
    reasons.push(`Multi-file implementation surface: ${fileCount} files`);
  }
  if (evidence.apiContractChanged) {
    size = maximum(TASK_SIZE_ORDER, size, "medium");
    risk = maximum(TASK_RISK_ORDER, risk, "medium");
    reasons.push("External API contract change");
  }
  if (evidence.publicApiChanged) {
    size = maximum(TASK_SIZE_ORDER, size, "medium");
    risk = maximum(TASK_RISK_ORDER, risk, "medium");
    reasons.push("Public component API change");
  }
  if (evidence.scopedRisk) {
    if (!TASK_RISK_ORDER.includes(evidence.scopedRisk.level)) {
      throw new Error("Scoped task governance risk assessment is invalid.");
    }
    risk = maximum(TASK_RISK_ORDER, risk, evidence.scopedRisk.level);
  }
  const derivedReview = requiredTaskReviewTier(size, risk);
  const reviewTier = maximum(
    TASK_REVIEW_TIER_ORDER,
    current.reviewTier,
    derivedReview,
  );
  return mergeTaskGovernance(current, {
    size,
    risk,
    reviewTier,
    reasons,
  })!;
}
