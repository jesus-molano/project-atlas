import {
  amendTaskEvidenceContract,
  loadLatestTaskContinuationBundle,
  loadLatestTaskEvidenceContract,
  loadTaskFeedbackQueue,
  loadTaskSourceLedger,
  lockTaskChangeSurface,
  persistTaskContinuationBundleWithCheckpoint,
  persistTaskFeedbackEvent,
  preserveTaskCriterionProgress,
  reconcileTaskGit,
  resolveTaskObjective,
  writeTaskCheckpoint,
  type TaskCriterionProgress,
  type TaskFeedbackEvent,
  type TaskFeedbackSummary,
  type TaskResumeCapsule,
} from "@component-atlas/runtime";
import { z } from "zod";
import { assertSelectableHandles } from "./core-handle-ownership.js";

const boundedReference = z.string().min(1).max(320);
const stableId = z.string().min(1).max(120);
const criterionPatch = z
  .object({
    operation: z.enum(["add", "replace"]),
    id: stableId,
    replaces: stableId.optional(),
    statement: z.string().min(1).max(1_000),
    required: z.boolean(),
    source_refs: z.array(boundedReference).max(16).optional(),
  })
  .superRefine((value, context) => {
    if (value.operation === "add" && value.replaces) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An added criterion cannot replace another criterion.",
      });
    }
    if (value.operation === "replace" && !value.replaces) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A replaced criterion requires the exact prior criterion ID.",
      });
    }
  });
const decisionPatch = z
  .object({
    operation: z.enum(["add", "replace"]),
    id: stableId,
    replaces: stableId.optional(),
    question: z.string().min(1).max(1_000),
    status: z.enum(["open", "resolved", "deferred"]),
    answer: z.string().min(1).max(2_000).optional(),
    source_refs: z.array(boundedReference).max(16).optional(),
  })
  .superRefine((value, context) => {
    if (value.operation === "add" && value.replaces) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An added decision cannot replace another decision.",
      });
    }
    if (value.operation === "replace" && !value.replaces) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A replaced decision requires the exact prior decision ID.",
      });
    }
    if (value.status === "resolved" && !value.answer) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A resolved decision requires an answer.",
      });
    }
    if (value.status === "open" && value.answer) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An open decision cannot contain an answer.",
      });
    }
  });

export const taskContractPatchSchema = z
  .object({
    criteria: z.array(criterionPatch).max(64).optional(),
    decisions: z.array(decisionPatch).max(64).optional(),
    constraints_add: z.array(z.string().min(1).max(1_000)).max(64).optional(),
    exclusions_add: z.array(z.string().min(1).max(1_000)).max(64).optional(),
  })
  .refine(
    (value) =>
      Boolean(
        value.criteria?.length ||
          value.decisions?.length ||
          value.constraints_add?.length ||
          value.exclusions_add?.length,
      ),
    { message: "A contract patch requires at least one explicit change." },
  );

const criterionUpdateSchema = z.object({
  criterion_id: stableId,
  status: z.enum(["pending", "satisfied", "blocked", "deferred"]),
  evidence_refs: z.array(boundedReference).max(24).optional(),
  validation_refs: z.array(boundedReference).max(16).optional(),
  note: z.string().min(1).max(1_000).optional(),
});

export const coreTaskReconcileInputSchema = {
  contract_patch: z.record(z.string(), z.unknown()).optional(),
  criterion_updates: z
    .array(z.record(z.string(), z.unknown()))
    .max(64)
    .optional(),
  feedback_ids: z.array(z.string().min(1).max(160)).max(64).optional(),
};

export const taskCriterionUpdatesSchema = z
  .array(criterionUpdateSchema)
  .max(64);

export type TaskContractPatchInput = z.infer<typeof taskContractPatchSchema>;
export type TaskCriterionUpdateInput = z.infer<typeof criterionUpdateSchema>;

interface ReconcileCoreTaskInput {
  rootPath: string;
  taskId: string;
  capsule: TaskResumeCapsule;
  contractPatch?: TaskContractPatchInput;
  criterionUpdates?: TaskCriterionUpdateInput[];
  feedbackIds?: string[];
  covered?: string[];
  remaining?: string[];
  nextAction?: string;
}

function feedbackSummary(
  queue: TaskFeedbackEvent[],
): TaskFeedbackSummary | undefined {
  const latest = queue.at(-1);
  if (!latest) return undefined;
  return {
    total: queue.length,
    pending: queue.filter(
      (event) => event.required && event.status === "pending",
    ).length,
    latestHandle: latest.handle,
    latestAt: latest.createdAt,
  };
}

function exactValidationReference(
  capsule: TaskResumeCapsule,
): string | undefined {
  return capsule.validation
    ? `validation:${capsule.validation.lockId}:${capsule.validation.deltaHash}`
    : undefined;
}

function currentProgress(
  contract: NonNullable<
    Awaited<ReturnType<typeof loadLatestTaskEvidenceContract>>
  >,
  continuation: Awaited<ReturnType<typeof loadLatestTaskContinuationBundle>>,
): TaskCriterionProgress[] {
  if (continuation?.contract.handle === contract.handle) {
    return continuation.criteria;
  }
  return contract.criteria.map((criterion) => ({
    criterionId: criterion.id,
    status: "pending",
    evidenceRefs: [],
    validationRefs: [],
  }));
}

function withoutStaleValidation(
  progress: TaskCriterionProgress[],
  validationIsCurrent: boolean,
): TaskCriterionProgress[] {
  if (validationIsCurrent) return progress;
  return progress.map((criterion) => {
    const evidenceRefs = criterion.evidenceRefs;
    return {
      ...criterion,
      status:
        criterion.status === "satisfied" && evidenceRefs.length === 0
          ? "pending"
          : criterion.status,
      validationRefs: [],
    };
  });
}

function applyCriterionUpdates(
  progress: TaskCriterionProgress[],
  updates: TaskCriterionUpdateInput[],
): TaskCriterionProgress[] {
  const byId = new Map(progress.map((criterion) => [criterion.criterionId, criterion]));
  for (const update of updates) {
    if (!byId.has(update.criterion_id)) {
      throw new Error(
        `Criterion update ${update.criterion_id} is outside the latest evidence contract.`,
      );
    }
    byId.set(update.criterion_id, {
      criterionId: update.criterion_id,
      status: update.status,
      evidenceRefs: update.evidence_refs ?? [],
      validationRefs: update.validation_refs ?? [],
      ...(update.note ? { note: update.note } : {}),
    });
  }
  return progress.map((criterion) => byId.get(criterion.criterionId)!);
}

async function selectedFeedback(
  rootPath: string,
  taskId: string,
  feedbackIds: string[],
): Promise<{
  queue: TaskFeedbackEvent[];
  selected: TaskFeedbackEvent[];
  pending: TaskFeedbackEvent[];
}> {
  const queue = await loadTaskFeedbackQueue(rootPath, taskId);
  const byId = new Map(queue.map((event) => [event.feedbackId, event]));
  const missing = feedbackIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(`Unknown task feedback IDs: ${missing.join(", ")}.`);
  }
  const selected = feedbackIds.map((id) => byId.get(id)!);
  return {
    queue,
    selected,
    pending: selected.filter((event) => event.status === "pending"),
  };
}

function eventContractPatch(
  events: TaskFeedbackEvent[],
): TaskContractPatchInput | undefined {
  const patches = events
    .filter((event) => event.contractPatch !== undefined)
    .map((event) => taskContractPatchSchema.parse(event.contractPatch));
  if (patches.length === 0) return undefined;
  const serialized = new Set(patches.map((patch) => JSON.stringify(patch)));
  if (serialized.size !== 1) {
    throw new Error(
      "Selected feedback contains different contract patches; reconcile them separately.",
    );
  }
  return patches[0];
}

async function relockWithinScope(
  rootPath: string,
  capsule: TaskResumeCapsule,
  contractHandle: string,
  feedbackIds: string[],
) {
  const current = capsule.changeSurface;
  if (!current) return undefined;
  return lockTaskChangeSurface(rootPath, {
    taskId: capsule.taskId,
    ...(current.objective ? { objective: current.objective } : {}),
    intent: current.intent,
    primary: current.primary,
    references: current.references,
    allowedFiles: current.allowedFiles,
    referenceFiles: current.referenceFiles,
    exclusions: current.exclusions,
    reuseDecision: current.reuseDecision,
    sourceLedger: current.evidence.sourceLedger,
    handles: [
      contractHandle,
      ...current.evidence.handles.filter(
        (handle) => !handle.startsWith("contract:"),
      ),
    ],
    gitBaseline: current.gitBaseline,
    invalidationReason: `Within-scope feedback reconciliation: ${feedbackIds.join(", ")}`,
  });
}

function checkpointHandles(
  capsule: TaskResumeCapsule,
  contractHandle: string | undefined,
  continuationHandle: string | undefined,
  gitHandle: string,
  feedbackHandle: string | undefined,
): string[] {
  return [
    ...(contractHandle ? [contractHandle] : []),
    ...(continuationHandle ? [continuationHandle] : []),
    gitHandle,
    ...(feedbackHandle ? [feedbackHandle] : []),
    ...capsule.handles.filter(
      (handle) =>
        !handle.startsWith("contract:") &&
        !handle.startsWith("continuation:") &&
        !handle.startsWith("git-state:") &&
        !handle.startsWith("feedback:"),
    ),
  ].slice(0, 8);
}

export async function reconcileCoreTask(
  input: ReconcileCoreTaskInput,
): Promise<Record<string, unknown>> {
  const feedbackIds = [...new Set(input.feedbackIds ?? [])];
  const feedback = await selectedFeedback(
    input.rootPath,
    input.taskId,
    feedbackIds,
  );
  const storedPatch = eventContractPatch(feedback.pending);
  const contractPatch = input.contractPatch ?? storedPatch;
  if (input.contractPatch && storedPatch) {
    if (JSON.stringify(input.contractPatch) !== JSON.stringify(storedPatch)) {
      throw new Error(
        "The supplied contract patch conflicts with the selected feedback patch.",
      );
    }
  }
  if (contractPatch && feedbackIds.length === 0) {
    throw new Error(
      "A contract patch requires the exact feedback_ids that authorize this revision.",
    );
  }
  const scopeChange = feedback.pending.some(
    (event) => event.kind === "scope-change" || event.impact === "scope",
  );
  const hasExplicitReconciliation = Boolean(
    contractPatch || input.criterionUpdates?.length,
  );
  const unsupportedRequiredFeedback = feedback.pending.filter(
    (event) =>
      event.required &&
      event.kind !== "scope-change" &&
      event.impact !== "scope" &&
      !hasExplicitReconciliation &&
      event.evidenceRefs.length === 0,
  );
  if (unsupportedRequiredFeedback.length > 0) {
    throw new Error(
      `Required feedback needs a contract patch, criterion update, evidence reference, or scope invalidation before it can be resolved: ${unsupportedRequiredFeedback
        .map((event) => event.feedbackId)
        .join(", ")}.`,
    );
  }
  const objective = await resolveTaskObjective(input.rootPath, input.taskId);
  if (!objective) throw new Error("Task objective is unavailable.");
  const sourceLedger = await loadTaskSourceLedger(input.rootPath, input.taskId);
  const [priorContract, priorContinuation] = await Promise.all([
    loadLatestTaskEvidenceContract(input.rootPath, input.taskId),
    loadLatestTaskContinuationBundle(input.rootPath, input.taskId),
  ]);
  if ((contractPatch || input.criterionUpdates?.length) && !priorContract) {
    throw new Error(
      "Contract patches and criterion updates require a recorded evidence contract.",
    );
  }
  const sourceReferences = [
    ...(contractPatch?.criteria ?? []).flatMap(
      (criterion) => criterion.source_refs ?? [],
    ),
    ...(contractPatch?.decisions ?? []).flatMap(
      (decision) => decision.source_refs ?? [],
    ),
    ...(input.criterionUpdates ?? []).flatMap(
      (criterion) => criterion.evidence_refs ?? [],
    ),
    ...feedback.pending.flatMap((event) => event.evidenceRefs),
  ];
  if (sourceReferences.length > 0) {
    await assertSelectableHandles(
      input.rootPath,
      input.taskId,
      [...new Set(sourceReferences)],
      sourceLedger?.receiptIds ?? input.capsule.sourceReceiptIds,
    );
  }
  const expectedValidation = exactValidationReference(input.capsule);
  const suppliedValidationReferences = [
    ...new Set(
      (input.criterionUpdates ?? []).flatMap(
        (criterion) => criterion.validation_refs ?? [],
      ),
    ),
  ];
  if (
    suppliedValidationReferences.length > 0 &&
    (!expectedValidation ||
      suppliedValidationReferences.some(
        (reference) => reference !== expectedValidation,
      ))
  ) {
    throw new Error(
      "Criterion validation references must match the current Atlas validation exactly.",
    );
  }
  const git = await reconcileTaskGit(input.rootPath, {
    taskId: input.taskId,
    storedHead: input.capsule.workspace.head,
    ...(input.capsule.changeSurface?.gitBaseline
      ? { baseline: input.capsule.changeSurface.gitBaseline }
      : {}),
  });
  const validationIsCurrent = Boolean(
    input.capsule.validation &&
      input.capsule.changeSurface &&
      git.delta?.deltaHash === input.capsule.validation.deltaHash &&
      input.capsule.validation.lockId === input.capsule.changeSurface.lockId,
  );

  let contract = priorContract;
  if (contractPatch && priorContract && feedback.pending.length > 0) {
    contract = await amendTaskEvidenceContract(input.rootPath, {
      taskId: input.taskId,
      contractHandle: priorContract.handle,
      criteria: (contractPatch.criteria ?? []).map((criterion) => ({
        id: criterion.id,
        statement: criterion.statement,
        required: criterion.required,
        sourceRefs: criterion.source_refs ?? [],
        ...(criterion.operation === "replace"
          ? { supersedes: [criterion.replaces ?? criterion.id] }
          : {}),
      })),
      decisions: (contractPatch.decisions ?? []).map((decision) => ({
        id: decision.id,
        question: decision.question,
        status: decision.status,
        ...(decision.answer ? { answer: decision.answer } : {}),
        sourceRefs: decision.source_refs ?? [],
        ...(decision.operation === "replace"
          ? { supersedes: [decision.replaces ?? decision.id] }
          : {}),
      })),
      constraints: [
        ...new Set([
          ...priorContract.constraints,
          ...(contractPatch.constraints_add ?? []),
        ]),
      ],
      exclusions: [
        ...new Set([
          ...priorContract.exclusions,
          ...(contractPatch.exclusions_add ?? []),
        ]),
      ],
    });
  }

  let activeLock = input.capsule.changeSurface;
  if (
    contract &&
    priorContract &&
    contract.handle !== priorContract.handle &&
    activeLock &&
    !scopeChange &&
    !input.capsule.changeInvalidation
  ) {
    activeLock = await relockWithinScope(
      input.rootPath,
      input.capsule,
      contract.handle,
      feedbackIds,
    );
  }

  let saved: TaskResumeCapsule;
  let continuation = priorContinuation;
  if (contract) {
    const baseProgress =
      priorContract && contract.handle !== priorContract.handle
        ? preserveTaskCriterionProgress(
            priorContract,
            currentProgress(priorContract, priorContinuation),
            contract,
          )
        : currentProgress(contract, priorContinuation);
    const progress = withoutStaleValidation(
      applyCriterionUpdates(baseProgress, input.criterionUpdates ?? []),
      validationIsCurrent &&
        activeLock?.lockId === input.capsule.changeSurface?.lockId,
    );
    const priorValidationRefs =
      validationIsCurrent &&
      activeLock?.lockId === input.capsule.changeSurface?.lockId
        ? priorContinuation?.validationRefs ?? []
        : [];
    const persisted = await persistTaskContinuationBundleWithCheckpoint(
      input.rootPath,
      {
        taskId: input.taskId,
        contractHandle: contract.handle,
        criteria: progress,
        covered: input.covered ?? priorContinuation?.covered ?? input.capsule.scope.covered,
        remaining:
          input.remaining ??
          priorContinuation?.remaining ??
          input.capsule.scope.remaining,
        nextSafeAction:
          input.nextAction ??
          (scopeChange
            ? "Relock the expanded task scope before continuing implementation."
            : input.capsule.nextSafeAction),
        validationRefs: priorValidationRefs,
        visualHandles: priorContinuation?.visualHandles ?? [],
        ...(activeLock && !scopeChange
          ? { changeSurfaceLockId: activeLock.lockId }
          : {}),
        ...(priorContinuation
          ? { previousHandle: priorContinuation.handle }
          : {}),
      },
      async (bundle) =>
        writeTaskCheckpoint(input.rootPath, {
          taskId: input.taskId,
          expectedUpdatedAt: input.capsule.updatedAt,
          status: input.capsule.status,
          milestone: "batch-completed",
          objective: objective.text,
          objectiveApproved: objective.approved,
          ...(objective.reference
            ? { objectiveReference: objective.reference }
            : {}),
          decisions: sourceLedger?.decisions ?? [],
          ...(sourceLedger?.relations
            ? { sourceRelations: sourceLedger.relations }
            : {}),
          sourceReceiptIds:
            sourceLedger?.receiptIds ?? input.capsule.sourceReceiptIds,
          handles: checkpointHandles(
            input.capsule,
            contract?.handle,
            bundle.handle,
            git.handle,
            feedback.queue.at(-1)?.handle,
          ),
          covered: input.covered ?? input.capsule.scope.covered,
          remaining: input.remaining ?? input.capsule.scope.remaining,
          budgetChars: input.capsule.budget.contextChars,
          estimatedTokens: input.capsule.budget.estimatedTokens,
          ...(feedbackSummary(feedback.queue)
            ? { feedbackSummary: feedbackSummary(feedback.queue)! }
            : {}),
          ...(activeLock && activeLock.lockId !== input.capsule.changeSurface?.lockId
            ? { changeSurface: activeLock }
            : {}),
          ...(scopeChange && input.capsule.changeSurface && !input.capsule.changeInvalidation
            ? {
                changeInvalidation: {
                  reason: `Feedback requires a scope change: ${feedbackIds.join(", ")}`,
                },
              }
            : {}),
          ...(!validationIsCurrent ||
          activeLock?.lockId !== input.capsule.changeSurface?.lockId ||
          scopeChange
            ? { validation: null }
            : {}),
          nextSafeAction:
            input.nextAction ??
            (scopeChange
              ? "Relock the expanded task scope before continuing implementation."
              : "Continue from the reconciled evidence and revalidate when required."),
        }),
    );
    continuation = persisted.artifact;
    saved = persisted.checkpoint;
  } else {
    saved = await writeTaskCheckpoint(input.rootPath, {
      taskId: input.taskId,
      expectedUpdatedAt: input.capsule.updatedAt,
      status: input.capsule.status,
      milestone: "batch-completed",
      objective: objective.text,
      objectiveApproved: objective.approved,
      ...(objective.reference ? { objectiveReference: objective.reference } : {}),
      decisions: sourceLedger?.decisions ?? [],
      ...(sourceLedger?.relations
        ? { sourceRelations: sourceLedger.relations }
        : {}),
      sourceReceiptIds:
        sourceLedger?.receiptIds ?? input.capsule.sourceReceiptIds,
      handles: checkpointHandles(
        input.capsule,
        undefined,
        undefined,
        git.handle,
        feedback.queue.at(-1)?.handle,
      ),
      covered: input.covered ?? input.capsule.scope.covered,
      remaining: input.remaining ?? input.capsule.scope.remaining,
      budgetChars: input.capsule.budget.contextChars,
      estimatedTokens: input.capsule.budget.estimatedTokens,
      ...(feedbackSummary(feedback.queue)
        ? { feedbackSummary: feedbackSummary(feedback.queue)! }
        : {}),
      ...(scopeChange && input.capsule.changeSurface && !input.capsule.changeInvalidation
        ? {
            changeInvalidation: {
              reason: `Feedback requires a scope change: ${feedbackIds.join(", ")}`,
            },
          }
        : {}),
      ...(!validationIsCurrent && input.capsule.validation
        ? { validation: null }
        : {}),
      nextSafeAction:
        input.nextAction ??
        "Continue from the reconciled Git and feedback state.",
    });
  }

  const resolved: TaskFeedbackEvent[] = [];
  for (const event of feedback.pending) {
    resolved.push(
      await persistTaskFeedbackEvent(input.rootPath, {
        taskId: input.taskId,
        feedbackId: event.feedbackId,
        kind: event.kind,
        status: "resolved",
        message: event.message,
        origin: event.origin,
        required: event.required,
        impact: event.impact,
        evidenceRefs: event.evidenceRefs,
        affectedCriterionIds: event.affectedCriterionIds,
        ...(event.contractPatch !== undefined
          ? { contractPatch: event.contractPatch }
          : {}),
        previousHandle: event.handle,
      }),
    );
  }
  const currentQueue = await loadTaskFeedbackQueue(input.rootPath, input.taskId);
  if (resolved.length > 0) {
    const latest = currentQueue.at(-1);
    saved = await writeTaskCheckpoint(input.rootPath, {
      taskId: input.taskId,
      expectedUpdatedAt: saved.updatedAt,
      status: saved.status,
      milestone: "batch-completed",
      objective: objective.text,
      objectiveApproved: objective.approved,
      ...(objective.reference ? { objectiveReference: objective.reference } : {}),
      decisions: sourceLedger?.decisions ?? [],
      ...(sourceLedger?.relations
        ? { sourceRelations: sourceLedger.relations }
        : {}),
      sourceReceiptIds: sourceLedger?.receiptIds ?? saved.sourceReceiptIds,
      handles: checkpointHandles(
        saved,
        contract?.handle,
        continuation?.handle,
        git.handle,
        latest?.handle,
      ),
      covered: saved.scope.covered,
      remaining: saved.scope.remaining,
      budgetChars: saved.budget.contextChars,
      estimatedTokens: saved.budget.estimatedTokens,
      ...(feedbackSummary(currentQueue)
        ? { feedbackSummary: feedbackSummary(currentQueue)! }
        : {}),
      nextSafeAction:
        feedbackSummary(currentQueue)?.pending
          ? "Resolve the remaining required feedback before completion."
          : saved.nextSafeAction,
    });
  }

  return {
    status: "reconciled",
    taskId: input.taskId,
    git,
    feedback: feedbackSummary(currentQueue) ?? { total: 0, pending: 0 },
    reconciledFeedbackIds: resolved.map((event) => event.feedbackId),
    ...(contract
      ? {
          contract: {
            handle: contract.handle,
            revision: contract.revision,
          },
        }
      : {}),
    ...(continuation
      ? {
          continuation: {
            handle: continuation.handle,
            revision: continuation.revision,
          },
        }
      : {}),
    ...(activeLock && activeLock.lockId !== input.capsule.changeSurface?.lockId
      ? { lock: { id: activeLock.lockId, revision: activeLock.revision } }
      : {}),
    validation: saved.validation ? "current" : "stale-or-missing",
    nextAction: saved.nextSafeAction,
  };
}
