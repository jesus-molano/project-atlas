import { assertSourceReceiptMatchesDecision } from "@component-atlas/core";
import {
  assessLatestFigmaSnapshotReuse,
  loadPersistedSourceReceipt,
  persistFigmaSnapshotWithCheckpoint,
  writeTaskCheckpoint,
  type FigmaSnapshotIdentity,
  type TaskResumeCapsule,
} from "@component-atlas/runtime";
import { z } from "zod";
import { authoritativeTaskSources } from "./core-source-evidence.js";
import { loadAuthorizedTaskFigmaAsset } from "./core-handle-ownership.js";

const boundedText = z.string().min(1).max(240);
const coverageEntry = z.object({
  status: z.enum(["complete", "partial", "not-requested"]),
  omitted: z.number().int().min(0).max(1_000_000),
});
const semanticItem = z.object({
  id: boundedText,
  name: boundedText,
  type: z.string().min(1).max(80),
  node_id: boundedText.optional(),
  token_refs: z.array(boundedText).max(24).optional(),
  properties: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        value: boundedText.optional(),
      }),
    )
    .max(24)
    .optional(),
  variants: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        value: boundedText,
      }),
    )
    .max(24)
    .optional(),
  asset_refs: z.array(z.string().min(1).max(280)).max(16).optional(),
});
const categories = ["nodes", "components", "styles", "states", "assets"] as const;
const figmaSnapshotInput = z.object({
  previous_handle: z
    .string()
    .regex(/^figma-snapshot:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{16}$/u)
    .optional(),
  identity: z.object({
    file_key: z.string().regex(/^[A-Za-z0-9_-]{1,240}$/u),
    node_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,240}$/u).optional(),
    version: z.string().min(1).max(160),
    last_modified: z.string().datetime(),
  }),
  observed_at: z.string().datetime(),
  receipt_ids: z
    .array(z.string().regex(/^receipt-(?:[a-f0-9]{16}|[a-f0-9]{64})$/u))
    .min(1)
    .max(64),
  coverage: z.object(Object.fromEntries(categories.map((key) => [key, coverageEntry])) as {
    [K in (typeof categories)[number]]: typeof coverageEntry;
  }),
  content: z.object(Object.fromEntries(categories.map((key) => [key, z.array(semanticItem).max(128)])) as {
    [K in (typeof categories)[number]]: z.ZodArray<typeof semanticItem>;
  }),
  created_at: z.string().datetime().optional(),
});
const figmaSnapshotReuseInput = z.object({
  file_key: z.string().regex(/^[A-Za-z0-9_-]{1,240}$/u),
  node_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,240}$/u).optional(),
  required_categories: z.array(z.enum(categories)).min(1).max(categories.length),
});

export const coreFigmaSnapshotInputSchema = {
  figma_snapshot: z.record(z.string(), z.unknown()).optional(),
};

interface RecordCoreFigmaSnapshotInput {
  rootPath: string;
  taskId: string;
  capsule: TaskResumeCapsule;
  snapshot?: Record<string, unknown>;
}

interface CheckCoreFigmaSnapshotInput extends RecordCoreFigmaSnapshotInput {
  sourceReceiptId?: string;
}

function authorizedScopeIds(receipt: Awaited<ReturnType<typeof loadPersistedSourceReceipt>>) {
  return new Set(
    [
      receipt.requested.nodeId,
      receipt.resolved.nodeId,
      receipt.scope.id,
      receipt.scope.parentId,
      receipt.scopeRelation?.sourceId,
      receipt.scopeRelation?.targetId,
      ...(receipt.scopeRelation?.ancestorIds ?? []),
    ]
      .filter((value): value is string => Boolean(value))
      .map(normalizedFigmaNodeId),
  );
}

function normalizedFigmaNodeId(value: string): string {
  return value.trim().replace(/^(\d+)-(\d+)$/u, "$1:$2");
}

function exactFigmaScopeNodeId(
  receipt: Awaited<ReturnType<typeof loadPersistedSourceReceipt>>,
): string | undefined {
  if (["node", "selection"].includes(receipt.scope.kind)) {
    return normalizedFigmaNodeId(receipt.scope.id);
  }
  const nodeId = receipt.resolved.nodeId ?? receipt.requested.nodeId;
  return nodeId ? normalizedFigmaNodeId(nodeId) : undefined;
}

function normalizedDate(value: string): string {
  return new Date(value).toISOString();
}

async function currentFigmaReceiptIdentity(
  rootPath: string,
  sourceLedger: Awaited<ReturnType<typeof authoritativeTaskSources>>,
  receiptId: string,
): Promise<{
  identity: FigmaSnapshotIdentity;
  observedAt: string;
}> {
  if (!sourceLedger.receiptIds.includes(receiptId)) {
    throw new Error(`Figma receipt ${receiptId} is outside this task ledger.`);
  }
  const receipt = await loadPersistedSourceReceipt(rootPath, receiptId);
  const decision = sourceLedger.decisions.find(
    (candidate) => candidate.id === receipt.sourceDecisionId,
  );
  if (!decision) {
    throw new Error(`Figma receipt ${receiptId} has no task source decision.`);
  }
  assertSourceReceiptMatchesDecision(decision, receipt);
  const nodeId = exactFigmaScopeNodeId(receipt);
  if (
    receipt.provider !== "figma" ||
    !["figma-desktop-mcp-local", "figma-remote-connector"].includes(
      receipt.adapter,
    ) ||
    receipt.coverage !== "exact" ||
    receipt.freshness !== "current" ||
    !receipt.requested.fileKey ||
    receipt.requested.fileKey !== receipt.resolved.fileKey ||
    !receipt.resolved.version ||
    !receipt.resolved.lastModified ||
    (nodeId !== undefined && !authorizedScopeIds(receipt).has(nodeId))
  ) {
    throw new Error(
      `Figma receipt ${receiptId} does not prove an exact current snapshot identity.`,
    );
  }
  return {
    identity: {
      fileKey: receipt.resolved.fileKey,
      ...(nodeId ? { nodeId } : {}),
      version: receipt.resolved.version,
      lastModified: normalizedDate(receipt.resolved.lastModified),
    },
    observedAt: receipt.observedAt,
  };
}

export async function checkCoreFigmaSnapshotReuse(
  input: CheckCoreFigmaSnapshotInput,
) {
  if (!input.snapshot) {
    throw new Error("check-figma-snapshot requires figma_snapshot.");
  }
  if (input.capsule.status === "completed") {
    throw new Error("Completed tasks cannot reuse task-local Figma snapshots.");
  }
  const request = figmaSnapshotReuseInput.parse(input.snapshot);
  let currentIdentity: FigmaSnapshotIdentity | undefined;
  if (input.sourceReceiptId) {
    const sourceLedger = await authoritativeTaskSources(
      input.rootPath,
      input.taskId,
      input.capsule,
    );
    const current = await currentFigmaReceiptIdentity(
      input.rootPath,
      sourceLedger,
      input.sourceReceiptId,
    );
    currentIdentity = current.identity;
    if (
      currentIdentity.fileKey !== request.file_key ||
      normalizedFigmaNodeId(currentIdentity.nodeId ?? "") !==
        normalizedFigmaNodeId(request.node_id ?? "")
    ) {
      throw new Error(
        `Figma receipt ${input.sourceReceiptId} does not prove the requested cache scope.`,
      );
    }
  }
  return assessLatestFigmaSnapshotReuse(input.rootPath, {
    taskId: input.taskId,
    scope: {
      fileKey: request.file_key,
      ...(request.node_id
        ? { nodeId: normalizedFigmaNodeId(request.node_id) }
        : {}),
    },
    ...(currentIdentity ? { currentIdentity } : {}),
    requiredCategories: request.required_categories,
  });
}

export async function recordCoreFigmaSnapshot(
  input: RecordCoreFigmaSnapshotInput,
): Promise<Record<string, unknown>> {
  if (!input.snapshot) {
    throw new Error("record-figma-snapshot requires figma_snapshot.");
  }
  if (input.capsule.status === "completed") {
    throw new Error("Completed tasks cannot record Figma snapshots.");
  }
  if (
    input.capsule.changeSurface &&
    !input.capsule.changeInvalidation?.relockRequired
  ) {
    throw new Error(
      "A scoped task can record a new Figma snapshot only inside an explicit relock-required window.",
    );
  }
  const snapshotInput = figmaSnapshotInput.parse(input.snapshot);
  const sourceLedger = await authoritativeTaskSources(
    input.rootPath,
    input.taskId,
    input.capsule,
  );
  for (const receiptId of [...new Set(snapshotInput.receipt_ids)]) {
    const current = await currentFigmaReceiptIdentity(
      input.rootPath,
      sourceLedger,
      receiptId,
    );
    if (
      current.identity.fileKey !== snapshotInput.identity.file_key ||
      current.identity.version !== snapshotInput.identity.version ||
      current.identity.lastModified !==
        normalizedDate(snapshotInput.identity.last_modified) ||
      (snapshotInput.identity.node_id === undefined) !==
        (current.identity.nodeId === undefined) ||
      (snapshotInput.identity.node_id !== undefined &&
        normalizedFigmaNodeId(snapshotInput.identity.node_id) !==
          current.identity.nodeId)
    ) {
      throw new Error(
        `Figma receipt ${receiptId} does not prove this exact current snapshot identity.`,
      );
    }
    if (Date.parse(snapshotInput.observed_at) < Date.parse(current.observedAt)) {
      throw new Error("Figma snapshot observation predates its source receipt.");
    }
  }

  const assetRefs = [
    ...new Set(
      categories.flatMap((category) =>
        snapshotInput.content[category].flatMap((item) => item.asset_refs ?? []),
      ),
    ),
  ];
  for (const handle of assetRefs) {
    await loadAuthorizedTaskFigmaAsset(
      input.rootPath,
      input.taskId,
      handle,
      sourceLedger.receiptIds,
    );
  }

  const persisted = await persistFigmaSnapshotWithCheckpoint(
    input.rootPath,
    {
      taskId: input.taskId,
      identity: {
        fileKey: snapshotInput.identity.file_key,
        ...(snapshotInput.identity.node_id
          ? { nodeId: normalizedFigmaNodeId(snapshotInput.identity.node_id) }
          : {}),
        version: snapshotInput.identity.version,
        lastModified: snapshotInput.identity.last_modified,
      },
      observedAt: snapshotInput.observed_at,
      receiptIds: snapshotInput.receipt_ids,
      coverage: snapshotInput.coverage,
      content: Object.fromEntries(
        categories.map((category) => [
          category,
          snapshotInput.content[category].map((item) => ({
            id: item.id,
            name: item.name,
            type: item.type,
            ...(item.node_id ? { nodeId: item.node_id } : {}),
            tokenRefs: item.token_refs ?? [],
            properties: item.properties ?? [],
            variants: item.variants ?? [],
            assetRefs: item.asset_refs ?? [],
          })),
        ]),
      ) as {
        [K in (typeof categories)[number]]: Array<{
          id: string;
          name: string;
          type: string;
          nodeId?: string;
          tokenRefs: string[];
          properties: Array<{ name: string; value?: string }>;
          variants: Array<{ name: string; value: string }>;
          assetRefs: string[];
        }>;
      },
      ...(snapshotInput.previous_handle
        ? { previousHandle: snapshotInput.previous_handle }
        : {}),
      ...(snapshotInput.created_at
        ? { createdAt: snapshotInput.created_at }
        : {}),
    },
    async (snapshot) =>
      writeTaskCheckpoint(input.rootPath, {
        taskId: input.taskId,
        expectedUpdatedAt: input.capsule.updatedAt,
        status: input.capsule.status,
        milestone: "source-resolved",
        objective: input.capsule.objective.text,
        objectiveApproved: input.capsule.objective.approved,
        ...(input.capsule.objective.reference
          ? { objectiveReference: input.capsule.objective.reference }
          : {}),
        decisions: sourceLedger.decisions,
        sourceRelations: sourceLedger.relations,
        sourceReceiptIds: sourceLedger.receiptIds,
        handles: [
          snapshot.handle,
          ...input.capsule.handles.filter(
            (handle) => !handle.startsWith("figma-snapshot:"),
          ),
        ].slice(0, 8),
        covered: [
          ...input.capsule.scope.covered.filter(
            (item) => item !== "Figma semantic snapshot recorded",
          ),
          "Figma semantic snapshot recorded",
        ].slice(-8),
        remaining: input.capsule.scope.remaining,
        budgetChars: input.capsule.budget.contextChars,
        estimatedTokens: input.capsule.budget.estimatedTokens,
        nextSafeAction: input.capsule.nextSafeAction,
      }),
  );
  return {
    taskId: input.taskId,
    status: "figma-snapshot-recorded",
    snapshot: {
      handle: persisted.snapshot.handle,
      hash: persisted.snapshot.hash,
      revision: persisted.snapshot.revision,
      identity: persisted.snapshot.identity,
      coverage: persisted.snapshot.coverage,
    },
    handles: persisted.checkpoint.handles,
    nextSafeAction: persisted.checkpoint.nextSafeAction,
  };
}
