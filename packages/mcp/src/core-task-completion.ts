import {
  assertTaskCompletionIntentRequest,
  claimTaskCompletionIntent,
  commitTaskCompletionIntent,
  loadTaskCompletionCommit,
  loadTaskCompletionIntent,
  loadTaskCompletionReceipt,
  persistTaskCompletionReceipt,
  resolveTaskObjective,
  validateDiff,
  writeTaskCheckpoint,
  type TaskCompletionIntent,
  type TaskCompletionProjection,
  type TaskCompletionResult,
  type TaskResumeCapsule,
} from "@component-atlas/runtime";
import path from "node:path";
import {
  authoritativeTaskSources,
  type AuthoritativeTaskSources,
} from "./core-source-evidence.js";
import {
  loadClosedVisualReview,
  loadPassingVisualReview,
} from "./core-visual-review.js";
import { assertCoreTaskEvidenceReadyForSuccess } from "./core-task-evidence.js";

export interface CompleteTaskInput {
  result: TaskCompletionResult;
  summary: string;
  verification: string[];
  files: string[];
}

type TaskCompletionFaultStage = "after-delivery" | "after-checkpoint";
let taskCompletionFaultInjector:
  | ((stage: TaskCompletionFaultStage) => void | Promise<void>)
  | undefined;
const taskCompletionQueues = new Map<string, Promise<void>>();

export function setTaskCompletionFaultInjectorForTests(
  injector?: (stage: TaskCompletionFaultStage) => void | Promise<void>,
): void {
  taskCompletionFaultInjector = injector;
}

async function injectTaskCompletionFault(
  stage: TaskCompletionFaultStage,
): Promise<void> {
  await taskCompletionFaultInjector?.(stage);
}

async function reconcileCompletedTask(
  rootPath: string,
  taskId: string,
  capsule: TaskResumeCapsule,
  intent: TaskCompletionIntent,
  sourceLedger: AuthoritativeTaskSources,
): Promise<TaskCompletionProjection> {
  const existingCommit = await loadTaskCompletionCommit(rootPath, taskId);
  if (existingCommit) {
    if (
      existingCommit.requestHash !== intent.requestHash ||
      existingCommit.completedAt !== intent.completedAt
    ) {
      throw new Error(
        "The committed task completion differs from its durable intent.",
      );
    }
    return existingCommit.projection;
  }
  const completion = capsule.completion;
  if (
    !completion ||
    completion.result !== intent.request.result ||
    completion.summary !== intent.request.summary ||
    capsule.updatedAt !== intent.completedAt
  ) {
    throw new Error(
      "The completed capsule cannot be reconciled with its durable completion intent.",
    );
  }
  if (completion.deliveryReceipt) {
    const delivery = await loadTaskCompletionReceipt(
      rootPath,
      completion.deliveryReceipt,
      taskId,
    );
    if (
      delivery.completedAt !== intent.completedAt ||
      delivery.result !== completion.result ||
      delivery.summary !== completion.summary
    ) {
      throw new Error(
        "The delivery receipt cannot be reconciled with its completion intent.",
      );
    }
  }
  const projection: TaskCompletionProjection = {
    taskId,
    status: "completed",
    ready: completion.result === "success",
    result: completion.result,
    summary: completion.summary,
    verification: completion.verification,
    files: completion.files,
    sourceReceiptIds: sourceLedger.receiptIds,
    deliveryReceipt: completion.deliveryReceipt ?? null,
    handles: [
      ...new Set([
        ...(completion.deliveryReceipt ? [completion.deliveryReceipt] : []),
        ...(intent.bindings.visualReview
          ? [intent.bindings.visualReview.handle]
          : []),
        ...(intent.bindings.handles ?? []),
      ]),
    ].slice(0, 8),
    memory: "not-written",
  };
  return (await commitTaskCompletionIntent(rootPath, intent, projection))
    .projection;
}

export async function loadCommittedTaskCompletion(
  rootPath: string,
  taskId: string,
  request: CompleteTaskInput,
): Promise<TaskCompletionProjection | undefined> {
  const intent = await loadTaskCompletionIntent(rootPath, taskId);
  if (!intent) return undefined;
  assertTaskCompletionIntentRequest(intent, request);
  const commit = await loadTaskCompletionCommit(rootPath, taskId);
  if (!commit) return undefined;
  if (
    commit.requestHash !== intent.requestHash ||
    commit.completedAt !== intent.completedAt
  ) {
    throw new Error(
      "The committed task completion differs from its durable intent.",
    );
  }
  return commit.projection;
}

async function completeTaskUnlocked(
  rootPath: string,
  taskId: string,
  capsule: TaskResumeCapsule,
  requestedCompletion: CompleteTaskInput,
): Promise<TaskCompletionProjection> {
  const objective = await resolveTaskObjective(rootPath, taskId);
  if (
    objective?.authority !== "authoritative" ||
    !objective.reference
  ) {
    throw new Error(
      "Task objective is not authoritative; re-prepare or explicitly promote the legacy objective before completion.",
    );
  }
  const sourceLedger = await authoritativeTaskSources(
    rootPath,
    taskId,
    capsule,
  );
  if (requestedCompletion.result === "success") {
    await assertCoreTaskEvidenceReadyForSuccess(
      rootPath,
      taskId,
      capsule,
      sourceLedger,
    );
  }
  const existingIntent = await loadTaskCompletionIntent(rootPath, taskId);
  if (existingIntent) {
    assertTaskCompletionIntentRequest(existingIntent, requestedCompletion);
  }
  if (
    capsule.status === "completed" ||
    capsule.lifecycle.phase === "completed"
  ) {
    if (!existingIntent) {
      throw new Error(
        "This legacy task is already completed without a retryable completion intent; use resume to inspect it.",
      );
    }
    return reconcileCompletedTask(
      rootPath,
      taskId,
      capsule,
      existingIntent,
      sourceLedger,
    );
  }
  if (capsule.changeInvalidation?.relockRequired) {
    throw new Error(
      "Task completion is blocked until the invalidated ChangeSurface is explicitly relocked and revalidated.",
    );
  }
  const attachedVisualReview =
    requestedCompletion.result === "success"
      ? await loadPassingVisualReview(rootPath, taskId, capsule)
      : await loadClosedVisualReview(rootPath, taskId, capsule);
  const passingVisualReview =
    requestedCompletion.result === "success"
      ? attachedVisualReview
      : undefined;
  const visualReviewHash = passingVisualReview?.hash;
  if (
    requestedCompletion.result === "success" &&
    capsule.lifecycle.phase !== "validated"
  ) {
    throw new Error(
      "A successful task may complete only after a non-blocking atlas_validate_change result.",
    );
  }
  if (
    requestedCompletion.result === "success" &&
    (!capsule.changeSurface || !capsule.validation)
  ) {
    throw new Error(
      "A successful task requires validation evidence bound to the active ChangeSurface lock.",
    );
  }
  let completionValidation:
    | Awaited<ReturnType<typeof validateDiff>>
    | undefined;
  let observedValidation:
    | Awaited<ReturnType<typeof validateDiff>>
    | undefined;
  if (capsule.changeSurface && capsule.validation) {
    const sourceAuthority = capsule.changeSurface.evidence.sourceLedger;
    const currentValidation = await validateDiff(rootPath, {
      changeSurface: capsule.changeSurface,
      confirmedOperations: sourceAuthority.confirmedOperations,
      requireConfirmedOperations: sourceAuthority.openApiAuthority,
    });
    observedValidation = currentValidation;
    const unchanged =
      !currentValidation.blocking &&
      currentValidation.deltaHash === capsule.validation.deltaHash &&
      capsule.validation.lockId === capsule.changeSurface.lockId;
    if (requestedCompletion.result === "success" && !unchanged) {
      throw new Error(
        "The Git delta changed after validation or no longer satisfies the active ChangeSurface; validate again before completing.",
      );
    }
    if (unchanged) completionValidation = currentValidation;
  }
  if (
    requestedCompletion.result === "success" &&
    (!completionValidation || !capsule.changeSurface || !capsule.validation)
  ) {
    throw new Error(
      "A successful task requires a fresh validation bound to the active ChangeSurface lock.",
    );
  }
  const intent = await claimTaskCompletionIntent(rootPath, {
    taskId,
    request: requestedCompletion,
    bindings: {
      head: capsule.workspace.head,
      objective: objective.reference,
      ...(capsule.changeSurface
        ? { lockId: capsule.changeSurface.lockId }
        : {}),
      ...(observedValidation
        ? { deltaHash: observedValidation.deltaHash }
        : {}),
      sourceReceiptIds: sourceLedger.receiptIds,
      handles: capsule.handles,
      ...(attachedVisualReview
        ? {
            visualReview: {
              handle: attachedVisualReview.handle,
              contractHandle: attachedVisualReview.contractHandle,
              hash: attachedVisualReview.hash,
              result: attachedVisualReview.result,
            },
          }
        : {}),
      ...(capsule.changeSurface?.gitBaseline.checkoutId
        ? { checkoutId: capsule.changeSurface.gitBaseline.checkoutId }
        : {}),
    },
  });
  const completionRequest = intent.request;
  const deliveryVerification = [
    ...completionRequest.verification,
    ...(visualReviewHash ? [`visual-review:${visualReviewHash}`] : []),
    ...(completionRequest.result !== "success" && attachedVisualReview
      ? [
          `visual-review-outcome:${attachedVisualReview.handle}:${attachedVisualReview.result}`,
        ]
      : []),
  ];
  const delivery =
    completionValidation && capsule.changeSurface
      ? await persistTaskCompletionReceipt(rootPath, {
          taskId,
          objective: objective.reference,
          lockId: capsule.changeSurface.lockId,
          result: completionRequest.result,
          summary: completionRequest.summary,
          verification: deliveryVerification,
          validatedDelta: {
            deltaHash: completionValidation.deltaHash,
            changedFiles: completionValidation.changedFiles.map((entry) => ({
              path: entry.path,
              ...(entry.previousPath
                ? { previousPath: entry.previousPath }
                : {}),
            })),
          },
          head: capsule.workspace.head,
          ...(capsule.changeSurface.gitBaseline.checkoutId
            ? { checkoutId: capsule.changeSurface.gitBaseline.checkoutId }
            : {}),
          sourceHandles: [
            ...new Set([
              ...(attachedVisualReview
                ? [
                    attachedVisualReview.contractHandle,
                    attachedVisualReview.handle,
                  ]
                : []),
              ...sourceLedger.receiptIds,
              ...capsule.handles,
            ]),
          ],
          ...(passingVisualReview && visualReviewHash
            ? {
                visualReview: {
                  receiptHandle: passingVisualReview.handle,
                  contractHandle: passingVisualReview.contractHandle,
                  contractHash: passingVisualReview.contractHash,
                  reviewHash: visualReviewHash,
                  result: "pass" as const,
                  captureCount: passingVisualReview.captures.length,
                  cleanupState: passingVisualReview.cleanup.state as "clean",
                },
              }
            : {}),
          completedAt: intent.completedAt,
        })
      : undefined;
  await injectTaskCompletionFault("after-delivery");
  const completionFiles = delivery?.files ?? completionRequest.files;
  const completionHandles = [
    ...new Set([
      ...(delivery ? [delivery.handle] : []),
      ...(attachedVisualReview ? [attachedVisualReview.handle] : []),
      ...capsule.handles,
    ]),
  ].slice(0, 8);
  await writeTaskCheckpoint(rootPath, {
    taskId,
    expectedUpdatedAt: capsule.updatedAt,
    status: "completed",
    milestone: "completed",
    objective: objective.text,
    objectiveApproved: objective.approved,
    objectiveReference: objective.reference,
    decisions: sourceLedger.decisions,
    sourceRelations: sourceLedger.relations,
    sourceReceiptIds: sourceLedger.receiptIds,
    handles: completionHandles,
    covered: [...capsule.scope.covered, "delivery completed"].slice(-8),
    remaining: [],
    budgetChars: capsule.budget.contextChars,
    estimatedTokens: capsule.budget.estimatedTokens,
    completion: {
      result: completionRequest.result,
      summary: completionRequest.summary,
      verification: deliveryVerification,
      files: completionFiles,
      ...(delivery ? { deliveryReceipt: delivery.handle } : {}),
    },
    at: intent.completedAt,
    nextSafeAction:
      "Task complete. Record or propose memory only if the user explicitly requests it.",
  });
  const projection: TaskCompletionProjection = {
    taskId,
    status: "completed",
    ready: completionRequest.result === "success",
    result: completionRequest.result,
    summary: completionRequest.summary,
    verification: deliveryVerification,
    files: completionFiles,
    sourceReceiptIds: sourceLedger.receiptIds,
    deliveryReceipt: delivery?.handle ?? null,
    handles: completionHandles,
    memory: "not-written",
  };
  await injectTaskCompletionFault("after-checkpoint");
  return (await commitTaskCompletionIntent(rootPath, intent, projection))
    .projection;
}

export async function completeTask(
  rootPath: string,
  taskId: string,
  capsule: TaskResumeCapsule,
  requestedCompletion: CompleteTaskInput,
): Promise<TaskCompletionProjection> {
  const key = `${path.resolve(rootPath)}\0${taskId}`;
  const previous = taskCompletionQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  taskCompletionQueues.set(key, tail);
  await previous;
  try {
    const committed = await loadCommittedTaskCompletion(
      rootPath,
      taskId,
      requestedCompletion,
    );
    if (committed) return committed;
    return await completeTaskUnlocked(
      rootPath,
      taskId,
      capsule,
      requestedCompletion,
    );
  } finally {
    release();
    if (taskCompletionQueues.get(key) === tail) {
      taskCompletionQueues.delete(key);
    }
  }
}
