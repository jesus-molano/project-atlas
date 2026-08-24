import {
  loadLatestTaskContinuationBundle,
  loadLatestTaskEvidenceContract,
  loadTaskFeedbackQueue,
  loadTaskFinalReceipt,
  loadTaskResumeCapsule,
  inspectTaskGit,
  recoverTaskResumeState,
  resolveTaskObjective,
  taskAcceptanceState,
  type TaskResumeCapsule,
} from "@component-atlas/runtime";

function compactCandidates(
  candidates: Awaited<ReturnType<typeof recoverTaskResumeState>>["candidates"],
) {
  return candidates.map((candidate) => ({
    taskId: candidate.taskId,
    title: candidate.title,
    status: candidate.status,
    updatedAt: candidate.updatedAt,
    objective: candidate.objective.slice(0, 240),
    objectiveTruncated: candidate.objective.length > 240,
    nextSafeAction: candidate.nextSafeAction.slice(0, 320),
    ...(candidate.continuationHandle
      ? { continuationHandle: candidate.continuationHandle }
      : {}),
  }));
}

async function structuredCapsule(rootPath: string, capsule: TaskResumeCapsule) {
  const [objective, contract, continuation, reconciliation, feedbackQueue] =
    await Promise.all([
      resolveTaskObjective(rootPath, capsule.taskId),
      loadLatestTaskEvidenceContract(rootPath, capsule.taskId),
      loadLatestTaskContinuationBundle(rootPath, capsule.taskId),
      inspectTaskGit(rootPath, {
        taskId: capsule.taskId,
        ...(capsule.changeSurface?.gitBaseline
          ? { baseline: capsule.changeSurface.gitBaseline }
          : {}),
        storedHead: capsule.workspace.head,
      }),
      loadTaskFeedbackQueue(rootPath, capsule.taskId),
    ]);
  const {
    handle: _liveHandle,
    hash: _liveHash,
    ...liveReconciliation
  } = reconciliation;
  const latestFeedback = feedbackQueue.at(-1);
  const acceptance =
    contract && continuation && continuation.contract.handle === contract.handle
      ? taskAcceptanceState(contract, continuation)
      : undefined;
  const validation = !capsule.validation
    ? "missing"
    : capsule.changeSurface &&
        reconciliation.delta?.deltaHash === capsule.validation.deltaHash &&
        capsule.validation.lockId === capsule.changeSurface.lockId
      ? "current"
      : "stale";
  return {
    status: capsule.status,
    taskId: capsule.taskId,
    title: capsule.title,
    objective: objective?.text ?? capsule.objective.text,
    updatedAt: capsule.updatedAt,
    lifecycle: capsule.lifecycle,
    git: {
      ...capsule.workspace,
      reconciliation: { ...liveReconciliation, persisted: false },
    },
    ...(contract
      ? {
          criteria: {
            contract: {
              handle: contract.handle,
              revision: contract.revision,
              total: contract.criteria.length,
            },
            ...(acceptance ? { acceptance } : {}),
          },
        }
      : { criteria: { total: 0 } }),
    feedback: latestFeedback
      ? {
          total: feedbackQueue.length,
          pending: feedbackQueue.filter(
            (event) => event.required && event.status === "pending",
          ).length,
          latestHandle: latestFeedback.handle,
          latestAt: latestFeedback.createdAt,
        }
      : { total: 0, pending: 0 },
    validation,
    ...(capsule.lineage ? { lineage: capsule.lineage } : {}),
    handles: capsule.handles,
    nextAction:
      validation === "stale"
        ? "Reconcile the changed Git delta and run Atlas validation again before completion."
        : continuation?.nextSafeAction ?? capsule.nextSafeAction,
  };
}

export async function resumeCoreTask(
  rootPath: string,
  taskId?: string,
): Promise<Record<string, unknown>> {
  if (!taskId) {
    const recovery = await recoverTaskResumeState(rootPath);
    if (recovery.status !== "ready") {
      return {
        status: recovery.status,
        candidateCount: recovery.candidateCount,
        returnedCandidateCount: recovery.candidates.length,
        omittedCandidateCount: Math.max(
          0,
          recovery.candidateCount - recovery.candidates.length,
        ),
        candidates: compactCandidates(recovery.candidates),
        recommendation: {
          taskId:
            recovery.status === "selection-required"
              ? recovery.recommendedTaskId
              : null,
          reason:
            recovery.status === "selection-required"
              ? recovery.recommendationReason
              : "no-active-task",
        },
        nextAction:
          recovery.status === "selection-required"
            ? "Resume one exact task_id, or prepare with start_new_task=true for a separate objective."
            : "Prepare a new Atlas task before implementation.",
      };
    }
    return {
      ...(await structuredCapsule(rootPath, recovery.capsule)),
      candidateCount: recovery.candidateCount,
      returnedCandidateCount: recovery.candidates.length,
      omittedCandidateCount: Math.max(
        0,
        recovery.candidateCount - recovery.candidates.length,
      ),
      candidates: compactCandidates(recovery.candidates),
      recommendation: {
        taskId: recovery.recommendedTaskId,
        reason: recovery.recommendationReason,
      },
      recovered: "exact-checkout" as const,
    };
  }

  const capsule = await loadTaskResumeCapsule(rootPath, taskId);
  if (capsule) {
    const objective = await resolveTaskObjective(rootPath, capsule.taskId);
    return {
      ...(await structuredCapsule(rootPath, capsule)),
      candidateCount: 1,
      returnedCandidateCount: capsule.status === "completed" ? 0 : 1,
      omittedCandidateCount: 0,
      candidates:
        capsule.status === "completed"
          ? []
          : compactCandidates([{
              taskId: capsule.taskId,
              title: capsule.title,
              status: capsule.status,
              updatedAt: capsule.updatedAt,
              objective: objective?.text ?? capsule.objective.text,
              nextSafeAction: capsule.nextSafeAction,
            }]),
      recommendation: { taskId: capsule.taskId, reason: "explicit-task-id" },
    };
  }
  const finalReceipt = await loadTaskFinalReceipt(rootPath, taskId);
  if (!finalReceipt) return { status: "not-found", taskId };
  return {
    status: "completed",
    taskId,
    candidateCount: 0,
    returnedCandidateCount: 0,
    omittedCandidateCount: 0,
    title: finalReceipt.objective.slice(0, 160),
    objective: finalReceipt.objective,
    git: { head: finalReceipt.head },
    criteria: { total: 0 },
    feedback: { total: 0, pending: 0 },
    final: {
      completedAt: finalReceipt.completedAt,
      ...(finalReceipt.lock ? { lock: finalReceipt.lock } : {}),
      ...(finalReceipt.validation ? { validation: finalReceipt.validation } : {}),
      ...(finalReceipt.outcome
        ? {
            result: finalReceipt.outcome.result,
            summary: finalReceipt.outcome.summary,
            verification: finalReceipt.outcome.verification,
            files: finalReceipt.outcome.files,
          }
        : {}),
    },
    deliveryReceipt: finalReceipt.deliveryReceipt ?? null,
    handles: finalReceipt.deliveryReceipt ? [finalReceipt.deliveryReceipt] : [],
    memory: "not-written",
    ...(finalReceipt.lock ? { lock: finalReceipt.lock } : {}),
    ...(finalReceipt.validation ? { validation: finalReceipt.validation } : {}),
    recommendation: { taskId, reason: "explicit-task-id" },
  };
}
