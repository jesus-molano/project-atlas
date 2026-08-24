import {
  assertSourceReceiptMatchesDecision,
  buildComponentContext,
  type ComponentGraph,
} from "@component-atlas/core";
import {
  getProjectMemoryItem,
  inspectFigmaDesignNode,
  listFigmaDesignIndexes,
  loadConfirmedTaskSourceDecision,
  loadFigmaSnapshot,
  loadFigmaAssetMetadata,
  loadPersistedSourceReceipt,
  loadProjectGraph,
  loadTaskCompletionReceipt,
  loadTaskContinuationBundle,
  loadTaskEvidenceContract,
  loadTaskExecutionManifest,
  loadTaskFeedbackEvent,
  loadTaskGitReconciliation,
  loadTaskResumeCapsule,
  loadTaskRetrievalResult,
  loadTaskSourceLedger,
  loadVisualEvidenceContract,
  loadVisualReviewReceipt,
} from "@component-atlas/runtime";

export function taskBoundHandle(handle: string): boolean {
  return (
    handle.startsWith("receipt-") ||
    handle.startsWith("figma-asset:") ||
    handle.startsWith("figma-snapshot:") ||
    handle.startsWith("visual:") ||
    handle.startsWith("visual-review:") ||
    handle.startsWith("delivery:") ||
    handle.startsWith("contract:") ||
    handle.startsWith("continuation:") ||
    handle.startsWith("feedback:") ||
    handle.startsWith("git-state:") ||
    handle.startsWith("retrieval:") ||
    handle.startsWith("manifest:")
  );
}

async function taskReceiptIds(
  rootPath: string,
  taskId: string,
): Promise<string[]> {
  const [ledger, capsule] = await Promise.all([
    loadTaskSourceLedger(rootPath, taskId),
    loadTaskResumeCapsule(rootPath, taskId),
  ]);
  return [...new Set([...(ledger?.receiptIds ?? []), ...(capsule?.sourceReceiptIds ?? [])])];
}

export async function loadAuthorizedTaskFigmaAsset(
  rootPath: string,
  taskId: string,
  handle: string,
  allowedReceiptIds?: string[],
) {
  const metadata = await loadFigmaAssetMetadata(handle, rootPath);
  if (metadata.taskId !== taskId) {
    throw new Error(`Figma asset ${handle} belongs to a different task.`);
  }
  if (Date.parse(metadata.expiresAt) <= Date.now()) {
    throw new Error(`Figma asset ${handle} has expired.`);
  }
  const ownedReceiptIds =
    allowedReceiptIds ?? (await taskReceiptIds(rootPath, taskId));
  if (!ownedReceiptIds.includes(metadata.sourceReceiptId)) {
    throw new Error(
      `Figma asset ${handle} is backed by a receipt outside task ${taskId}.`,
    );
  }
  const receipt = await loadPersistedSourceReceipt(
    rootPath,
    metadata.sourceReceiptId,
  );
  const decision = await loadConfirmedTaskSourceDecision(
    rootPath,
    taskId,
    receipt.sourceDecisionId,
  );
  assertSourceReceiptMatchesDecision(
    {
      id: decision.id,
      kind: decision.kind,
      reference: decision.reference,
      state: decision.state,
      ...(decision.routePolicy ? { routePolicy: decision.routePolicy } : {}),
    },
    receipt,
  );
  const authorizedScopeIds = new Set(
    [
      receipt.requested.nodeId,
      receipt.resolved.nodeId,
      receipt.scope.id,
      receipt.scope.parentId,
      receipt.scopeRelation?.sourceId,
      receipt.scopeRelation?.targetId,
      ...(receipt.scopeRelation?.ancestorIds ?? []),
    ].filter((value): value is string => Boolean(value)),
  );
  if (
    receipt.provider !== "figma" ||
    receipt.adapter !== "figma-desktop-mcp-local" ||
    receipt.coverage !== "exact" ||
    receipt.freshness !== "current" ||
    receipt.requested.fileKey !== metadata.fileKey ||
    !authorizedScopeIds.has(metadata.scopeNodeId)
  ) {
    throw new Error(
      `Figma asset ${handle} is not backed by current exact Desktop MCP evidence for its selected scope.`,
    );
  }
  return metadata;
}

export async function assertTaskBoundHandle(
  rootPath: string,
  taskId: string,
  handle: string,
  allowedReceiptIds?: string[],
): Promise<void> {
  if (handle.startsWith("receipt-")) {
    const owned = allowedReceiptIds ?? (await taskReceiptIds(rootPath, taskId));
    if (!owned.includes(handle)) {
      throw new Error(`Source receipt ${handle} is not bound to task ${taskId}.`);
    }
    await loadPersistedSourceReceipt(rootPath, handle);
    return;
  }
  if (handle.startsWith("figma-asset:")) {
    await loadAuthorizedTaskFigmaAsset(
      rootPath,
      taskId,
      handle,
      allowedReceiptIds,
    );
    return;
  }
  if (handle.startsWith("figma-snapshot:")) {
    const snapshot = await loadFigmaSnapshot(rootPath, handle);
    if (snapshot.taskId !== taskId) {
      throw new Error(`Figma snapshot ${handle} belongs to a different task.`);
    }
    const owned = allowedReceiptIds ?? (await taskReceiptIds(rootPath, taskId));
    if (snapshot.receiptIds.some((receiptId) => !owned.includes(receiptId))) {
      throw new Error(
        `Figma snapshot ${handle} is backed by a receipt outside task ${taskId}.`,
      );
    }
    return;
  }
  if (handle.startsWith("visual:")) {
    const contract = await loadVisualEvidenceContract(rootPath, handle);
    if (contract.taskId !== taskId) {
      throw new Error(`Visual contract ${handle} belongs to a different task.`);
    }
    return;
  }
  if (handle.startsWith("visual-review:")) {
    await loadVisualReviewReceipt(rootPath, handle, taskId);
    return;
  }
  if (handle.startsWith("delivery:")) {
    await loadTaskCompletionReceipt(rootPath, handle, taskId);
    return;
  }
  if (handle.startsWith("contract:")) {
    const contract = await loadTaskEvidenceContract(rootPath, handle);
    if (contract.taskId !== taskId) {
      throw new Error(`Task evidence contract ${handle} belongs to a different task.`);
    }
    return;
  }
  if (handle.startsWith("continuation:")) {
    const continuation = await loadTaskContinuationBundle(rootPath, handle);
    if (continuation.taskId !== taskId) {
      throw new Error(`Task continuation ${handle} belongs to a different task.`);
    }
    return;
  }
  if (handle.startsWith("feedback:")) {
    const feedback = await loadTaskFeedbackEvent(rootPath, handle);
    if (feedback.taskId !== taskId) {
      throw new Error(`Task feedback ${handle} belongs to a different task.`);
    }
    return;
  }
  if (handle.startsWith("git-state:")) {
    const gitState = await loadTaskGitReconciliation(rootPath, handle);
    if (gitState.taskId !== taskId) {
      throw new Error(`Git state ${handle} belongs to a different task.`);
    }
    return;
  }
  if (handle.startsWith("retrieval:")) {
    await loadTaskRetrievalResult(rootPath, handle, taskId);
    return;
  }
  if (handle.startsWith("manifest:")) {
    await loadTaskExecutionManifest(rootPath, handle, taskId);
    return;
  }
  throw new Error(`Handle ${handle} is not task-bound.`);
}

async function assertDesignHandle(rootPath: string, handle: string): Promise<void> {
  const selector = handle.slice(7);
  const separator = selector.indexOf("::");
  const requestedFile = separator > 0 ? selector.slice(0, separator) : undefined;
  const node = separator > 0 ? selector.slice(separator + 2) : selector;
  const indexes = await listFigmaDesignIndexes(rootPath);
  let matches = 0;
  for (const index of indexes.filter(
    (candidate) => !requestedFile || candidate.file.key === requestedFile,
  )) {
    try {
      await inspectFigmaDesignNode(rootPath, index.file.key, node);
      matches += 1;
    } catch {
      // A stable design handle is valid only when exactly one index owns it.
    }
  }
  if (matches !== 1) {
    throw new Error(
      matches === 0
        ? `Design handle ${handle} was not found.`
        : `Design handle ${handle} is ambiguous; include fileKey::nodeId.`,
    );
  }
}

/** Validate every caller-selected handle before it becomes resumable evidence. */
export async function assertSelectableHandles(
  rootPath: string,
  taskId: string,
  handles: string[],
  allowedReceiptIds: string[],
  currentGraph?: ComponentGraph,
): Promise<void> {
  let graph = currentGraph;
  const requireGraph = async () => {
    graph ??= await loadProjectGraph(rootPath);
    return graph;
  };
  for (const handle of [...new Set(handles)]) {
    if (taskBoundHandle(handle)) {
      await assertTaskBoundHandle(rootPath, taskId, handle, allowedReceiptIds);
      continue;
    }
    if (handle.startsWith("code:")) {
      buildComponentContext(await requireGraph(), handle.slice(5));
      continue;
    }
    if (handle.startsWith("entity:")) {
      if (
        !(await requireGraph()).entities.some(
          (entity) => entity.id === handle.slice(7),
        )
      ) {
        throw new Error(`Frontend entity handle ${handle} was not found.`);
      }
      continue;
    }
    if (handle.startsWith("design:")) {
      await assertDesignHandle(rootPath, handle);
      continue;
    }
    if (handle.startsWith("memory:")) {
      await getProjectMemoryItem(rootPath, handle, { budgetChars: 1_600 });
      continue;
    }
    throw new Error(`Selected handle ${handle} is unsupported or malformed.`);
  }
}
