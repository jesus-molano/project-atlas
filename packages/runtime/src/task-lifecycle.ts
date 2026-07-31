export type TaskLifecyclePhase =
  | "prepared"
  | "scoped"
  | "validated"
  | "completed";

export interface TaskLifecycle {
  schemaVersion: 1;
  phase: TaskLifecyclePhase;
  revision: number;
  preparedAt: string;
  scopedAt?: string;
  validatedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

export interface TaskValidationReference {
  lockId: string;
  deltaHash: string;
  validatedAt: string;
}

export interface TaskChangeInvalidation {
  reason: string;
  invalidatedAt: string;
  previousLockId: string;
  relockRequired: true;
}

export interface TaskChangeInvalidationInput {
  reason: string;
  invalidatedAt?: string;
}

export function lifecyclePhaseFromLegacy(capsule: {
  status?: unknown;
  scope?: { covered?: unknown };
  changeSurface?: unknown;
}): TaskLifecyclePhase {
  if (capsule.status === "completed") return "completed";
  const covered = Array.isArray(capsule.scope?.covered)
    ? capsule.scope.covered.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  if (covered.some((item) => /diff validation|change validated/iu.test(item))) {
    return "validated";
  }
  if (
    capsule.changeSurface ||
    covered.some((item) => /locked change scope|change scope/iu.test(item))
  ) {
    return "scoped";
  }
  return "prepared";
}

export function lifecycleForPhase(
  current: TaskLifecycle | undefined,
  phase: TaskLifecyclePhase,
  at: string,
  preparedAt = at,
  allowValidatedRescope = false,
): TaskLifecycle {
  const order: TaskLifecyclePhase[] = [
    "prepared",
    "scoped",
    "validated",
    "completed",
  ];
  if (
    current &&
    allowValidatedRescope &&
    phase === "scoped" &&
    (current.phase === "validated" || current.phase === "scoped")
  ) {
    return {
      schemaVersion: 1,
      phase: "scoped",
      revision: current.revision + 1,
      preparedAt: current.preparedAt,
      scopedAt: at,
      updatedAt: at,
    };
  }
  if (current && order.indexOf(phase) < order.indexOf(current.phase)) {
    throw new Error(
      `Task lifecycle cannot move backwards from ${current.phase} to ${phase}.`,
    );
  }
  if (current?.phase === phase) return { ...current, updatedAt: at };
  const next: TaskLifecycle = {
    schemaVersion: 1,
    phase,
    revision: (current?.revision ?? 0) + 1,
    preparedAt: current?.preparedAt ?? preparedAt,
    ...(current?.scopedAt ? { scopedAt: current.scopedAt } : {}),
    ...(current?.validatedAt ? { validatedAt: current.validatedAt } : {}),
    ...(current?.completedAt ? { completedAt: current.completedAt } : {}),
    updatedAt: at,
  };
  if (phase === "scoped" && !next.scopedAt) next.scopedAt = at;
  if (phase === "validated" && !next.validatedAt) next.validatedAt = at;
  if (phase === "completed" && !next.completedAt) next.completedAt = at;
  return next;
}

export function validLifecycle(value: TaskLifecycle | undefined): boolean {
  return Boolean(
    value?.schemaVersion === 1 &&
      ["prepared", "scoped", "validated", "completed"].includes(value.phase) &&
      Number.isInteger(value.revision) &&
      value.revision > 0 &&
      Number.isFinite(Date.parse(value.preparedAt)) &&
      Number.isFinite(Date.parse(value.updatedAt)),
  );
}
