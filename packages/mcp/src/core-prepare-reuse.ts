import {
  normalizeLockedEvidenceHandles,
  TaskRetrievalBudgetExceededError,
  writeTaskCheckpoint,
} from "@component-atlas/runtime";
import type {
  TaskCheckpointInput,
  TaskResumeCapsule,
} from "@component-atlas/runtime";
import { compact } from "./core-tool-helpers.js";
import { text } from "./shared.js";

export const CORE_PREPARE_NEXT_STEPS = [
  "Expand only a named unresolved handle with atlas_expand_context.",
  "Lock the exact change surface with atlas_lock_change_scope before editing.",
  "Validate with atlas_validate_change, then close technically with atlas_task_state; use atlas_memory only through its separate consent flow.",
] as const;

export function completedTaskPrepareResult(id: string, budgetChars: number) {
  return text(
    compact(
      {
        taskId: id,
        status: "completed",
        terminal: true,
        repositoryScanned: false,
        requiresNewTaskId: true,
        nextAction:
          "Use atlas_task_state action=resume to inspect this immutable closeout; start follow-up work with a new task_id.",
      },
      budgetChars,
    ),
  );
}

export function explicitlyChangesApiContract(objective: string): boolean {
  return /(?:\b(?:change|modify|migrate|replace|update)\b[^.\n]{0,48}\b(?:api contract|openapi schema)\b|\b(?:api contract|openapi schema)\b[^.\n]{0,48}\b(?:change|modify|migrate|replace|update)\b|\b(?:cambiar|modificar|migrar|reemplazar|actualizar)\b[^.\n]{0,48}\b(?:contrato de api|esquema openapi)\b)/iu.test(
    objective,
  );
}

type ReuseContinuationInput = Pick<
  TaskCheckpointInput,
  | "taskId"
  | "objective"
  | "objectiveApproved"
  | "objectiveReference"
  | "decisions"
  | "sourceRelations"
  | "sourceReceiptIds"
  | "governance"
  | "changeInvalidation"
> & {
  rootPath: string;
  error: unknown;
  prior?: TaskResumeCapsule;
  selectedHandles?: string[];
  budget: number;
};

export async function continueAfterReuseBudget(input: ReuseContinuationInput) {
  if (
    !(input.error instanceof TaskRetrievalBudgetExceededError) ||
    input.error.kind !== "reuse" ||
    !input.prior
  ) return undefined;
  const handles = normalizeLockedEvidenceHandles([
    ...(input.prior.changeSurface?.evidence.handles ?? []),
    ...input.prior.handles,
    ...(input.selectedHandles ?? []),
  ]);
  await writeTaskCheckpoint(input.rootPath, {
    taskId: input.taskId,
    expectedUpdatedAt: input.prior.updatedAt,
    milestone: "batch-completed",
    objective: input.objective,
    objectiveApproved: input.objectiveApproved,
    ...(input.objectiveReference
      ? { objectiveReference: input.objectiveReference }
      : {}),
    decisions: input.decisions,
    ...(input.sourceRelations
      ? { sourceRelations: input.sourceRelations }
      : {}),
    sourceReceiptIds: input.sourceReceiptIds,
    handles,
    ...(input.governance ? { governance: input.governance } : {}),
    ...(input.changeInvalidation
      ? { changeInvalidation: input.changeInvalidation }
      : {}),
    covered: ["repository orientation", "source gate", "existing reuse context"],
    remaining: ["lock change scope", "implementation", "validation"],
    budgetChars: input.budget,
    nextSafeAction:
      "Continue to atlas_lock_change_scope with planned surfaces or record reuse as not-applicable; do not retrieve again.",
  });
  return text(
    compact(
      {
        taskId: input.taskId,
        status: input.changeInvalidation
          ? "relock-required-with-existing-context"
          : "ready-with-existing-context",
        repositoryScanned: true,
        reuse: {
          consumed: input.error.consumed,
          limit: input.error.limit,
          operations: input.error.operations,
          acceptedInvalidationReasons: input.error.acceptedInvalidationReasons,
          fallbackDecisions: ["planned-surfaces", "not-applicable"],
        },
        handles,
        ...(input.changeInvalidation
          ? { invalidationReason: input.changeInvalidation.reason }
          : {}),
        nextAction:
          input.changeInvalidation
            ? "Relock with atlas_lock_change_scope and the same invalidation reason."
            : "Call atlas_lock_change_scope with the planned surfaces, or record reuse as not-applicable when no candidate applies.",
      },
      input.budget,
      handles,
      ["reuse", "nextAction"],
    ),
  );
}
