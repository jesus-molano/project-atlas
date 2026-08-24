import { assertSourceReceiptMatchesDecision } from "@component-atlas/core";
import {
  loadPersistedSourceReceipt,
  loadTaskCompletionReceipt,
  loadTaskFinalReceipt,
  loadTaskResumeCapsule,
  loadTaskSourceLedger,
  resolveTaskObjective,
} from "@component-atlas/runtime";

export async function completedTaskContext(rootPath: string, id: string) {
  const capsule = await loadTaskResumeCapsule(rootPath, id);
  if (
    capsule?.status === "completed" &&
    capsule.lifecycle.phase === "completed"
  ) {
    const objective = await resolveTaskObjective(rootPath, id);
    if (!objective) throw new Error("Completed task objective is missing.");
    return { objective: objective.text };
  }
  const finalReceipt = await loadTaskFinalReceipt(rootPath, id);
  if (
    finalReceipt?.outcome &&
    ["failure", "partial"].includes(finalReceipt.outcome.result)
  ) {
    return { objective: finalReceipt.objective };
  }
  if (
    finalReceipt?.deliveryReceipt &&
    finalReceipt.validation &&
    finalReceipt.lock?.id === finalReceipt.validation.lockId
  ) {
    await loadTaskCompletionReceipt(
      rootPath,
      finalReceipt.deliveryReceipt,
      id,
    );
    return { objective: finalReceipt.objective };
  }
  throw new Error(
    "Episodic recording and canonical proposals require a completed task with either a durable partial/failure outcome or a validated successful delivery receipt.",
  );
}

export async function verifyTaskReceiptLedger(
  rootPath: string,
  taskId: string,
  receiptIds: string[],
): Promise<
  Array<{
    id: string;
    receipt: Awaited<ReturnType<typeof loadPersistedSourceReceipt>>;
  }>
> {
  const uniqueReceiptIds = [...new Set(receiptIds)];
  if (uniqueReceiptIds.length === 0) return [];
  const ledger = await loadTaskSourceLedger(rootPath, taskId);
  if (!ledger) throw new Error(`Task ${taskId} has no source ledger.`);
  const verified = [];
  for (const id of uniqueReceiptIds) {
    if (!ledger.receiptIds.includes(id)) {
      throw new Error(`Receipt ${id} is outside task ${taskId}'s source ledger.`);
    }
    const receipt = await loadPersistedSourceReceipt(rootPath, id);
    const decision = ledger.decisions.find(
      (candidate) => candidate.id === receipt.sourceDecisionId,
    );
    if (!decision) {
      throw new Error(`Receipt ${id} is outside task ${taskId}'s source ledger.`);
    }
    assertSourceReceiptMatchesDecision(decision, receipt);
    verified.push({ id, receipt });
  }
  return verified;
}
