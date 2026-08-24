import {
  assertVisualArtifactSessionClean,
  assertVisualCleanupReceipt,
  loadLatestFigmaSnapshot,
  loadVisualEvidenceContract,
  loadVisualReviewReceipt,
  persistVisualReviewReceipt,
  resolveTaskObjective,
  verifyVisualCaptureReceipt,
  writeTaskCheckpoint,
  type TaskResumeCapsule,
  type VisualEvidenceContract,
  type VisualReviewReceipt,
} from "@component-atlas/runtime";
import { z } from "zod";
import { authoritativeTaskSources } from "./core-source-evidence.js";

const captureHandle = /^artifact-[a-f0-9]{12}-[a-f0-9]{8}$/u;
const MAX_VISUAL_REVIEW_CASES = 14;

export const visualReviewInputSchema = z.object({
  contract_handle: z
    .string()
    .regex(/^visual:vd-[A-Za-z0-9_-]+:[a-f0-9]{16}$/u),
  contract_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  state_matrix: z.object({
    surface: z.string().min(1).max(120),
    cases: z
      .array(
        z.object({
          id: z.string().min(1).max(64),
          route: z.string().min(1).max(160),
          viewport: z.string().min(1).max(48),
          state: z.string().min(1).max(48),
        }),
      )
      .min(1)
      .max(MAX_VISUAL_REVIEW_CASES),
  }),
  captures: z
    .array(
      z.object({
        case_id: z.string().min(1).max(64),
        handle: z.string().regex(captureHandle),
        hash: z.string().regex(/^[a-f0-9]{64}$/u),
        receipt: z
          .string()
          .regex(
            /^capture-receipt:v1:[a-f0-9]{16}:vd-[A-Za-z0-9_-]+:[a-f0-9]{16}:[a-f0-9]{16}$/u,
          ),
      }),
    )
    .max(MAX_VISUAL_REVIEW_CASES),
  figma_comparisons: z
    .array(
      z.object({
        case_id: z.string().min(1).max(64),
        status: z.enum(["match", "deviation", "not-applicable"]),
        node_id: z.string().min(1).max(240).optional(),
      }),
    )
    .max(MAX_VISUAL_REVIEW_CASES),
  result: z.enum(["pass", "fix-and-recapture", "blocked"]),
  deviation_count: z.number().int().min(0).max(99),
  cleanup: z.object({
    state: z.enum([
      "clean",
      "selected-retained",
      "not-applicable",
      "cleanup-pending",
    ]),
    receipt: z.string().min(1).max(260).optional(),
  }),
  preliminary_review_handle: z
    .string()
    .regex(/^visual-review:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{16}$/u)
    .optional(),
  reviewed_at: z.string().datetime().optional(),
});

export type VisualReviewInput = z.infer<typeof visualReviewInputSchema>;

function sameImmutableReviewEvidence(
  preliminary: VisualReviewReceipt,
  final: VisualReviewReceipt,
): boolean {
  return (
    preliminary.schemaVersion === final.schemaVersion &&
    preliminary.taskId === final.taskId &&
    preliminary.contractHandle === final.contractHandle &&
    preliminary.contractHash === final.contractHash &&
    preliminary.artifactSessionId === final.artifactSessionId &&
    preliminary.result === final.result &&
    preliminary.deviationCount === final.deviationCount &&
    JSON.stringify(preliminary.stateMatrix) ===
      JSON.stringify(final.stateMatrix) &&
    JSON.stringify(preliminary.captures) === JSON.stringify(final.captures) &&
    (preliminary.schemaVersion !== 2 ||
      final.schemaVersion !== 2 ||
      JSON.stringify(preliminary.figmaComparisons) ===
        JSON.stringify(final.figmaComparisons)) &&
    JSON.stringify(preliminary.coverage) === JSON.stringify(final.coverage)
  );
}

async function assertFinalReviewChain(
  rootPath: string,
  taskId: string,
  final: VisualReviewReceipt,
  contractSessionId: string,
): Promise<void> {
  if (
    final.cleanup.state !== "clean" ||
    !final.cleanup.receipt ||
    !final.preliminaryReviewHandle ||
    !final.artifactSessionId
  ) {
    throw new Error(
      "A final visual review requires immutable preliminary and cleanup evidence.",
    );
  }
  const preliminary = await loadVisualReviewReceipt(
    rootPath,
    final.preliminaryReviewHandle,
    taskId,
  );
  if (
    preliminary.cleanup.state !== "selected-retained" ||
    !sameImmutableReviewEvidence(preliminary, final)
  ) {
    throw new Error(
      "The final visual review differs from its selected-retained preliminary review.",
    );
  }
  const cleanup = assertVisualCleanupReceipt(taskId, final.cleanup.receipt);
  if (
    (final.result === "pass"
      ? cleanup.reason !== "close"
      : !["close", "cancel"].includes(cleanup.reason)) ||
    cleanup.sessionId !== final.artifactSessionId ||
    cleanup.sessionId !== contractSessionId
  ) {
    throw new Error(
      "The final visual cleanup receipt is not bound to the reviewed artifact session.",
    );
  }
  await assertVisualArtifactSessionClean(cleanup.sessionId);
}

function normalizedFigmaNodeId(value: string): string {
  return value.trim().replace(/^(\d+)-(\d+)$/u, "$1:$2");
}

async function assertFigmaComparisonAuthority(
  rootPath: string,
  taskId: string,
  capsule: TaskResumeCapsule,
  contract: Pick<VisualEvidenceContract, "authority" | "figma">,
  input: VisualReviewInput,
): Promise<void> {
  if (contract.authority !== "exact-figma") {
    if (
      input.figma_comparisons.some(
        (comparison) =>
          comparison.status !== "not-applicable" || comparison.node_id !== undefined,
      )
    ) {
      throw new Error(
        "Non-Figma visual authority must mark every Figma comparison as not-applicable.",
      );
    }
    return;
  }
  if (
    input.figma_comparisons.some(
      (comparison) =>
        comparison.status === "not-applicable" || !comparison.node_id,
    )
  ) {
    throw new Error(
      "Exact Figma authority requires a node-bound comparison for every supplied case.",
    );
  }
  if (input.figma_comparisons.length === 0 && input.result !== "pass") {
    return;
  }
  const snapshot = await loadLatestFigmaSnapshot(rootPath, taskId);
  if (
    !snapshot ||
    !capsule.changeSurface?.evidence.handles.includes(snapshot.handle)
  ) {
    throw new Error(
      "Exact Figma comparison requires the latest semantic snapshot in the active ChangeSurface.",
    );
  }
  if (
    !contract.figma ||
    snapshot.identity.fileKey !== contract.figma.fileKey ||
    normalizedFigmaNodeId(snapshot.identity.nodeId ?? "") !==
      normalizedFigmaNodeId(contract.figma.nodeId ?? "")
  ) {
    throw new Error(
      "Exact Figma comparison requires a semantic snapshot for the visual contract's exact file and node.",
    );
  }
  const exactNodeId = normalizedFigmaNodeId(contract.figma.nodeId ?? "");
  const unknownNode = input.figma_comparisons.find(
    (comparison) =>
      comparison.node_id &&
      normalizedFigmaNodeId(comparison.node_id) !== exactNodeId,
  );
  if (unknownNode) {
    throw new Error(
      `Figma comparison ${unknownNode.case_id} must reference the exact node authorized by the locked visual contract and semantic snapshot.`,
    );
  }
}

export async function attachVisualReview(
  rootPath: string,
  taskId: string,
  capsule: TaskResumeCapsule,
  input: VisualReviewInput,
) {
  const objective = await resolveTaskObjective(rootPath, taskId);
  if (
    objective?.authority !== "authoritative" ||
    !objective.reference
  ) {
    throw new Error(
      "Task objective is not authoritative; re-prepare or explicitly promote the legacy objective before visual review.",
    );
  }
  const sourceLedger = await authoritativeTaskSources(
    rootPath,
    taskId,
    capsule,
  );
  if (
    capsule.status === "completed" ||
    !capsule.changeSurface ||
    !["scoped", "validated"].includes(capsule.lifecycle.phase) ||
    capsule.changeInvalidation?.relockRequired
  ) {
    throw new Error(
      "Visual review may be attached only to an active, locked, non-invalidated task.",
    );
  }
  if (!capsule.changeSurface.evidence.handles.includes(input.contract_handle)) {
    throw new Error(
      "Visual review must reference a visual contract frozen in the active ChangeSurface.",
    );
  }
  const contract = await loadVisualEvidenceContract(rootPath, input.contract_handle);
  if (
    contract.taskId !== taskId ||
    contract.hash !== input.contract_hash ||
    Date.parse(contract.expiresAt) <= Date.now()
  ) {
    throw new Error(
      "Visual review contract identity is stale or differs from the locked task evidence.",
    );
  }
  await assertFigmaComparisonAuthority(
    rootPath,
    taskId,
    capsule,
    contract,
    input,
  );
  let artifactSessionId: string | undefined;
  let preliminaryReviewHandle: string | undefined;
  if (input.cleanup.state === "clean") {
    if (!input.preliminary_review_handle || !input.cleanup.receipt) {
      throw new Error(
        "A final clean review requires the immutable preliminary review and cleanup receipt.",
      );
    }
    const preliminary = await loadVisualReviewReceipt(
      rootPath,
      input.preliminary_review_handle,
      taskId,
    );
    if (
      preliminary.schemaVersion !== 2 ||
      preliminary.cleanup.state !== "selected-retained" ||
      !preliminary.artifactSessionId ||
      preliminary.contractHandle !== input.contract_handle ||
      preliminary.contractHash !== input.contract_hash ||
      preliminary.result !== input.result ||
      preliminary.deviationCount !== input.deviation_count ||
      preliminary.stateMatrix.surface !== input.state_matrix.surface ||
      JSON.stringify(preliminary.stateMatrix.cases) !==
        JSON.stringify(
          input.state_matrix.cases
            .map((entry) => ({
              id: entry.id,
              route: entry.route,
              viewport: entry.viewport,
              state: entry.state,
            }))
            .sort((left, right) => left.id.localeCompare(right.id)),
        ) ||
      JSON.stringify(preliminary.captures) !==
        JSON.stringify(
          input.captures
            .map((capture) => ({
              caseId: capture.case_id,
              handle: capture.handle,
              hash: capture.hash,
              receipt: capture.receipt,
            }))
            .sort((left, right) => left.caseId.localeCompare(right.caseId)),
        ) ||
      JSON.stringify(preliminary.figmaComparisons) !==
        JSON.stringify(
          input.figma_comparisons
            .map((comparison) => ({
              caseId: comparison.case_id,
              status: comparison.status,
              ...(comparison.node_id
                ? { nodeId: comparison.node_id }
                : {}),
            }))
            .sort((left, right) => left.caseId.localeCompare(right.caseId)),
        )
    ) {
      throw new Error(
        "A final clean review must preserve the preliminary task, contract, matrix, captures and outcome exactly.",
      );
    }
    const cleanup = assertVisualCleanupReceipt(taskId, input.cleanup.receipt);
    if (
      cleanup.sessionId !== preliminary.artifactSessionId ||
      cleanup.sessionId !== contract.artifactSessionId
    ) {
      throw new Error(
        "Visual cleanup must close the same session that emitted the selected contract and preliminary captures.",
      );
    }
    await assertVisualArtifactSessionClean(cleanup.sessionId);
    artifactSessionId = cleanup.sessionId;
    preliminaryReviewHandle = preliminary.handle;
  } else {
    if (input.preliminary_review_handle) {
      throw new Error(
        "Only a final clean review may reference a preliminary review.",
      );
    }
    const verifiedCaptures = await Promise.all(
      input.captures.map((capture) =>
        verifyVisualCaptureReceipt({
          taskId,
          receipt: capture.receipt,
          handle: capture.handle,
          hash: capture.hash,
        }),
      ),
    );
    const sessions = new Set(
      verifiedCaptures.map((capture) => capture.sessionId),
    );
    if (
      sessions.size > 1 ||
      (verifiedCaptures.length > 0 &&
        verifiedCaptures[0]!.sessionId !== contract.artifactSessionId)
    ) {
      throw new Error(
        "Every visual capture must come from the selected contract's live artifact session.",
      );
    }
    artifactSessionId =
      verifiedCaptures[0]?.sessionId ??
      (input.cleanup.state === "selected-retained"
        ? contract.artifactSessionId
        : undefined);
  }
  const reviewedAt = input.reviewed_at ?? new Date().toISOString();
  const receipt = await persistVisualReviewReceipt(rootPath, {
    taskId,
    contractHandle: input.contract_handle,
    contractHash: input.contract_hash,
    ...(artifactSessionId ? { artifactSessionId } : {}),
    ...(preliminaryReviewHandle ? { preliminaryReviewHandle } : {}),
    stateMatrix: {
      surface: input.state_matrix.surface,
      cases: input.state_matrix.cases,
    },
    captures: input.captures.map((capture) => ({
      caseId: capture.case_id,
      handle: capture.handle,
      hash: capture.hash,
      receipt: capture.receipt,
    })),
    figmaComparisons: input.figma_comparisons.map((comparison) => ({
      caseId: comparison.case_id,
      status: comparison.status,
      ...(comparison.node_id ? { nodeId: comparison.node_id } : {}),
    })),
    result: input.result,
    deviationCount: input.deviation_count,
    cleanup: {
      state: input.cleanup.state,
      ...(input.cleanup.receipt ? { receipt: input.cleanup.receipt } : {}),
    },
    reviewedAt,
  });
  const ready =
    receipt.result === "pass" &&
    receipt.coverage.complete &&
    receipt.cleanup.state === "clean";
  const saved = await writeTaskCheckpoint(rootPath, {
    taskId,
    expectedUpdatedAt: capsule.updatedAt,
    milestone:
      capsule.lifecycle.phase === "validated"
        ? "change-validated"
        : "batch-completed",
    objective: objective.text,
    objectiveApproved: objective.approved,
    objectiveReference: objective.reference,
    decisions: sourceLedger.decisions,
    sourceRelations: sourceLedger.relations,
    sourceReceiptIds: sourceLedger.receiptIds,
    handles: [
      ...new Set([
        ...capsule.handles.filter(
          (handle) => !handle.startsWith("visual-review:"),
        ),
        receipt.handle,
      ]),
    ].slice(0, 8),
    covered: [...capsule.scope.covered, "visual review"].slice(-8),
    remaining: ready ? capsule.scope.remaining : ["visual review"],
    budgetChars: capsule.budget.contextChars,
    estimatedTokens: capsule.budget.estimatedTokens,
    visualReview: {
      schemaVersion: 3,
      receiptHandle: receipt.handle,
      receiptHash: receipt.hash,
    },
    nextSafeAction:
      receipt.cleanup.state === "cleanup-pending"
        ? "Retry cleanup; attach the final review."
        : receipt.cleanup.state === "selected-retained"
          ? "Clean; attach final review."
          : receipt.result === "pass" && receipt.coverage.complete
            ? "Revalidate, then complete."
            : "Resolve visual review before completion.",
  });
  return { saved, receipt, ready };
}

export async function loadPassingVisualReview(
  rootPath: string,
  taskId: string,
  capsule: TaskResumeCapsule,
): Promise<VisualReviewReceipt | undefined> {
  const lockedVisualHandles =
    capsule.changeSurface?.evidence.handles.filter((handle) =>
      handle.startsWith("visual:"),
    ) ?? [];
  if (lockedVisualHandles.length === 0) return undefined;
  const receipt = await loadAttachedVisualReview(rootPath, taskId, capsule);
  if (
    !receipt ||
    receipt.schemaVersion !== 2 ||
    !lockedVisualHandles.includes(receipt.contractHandle) ||
    receipt.result !== "pass" ||
    !receipt.coverage.complete ||
    !receipt.coverage.browser.complete ||
    !receipt.coverage.figma.complete ||
    receipt.cleanup.state !== "clean" ||
    receipt.captures.length < 1
  ) {
    throw new Error(
      "Visual-authority tasks require a passing immutable review receipt with complete matrix coverage, real captures and completed cleanup before delivery.",
    );
  }
  const contract = await loadVisualEvidenceContract(rootPath, receipt.contractHandle);
  if (
    contract.taskId !== taskId ||
    contract.hash !== receipt.contractHash ||
    Date.parse(contract.expiresAt) <= Date.now()
  ) {
    throw new Error(
      "The reviewed visual contract is stale or differs from the locked task evidence.",
    );
  }
  await assertFinalReviewChain(
    rootPath,
    taskId,
    receipt,
    contract.artifactSessionId,
  );
  return receipt;
}

export async function loadClosedVisualReview(
  rootPath: string,
  taskId: string,
  capsule: TaskResumeCapsule,
): Promise<VisualReviewReceipt | undefined> {
  const lockedVisualHandles =
    capsule.changeSurface?.evidence.handles.filter((handle) =>
      handle.startsWith("visual:"),
    ) ?? [];
  if (lockedVisualHandles.length === 0) {
    return loadAttachedVisualReview(rootPath, taskId, capsule);
  }
  const receipt = await loadAttachedVisualReview(rootPath, taskId, capsule);
  if (
    !receipt ||
    receipt.cleanup.state !== "clean" ||
    !lockedVisualHandles.includes(receipt.contractHandle)
  ) {
    throw new Error(
      "A visual-authority task may close as partial or failure only after its task-bound artifact session is clean.",
    );
  }
  const contract = await loadVisualEvidenceContract(
    rootPath,
    receipt.contractHandle,
  );
  if (contract.taskId !== taskId || contract.hash !== receipt.contractHash) {
    throw new Error(
      "The closed visual review differs from the locked task evidence.",
    );
  }
  await assertFinalReviewChain(
    rootPath,
    taskId,
    receipt,
    contract.artifactSessionId,
  );
  return receipt;
}

export async function loadAttachedVisualReview(
  rootPath: string,
  taskId: string,
  capsule: TaskResumeCapsule,
): Promise<VisualReviewReceipt | undefined> {
  const summary = capsule.visualReview;
  if (
    !summary ||
    (summary.schemaVersion !== 2 && summary.schemaVersion !== 3)
  ) {
    return undefined;
  }
  const receipt = await loadVisualReviewReceipt(
    rootPath,
    summary.receiptHandle,
    taskId,
  );
  if (
    !capsule.changeSurface?.evidence.handles.includes(receipt.contractHandle)
  ) {
    throw new Error(
      "The attached visual review contract is outside the active ChangeSurface.",
    );
  }
  if (summary.schemaVersion === 3) {
    if (receipt.hash !== summary.receiptHash) {
      throw new Error(
        "The visual review capsule pointer differs from its immutable receipt.",
      );
    }
    return receipt;
  }
  const mismatches = [
    ...(receipt.hash !== summary.receiptHash ? ["receipt-hash"] : []),
    ...(receipt.contractHandle !== summary.contractHandle
      ? ["contract-handle"]
      : []),
    ...(receipt.contractHash !== summary.contractHash ? ["contract-hash"] : []),
    ...(receipt.result !== summary.result ? ["result"] : []),
    ...(receipt.captures.length !== summary.captureCount ? ["capture-count"] : []),
    ...(receipt.deviationCount !== summary.deviationCount
      ? ["deviation-count"]
      : []),
    ...(receipt.cleanup.state !== summary.cleanup.state ? ["cleanup-state"] : []),
    ...(summary.cleanup.receipt !== undefined &&
    receipt.cleanup.receipt !== summary.cleanup.receipt
      ? ["cleanup-receipt"]
      : []),
  ];
  if (mismatches.length > 0) {
    throw new Error(
      `The visual review capsule summary differs from its immutable receipt: ${mismatches.join(
        ", ",
      )}.`,
    );
  }
  return receipt;
}
