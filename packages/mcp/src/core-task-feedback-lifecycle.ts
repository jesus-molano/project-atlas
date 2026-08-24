import { createHash, randomUUID } from "node:crypto";
import {
  loadLatestTaskEvidenceContract,
  loadTaskFeedbackQueue,
  loadTaskFinalReceipt,
  loadTaskResumeCapsule,
  loadTaskSourceLedger,
  persistTaskFeedbackEvent,
  recoverTaskResumeState,
  resolveTaskObjective,
  writeTaskCheckpoint,
  writeTaskFocus,
} from "@component-atlas/runtime";
import { z } from "zod";
import {
  reconcileCoreTask,
  taskContractPatchSchema,
  taskCriterionUpdatesSchema,
} from "./core-task-reconcile.js";
import { text } from "./shared.js";

export const feedbackKind = z.enum([
  "note",
  "correction",
  "decision",
  "scope-change",
  "review-finding",
  "finding",
]);

type FeedbackKind = z.infer<typeof feedbackKind>;
type FeedbackImpact = "none" | "within-scope" | "scope-change";

export async function resolveFocusedTaskId(
  rootPath: string,
  requested?: string,
): Promise<string> {
  if (requested) return requested;
  const recovery = await recoverTaskResumeState(rootPath);
  if (recovery.status === "ready") return recovery.recommendedTaskId;
  if (recovery.status === "selection-required") {
    throw new Error(
      "Multiple active Atlas tasks exist; provide task_id or set the checkout focus before updating task state.",
    );
  }
  throw new Error("No active Atlas task exists for this checkout.");
}

function feedbackIdentity(input: {
  taskId: string;
  kind: string;
  message: string;
  origin: string;
  required: boolean;
  impact: "none" | "criterion" | "contract" | "scope";
  evidenceRefs: string[];
  affectedCriterionIds: string[];
  contractPatch?: unknown;
}): string {
  return `feedback-${createHash("sha256")
    .update(
      JSON.stringify({
        ...input,
        message: input.message.trim(),
        evidenceRefs: [...new Set(input.evidenceRefs)].toSorted(),
        affectedCriterionIds: [
          ...new Set(input.affectedCriterionIds),
        ].toSorted(),
        contractPatch: input.contractPatch ?? null,
      }),
      "utf8",
    )
    .digest("hex")
    .slice(0, 32)}`;
}

function feedbackImpact(
  value: FeedbackImpact | undefined,
): "none" | "criterion" | "contract" | "scope" | undefined {
  if (value === "within-scope") return "contract";
  if (value === "scope-change") return "scope";
  return value;
}

function feedbackQueueSummary(
  queue: Awaited<ReturnType<typeof loadTaskFeedbackQueue>>,
) {
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

async function requireCapsule(rootPath: string, taskId: string) {
  const capsule = await loadTaskResumeCapsule(rootPath, taskId);
  if (!capsule) throw new Error(`Task ${taskId} has no Project Atlas capsule.`);
  return capsule;
}

export interface CoreTaskFeedbackLifecycleInput {
  rootPath: string;
  taskId: string;
  action: "append-feedback" | "reconcile";
  kind?: FeedbackKind;
  feedbackText?: string;
  origin?: "user" | "agent" | "reviewer";
  required?: boolean;
  impact?: FeedbackImpact;
  evidenceRefs?: string[];
  contractPatch?: Record<string, unknown>;
  criterionUpdates?: Record<string, unknown>[];
  feedbackIds?: string[];
  covered?: string[];
  remaining?: string[];
  nextAction?: string;
}

export async function handleCoreTaskFeedbackLifecycle(
  input: CoreTaskFeedbackLifecycleInput,
) {
  const parsedContractPatch = input.contractPatch
    ? taskContractPatchSchema.parse(input.contractPatch)
    : undefined;
  const parsedCriterionUpdates = input.criterionUpdates
    ? taskCriterionUpdatesSchema.parse(input.criterionUpdates)
    : undefined;

  if (input.action === "reconcile") {
    const capsule = await requireCapsule(input.rootPath, input.taskId);
    return text(
      await reconcileCoreTask({
        rootPath: input.rootPath,
        taskId: input.taskId,
        capsule,
        ...(parsedContractPatch ? { contractPatch: parsedContractPatch } : {}),
        ...(parsedCriterionUpdates?.length
          ? { criterionUpdates: parsedCriterionUpdates }
          : {}),
        ...(input.feedbackIds ? { feedbackIds: input.feedbackIds } : {}),
        ...(input.covered ? { covered: input.covered } : {}),
        ...(input.remaining ? { remaining: input.remaining } : {}),
        ...(input.nextAction ? { nextAction: input.nextAction } : {}),
      }),
    );
  }

  if (!input.kind || !input.feedbackText) {
    throw new Error("append-feedback requires kind and text.");
  }
  const normalizedKind =
    input.kind === "finding" ? "review-finding" : input.kind;
  const normalizedImpact = feedbackImpact(input.impact);
  const feedbackOrigin = input.origin ?? "user";
  const feedbackRequired = input.required ?? normalizedKind !== "note";
  const affectedCriterionIds =
    parsedContractPatch?.criteria?.map((criterion) => criterion.id) ?? [];
  const eventImpact =
    normalizedImpact ??
    (normalizedKind === "scope-change"
      ? "scope"
      : normalizedKind === "correction" || normalizedKind === "decision"
        ? "contract"
        : affectedCriterionIds.length > 0
          ? "criterion"
          : "none");
  const eventInput = {
    kind: normalizedKind,
    status:
      normalizedKind === "note" && !feedbackRequired ? "resolved" : "pending",
    message: input.feedbackText,
    origin: feedbackOrigin,
    required: feedbackRequired,
    impact: eventImpact,
    evidenceRefs: input.evidenceRefs ?? [],
    affectedCriterionIds,
    ...(parsedContractPatch ? { contractPatch: parsedContractPatch } : {}),
  } as const;

  // Capsule loading may prune an expired completed task into its final receipt.
  const existingCapsule = await loadTaskResumeCapsule(input.rootPath, input.taskId);
  const final = await loadTaskFinalReceipt(input.rootPath, input.taskId);
  const completedParent = Boolean(
    final ||
      existingCapsule?.status === "completed" ||
      existingCapsule?.lifecycle.phase === "completed",
  );
  if (completedParent && normalizedKind !== "correction") {
    throw new Error(
      "Completed tasks are immutable; only a correction may create a linked follow-up task.",
    );
  }
  if (completedParent) {
    const parentTaskId = input.taskId;
    const parentObjective =
      final?.objective ??
      (await resolveTaskObjective(input.rootPath, parentTaskId))?.text;
    if (!parentObjective) {
      throw new Error("Completed parent objective is unavailable.");
    }
    const childTaskId = `task-${randomUUID()}`;
    const event = await persistTaskFeedbackEvent(input.rootPath, {
      taskId: childTaskId,
      feedbackId: feedbackIdentity({ taskId: childTaskId, ...eventInput }),
      ...eventInput,
    });
    await writeTaskCheckpoint(input.rootPath, {
      taskId: childTaskId,
      title: `Follow-up: ${parentObjective}`,
      lineage: {
        rootTaskId: existingCapsule?.lineage?.rootTaskId ?? parentTaskId,
        parentTaskId,
        relation: "correction",
        sourceFeedbackHandle: event.handle,
      },
      feedbackSummary: {
        total: 1,
        pending: event.required ? 1 : 0,
        latestHandle: event.handle,
        latestAt: event.createdAt,
      },
      milestone: "objective-approved",
      objective: `Follow up on ${parentObjective}\n\n${input.feedbackText}`,
      objectiveApproved: true,
      decisions: [],
      sourceReceiptIds: [],
      handles: [event.handle],
      covered: ["follow-up task created from completed parent"],
      remaining: ["review appended feedback", "prepare and lock follow-up scope"],
      budgetChars: 3_600,
      nextSafeAction:
        "Prepare the follow-up task, then decide and lock its change scope.",
    });
    await writeTaskFocus(input.rootPath, { taskId: childTaskId });
    return text({
      status: "follow-up-created",
      taskId: childTaskId,
      parentTaskId,
      feedback: {
        id: event.feedbackId,
        handle: event.handle,
        kind: normalizedKind,
        required: event.required,
      },
      nextAction: "Continue with the focused follow-up task.",
    });
  }

  const capsule = existingCapsule ?? (await requireCapsule(input.rootPath, input.taskId));
  if (capsule.status === "completed") {
    throw new Error(
      "Only corrective feedback can continue a completed task; use note feedback before completion.",
    );
  }
  const event = await persistTaskFeedbackEvent(input.rootPath, {
    taskId: input.taskId,
    feedbackId: feedbackIdentity({ taskId: input.taskId, ...eventInput }),
    ...eventInput,
  });
  const objective = await resolveTaskObjective(input.rootPath, input.taskId);
  if (!objective) throw new Error("Task objective is unavailable.");
  const sourceLedger = await loadTaskSourceLedger(input.rootPath, input.taskId);
  const queue = await loadTaskFeedbackQueue(input.rootPath, input.taskId);
  const queueSummary = feedbackQueueSummary(queue)!;
  const savedFeedback = await writeTaskCheckpoint(input.rootPath, {
    taskId: input.taskId,
    expectedUpdatedAt: capsule.updatedAt,
    status: capsule.status,
    milestone: "decision-confirmed",
    objective: objective.text,
    objectiveApproved: objective.approved,
    ...(objective.reference ? { objectiveReference: objective.reference } : {}),
    decisions: sourceLedger?.decisions ?? [],
    ...(sourceLedger?.relations ? { sourceRelations: sourceLedger.relations } : {}),
    sourceReceiptIds: sourceLedger?.receiptIds ?? capsule.sourceReceiptIds,
    handles: [event.handle, ...capsule.handles].slice(0, 8),
    covered: [...capsule.scope.covered, "feedback appended"].slice(-8),
    remaining: capsule.scope.remaining,
    budgetChars: capsule.budget.contextChars,
    estimatedTokens: capsule.budget.estimatedTokens,
    feedbackSummary: queueSummary,
    ...((input.impact === "scope-change" || normalizedKind === "scope-change") &&
    capsule.changeSurface &&
    !capsule.changeInvalidation
      ? {
          changeInvalidation: {
            reason: `Feedback ${event.feedbackId} changes the locked task scope.`,
          },
        }
      : {}),
    nextSafeAction:
      input.impact === "scope-change" || normalizedKind === "scope-change"
        ? "Review the feedback, amend the task evidence and explicitly relock the changed scope."
        : "Review the feedback and amend task evidence or criterion progress before continuing.",
  });
  await writeTaskFocus(input.rootPath, { taskId: input.taskId });
  if (
    parsedContractPatch &&
    event.impact !== "scope" &&
    (await loadLatestTaskEvidenceContract(input.rootPath, input.taskId))
  ) {
    const reconciliation = await reconcileCoreTask({
      rootPath: input.rootPath,
      taskId: input.taskId,
      capsule: savedFeedback,
      contractPatch: parsedContractPatch,
      feedbackIds: [event.feedbackId],
    });
    return text({
      status: "feedback-applied",
      taskId: input.taskId,
      feedback: {
        id: event.feedbackId,
        handle: event.handle,
        kind: normalizedKind,
        origin: event.origin,
        required: event.required,
      },
      reconciliation,
    });
  }
  return text({
    status: "feedback-appended",
    taskId: input.taskId,
    feedback: {
      id: event.feedbackId,
      handle: event.handle,
      kind: normalizedKind,
      origin: event.origin,
      required: event.required,
    },
    nextAction: parsedContractPatch
      ? "Record an evidence contract, then reconcile the queued contract patch."
      : "Reconcile the feedback into task evidence before claiming completion.",
  });
}
