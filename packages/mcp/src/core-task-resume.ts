import {
  encodeResumeCapsule,
  loadTaskFinalReceipt,
  loadTaskResumeTransport,
  recoverTaskResumeState,
} from "@component-atlas/runtime";

function compactCandidates(
  candidates: Awaited<ReturnType<typeof recoverTaskResumeState>>["candidates"],
) {
  return candidates.map((candidate) => ({
    taskId: candidate.taskId,
    status: candidate.status,
    updatedAt: candidate.updatedAt,
    objective: candidate.objective.slice(0, 240),
    nextSafeAction: candidate.nextSafeAction.slice(0, 320),
    ...(candidate.continuationHandle
      ? { continuationHandle: candidate.continuationHandle }
      : {}),
  }));
}

export async function resumeCoreTask(rootPath: string, taskId?: string) {
  if (!taskId) {
    const recovery = await recoverTaskResumeState(rootPath);
    if (recovery.status !== "ready") {
      return {
        status: recovery.status,
        candidateCount: recovery.candidateCount,
        candidates: compactCandidates(recovery.candidates),
        nextAction:
          recovery.status === "selection-required"
            ? "Repeat action=resume with one exact task_id from candidates."
            : "Prepare a new Atlas task before implementation.",
      };
    }
    return {
      ...encodeResumeCapsule(recovery.capsule),
      taskId: recovery.capsule.taskId,
      recovered: "exact-checkout" as const,
      ...(recovery.continuation
        ? { continuationHandle: recovery.continuation.handle }
        : {}),
      nextAction: recovery.continuation
        ? `Expand ${recovery.continuation.handle} before continuing implementation.`
        : recovery.capsule.nextSafeAction,
    };
  }

  const transport = await loadTaskResumeTransport(rootPath, taskId);
  if (transport) return transport;
  const finalReceipt = await loadTaskFinalReceipt(rootPath, taskId);
  if (!finalReceipt) return { status: "not-found", taskId };
  return {
    status: "completed",
    taskId,
    final: {
      completedAt: finalReceipt.completedAt,
      objective: finalReceipt.objective,
      head: finalReceipt.head,
      ...(finalReceipt.outcome
        ? {
            result: finalReceipt.outcome.result,
            summary: finalReceipt.outcome.summary.slice(0, 500),
            verification: finalReceipt.outcome.verification
              .slice(0, 4)
              .map((item) => item.slice(0, 200)),
            files: finalReceipt.outcome.files.slice(0, 8),
            omitted: {
              verification: Math.max(
                0,
                finalReceipt.outcome.verification.length - 4,
              ),
              files: Math.max(0, finalReceipt.outcome.files.length - 8),
            },
          }
        : {}),
      ...(finalReceipt.lock ? { lock: finalReceipt.lock } : {}),
      ...(finalReceipt.validation
        ? { validation: finalReceipt.validation }
        : {}),
    },
    deliveryReceipt: finalReceipt.deliveryReceipt ?? null,
    handles: finalReceipt.deliveryReceipt ? [finalReceipt.deliveryReceipt] : [],
    memory: "not-written" as const,
  };
}
