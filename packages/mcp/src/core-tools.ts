import {
  assessTaskIntake,
  assessScopedTaskRisk,
  assessTaskRisk,
  buildChangeSurface,
  normalizeTaskSourceRelations,
  SOURCE_RECEIPT_ID_PATTERN,
} from "@component-atlas/core";
import {
  checkBeforeChange,
  computeTaskObjectiveHash,
  lockTaskChangeSurface,
  loadPersistedSourceReceipt,
  loadVisualEvidenceContract,
  loadTaskSourceLedger,
  normalizeLockedChangeIntent,
  normalizeLockedEvidenceHandles,
  prepareTaskContext,
  persistTaskObjective,
  scanProject,
  taskObjectiveReference,
  taskContextResumeHandles,
  writeTaskFocus,
  validateDiff,
  writeTaskCheckpoint,
} from "@component-atlas/runtime";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerCoreExpandContext } from "./core-expand-context.js";
import {
  assertSelectableHandles,
  assertTaskBoundHandle,
  taskBoundHandle,
} from "./core-handle-ownership.js";
import {
  compact,
  mergedObjective,
  requireAuthoritativeObjective,
  requireCapsule,
  sourceLedgerFingerprint,
  stableHash,
  surfaceProjection,
  taskRiskRank,
} from "./core-tool-helpers.js";
import { registerCoreLifecycleTools } from "./core-lifecycle-tools.js";
import { assertReuseDecisionInvariants } from "./core-reuse-decision.js";
import {
  classifyPreparedTaskGovernance,
  escalateLockedTaskGovernance,
  reconcilePreparedTaskGovernance,
} from "./core-task-governance.js";
import {
  CORE_PREPARE_NEXT_STEPS,
  continueAfterReuseBudget,
  explicitlyChangesApiContract,
} from "./core-prepare-reuse.js";
import {
  bindSourceEvidenceBundle,
  activeCurrentSourceReceiptIds,
  capsuleDecisions,
  confirmedOperationsFromReceipts,
  containsCredentializedUrl,
  normalizedSourceRelations,
  normalizedSources,
  requiredSourcesWithoutCurrentReceipts,
  sourceInput,
  sourceRelationInput,
} from "./core-source-evidence.js";
import { prepareTaskFocus } from "./core-task-prepare-focus.js";
import { text } from "./shared.js";

const taskId = z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/u);
export function registerCoreTools(server: McpServer): void {
  server.registerTool(
    "atlas_prepare_task",
    {
      description:
        "Preflight consent first, then prepare one bounded frontend task with confirmed receipts, repository reuse context and resumable handles.",
      inputSchema: {
        root_path: z.string(),
        objective: z
          .string()
          .min(1)
          .max(6_000)
          .refine((value) => !containsCredentializedUrl(value), {
            message:
              "Task objectives must not contain URL credentials or secret signature parameters.",
          }),
        task_id: taskId.optional(),
        title: z.string().min(1).max(160).optional(),
        start_new_task: z.boolean().optional(),
        objective_confirmed: z.boolean().optional(),
        sources: z.array(sourceInput).max(12).optional(),
        source_relations: z.array(sourceRelationInput).max(12).optional(),
        receipt_ids: z
          .array(z.string().regex(SOURCE_RECEIPT_ID_PATTERN))
          .max(20)
          .optional(),
        selected_handles: z.array(z.string().max(260)).max(8).optional(),
        retrieval_invalidation_reason: z.enum([
          "graph-changed", "scope-changed", "source-ledger-changed", "user-requested",
        ]).optional(),
        invalidation_reason: z.string().min(1).max(500).optional(),
        budget_chars: z.number().int().min(1_600).max(3_600).optional(),
      },
      annotations: {
        title: "Prepare frontend task",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      root_path,
      objective,
      task_id,
      title,
      start_new_task,
      objective_confirmed,
      sources,
      source_relations,
      receipt_ids,
      selected_handles,
      retrieval_invalidation_reason,
      invalidation_reason,
      budget_chars,
    }) => {
      const budget = budget_chars ?? 3_600;
      const focus = await prepareTaskFocus({
        rootPath: root_path,
        objective,
        ...(task_id ? { taskId: task_id } : {}),
        ...(start_new_task ? { startNewTask: start_new_task } : {}),
        budget,
      });
      if ("response" in focus) return focus.response;
      const { id, prior, priorObjective } = focus;
      // An explicit task ID and a safely recovered task become the checkout's
      // focus after their capsule exists. New tasks are focused after the first
      // successful checkpoint below.
      const priorLedger = await loadTaskSourceLedger(root_path, id);
      const implicitFocusedContinuation =
        !task_id && !start_new_task && Boolean(priorObjective?.text);
      const effectiveObjective = mergedObjective(
        implicitFocusedContinuation || priorObjective?.authority === "legacy-projection"
          ? undefined
          : priorObjective?.text,
        implicitFocusedContinuation ? priorObjective!.text : objective,
      );
      const priorRisk = assessTaskRisk(priorObjective?.text ?? objective);
      const risk = assessTaskRisk(effectiveObjective);
      const objectiveUnchanged =
        priorObjective?.text.trim() === effectiveObjective.trim();
      const approved =
        Boolean(objective_confirmed) ||
        (priorObjective?.authority === "authoritative" &&
          Boolean(priorObjective.approved) &&
          objectiveUnchanged &&
          taskRiskRank[risk.level] <= taskRiskRank[priorRisk.level]);
      if (
        priorObjective?.authority === "legacy-projection" &&
        objective_confirmed !== true
      ) {
        return text(
          compact(
            {
              taskId: id,
              status: "needs-confirmation",
              repositoryScanned: false,
              questions: [
                "Confirm the complete objective text to promote this legacy truncated task projection.",
              ],
              nextAction:
                "Repeat prepare with the complete objective and objective_confirmed=true; Atlas will bind it by SHA-256 before any scan or relock.",
            },
            budget_chars ?? 3_600,
          ),
        );
      }
      const decisions = normalizedSources(
        effectiveObjective,
        priorLedger?.decisions ?? capsuleDecisions(prior),
        sources ?? [],
      );
      const governance = reconcilePreparedTaskGovernance(
        prior?.governance,
        classifyPreparedTaskGovernance({
          objective: effectiveObjective,
          risk,
          confirmedAuthorityRoles: decisions
            .filter((source) => source.state === "confirmed")
            .map(
              (source) =>
                source.authorityRole ?? "implementation-reference",
            ),
        }),
      );
      const relations = source_relations
        ? normalizedSourceRelations(source_relations, decisions)
        : normalizeTaskSourceRelations(
            (priorLedger?.relations ?? prior?.sourceRelations ?? []).filter(
              (relation) => {
                const from = decisions.find(
                  (decision) => decision.id === relation.fromSourceId,
                );
                const to = decisions.find(
                  (decision) => decision.id === relation.toSourceId,
                );
                return from?.state === "confirmed" && to?.state === "confirmed";
              },
            ),
            decisions,
          );
      const priorReceiptIds =
        priorLedger?.receiptIds ?? prior?.sourceReceiptIds ?? [];
      const proposedActiveReceiptIds = await activeCurrentSourceReceiptIds(
        root_path,
        decisions,
        receipt_ids ?? priorReceiptIds,
      );
      for (const handle of selected_handles ?? []) {
        if (taskBoundHandle(handle)) {
          await assertTaskBoundHandle(
            root_path,
            id,
            handle,
            proposedActiveReceiptIds,
          );
        }
      }
      const proposedLedgerHash = sourceLedgerFingerprint(
        decisions,
        relations,
        proposedActiveReceiptIds,
      );
      const lockedEvidenceHandles =
        prior?.changeSurface?.evidence.handles ?? [];
      const proposedEvidenceHandles =
        selected_handles ??
        prior?.changeSurface?.evidence.handles ??
        prior?.handles ??
        [];
      const lockedEvidenceChanged = Boolean(
        prior?.changeSurface &&
          (Boolean(invalidation_reason) ||
            normalizeLockedChangeIntent(effectiveObjective) !==
              prior.changeSurface.intent ||
            prior.changeSurface.objective?.hash !==
              computeTaskObjectiveHash(effectiveObjective) ||
            proposedLedgerHash !== prior.changeSurface.evidence.sourceLedger.hash ||
            sources?.some((source) => Boolean(source.evidence)) ||
            stableHash(normalizeLockedEvidenceHandles(proposedEvidenceHandles)) !==
              stableHash(normalizeLockedEvidenceHandles(lockedEvidenceHandles))),
      );
      if (prior?.changeSurface && !lockedEvidenceChanged) {
        return text(
          compact(
            {
              taskId: id,
              status: "already-scoped",
              repositoryScanned: false,
              lock: {
                id: prior.changeSurface.lockId,
                revision: prior.changeSurface.revision,
              },
              governance,
              nextAction: prior.nextSafeAction,
            },
            budget,
          ),
        );
      }
      if (lockedEvidenceChanged && !invalidation_reason) {
        return text(
          compact(
            {
              taskId: id,
              status: "needs-confirmation",
              repositoryScanned: false,
              questions: [
                "Name the objective, source-ledger, receipt, or visual-contract change that invalidates the current lock.",
              ],
              governance,
              nextAction:
                "Repeat prepare with invalidation_reason, then relock with the same reason before editing.",
            },
            budget,
          ),
        );
      }
      const checkpointObjectiveReference =
        priorObjective?.authority === "authoritative" &&
        objectiveUnchanged &&
        priorObjective.reference
          ? priorObjective.reference
          : priorObjective?.authority === "legacy-projection"
            ? taskObjectiveReference(
                await persistTaskObjective(root_path, {
                  taskId: id,
                  objective: effectiveObjective,
                }),
              )
            : undefined;
      const intake = {
        schemaVersion: 1 as const,
        scope: "task" as const,
        objective: effectiveObjective,
        objectiveConfirmed: approved,
        risk,
        sources: decisions,
        ...(relations.length > 0 ? { relations } : {}),
      };
      const assessment = assessTaskIntake(intake);
      if (assessment.status !== "ready") {
        const blocked = assessment.status === "blocked";
        await writeTaskCheckpoint(root_path, {
          taskId: id,
          ...(title ? { title } : {}),
          expectedUpdatedAt: prior?.updatedAt ?? null,
          status: blocked ? "blocked" : "active",
          milestone: blocked ? "blocked" : "decision-confirmed",
          objective: effectiveObjective,
          objectiveApproved: approved,
          ...(checkpointObjectiveReference
            ? { objectiveReference: checkpointObjectiveReference }
            : {}),
          decisions,
          sourceRelations: relations,
          sourceReceiptIds: priorReceiptIds,
          handles: prior?.handles ?? [],
          governance,
          covered: ["objective and source preflight"],
          remaining: assessment.reasons,
          budgetChars: budget,
          nextSafeAction:
            "Confirm, omit, replace or mark only the named pending source/objective decisions, then prepare again.",
          ...(lockedEvidenceChanged ? { changeInvalidation: { reason: invalidation_reason! } } : {}),
        });
        await writeTaskFocus(root_path, { taskId: id });
        return text(
          compact(
            {
              taskId: id,
              status: assessment.status,
              risk,
              governance,
              sources: decisions,
              relations,
              questions: assessment.reasons,
              repositoryScanned: false,
              nextAction:
                "Resolve the listed consent decisions and call atlas_prepare_task again with the same task_id.",
            },
            budget,
            [],
          ),
        );
      }
      const boundEvidence = await bindSourceEvidenceBundle(
        root_path,
        decisions,
        sources ?? [],
        receipt_ids ??
          priorReceiptIds,
      );
      const boundReceiptIds = boundEvidence.receiptIds;
      const unresolvedRequiredSources =
        await requiredSourcesWithoutCurrentReceipts(
          root_path,
          decisions,
          boundReceiptIds,
        );
      if (unresolvedRequiredSources.length > 0) {
        const reasons = unresolvedRequiredSources.map(
          (source) =>
            `Required ${source.kind} source has no exact current receipt: ${source.reference}`,
        );
        await writeTaskCheckpoint(root_path, {
          taskId: id,
          ...(title ? { title } : {}),
          expectedUpdatedAt: prior?.updatedAt ?? null,
          status: "blocked",
          milestone: "blocked",
          objective: effectiveObjective,
          objectiveApproved: approved,
          ...(checkpointObjectiveReference
            ? { objectiveReference: checkpointObjectiveReference }
            : {}),
          decisions,
          sourceRelations: relations,
          sourceReceiptIds: boundReceiptIds,
          handles: prior?.handles ?? [],
          governance,
          covered: ["objective and source consent"],
          remaining: reasons,
          budgetChars: budget,
          ...(lockedEvidenceChanged
            ? { changeInvalidation: { reason: invalidation_reason! } }
            : {}),
          nextSafeAction:
            "Retrieve each required confirmed source and attach exact current evidence before repository scanning.",
        });
        await writeTaskFocus(root_path, { taskId: id });
        return text(
          compact(
            {
              taskId: id,
              status: "blocked",
              risk,
              governance,
              sources: decisions,
              missingRequiredEvidence: unresolvedRequiredSources.map(
                (source) => ({
                  id: source.id,
                  kind: source.kind,
                  reference: source.reference,
                }),
              ),
              repositoryScanned: false,
              nextAction:
                "Resolve the required sources through their confirmed adapters, then prepare again with the resulting receipts.",
            },
            budget,
          ),
        );
      }
      const currentOpenApiReceipts = (
        await Promise.all(
          boundReceiptIds.map((receiptId) =>
            loadPersistedSourceReceipt(root_path, receiptId),
          ),
        )
      ).filter((receipt) => receipt.provider === "openapi");
      const graph = await scanProject(root_path, { writeArtifacts: false });
      await assertSelectableHandles(
        root_path,
        id,
        selected_handles ?? [],
        boundReceiptIds,
        graph,
      );
      try {
        const context = await prepareTaskContext(
          root_path,
          intake,
          {
            budgetChars: Math.max(1_600, budget - 280),
            topK: 3,
            taskId: id,
            ...(boundEvidence.transientOpenApiSources.length > 0
              ? {
                  transientOpenApiSources:
                    boundEvidence.transientOpenApiSources,
                }
              : {}),
            ...(currentOpenApiReceipts.length > 0
              ? { currentOpenApiReceipts }
              : {}),
            ...(selected_handles ? { selectedHandles: selected_handles } : {}),
            ...(retrieval_invalidation_reason
              ? {
                  retrievalInvalidationReason:
                    retrieval_invalidation_reason,
                }
              : {}),
          },
        );
        // Runtime task context is shared with the explicitly retained legacy
        // profile. Project the workflow guidance at the profile boundary so a
        // core response can never instruct the caller to invoke a legacy-only
        // tool while legacy keeps its compatible next steps.
        const coreContext = {
          ...context,
          nextSteps: [...CORE_PREPARE_NEXT_STEPS],
        };
        const handles = normalizeLockedEvidenceHandles([
          ...(prior?.changeSurface?.evidence.handles ?? []),
          ...(prior?.handles ?? []),
          ...(selected_handles ?? []),
          ...taskContextResumeHandles(coreContext),
        ]);
        const sourceReceiptIds = [
          ...new Set([...boundReceiptIds, ...context.sourceReceiptIds]),
        ];
        await writeTaskCheckpoint(root_path, {
          taskId: id,
          ...(title ? { title } : {}),
          expectedUpdatedAt: prior?.updatedAt ?? null,
          milestone:
            context.sourceReceiptIds.length > 0
              ? "source-resolved"
              : "batch-completed",
          objective: effectiveObjective,
          objectiveApproved: approved,
          ...(checkpointObjectiveReference
            ? { objectiveReference: checkpointObjectiveReference }
            : {}),
          decisions,
          sourceRelations: relations,
          sourceReceiptIds,
          handles,
          governance,
          covered: ["repository orientation", "source gate", "bounded context"],
          remaining: ["lock change scope", "implementation", "validation"],
          budgetChars: budget,
          estimatedTokens: coreContext.metrics.estimatedTokens,
          ...(lockedEvidenceChanged
            ? { changeInvalidation: { reason: invalidation_reason! } }
            : {}),
          nextSafeAction:
            lockedEvidenceChanged
              ? "Explicitly relock with the same invalidation reason before editing."
              : "Expand only a named unresolved handle, then lock the change scope.",
        });
        await writeTaskFocus(root_path, { taskId: id });
        return text(
          compact(
            {
              ...coreContext,
              sourceReceiptIds,
              taskId: id,
              risk,
              governance,
              status: lockedEvidenceChanged ? "relock-required" : "ready",
              ...(lockedEvidenceChanged
                ? { invalidationReason: invalidation_reason }
                : {}),
            },
            budget,
            handles,
            [
              "sourceReceiptIds",
              "sourceWarnings",
              "operationIndex",
              "nextSteps",
            ],
          ),
        );
      } catch (error) {
        const continuation = await continueAfterReuseBudget({
          rootPath: root_path, error, budget, taskId: id,
          ...(prior ? { prior } : {}),
          objective: effectiveObjective, objectiveApproved: approved,
          ...(checkpointObjectiveReference
            ? { objectiveReference: checkpointObjectiveReference }
            : {}),
          decisions, sourceRelations: relations,
          sourceReceiptIds: boundReceiptIds,
          ...(selected_handles ? { selectedHandles: selected_handles } : {}),
          governance,
          ...(lockedEvidenceChanged
            ? { changeInvalidation: { reason: invalidation_reason! } }
            : {}),
        });
        if (continuation) return continuation;
        await writeTaskCheckpoint(root_path, {
          taskId: id,
          ...(title ? { title } : {}),
          expectedUpdatedAt: prior?.updatedAt ?? null,
          status: "blocked",
          milestone: "blocked",
          objective: effectiveObjective,
          objectiveApproved: approved,
          ...(checkpointObjectiveReference
            ? { objectiveReference: checkpointObjectiveReference }
            : {}),
          decisions,
          sourceRelations: relations,
          sourceReceiptIds: boundReceiptIds,
          handles: selected_handles ?? prior?.handles ?? [],
          governance,
          covered: ["repository orientation", "source gate"],
          remaining: [error instanceof Error ? error.message : String(error)],
          budgetChars: budget,
          ...(lockedEvidenceChanged
            ? { changeInvalidation: { reason: invalidation_reason! } }
            : {}),
          nextSafeAction:
            "Resolve only the required source or objective decision named by the blocker.",
        });
        await writeTaskFocus(root_path, { taskId: id });
        throw error;
      }
    },
  );

  registerCoreExpandContext(server);

  server.registerTool(
    "atlas_lock_change_scope",
    {
      description:
        "Persist a versioned reuse decision, primary surface, allowed files, exclusions, evidence fingerprints and Git baseline before editing.",
      inputSchema: {
        root_path: z.string(),
        task_id: taskId,
        primary_component: z.string().max(260).optional(),
        primary_surface: z
          .object({
            kind: z.enum([
              "route",
              "service",
              "state",
              "api",
              "configuration",
              "files",
            ]),
            id: z.string().min(1).max(260),
            path: z.string().min(1).max(500).optional(),
          })
          .optional(),
        reference_components: z.array(z.string().max(260)).max(2).optional(),
        allowed_files: z.array(z.string().min(1).max(500)).max(32).optional(),
        exclusions: z.array(z.string().max(500)).max(16).optional(),
        decision: z.enum([
          "reuse",
          "extend",
          "compose",
          "extract-and-reuse",
          "create",
          "not-applicable",
        ]),
        rationale: z.string().min(1).max(1_500),
        selected_component_ids: z.array(z.string().max(260)).max(12).optional(),
        rejected_component_ids: z.array(z.string().max(260)).max(12).optional(),
        risk_confirmed: z.boolean().optional(),
        invalidation_reason: z.string().min(1).max(500).optional(),
      },
      annotations: {
        title: "Lock frontend change scope",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({
      root_path,
      task_id,
      primary_component,
      primary_surface,
      reference_components,
      allowed_files,
      exclusions,
      decision,
      rationale,
      selected_component_ids,
      rejected_component_ids,
      risk_confirmed,
      invalidation_reason,
    }) => {
      const capsule = await requireCapsule(root_path, task_id);
      const objective = await requireAuthoritativeObjective(root_path, task_id);
      if (!capsule.changeSurface && invalidation_reason) {
        throw new Error(
          "The first ChangeSurface lock cannot declare an invalidation_reason.",
        );
      }
      if (
        capsule.changeSurface &&
        !capsule.changeInvalidation?.relockRequired &&
        invalidation_reason
      ) {
        throw new Error(
          "Relocking is allowed only after atlas_prepare_task persists a matching relock-required invalidation.",
        );
      }
      if (
        capsule.changeInvalidation?.relockRequired &&
        invalidation_reason !== capsule.changeInvalidation.reason
      ) {
        throw new Error(
          "Relocking requires the exact persisted invalidation_reason from atlas_prepare_task.",
        );
      }
      const ledger = await loadTaskSourceLedger(root_path, task_id);
      const ledgerDecisions = ledger?.decisions ?? capsuleDecisions(capsule);
      const decisionById = new Map(
        ledgerDecisions.map((source) => [source.id, source]),
      );
      const ledgerRelations = (
        ledger?.relations ?? capsule.sourceRelations ?? []
      ).filter(
        (relation) =>
          decisionById.get(relation.fromSourceId)?.state === "confirmed" &&
          decisionById.get(relation.toSourceId)?.state === "confirmed",
      );
      const ledgerReceiptIds = await activeCurrentSourceReceiptIds(
        root_path,
        ledgerDecisions,
        ledger?.receiptIds ?? capsule.sourceReceiptIds,
      );
      const requiresVisualContract = ledgerDecisions.some(
        (source) =>
          source.state === "confirmed" &&
          (source.kind === "figma" || source.authorityRole === "visual"),
      );
      const priorLockedHandles = capsule.changeSurface?.evidence.handles ?? [];
      const currentVisualHandles = capsule.handles.filter((handle) =>
        handle.startsWith("visual:"),
      );
      const currentFigmaSnapshotHandles = capsule.handles.filter((handle) =>
        handle.startsWith("figma-snapshot:"),
      );
      const visualHandles =
        currentVisualHandles.length > 0
          ? currentVisualHandles
          : priorLockedHandles.filter((handle) => handle.startsWith("visual:"));
      if (requiresVisualContract && visualHandles.length === 0) {
        throw new Error(
          "Confirmed Figma or visual authority requires an attached visual: contract before locking ChangeSurface.",
        );
      }
      for (const handle of visualHandles) {
        const contract = await loadVisualEvidenceContract(root_path, handle);
        if (
          contract.taskId !== task_id ||
          Date.parse(contract.expiresAt) <= Date.now()
        ) {
          throw new Error(
            "ChangeSurface cannot freeze a stale or cross-task visual contract.",
          );
        }
      }
      if (Boolean(primary_component) === Boolean(primary_surface)) {
        throw new Error(
          "Lock exactly one primary_component or primary_surface.",
        );
      }
      if (decision === "create" && !(allowed_files?.length)) {
        throw new Error(
          "A create decision requires exact future allowed_files before editing.",
        );
      }
      // Scope, Git baseline, and graph/theme fingerprints must describe the
      // same pre-edit repository state. Refresh here even if prepare already
      // populated the index; another process may have changed the checkout.
      const graph = await scanProject(root_path, { writeArtifacts: false });
      const surface = buildChangeSurface(graph, objective.text, {
        ...(primary_component ? { primaryComponent: primary_component } : {}),
        ...(primary_surface
          ? {
              primarySurface: {
                kind: primary_surface.kind,
                id: primary_surface.id,
              },
            }
          : {}),
        ...(reference_components
          ? { secondaryComponents: reference_components }
          : {}),
        ...(allowed_files ? { allowedFiles: allowed_files } : {}),
        ...(exclusions ? { outOfScope: exclusions } : {}),
      });
      const reuseDecision = assertReuseDecisionInvariants({
        decision,
        existingComponentIds: graph.components.map((component) => component.id),
        ...(surface.primary ? { primaryComponentId: surface.primary.id } : {}),
        hasPrimarySurface: Boolean(surface.primarySurface),
        ...(selected_component_ids
          ? { selectedComponentIds: selected_component_ids }
          : {}),
        ...(rejected_component_ids
          ? { rejectedComponentIds: rejected_component_ids }
          : {}),
        rationale,
      });
      const files = [
        ...new Set(
          [
            ...surface.files
              .filter((file) =>
                ["implementation", "test"].includes(file.role),
              )
              .map((file) => file.path),
            ...surface.authorizedFiles,
            ...(primary_surface?.path
              ? [
                  primary_surface.path
                    .trim()
                    .replaceAll("\\", "/")
                    .replace(/^\.\//u, ""),
                ]
              : []),
          ].filter(Boolean),
        ),
      ];
      if (files.length === 0) {
        throw new Error(
          "A locked change surface requires at least one implementation, test or explicitly allowed file.",
        );
      }
      const preflight = await checkBeforeChange(
        root_path,
        objective.text,
        {
          files,
          budgetChars: 1_600,
          confirmedFigmaReferences: ledgerDecisions
            .filter(
              (source) =>
                source.state === "confirmed" && source.kind === "figma",
            )
            .map((source) => source.reference),
        },
      );
      const handles = normalizeLockedEvidenceHandles([
        ...new Set([
          ...visualHandles,
          ...priorLockedHandles.filter(
            (handle) =>
              (!handle.startsWith("visual:") || visualHandles.includes(handle)) &&
              (!handle.startsWith("figma-snapshot:") ||
                currentFigmaSnapshotHandles.length === 0),
          ),
          ...capsule.handles,
        ]),
        ...(surface.primary ? [`code:${surface.primary.id}`] : []),
        ...surface.references.map((item) => `code:${item.component.id}`),
      ].filter((item, index, list) => list.indexOf(item) === index));
      const sourceLedgerHash = sourceLedgerFingerprint(
        ledgerDecisions,
        ledgerRelations,
        ledgerReceiptIds,
      );
      const confirmedOperations = await confirmedOperationsFromReceipts(
        root_path,
        ledgerReceiptIds,
        ledgerDecisions,
      );
      const openApiAuthority = (
        await Promise.all(
          ledgerReceiptIds.map((receiptId) =>
            loadPersistedSourceReceipt(root_path, receiptId),
          ),
        )
      ).some((receipt) => receipt.provider === "openapi");
      const risk = assessScopedTaskRisk(objective.text, {
        selection: surface.selection,
        ...(surface.impact ? { impact: surface.impact } : {}),
        publicApiChanged: decision === "extend",
        implementationFiles: files.length,
        confirmedAuthorityRoles: ledgerDecisions
          .filter((source) => source.state === "confirmed")
          .map(
            (source) => source.authorityRole ?? "implementation-reference",
          ),
      });
      const governance = escalateLockedTaskGovernance(
        reconcilePreparedTaskGovernance(
          capsule.governance,
          classifyPreparedTaskGovernance({
            objective: objective.text,
            risk: assessTaskRisk(objective.text),
            confirmedAuthorityRoles: ledgerDecisions
              .filter((source) => source.state === "confirmed")
              .map(
                (source) =>
                  source.authorityRole ?? "implementation-reference",
              ),
          }),
        ),
        {
          fileCount: files.length,
          publicApiChanged: decision === "extend",
          sharedSurface:
            surface.impact?.level === "shared" ||
            surface.impact?.level === "high",
          apiContractChanged:
            primary_surface?.kind === "api" ||
            (openApiAuthority && explicitlyChangesApiContract(objective.text)),
          ...(surface.impact ? { impact: surface.impact } : {}),
          scopedRisk: risk,
        },
      );
      if (
        risk.requiresObjectiveConfirmation &&
        !objective.approved &&
        risk_confirmed !== true
      ) {
        await writeTaskCheckpoint(root_path, {
          taskId: task_id,
          expectedUpdatedAt: capsule.updatedAt,
          milestone: "decision-confirmed",
          objective: objective.text,
          objectiveApproved: false,
          objectiveReference: objective.reference,
          decisions: ledgerDecisions,
          sourceRelations: ledgerRelations,
          sourceReceiptIds: ledgerReceiptIds,
          handles,
          governance,
          covered: ["sources", "bounded context", "reuse decision"],
          remaining: ["confirm escalated governance", "lock change scope"],
          budgetChars: capsule.budget.contextChars,
          estimatedTokens: capsule.budget.estimatedTokens,
          nextSafeAction:
            "Confirm the escalated risk and governed surface before locking implementation scope.",
        });
        return text(
          compact(
            {
              taskId: task_id,
              status: "needs-confirmation",
              risk,
              governance,
              surface: surfaceProjection(surface),
              gate: preflight.gate,
              findings: preflight.findings,
              questions: [
                "Confirm the escalated risk and locked surface before implementation.",
              ],
            },
            3_000,
            handles,
          ),
        );
      }
      if (preflight.gate.status === "blocked") {
        await writeTaskCheckpoint(root_path, {
          taskId: task_id,
          expectedUpdatedAt: capsule.updatedAt,
          status: "blocked",
          milestone: "blocked",
          objective: objective.text,
          objectiveApproved: objective.approved || risk_confirmed === true,
          objectiveReference: objective.reference,
          decisions: ledgerDecisions,
          sourceRelations: ledgerRelations,
          sourceReceiptIds: ledgerReceiptIds,
          handles,
          governance,
          covered: ["sources", "bounded context", "reuse decision"],
          remaining: preflight.gate.questions.map((question) => question.question),
          budgetChars: capsule.budget.contextChars,
          estimatedTokens: capsule.budget.estimatedTokens,
          nextSafeAction:
            "Resolve the decision-required finding before locking implementation scope.",
        });
        return text(
          compact(
            {
              taskId: task_id,
              status: "blocked",
              risk,
              governance,
              surface: surfaceProjection(surface),
              gate: preflight.gate,
              findings: preflight.findings,
            },
            3_000,
            handles,
          ),
        );
      }
      const locked = await lockTaskChangeSurface(root_path, {
        taskId: task_id,
        objective: objective.reference,
        intent: objective.text,
        primary: surface.primary
          ? {
              kind: "component",
              id: surface.primary.id,
              path: surface.primary.path,
            }
          : {
              kind: "non-component",
              surfaceKind: primary_surface!.kind,
              id: primary_surface!.id,
              ...(primary_surface!.path ? { path: primary_surface!.path } : {}),
            },
        references: surface.references.map((reference) => ({
          kind: "component",
          id: reference.component.id,
          path: reference.component.path,
        })),
        allowedFiles: files,
        referenceFiles: surface.files
          .filter((file) =>
            ["dependency-reference", "consumer-reference"].includes(file.role),
          )
          .map((file) => file.path),
        exclusions: exclusions ?? [],
        reuseDecision: {
          decision,
          rationale,
          selectedComponentIds: reuseDecision.selectedComponentIds,
          rejectedComponentIds: reuseDecision.rejectedComponentIds,
        },
        graph,
        sourceLedger: {
          hash: sourceLedgerHash,
          receiptIds: ledgerReceiptIds,
          decisionCount: ledgerDecisions.length,
          relationCount: ledgerRelations.length,
          receiptCount: ledgerReceiptIds.length,
          openApiAuthority,
          confirmedOperations,
        },
        handles,
        ...(invalidation_reason ? { invalidationReason: invalidation_reason } : {}),
      });
      await writeTaskCheckpoint(root_path, {
        taskId: task_id,
        expectedUpdatedAt: capsule.updatedAt,
        milestone: "batch-completed",
        objective: objective.text,
        objectiveApproved: objective.approved || risk_confirmed === true,
        objectiveReference: objective.reference,
        decisions: ledgerDecisions,
        sourceRelations: ledgerRelations,
        sourceReceiptIds: ledgerReceiptIds,
        handles,
        governance,
        covered: ["sources", "bounded context", "locked change scope"],
        remaining: ["implementation", "validation"],
        budgetChars: capsule.budget.contextChars,
        estimatedTokens: capsule.budget.estimatedTokens,
        changeSurface: locked,
        lifecyclePhase: "scoped",
        nextSafeAction: "Implement only the locked surface, then validate the diff.",
      });
      return text(
        compact(
          {
            taskId: task_id,
            status: "locked",
            risk,
            governance,
            surface: surfaceProjection(surface),
            lock: {
              id: locked.lockId,
              revision: locked.revision,
              lifecycle: "scoped",
              allowedFiles: locked.allowedFiles,
              exclusions: locked.exclusions,
              gitBaseline: locked.gitBaseline.handle,
              sourceLedgerHash: locked.evidence.sourceLedger.hash,
              evidenceHandles: locked.evidence.handles,
            },
            gate: preflight.gate,
            findings: preflight.findings,
          },
          3_000,
          handles,
        ),
      );
    },
  );

  server.registerTool(
    "atlas_validate_change",
    {
      description:
        "Validate the current local diff against the locked task, project fingerprint, reuse evidence and confirmed OpenAPI operations.",
      inputSchema: {
        root_path: z.string(),
        task_id: taskId,
      },
      annotations: {
        title: "Validate frontend change",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ root_path, task_id }) => {
      const capsule = await requireCapsule(root_path, task_id);
      const objective = await requireAuthoritativeObjective(root_path, task_id);
      if (capsule.changeInvalidation?.relockRequired) {
        throw new Error(
          "atlas_validate_change is blocked until the invalidated ChangeSurface is explicitly relocked.",
        );
      }
      if (!capsule.changeSurface || !["scoped", "validated"].includes(capsule.lifecycle.phase)) {
        throw new Error(
          "atlas_validate_change requires a persisted scoped ChangeSurface.",
        );
      }
      await scanProject(root_path, { writeArtifacts: false });
      const sourceAuthority = capsule.changeSurface.evidence.sourceLedger;
      const validation = await validateDiff(root_path, {
        changeSurface: capsule.changeSurface,
        confirmedOperations: sourceAuthority.confirmedOperations,
        requireConfirmedOperations: sourceAuthority.openApiAuthority,
      });
      await writeTaskCheckpoint(root_path, {
        taskId: task_id,
        expectedUpdatedAt: capsule.updatedAt,
        milestone: validation.blocking ? "batch-completed" : "change-validated",
        objective: objective.text,
        objectiveApproved: objective.approved,
        objectiveReference: objective.reference,
        decisions: capsuleDecisions(capsule),
        ...(capsule.sourceRelations
          ? { sourceRelations: capsule.sourceRelations }
          : {}),
        sourceReceiptIds: capsule.sourceReceiptIds,
        handles: capsule.handles,
        covered: [...capsule.scope.covered, "diff validation"].slice(-8),
        remaining: validation.blocking
          ? validation.findings
              .filter((finding) => finding.severity === "error")
              .map((finding) => finding.message)
              .slice(0, 8)
          : ["technical completion"],
        budgetChars: capsule.budget.contextChars,
        estimatedTokens: capsule.budget.estimatedTokens,
        validation: validation.blocking
          ? null
          : {
              lockId: capsule.changeSurface.lockId,
              deltaHash: validation.deltaHash,
              validatedAt: new Date().toISOString(),
            },
        ...(validation.blocking
          ? {}
          : { lifecyclePhase: "validated" as const }),
        nextSafeAction:
          validation.blocking
            ? "Fix the blocking scope or contract findings, then validate again."
            : validation.findings.length > 0
              ? "Review advisory findings, fix real regressions, then complete the technical task."
              : "Complete the technical task without writing memory.",
      });
      const errors = validation.findings.filter(
        (finding) => finding.severity === "error",
      );
      const warnings = validation.findings.filter(
        (finding) => finding.severity === "warning",
      );
      const summarizedFindings = [...errors.slice(0, 12), ...warnings.slice(0, 4)]
        .map((finding) => ({
          code: finding.code,
          severity: finding.severity,
          ...(finding.file ? { file: finding.file.slice(0, 180) } : {}),
          ...(finding.line ? { line: finding.line } : {}),
          message: finding.message.slice(0, 280),
        }));
      return text(
        compact(
          {
            taskId: task_id,
            status: validation.blocking
              ? "blocked"
              : validation.findings.length > 0
                ? "warn"
                : "pass",
            schemaVersion: validation.schemaVersion,
            deltaHash: validation.deltaHash,
            ...(validation.fingerprintHash
              ? { fingerprintHash: validation.fingerprintHash }
              : {}),
            blocking: validation.blocking,
            files: validation.files,
            additions: validation.additions,
            deletions: validation.deletions,
            renames: validation.renames,
            truncated: validation.truncated,
            ...(validation.apiValidation
              ? { apiValidation: validation.apiValidation }
              : {}),
            findingCounts: {
              errors: errors.length,
              warnings: warnings.length,
              omittedErrors: Math.max(0, errors.length - 12),
              omittedWarnings: Math.max(0, warnings.length - 4),
            },
            findings: summarizedFindings,
            changedFiles: validation.changedFiles.slice(0, 12).map((entry) => ({
              path: entry.path,
              status: entry.status,
              staged: entry.staged,
              unstaged: entry.unstaged,
              untracked: entry.untracked,
            })),
            changedFilesOmitted: Math.max(
              0,
              validation.changedFiles.length - 12,
            ),
            nextAction: validation.blocking
              ? "Fix every blocking finding; omittedErrors reports any additional errors requiring another validation pass."
              : validation.findings.length > 0
                ? "Review warnings, then complete against this unchanged delta."
                : validation.apiValidation
                  ? "Direct literal API calls passed. Cover wrappers, SDK methods and variable-derived paths with focused tests or generated-client checks, then complete against this unchanged delta."
                  : "Complete against this unchanged delta.",
          },
          3_000,
        ),
      );
    },
  );

  registerCoreLifecycleTools(server);
}
