import { createHash } from "node:crypto";
import { assertSourceReceiptMatchesDecision } from "@component-atlas/core";
import {
  applyMemoryUpdate,
  appendTaskJournalMilestone,
  assertLockedChangeSurfaceArtifact,
  beginMemoryConsentExecution,
  commitMemoryConsentExecution,
  committedMemoryConsentResult,
  consumeMemoryConsent,
  issueMemoryConsent,
  loadMemoryConsentState,
  loadPersistedSourceReceipt,
  loadTaskCompletionReceipt,
  loadTaskFinalReceipt,
  loadTaskSourceLedger,
  loadTaskResumeCapsule,
  loadTaskResumeTransport,
  persistVisualEvidenceContract,
  proposeMemoryUpdate,
  purgeTaskFigmaAssets,
  recordProjectOutcome,
  rejectMemoryUpdate,
  resolveTaskObjective,
  reviewMemoryProposal,
  writeTaskCheckpoint,
  type MemoryConsentAction,
  type MemoryConsentReceipt,
} from "@component-atlas/runtime";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  type CoreLifecycleAssetOperations,
  defaultCoreLifecycleAssetOperations,
  lockedFigmaAssetDestinationPath,
  verifiedLockedFigmaAssetSourceLedger,
} from "./core-figma-asset-lifecycle.js";
import { authoritativeTaskSources } from "./core-source-evidence.js";
import { loadAuthorizedTaskFigmaAsset } from "./core-handle-ownership.js";
import {
  completeTask,
  loadCommittedTaskCompletion,
} from "./core-task-completion.js";
import {
  attachVisualReview,
  visualReviewInputSchema,
} from "./core-visual-review.js";
import { text } from "./shared.js";

const taskId = z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/u);
const receiptId = z.string().regex(/^receipt-(?:[a-f0-9]{16}|[a-f0-9]{64})$/u);
const memoryType = z.enum([
  "project",
  "domain",
  "glossary-term",
  "subsystem",
  "module",
  "convention",
  "decision",
  "constraint",
  "integration",
  "known-issue",
  "fragile-area",
  "attempt",
  "plan",
  "debt",
  "note",
]);
const memoryRelationKind = z.enum([
  "belongs_to",
  "depends_on",
  "implements",
  "affects",
  "decided_by",
  "motivated_by",
  "contradicts",
  "supersedes",
  "verified_by",
  "failed_for",
  "fixed_by",
  "related_to",
  "references_code",
  "references_design",
  "references_ticket",
]);
const memoryItemInput = z.object({
  type: memoryType,
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(1_000),
  body: z.string().max(4_000).optional(),
  confidence: z.number().min(0).max(1).optional(),
  authority: z.enum(["observed", "inferred", "decided", "verified"]).optional(),
  tags: z.array(z.string().min(1).max(80)).max(12).optional(),
  supersedes: z.array(z.string().min(1).max(260)).max(20).optional(),
  relations: z
    .array(
      z.object({
        kind: memoryRelationKind,
        target_id: z.string().min(1).max(260),
        summary: z.string().max(300).optional(),
      }),
    )
    .max(20)
    .optional(),
});

async function requireCapsule(rootPath: string, id: string) {
  const capsule = await loadTaskResumeCapsule(rootPath, id);
  if (!capsule) throw new Error(`Task ${id} has no Project Atlas capsule.`);
  return capsule;
}

function consentHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function stableProposalConsentScope(
  review: Awaited<ReturnType<typeof reviewMemoryProposal>>,
) {
  const scope = {
    proposalId: review.proposalId,
    proposedBy: review.proposedBy,
    rationale: review.rationale,
    evidence: review.evidence,
    target: review.target,
    gate: review.gate,
    requiresCanonicalConfirmation: review.requiresCanonicalConfirmation,
    items: review.impact.items.map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      summary: item.summary,
      ...(item.body ? { body: item.body } : {}),
      confidence: item.confidence,
      authority: item.authority,
      tags: item.tags,
      relations: item.relations,
      supersedes: item.supersedes,
    })),
  };
  return { ...scope, proposalRevisionHash: consentHash(scope) };
}

function consentReceiptId(
  taskIdValue: string,
  payloadHash: string,
): string {
  return `consent:${taskIdValue}:${payloadHash.slice(0, 16)}`;
}

async function auditConsentReceipt(
  rootPath: string,
  receipt: MemoryConsentReceipt,
): Promise<void> {
  const { result: _committedResult, ...auditReceipt } = receipt;
  await appendTaskJournalMilestone(
    rootPath,
    receipt.taskId,
    "decision-confirmed",
    { kind: "memory-consent", consentReceipt: auditReceipt },
  );
}

async function needsConsent(
  rootPath: string,
  taskIdValue: string,
  action: MemoryConsentAction,
  payloadHash: string,
  token: string,
  scope: Record<string, unknown>,
) {
  const responseProbe = {
    taskId: taskIdValue,
    status: "needs-consent",
    action,
    consentToken: token,
    consentReceipt: {
      schemaVersion: 1,
      id: consentReceiptId(taskIdValue, payloadHash),
      taskId: taskIdValue,
      action,
      payloadHash,
      status: "issued",
      issuedAt: new Date().toISOString(),
    },
    scope,
    memoryWritten: false,
    nextAction:
      "Show this exact scope and token to the user. Repeat the unchanged call with consent equal to consentToken only after explicit approval.",
  };
  if (Buffer.byteLength(JSON.stringify(responseProbe), "utf8") > 3_600) {
    throw new Error(
      "Memory consent scope exceeds 3.6 KB; split it into a smaller proposal before requesting consent.",
    );
  }
  const issued = await issueMemoryConsent(rootPath, {
    taskId: taskIdValue,
    action,
    payloadHash,
  });
  if (issued.created) await auditConsentReceipt(rootPath, issued.receipt);
  return text({ ...responseProbe, consentReceipt: issued.receipt });
}

async function beginConsentExecution(
  rootPath: string,
  taskIdValue: string,
  action: MemoryConsentAction,
  payloadHash: string,
): Promise<ReturnType<typeof text> | undefined> {
  const state = await loadMemoryConsentState(
    rootPath,
    taskIdValue,
    action,
    payloadHash,
  );
  if (!state.issued) {
    throw new Error(
      "Memory consent token was not issued by Atlas for this task, action and exact payload.",
    );
  }
  if (state.committed) {
    const consumed = await consumeMemoryConsent(rootPath, {
      taskId: taskIdValue,
      action,
      payloadHash,
    });
    if (consumed.created) await auditConsentReceipt(rootPath, consumed.receipt);
    return text({
      ...committedMemoryConsentResult(state.committed),
      taskId: taskIdValue,
      status: "already-consumed",
      action,
      memoryWritten: true,
      consentReceipt: consumed.receipt,
      nextAction:
        "The committed mutation result was reconciled; no memory mutation was repeated.",
    });
  }
  const executing = await beginMemoryConsentExecution(rootPath, {
    taskId: taskIdValue,
    action,
    payloadHash,
  });
  if (executing.created) {
    await auditConsentReceipt(rootPath, executing.receipt);
  }
  return undefined;
}

async function committedConsent(
  rootPath: string,
  taskIdValue: string,
  action: MemoryConsentAction,
  payloadHash: string,
  result: Record<string, unknown>,
) {
  const committed = await commitMemoryConsentExecution(rootPath, {
    taskId: taskIdValue,
    action,
    payloadHash,
    result,
  });
  if (committed.created) {
    await auditConsentReceipt(rootPath, committed.receipt);
  }
  const consumed = await consumeMemoryConsent(rootPath, {
    taskId: taskIdValue,
    action,
    payloadHash,
  });
  if (consumed.created) {
    await auditConsentReceipt(rootPath, consumed.receipt);
  }
  return text({
    ...result,
    memoryWritten: true,
    consentReceipt: consumed.receipt,
  });
}

async function completedTaskContext(rootPath: string, id: string) {
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

async function verifyTaskReceiptLedger(
  rootPath: string,
  taskIdValue: string,
  receiptIds: string[],
): Promise<
  Array<{
    id: string;
    receipt: Awaited<ReturnType<typeof loadPersistedSourceReceipt>>;
  }>
> {
  const uniqueReceiptIds = [...new Set(receiptIds)];
  if (uniqueReceiptIds.length === 0) return [];
  const ledger = await loadTaskSourceLedger(rootPath, taskIdValue);
  if (!ledger) {
    throw new Error(`Task ${taskIdValue} has no source ledger.`);
  }
  const verified = [];
  for (const currentReceiptId of uniqueReceiptIds) {
    if (!ledger.receiptIds.includes(currentReceiptId)) {
      throw new Error(
        `Receipt ${currentReceiptId} is outside task ${taskIdValue}'s source ledger.`,
      );
    }
    const receipt = await loadPersistedSourceReceipt(rootPath, currentReceiptId);
    const decision = ledger.decisions.find(
      (candidate) => candidate.id === receipt.sourceDecisionId,
    );
    if (!decision) {
      throw new Error(
        `Receipt ${currentReceiptId} is outside task ${taskIdValue}'s source ledger.`,
      );
    }
    assertSourceReceiptMatchesDecision(decision, receipt);
    verified.push({ id: currentReceiptId, receipt });
  }
  return verified;
}

export function registerCoreLifecycleTools(
  server: McpServer,
  assetOperations: CoreLifecycleAssetOperations =
    defaultCoreLifecycleAssetOperations,
): void {
  server.registerTool(
    "atlas_task_state",
    {
      description:
        "Resume or update task state, govern Figma assets, or complete without writing Project Memory.",
      inputSchema: {
        root_path: z.string(),
        task_id: taskId,
        action: z.enum([
          "resume",
          "checkpoint",
          "block",
          "attach-evidence",
          "attach-review",
          "capture-figma-asset",
          "materialize-figma-asset",
          "complete",
        ]),
        milestone: z
          .enum(["source-resolved", "batch-completed", "change-validated"])
          .optional(),
        covered: z.array(z.string().max(240)).max(8).optional(),
        remaining: z.array(z.string().max(240)).max(8).optional(),
        next_action: z.string().min(1).max(500).optional(),
        result: z.enum(["success", "failure", "partial"]).optional(),
        summary: z.string().min(1).max(1_000).optional(),
        verification: z
          .array(z.string().min(1).max(500))
          .max(12)
          .optional(),
        files: z.array(z.string().min(1).max(260)).max(100).optional(),
        receipt_ids: z.array(receiptId).max(20).optional(),
        source_receipt_id: receiptId.optional(),
        asset_url: z.string().url().max(1_000).optional(),
        scope_node_id: z.string().min(1).max(160).optional(),
        asset_handle: z
          .string()
          .regex(/^figma-asset:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{24}$/u)
          .optional(),
        destination_path: z.string().min(1).max(500).optional(),
        visual_contract: z
          .object({
            handle: z
              .string()
              .regex(/^visual:vd-[A-Za-z0-9_-]+:[a-f0-9]{16}$/u),
            hash: z.string().regex(/^[a-f0-9]{64}$/u),
            selection_receipt: z
              .string()
              .regex(
                /^selection-receipt:v1:[a-f0-9]{16}:vd-[A-Za-z0-9_-]+:[a-f0-9]{16}:[a-z0-9]+:[a-f0-9]{16}$/u,
              ),
            authority: z.enum([
              "exact-figma",
              "existing-system",
              "selected-direction",
            ]),
            summary: z.string().min(1).max(1_000),
            selected_direction_id: z.string().max(160).optional(),
            figma: z
              .object({
                file_key: z.string().min(1).max(240),
                node_id: z.string().max(240).optional(),
              })
              .optional(),
            receipt_ids: z.array(receiptId).max(20).optional(),
            created_at: z.string().datetime().optional(),
            expires_at: z.string().datetime(),
          })
          .optional(),
        visual_review: visualReviewInputSchema.optional(),
      },
      annotations: {
        title: "Read or save task state",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      root_path,
      task_id,
      action,
      milestone,
      covered,
      remaining,
      next_action,
      result,
      summary,
      verification,
      files,
      receipt_ids,
      source_receipt_id,
      asset_url,
      scope_node_id,
      asset_handle,
      destination_path,
      visual_contract,
      visual_review,
    }) => {
      if (action === "resume") {
        const transport = await loadTaskResumeTransport(root_path, task_id);
        if (transport) return text(transport);
        const finalReceipt = await loadTaskFinalReceipt(root_path, task_id);
        if (!finalReceipt) {
          return text({ status: "not-found", taskId: task_id });
        }
        return text({
          status: "completed",
          taskId: task_id,
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
          handles: finalReceipt.deliveryReceipt
            ? [finalReceipt.deliveryReceipt]
            : [],
          memory: "not-written",
        });
      }
      if (action === "complete" && result && summary && verification?.length) {
        const committed = await loadCommittedTaskCompletion(
          root_path,
          task_id,
          { result, summary, verification, files: files ?? [] },
        );
        if (committed) {
          await purgeTaskFigmaAssets({ rootPath: root_path, taskId: task_id });
          return text(committed);
        }
      }
      const capsule = await requireCapsule(root_path, task_id);
      if (action === "capture-figma-asset") {
        if (!source_receipt_id || !asset_url || !scope_node_id) {
          throw new Error(
            "capture-figma-asset requires source_receipt_id, asset_url and scope_node_id.",
          );
        }
        if (
          capsule.status !== "active" ||
          (capsule.lifecycle.phase !== "prepared" &&
            !(
              capsule.lifecycle.phase === "scoped" &&
              capsule.changeInvalidation?.relockRequired
            ))
        ) {
          throw new Error(
            "Figma assets may be captured only while preparing an active task or inside an explicit relock-required window.",
          );
        }
        const verifiedReceipts = await verifyTaskReceiptLedger(
          root_path,
          task_id,
          [source_receipt_id],
        );
        const receipt = verifiedReceipts[0]?.receipt;
        if (!receipt) {
          throw new Error(
            "Figma asset capture requires a receipt from this task ledger.",
          );
        }
        if (
          receipt.provider !== "figma" ||
          receipt.adapter !== "figma-desktop-mcp-local" ||
          receipt.coverage !== "exact" ||
          receipt.freshness !== "current"
        ) {
          throw new Error(
            "Figma asset capture requires a current exact Figma Desktop MCP receipt from this task ledger.",
          );
        }
        const objective = await resolveTaskObjective(root_path, task_id);
        if (
          objective?.authority !== "authoritative" ||
          !objective.reference
        ) {
          throw new Error(
            "Task objective is not authoritative; re-prepare it before capturing Figma assets.",
          );
        }
        const sourceLedger = await authoritativeTaskSources(
          root_path,
          task_id,
          capsule,
        );
        const captured = await assetOperations.capture({
          rootPath: root_path,
          taskId: task_id,
          sourceReceiptId: source_receipt_id,
          sourceUrl: asset_url,
          scopeNodeId: scope_node_id,
        });
        const asset = await loadAuthorizedTaskFigmaAsset(
          root_path,
          task_id,
          captured.handle,
          sourceLedger.receiptIds,
        );
        const visualHandles = [
          ...new Set(
            capsule.handles.filter((handle) => handle.startsWith("visual:")),
          ),
        ].slice(0, 7);
        const handles = [
          ...visualHandles,
          asset.handle,
          ...capsule.handles.filter(
            (handle) =>
              !handle.startsWith("visual:") && handle !== asset.handle,
          ),
        ].slice(0, 8);
        const saved = await writeTaskCheckpoint(root_path, {
          taskId: task_id,
          status: "active",
          milestone: "source-resolved",
          objective: objective.text,
          objectiveApproved: objective.approved,
          objectiveReference: objective.reference,
          decisions: sourceLedger.decisions,
          sourceRelations: sourceLedger.relations,
          sourceReceiptIds: sourceLedger.receiptIds,
          handles,
          covered: [
            ...capsule.scope.covered.filter(
              (item) => item !== "selected Figma asset captured",
            ),
            "selected Figma asset captured",
          ].slice(-8),
          remaining: capsule.scope.remaining,
          budgetChars: capsule.budget.contextChars,
          estimatedTokens: capsule.budget.estimatedTokens,
          nextSafeAction: capsule.changeInvalidation?.relockRequired
            ? "Relock ChangeSurface with this Figma asset handle and its exact destination before materializing it."
            : "Lock ChangeSurface with this Figma asset handle and its exact destination before materializing it.",
        });
        return text({
          taskId: task_id,
          status: "asset-captured",
          asset,
          handles: saved.handles,
          nextSafeAction: saved.nextSafeAction,
        });
      }
      if (action === "materialize-figma-asset") {
        if (!asset_handle || !destination_path) {
          throw new Error(
            "materialize-figma-asset requires asset_handle and destination_path.",
          );
        }
        if (
          capsule.status !== "active" ||
          capsule.lifecycle.phase !== "scoped" ||
          capsule.changeInvalidation?.relockRequired ||
          !capsule.changeSurface
        ) {
          throw new Error(
            "Figma assets may be materialized only under an active, non-invalidated scoped ChangeSurface before validation.",
          );
        }
        await assertLockedChangeSurfaceArtifact(
          root_path,
          task_id,
          capsule.changeSurface,
        );
        const destination = lockedFigmaAssetDestinationPath(destination_path);
        if (!capsule.changeSurface.allowedFiles.includes(destination)) {
          throw new Error(
            `Figma asset destination ${destination} is outside the active ChangeSurface allowedFiles.`,
          );
        }
        if (!capsule.changeSurface.evidence.handles.includes(asset_handle)) {
          throw new Error(
            "Figma asset handle is not frozen in the active ChangeSurface evidence.",
          );
        }
        const sourceLedger = await verifiedLockedFigmaAssetSourceLedger(
          root_path,
          task_id,
          capsule,
        );
        const asset = await loadAuthorizedTaskFigmaAsset(
          root_path,
          task_id,
          asset_handle,
          sourceLedger.receiptIds,
        );
        if (!sourceLedger.receiptIds.includes(asset.sourceReceiptId)) {
          throw new Error(
            "Figma asset receipt is not frozen in the active ChangeSurface source ledger.",
          );
        }
        const materialized = await assetOperations.materialize({
          rootPath: root_path,
          handle: asset_handle,
          destinationPath: destination,
        });
        return text({
          taskId: task_id,
          status: "asset-materialized",
          asset: materialized,
          lock: {
            id: capsule.changeSurface.lockId,
            revision: capsule.changeSurface.revision,
          },
          nextSafeAction:
            "Continue only inside the locked surface, then run atlas_validate_change.",
        });
      }
      if (action === "attach-evidence") {
        const objective = await resolveTaskObjective(root_path, task_id);
        if (
          objective?.authority !== "authoritative" ||
          !objective.reference
        ) {
          throw new Error(
            "Task objective is not authoritative; re-prepare or explicitly promote the legacy objective before attaching evidence.",
          );
        }
        if (
          capsule.lifecycle.phase !== "prepared" &&
          !(
            capsule.lifecycle.phase === "scoped" &&
            capsule.changeInvalidation?.relockRequired
          )
        ) {
          throw new Error(
            "Evidence may be attached only before the first lock or inside an explicit relock-required invalidation window.",
          );
        }
        if (!visual_contract && !(receipt_ids?.length)) {
          throw new Error(
            "attach-evidence requires a visual_contract or verified receipt_ids.",
          );
        }
        const sourceLedger = await authoritativeTaskSources(
          root_path,
          task_id,
          capsule,
        );
        const verifiedReceipts = await verifyTaskReceiptLedger(
          root_path,
          task_id,
          [
            ...(receipt_ids ?? []),
            ...(visual_contract?.receipt_ids ?? []),
          ],
        );
        const verifiedReceiptIds = verifiedReceipts.map(({ id }) => id);
        if (visual_contract?.authority === "exact-figma") {
          if (!visual_contract.figma?.node_id) {
            throw new Error(
              "Exact Figma authority requires a resolved node_id; file-level evidence may inform candidates but cannot authorize fidelity implementation.",
            );
          }
          const visualReceiptIds = new Set(visual_contract.receipt_ids ?? []);
          const exactFigmaReceipt = verifiedReceipts.find(
            ({ id, receipt }) =>
              visualReceiptIds.has(id) &&
              receipt.provider === "figma" &&
              receipt.coverage === "exact" &&
              receipt.freshness === "current" &&
              receipt.resolved.fileKey === visual_contract.figma?.file_key &&
              receipt.resolved.nodeId === visual_contract.figma?.node_id,
          );
          if (!exactFigmaReceipt) {
            throw new Error(
              "Exact Figma authority requires a current exact Figma receipt whose resolved fileKey/nodeId match the visual contract.",
            );
          }
        }
        const visual = visual_contract
          ? await persistVisualEvidenceContract(root_path, {
              handle: visual_contract.handle,
              taskId: task_id,
              hash: visual_contract.hash,
              authority: visual_contract.authority,
              summary: visual_contract.summary,
              ...(visual_contract.selected_direction_id
                ? { selectedDirectionId: visual_contract.selected_direction_id }
                : {}),
              ...(visual_contract.figma
                ? {
                    figma: {
                      fileKey: visual_contract.figma.file_key,
                      ...(visual_contract.figma.node_id
                        ? { nodeId: visual_contract.figma.node_id }
                        : {}),
                    },
                  }
                : {}),
              sourceReceiptIds: visual_contract.receipt_ids ?? receipt_ids ?? [],
              selectionReceipt: visual_contract.selection_receipt,
              ...(visual_contract.created_at
                ? { createdAt: visual_contract.created_at }
                : {}),
              expiresAt: visual_contract.expires_at,
            })
          : undefined;
        const saved = await writeTaskCheckpoint(root_path, {
          taskId: task_id,
          milestone: "source-resolved",
          objective: objective.text,
          objectiveApproved: objective.approved,
          objectiveReference: objective.reference,
          decisions: sourceLedger.decisions,
          sourceRelations: sourceLedger.relations,
          sourceReceiptIds: [
            ...new Set([
              ...verifiedReceiptIds,
              ...(visual?.sourceReceiptIds ?? []),
              ...sourceLedger.receiptIds,
            ]),
          ],
          handles: [
            ...new Set([
              ...(visual ? [visual.handle] : []),
              ...(visual
                ? capsule.handles.filter(
                    (handle) =>
                      !handle.startsWith("visual:") &&
                      !handle.startsWith("visual-review:"),
                  )
                : capsule.handles),
            ]),
          ].slice(0, 8),
          covered: [...capsule.scope.covered, "external evidence attached"].slice(
            -8,
          ),
          remaining: capsule.scope.remaining,
          budgetChars: capsule.budget.contextChars,
          estimatedTokens: capsule.budget.estimatedTokens,
          nextSafeAction: capsule.nextSafeAction,
        });
        return text({
          taskId: task_id,
          status: "evidence-attached",
          sourceReceiptIds: saved.sourceReceiptIds,
          handles: saved.handles,
        });
      }
      if (action === "attach-review") {
        if (!visual_review) {
          throw new Error("attach-review requires visual_review evidence.");
        }
        const { saved, receipt, ready } = await attachVisualReview(
          root_path,
          task_id,
          capsule,
          visual_review,
        );
        return text({
          taskId: task_id,
          status: ready ? "review-attached" : "blocked",
          reviewReceipt: receipt.handle,
          visualReview: saved.visualReview,
          nextSafeAction: saved.nextSafeAction,
        });
      }
      if (action === "complete") {
        if (!result || !summary || !verification?.length) {
          throw new Error(
            "Completing a task requires result, summary and verification evidence.",
          );
        }
        const completed = await completeTask(root_path, task_id, capsule, {
          result,
          summary,
          verification,
          files: files ?? [],
        });
        await purgeTaskFigmaAssets({ rootPath: root_path, taskId: task_id });
        return text(completed);
      }
      const blocked = action === "block";
      const objective = await resolveTaskObjective(root_path, task_id);
      if (
        objective?.authority !== "authoritative" ||
        !objective.reference
      ) {
        throw new Error(
          "Task objective is not authoritative; re-prepare or explicitly promote the legacy objective before checkpointing.",
        );
      }
      const sourceLedger = await authoritativeTaskSources(
        root_path,
        task_id,
        capsule,
      );
      const saved = await writeTaskCheckpoint(root_path, {
        taskId: task_id,
        status: blocked ? "blocked" : "active",
        milestone: blocked ? "blocked" : (milestone ?? "batch-completed"),
        objective: objective.text,
        objectiveApproved: objective.approved,
        objectiveReference: objective.reference,
        decisions: sourceLedger.decisions,
        sourceRelations: sourceLedger.relations,
        sourceReceiptIds: sourceLedger.receiptIds,
        handles: capsule.handles,
        covered: covered ?? capsule.scope.covered,
        remaining: remaining ?? capsule.scope.remaining,
        budgetChars: capsule.budget.contextChars,
        estimatedTokens: capsule.budget.estimatedTokens,
        nextSafeAction:
          next_action ??
          (blocked
            ? "Resolve the named blocker before implementation."
            : capsule.nextSafeAction),
      });
      return text({
        taskId: saved.taskId,
        status: saved.status,
        updatedAt: saved.updatedAt,
        nextSafeAction: saved.nextSafeAction,
      });
    },
  );

  server.registerTool(
    "atlas_memory",
    {
      description:
        "Review or mutate Project Memory only through an explicit action-specific consent token; task completion never writes memory.",
      inputSchema: {
        root_path: z.string(),
        task_id: taskId,
        action: z.enum([
          "review-proposal",
          "record-episodic",
          "propose-canonical",
          "apply-canonical",
          "reject-proposal",
        ]),
        consent: z.string().min(1).max(320).optional(),
        result: z.enum(["success", "failure", "partial"]).optional(),
        summary: z.string().min(1).max(2_000).optional(),
        rationale: z.string().min(1).max(1_500).optional(),
        evidence: z.array(z.string().max(500)).max(12).optional(),
        files: z.array(z.string().max(500)).max(100).optional(),
        related_entity_ids: z.array(z.string().max(260)).max(20).optional(),
        items: z.array(memoryItemInput).min(1).max(8).optional(),
        proposal_id: z.string().min(1).max(260).optional(),
        rejection_reason: z.string().min(1).max(1_000).optional(),
      },
      annotations: {
        title: "Govern Project Atlas memory",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({
      root_path,
      task_id,
      action,
      consent,
      result,
      summary,
      rationale,
      evidence,
      files,
      related_entity_ids,
      items,
      proposal_id,
      rejection_reason,
    }) => {
      if (action === "review-proposal") {
        if (!proposal_id) {
          throw new Error("Reviewing memory requires proposal_id.");
        }
        return text(
          await reviewMemoryProposal(root_path, proposal_id, {
            target: "canonical",
          }),
        );
      }

      if (action === "record-episodic") {
        if (!result || !summary) {
          throw new Error(
            "Episodic memory requires result and summary after explicit consent.",
          );
        }
        const task = await completedTaskContext(root_path, task_id);
        const payload = {
          action,
          taskId: task_id,
          task: task.objective,
          result,
          summary: summary.trim(),
          evidence: evidence ?? [],
          files: files ?? [],
          relatedEntityIds: related_entity_ids ?? [],
        };
        const payloadHash = consentHash(payload);
        const expectedConsent = `${action}:${payloadHash}`;
        if (consent !== expectedConsent) {
          return needsConsent(root_path, task_id, action, payloadHash, expectedConsent, {
            task: task.objective,
            result,
            summary: summary.trim(),
            evidence: payload.evidence,
            files: payload.files,
            relatedEntityIds: payload.relatedEntityIds,
            target: "episodic",
          });
        }
        const priorConsumption = await beginConsentExecution(
          root_path,
          task_id,
          action,
          payloadHash,
        );
        if (priorConsumption) return priorConsumption;
        const recorded = await recordProjectOutcome({
          rootPath: root_path,
          taskId: task_id,
          task: task.objective,
          result,
          summary: summary.trim(),
          evidence: payload.evidence,
          relatedEntityIds: payload.relatedEntityIds,
          ...(files ? { files: payload.files } : {}),
          budgetChars: 1_600,
          idempotencyKey: payloadHash,
        });
        return committedConsent(
          root_path,
          task_id,
          action,
          payloadHash,
          recorded as unknown as Record<string, unknown>,
        );
      }

      if (action === "propose-canonical") {
        if (!rationale || !items?.length) {
          throw new Error(
            "A canonical memory proposal requires rationale and typed items.",
          );
        }
        await completedTaskContext(root_path, task_id);
        const drafts = items.map((item) => ({
          type: item.type,
          title: item.title,
          summary: item.summary,
          ...(item.body ? { body: item.body } : {}),
          confidence: item.confidence ?? 0.8,
          authority: item.authority ?? "observed",
          scope: "canonical" as const,
          ...(item.tags ? { tags: item.tags } : {}),
          ...(item.supersedes ? { supersedes: item.supersedes } : {}),
          relations: (item.relations ?? []).map((relation) => ({
            kind: relation.kind,
            targetId: relation.target_id,
            ...(relation.summary ? { summary: relation.summary } : {}),
          })),
        }));
        const payload = {
          action,
          taskId: task_id,
          rationale: rationale.trim(),
          evidence: evidence ?? [],
          items: drafts,
        };
        const payloadHash = consentHash(payload);
        const expectedConsent = `${action}:${payloadHash}`;
        if (consent !== expectedConsent) {
          return needsConsent(root_path, task_id, action, payloadHash, expectedConsent, {
            rationale: rationale.trim(),
            evidence: payload.evidence,
            items: drafts,
            target: "canonical",
          });
        }
        const priorConsumption = await beginConsentExecution(
          root_path,
          task_id,
          action,
          payloadHash,
        );
        if (priorConsumption) return priorConsumption;
        const proposed = await proposeMemoryUpdate({
          rootPath: root_path,
          rationale: rationale.trim(),
          evidence: payload.evidence,
          proposedBy: task_id,
          idempotencyKey: consentHash(payload),
          items: drafts,
          budgetChars: 1_600,
        });
        return committedConsent(
          root_path,
          task_id,
          action,
          payloadHash,
          proposed as unknown as Record<string, unknown>,
        );
      }

      if (!proposal_id) {
        throw new Error(`${action} requires proposal_id.`);
      }
      const review = await reviewMemoryProposal(root_path, proposal_id, {
        target: "canonical",
      });
      if (review.target !== "canonical") {
        throw new Error(
          `Memory proposal ${proposal_id} was not reviewed for the canonical target.`,
        );
      }
      if (review.proposedBy !== task_id) {
        throw new Error(
          `Memory proposal ${proposal_id} belongs to task ${review.proposedBy ?? "unknown"}; cross-task apply/reject is forbidden.`,
        );
      }
      if (action === "apply-canonical") {
        const proposalScope = stableProposalConsentScope(review);
        const payload = {
          action,
          taskId: task_id,
          proposalId: proposal_id,
          proposal: proposalScope,
        };
        const payloadHash = consentHash(payload);
        const expectedConsent = `${action}:${payloadHash}`;
        if (consent !== expectedConsent) {
          return needsConsent(
            root_path,
            task_id,
            action,
            payloadHash,
            expectedConsent,
            proposalScope,
          );
        }
        const priorConsumption = await beginConsentExecution(
          root_path,
          task_id,
          action,
          payloadHash,
        );
        if (priorConsumption) return priorConsumption;
        const applied = await applyMemoryUpdate(root_path, proposal_id, {
          confirmed: true,
          target: "canonical",
          canonicalConfirmed: true,
          budgetChars: 1_600,
          idempotencyKey: payloadHash,
        });
        return committedConsent(
          root_path,
          task_id,
          action,
          payloadHash,
          applied as unknown as Record<string, unknown>,
        );
      }
      if (!rejection_reason) {
        throw new Error("Rejecting a memory proposal requires rejection_reason.");
      }
      const payload = {
        action,
        taskId: task_id,
        proposalId: proposal_id,
        proposal: stableProposalConsentScope(review),
        rejectionReason: rejection_reason.trim(),
      };
      const payloadHash = consentHash(payload);
      const expectedConsent = `${action}:${payloadHash}`;
      if (consent !== expectedConsent) {
        return needsConsent(
          root_path,
          task_id,
          action,
          payloadHash,
          expectedConsent,
          {
            ...stableProposalConsentScope(review),
            rejectionReason: rejection_reason.trim(),
          },
        );
      }
      const priorConsumption = await beginConsentExecution(
        root_path,
        task_id,
        action,
        payloadHash,
      );
      if (priorConsumption) return priorConsumption;
      const rejected = await rejectMemoryUpdate(root_path, proposal_id, {
        confirmed: true,
        reason: rejection_reason,
        budgetChars: 1_600,
        idempotencyKey: payloadHash,
      });
      return committedConsent(
        root_path,
        task_id,
        action,
        payloadHash,
        rejected as unknown as Record<string, unknown>,
      );
    },
  );
}
