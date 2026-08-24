import {
  computeTaskObjectiveHash,
  loadLatestFigmaSnapshot,
  loadLatestTaskContinuationBundle,
  loadLatestTaskEvidenceContract,
  loadTaskFeedbackQueue,
  loadVisualEvidenceContract,
  persistTaskContinuationBundleWithCheckpoint,
  persistTaskEvidenceContractWithCheckpoint,
  resolveTaskObjective,
  taskAcceptanceState,
  writeTaskCheckpoint,
  type TaskResumeCapsule,
} from "@component-atlas/runtime";
import { z } from "zod";
import {
  assertSelectableHandles,
  assertTaskBoundHandle,
} from "./core-handle-ownership.js";
import {
  authoritativeTaskSources,
  type AuthoritativeTaskSources,
} from "./core-source-evidence.js";
import { sourceLedgerFingerprint } from "./core-tool-helpers.js";

const contractHandle = z
  .string()
  .regex(/^contract:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{16}$/u);
const continuationHandle = z
  .string()
  .regex(/^continuation:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{16}$/u);
const boundedReference = z.string().min(1).max(320);

const evidenceContractInput = z.object({
  previous_handle: contractHandle.optional(),
  criteria: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        statement: z.string().min(1).max(1_000),
        required: z.boolean(),
        source_refs: z.array(boundedReference).max(16).optional(),
      }),
    )
    .min(1)
    .max(64),
  decisions: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        question: z.string().min(1).max(1_000),
        status: z.enum(["open", "resolved", "deferred"]),
        answer: z.string().min(1).max(2_000).optional(),
        source_refs: z.array(boundedReference).max(16).optional(),
      }),
    )
    .max(64)
    .optional(),
  constraints: z.array(z.string().min(1).max(1_000)).max(64).optional(),
  exclusions: z.array(z.string().min(1).max(1_000)).max(64).optional(),
  context_handles: z.array(boundedReference).max(32).optional(),
  created_at: z.string().datetime().optional(),
});

const continuationInput = z.object({
  contract_handle: contractHandle,
  previous_handle: continuationHandle.optional(),
  criteria: z
    .array(
      z.object({
        criterion_id: z.string().min(1).max(120),
        status: z.enum(["pending", "satisfied", "blocked", "deferred"]),
        evidence_refs: z.array(boundedReference).max(24).optional(),
        validation_refs: z.array(boundedReference).max(16).optional(),
        note: z.string().min(1).max(1_000).optional(),
      }),
    )
    .min(1)
    .max(64),
  covered: z.array(z.string().min(1).max(1_000)).max(64).optional(),
  remaining: z.array(z.string().min(1).max(1_000)).max(64).optional(),
  next_action: z.string().min(1).max(2_000),
  validation_refs: z.array(boundedReference).max(32).optional(),
  visual_handles: z.array(boundedReference).max(24).optional(),
  change_surface_lock_id: z.string().regex(/^[a-f0-9]{24}$/u).optional(),
  created_at: z.string().datetime().optional(),
});

export const coreTaskEvidenceInputSchema = {
  evidence_contract: z.record(z.string(), z.unknown()).optional(),
  continuation: z.record(z.string(), z.unknown()).optional(),
};

type ContinuationInput = z.infer<typeof continuationInput>;

export type CoreTaskEvidenceAction =
  | "record-contract"
  | "checkpoint-continuation";

interface HandleTaskEvidenceInput {
  rootPath: string;
  taskId: string;
  action: string;
  capsule: TaskResumeCapsule;
  evidenceContract?: Record<string, unknown>;
  continuation?: Record<string, unknown>;
}

export interface CoreTaskEvidenceReadiness {
  contractHandle: string;
  continuationHandle: string;
  required: number;
  satisfied: number;
}

async function authoritativeObjective(rootPath: string, taskId: string) {
  const objective = await resolveTaskObjective(rootPath, taskId);
  if (
    objective?.authority !== "authoritative" ||
    !objective.reference
  ) {
    throw new Error(
      "Task objective is not authoritative; re-prepare it before recording durable evidence.",
    );
  }
  return objective;
}

function criterionProgress(input: ContinuationInput) {
  return input.criteria.map((criterion) => ({
    criterionId: criterion.criterion_id,
    status: criterion.status,
    evidenceRefs: criterion.evidence_refs ?? [],
    validationRefs: criterion.validation_refs ?? [],
    ...(criterion.note ? { note: criterion.note } : {}),
  }));
}

function exactValidationReference(capsule: TaskResumeCapsule): string | undefined {
  return capsule.validation
    ? `validation:${capsule.validation.lockId}:${capsule.validation.deltaHash}`
    : undefined;
}

function normalizedFigmaNodeId(value: string): string {
  return value.trim().replace(/^(\d+)-(\d+)$/u, "$1:$2");
}

function assertExactValidationReferences(
  capsule: TaskResumeCapsule,
  references: string[],
): void {
  if (references.length === 0) return;
  const expected = exactValidationReference(capsule);
  if (!expected || references.some((reference) => reference !== expected)) {
    throw new Error(
      "Validation references must match the task's current Atlas validation exactly.",
    );
  }
}

async function assertExactFigmaSnapshotReady(
  rootPath: string,
  taskId: string,
  capsule: TaskResumeCapsule,
  continuation?: Awaited<ReturnType<typeof loadLatestTaskContinuationBundle>>,
): Promise<void> {
  const lockedVisualHandles =
    capsule.changeSurface?.evidence.handles.filter((handle) =>
      handle.startsWith("visual:"),
    ) ?? [];
  const exactContracts: Array<
    Awaited<ReturnType<typeof loadVisualEvidenceContract>>
  > = [];
  for (const handle of lockedVisualHandles) {
    const contract = await loadVisualEvidenceContract(rootPath, handle);
    if (contract.taskId !== taskId) {
      throw new Error(`Visual contract ${handle} belongs to a different task.`);
    }
    if (contract.authority === "exact-figma") exactContracts.push(contract);
  }
  if (exactContracts.length === 0) return;

  const snapshot = await loadLatestFigmaSnapshot(rootPath, taskId);
  if (
    !snapshot ||
    !capsule.handles.includes(snapshot.handle) ||
    !capsule.changeSurface?.evidence.handles.includes(snapshot.handle) ||
    (continuation && !continuation.visualHandles.includes(snapshot.handle))
  ) {
    throw new Error(
      "Exact Figma authority requires the latest semantic snapshot in the task, active ChangeSurface and continuation before success.",
    );
  }
  const partialCategories = Object.entries(snapshot.coverage)
    .filter(([, coverage]) => coverage.status === "partial")
    .map(([category]) => category);
  const exactNodeId = snapshot.identity.nodeId
    ? normalizedFigmaNodeId(snapshot.identity.nodeId)
    : undefined;
  if (
    !exactNodeId ||
    snapshot.coverage.nodes.status !== "complete" ||
    partialCategories.length > 0 ||
    !snapshot.content.nodes.some(
      (node) =>
        normalizedFigmaNodeId(node.nodeId ?? node.id) === exactNodeId,
    )
  ) {
    throw new Error(
      `Exact Figma authority requires complete node coverage, the scoped node and no partial snapshot categories; partial=${partialCategories.join(",") || "none"}.`,
    );
  }
  for (const contract of exactContracts) {
    if (
      !contract.figma?.nodeId ||
      snapshot.identity.fileKey !== contract.figma.fileKey ||
      exactNodeId !== normalizedFigmaNodeId(contract.figma.nodeId) ||
      !snapshot.receiptIds.some((receiptId) =>
        contract.sourceReceiptIds.includes(receiptId),
      )
    ) {
      throw new Error(
        "The latest Figma snapshot does not match the locked exact visual authority.",
      );
    }
  }
}

export async function assertCoreTaskEvidenceReadyForSuccess(
  rootPath: string,
  taskId: string,
  capsule: TaskResumeCapsule,
  knownSourceLedger?: AuthoritativeTaskSources,
): Promise<CoreTaskEvidenceReadiness | undefined> {
  const pendingFeedback = (await loadTaskFeedbackQueue(rootPath, taskId))
    .filter((event) => event.required && event.status === "pending")
    .map((event) => event.feedbackId);
  if (pendingFeedback.length > 0) {
    throw new Error(
      `Successful completion requires all required feedback to be resolved; pending-feedback=${pendingFeedback.join(",")}.`,
    );
  }
  const contract = await loadLatestTaskEvidenceContract(rootPath, taskId);
  if (!contract) {
    if (
      capsule.governance?.size === "medium" ||
      capsule.governance?.size === "large"
    ) {
      throw new Error(
        "Successful completion of a medium or large task requires a durable evidence contract.",
      );
    }
    await assertExactFigmaSnapshotReady(rootPath, taskId, capsule);
    return undefined;
  }
  const continuation = await loadLatestTaskContinuationBundle(rootPath, taskId);
  if (!continuation || continuation.contract.handle !== contract.handle) {
    throw new Error(
      "Successful completion requires a continuation for the latest evidence contract.",
    );
  }
  const objective = await authoritativeObjective(rootPath, taskId);
  const sourceLedger =
    knownSourceLedger ??
    (await authoritativeTaskSources(rootPath, taskId, capsule));
  if (
    contract.objectiveHash !== computeTaskObjectiveHash(objective.text) ||
    contract.sourceLedgerHash !==
      sourceLedgerFingerprint(
        sourceLedger.decisions,
        sourceLedger.relations,
        sourceLedger.receiptIds,
      )
  ) {
    throw new Error(
      "The latest evidence contract is stale for the current objective or source ledger.",
    );
  }
  const acceptance = taskAcceptanceState(contract, continuation);
  const openDecisions = contract.decisions
    .filter((decision) => decision.status === "open")
    .map((decision) => decision.id);
  if (!acceptance.ready || openDecisions.length > 0) {
    throw new Error(
      `Task acceptance is incomplete; pending=${acceptance.pending.join(",") || "none"}; blocked=${acceptance.blocked.join(",") || "none"}; deferred=${acceptance.deferred.join(",") || "none"}; open-decisions=${openDecisions.join(",") || "none"}.`,
    );
  }
  if (
    !capsule.handles.includes(contract.handle) ||
    !capsule.handles.includes(continuation.handle)
  ) {
    throw new Error(
      "The task capsule does not activate the latest evidence contract and continuation.",
    );
  }
  if (!capsule.changeSurface?.evidence.handles.includes(contract.handle)) {
    throw new Error(
      "The latest evidence contract is not frozen in the active ChangeSurface; relock before completion.",
    );
  }
  if (continuation.changeSurfaceLockId !== capsule.changeSurface.lockId) {
    throw new Error(
      "The latest continuation is not checkpointed against the active ChangeSurface lock.",
    );
  }
  await assertExactFigmaSnapshotReady(
    rootPath,
    taskId,
    capsule,
    continuation,
  );
  const evidenceHandles = [
    ...new Set(
      continuation.criteria.flatMap((criterion) => criterion.evidenceRefs),
    ),
  ];
  if (evidenceHandles.length > 0) {
    await assertSelectableHandles(
      rootPath,
      taskId,
      evidenceHandles,
      sourceLedger.receiptIds,
    );
  }
  const validationReferences = [
    ...new Set([
      ...continuation.validationRefs,
      ...continuation.criteria.flatMap(
        (criterion) => criterion.validationRefs,
      ),
    ]),
  ];
  assertExactValidationReferences(capsule, validationReferences);
  const expectedValidation = exactValidationReference(capsule);
  if (!expectedValidation || !continuation.validationRefs.includes(expectedValidation)) {
    throw new Error(
      "Successful completion requires the latest Atlas validation in the continuation.",
    );
  }
  for (const handle of continuation.visualHandles) {
    await assertTaskBoundHandle(
      rootPath,
      taskId,
      handle,
      sourceLedger.receiptIds,
    );
  }
  return {
    contractHandle: contract.handle,
    continuationHandle: continuation.handle,
    required: acceptance.required,
    satisfied: acceptance.satisfied,
  };
}

export async function handleCoreTaskEvidenceAction(
  input: HandleTaskEvidenceInput,
): Promise<Record<string, unknown> | undefined> {
  if (
    input.action !== "record-contract" &&
    input.action !== "checkpoint-continuation"
  ) {
    return undefined;
  }
  if (input.capsule.status === "completed") {
    throw new Error("Completed tasks cannot change their evidence contract.");
  }
  const objective = await authoritativeObjective(input.rootPath, input.taskId);
  const sourceLedger = await authoritativeTaskSources(
    input.rootPath,
    input.taskId,
    input.capsule,
  );

  if (input.action === "record-contract") {
    if (!input.evidenceContract) {
      throw new Error("record-contract requires evidence_contract.");
    }
    const evidenceContract = evidenceContractInput.parse(input.evidenceContract);
    const contextHandles = evidenceContract.context_handles ?? [];
    const sourceHandles = [
      ...evidenceContract.criteria.flatMap(
        (criterion) => criterion.source_refs ?? [],
      ),
      ...(evidenceContract.decisions ?? []).flatMap(
        (decision) => decision.source_refs ?? [],
      ),
    ];
    const selectedHandles = [...new Set([...contextHandles, ...sourceHandles])];
    if (selectedHandles.length > 0) {
      await assertSelectableHandles(
        input.rootPath,
        input.taskId,
        selectedHandles,
        sourceLedger.receiptIds,
      );
    }
    const persisted = await persistTaskEvidenceContractWithCheckpoint(input.rootPath, {
      taskId: input.taskId,
      objective: objective.text,
      objectiveHash: computeTaskObjectiveHash(objective.text),
      sourceLedgerHash: sourceLedgerFingerprint(
        sourceLedger.decisions,
        sourceLedger.relations,
        sourceLedger.receiptIds,
      ),
      criteria: evidenceContract.criteria.map((criterion) => ({
        id: criterion.id,
        statement: criterion.statement,
        required: criterion.required,
        sourceRefs: criterion.source_refs ?? [],
      })),
      decisions: (evidenceContract.decisions ?? []).map((decision) => ({
        id: decision.id,
        question: decision.question,
        status: decision.status,
        ...(decision.answer ? { answer: decision.answer } : {}),
        sourceRefs: decision.source_refs ?? [],
      })),
      constraints: evidenceContract.constraints ?? [],
      exclusions: evidenceContract.exclusions ?? [],
      sourceReceiptIds: sourceLedger.receiptIds,
      contextHandles,
      ...(evidenceContract.previous_handle
        ? { previousHandle: evidenceContract.previous_handle }
        : {}),
      ...(evidenceContract.created_at
        ? { createdAt: evidenceContract.created_at }
        : {}),
    }, async (contract, metadata) => {
      const changedRevision = metadata.publish;
      return writeTaskCheckpoint(input.rootPath, {
        taskId: input.taskId,
        expectedUpdatedAt: input.capsule.updatedAt,
        status: input.capsule.status,
        milestone: "decision-confirmed",
        objective: objective.text,
        objectiveApproved: objective.approved,
        ...(objective.reference
          ? { objectiveReference: objective.reference }
          : {}),
        decisions: sourceLedger.decisions,
        sourceRelations: sourceLedger.relations,
        sourceReceiptIds: sourceLedger.receiptIds,
        handles: [
          contract.handle,
          ...input.capsule.handles.filter(
            (handle) =>
              !handle.startsWith("contract:") &&
              (!changedRevision || !handle.startsWith("continuation:")),
          ),
        ].slice(0, 8),
        covered: [
          ...input.capsule.scope.covered.filter(
            (item) => item !== "task evidence contract recorded",
          ),
          "task evidence contract recorded",
        ].slice(-8),
        remaining: input.capsule.scope.remaining,
        budgetChars: input.capsule.budget.contextChars,
        estimatedTokens: input.capsule.budget.estimatedTokens,
        nextSafeAction: changedRevision
          ? "Checkpoint criterion progress against the latest evidence contract."
          : input.capsule.nextSafeAction,
      });
    });
    const contract = persisted.artifact;
    const saved = persisted.checkpoint;
    return {
      taskId: input.taskId,
      status: "contract-recorded",
      contract: {
        handle: contract.handle,
        hash: contract.hash,
        revision: contract.revision,
      },
      handles: saved.handles,
      nextSafeAction: saved.nextSafeAction,
    };
  }

  if (!input.continuation) {
    throw new Error("checkpoint-continuation requires continuation.");
  }
  const continuationInputValue = continuationInput.parse(input.continuation);
  const contract = await loadLatestTaskEvidenceContract(
    input.rootPath,
    input.taskId,
  );
  if (!contract || contract.handle !== continuationInputValue.contract_handle) {
    throw new Error(
      "Continuation must reference the latest task evidence contract.",
    );
  }
  const evidenceHandles = [
    ...new Set(
      continuationInputValue.criteria.flatMap(
        (criterion) => criterion.evidence_refs ?? [],
      ),
    ),
  ];
  if (evidenceHandles.length > 0) {
    await assertSelectableHandles(
      input.rootPath,
      input.taskId,
      evidenceHandles,
      sourceLedger.receiptIds,
    );
  }
  const validationReferences = [
    ...new Set([
      ...(continuationInputValue.validation_refs ?? []),
      ...continuationInputValue.criteria.flatMap(
        (criterion) => criterion.validation_refs ?? [],
      ),
    ]),
  ];
  assertExactValidationReferences(input.capsule, validationReferences);
  for (const handle of [
    ...new Set(continuationInputValue.visual_handles ?? []),
  ]) {
    await assertTaskBoundHandle(
      input.rootPath,
      input.taskId,
      handle,
      sourceLedger.receiptIds,
    );
  }
  if (
    continuationInputValue.change_surface_lock_id &&
    continuationInputValue.change_surface_lock_id !==
      input.capsule.changeSurface?.lockId
  ) {
    throw new Error(
      "Continuation ChangeSurface lock must match the task's active lock.",
    );
  }
  const persisted = await persistTaskContinuationBundleWithCheckpoint(input.rootPath, {
    taskId: input.taskId,
    contractHandle: contract.handle,
    criteria: criterionProgress(continuationInputValue),
    covered: continuationInputValue.covered ?? input.capsule.scope.covered,
    remaining: continuationInputValue.remaining ?? input.capsule.scope.remaining,
    nextSafeAction: continuationInputValue.next_action,
    validationRefs: continuationInputValue.validation_refs ?? [],
    visualHandles: continuationInputValue.visual_handles ?? [],
    ...(continuationInputValue.change_surface_lock_id
      ? { changeSurfaceLockId: continuationInputValue.change_surface_lock_id }
      : {}),
    ...(continuationInputValue.previous_handle
      ? { previousHandle: continuationInputValue.previous_handle }
      : {}),
    ...(continuationInputValue.created_at
      ? { createdAt: continuationInputValue.created_at }
      : {}),
  }, async (continuation) =>
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
      decisions: sourceLedger.decisions,
      sourceRelations: sourceLedger.relations,
      sourceReceiptIds: sourceLedger.receiptIds,
      handles: [
        continuation.handle,
        contract.handle,
        ...continuation.visualHandles,
        ...input.capsule.handles.filter(
          (handle) =>
            !handle.startsWith("contract:") &&
            !handle.startsWith("continuation:") &&
            !continuation.visualHandles.includes(handle),
        ),
      ].slice(0, 8),
      covered: continuation.covered,
      remaining: continuation.remaining,
      budgetChars: input.capsule.budget.contextChars,
      estimatedTokens: input.capsule.budget.estimatedTokens,
      nextSafeAction: continuation.nextSafeAction,
    }),
  );
  const continuation = persisted.artifact;
  const saved = persisted.checkpoint;
  const acceptance = taskAcceptanceState(contract, continuation);
  return {
    taskId: input.taskId,
    status: "continuation-checkpointed",
    continuation: {
      handle: continuation.handle,
      hash: continuation.hash,
      revision: continuation.revision,
      contract: continuation.contract,
    },
    acceptance,
    handles: saved.handles,
    nextSafeAction: saved.nextSafeAction,
  };
}
