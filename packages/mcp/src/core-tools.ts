import { randomUUID } from "node:crypto";
import {
  assessTaskRisk,
  buildChangeSurface,
  buildComponentContext,
  classifyTaskSource,
  defaultTaskSourceAuthorityRole,
  defaultTaskSourceRoutePolicy,
  detectTaskSources,
  ensureTaskSourceDecisions,
  isMissingTaskSourceReference,
  normalizeTaskSourceDecisions,
  type DecisionKind,
  type TaskRiskAssessment,
  type TaskSourceDecision,
} from "@component-atlas/core";
import {
  checkBeforeChange,
  expandSourceReceipt,
  fitBudgetedResponse,
  getProjectMemoryItem,
  inspectFigmaDesignNode,
  listFigmaDesignIndexes,
  loadProjectGraph,
  loadTaskExecutionManifest,
  loadTaskResumeCapsule,
  loadTaskResumeTransport,
  loadTaskRetrievalResult,
  prepareTaskContext,
  proposeMemoryUpdate,
  recordDecision,
  recordProjectOutcome,
  scanProject,
  taskContextResumeHandles,
  validateDiff,
  writeTaskCheckpoint,
} from "@component-atlas/runtime";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { text } from "./shared.js";

const taskId = z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/u);
const sourceKind = z.enum([
  "jira",
  "confluence",
  "figma",
  "github",
  "openapi",
  "other",
]);
const sourceInput = z.object({
  reference: z.string().min(1).max(1_000),
  kind: sourceKind.optional(),
  state: z.enum(["confirmed", "omitted", "unavailable"]).optional(),
  required: z.boolean().optional(),
});
const confirmedOperation = z.object({
  method: z.string().min(1).max(16),
  path: z.string().min(1).max(500),
  operation_id: z.string().max(200).optional(),
});

const rank: Record<TaskRiskAssessment["level"], number> = {
  low: 0,
  medium: 1,
  high: 2,
};

function mergedObjective(prior: string | undefined, update: string): string {
  const next = update.trim();
  if (!prior || prior.trim() === next || prior.includes(`Update: ${next}`)) {
    return prior?.trim() || next;
  }
  return `${prior.trim()}\nUpdate: ${next}`.slice(0, 6_000);
}

function capsuleDecisions(
  capsule: Awaited<ReturnType<typeof loadTaskResumeCapsule>>,
): TaskSourceDecision[] {
  if (!capsule) return [];
  return normalizeTaskSourceDecisions(
    capsule.decisions
      .filter((decision) => !isMissingTaskSourceReference(decision.reference))
      .map((decision) => ({
        ...decision,
        origin: "manual",
        relationship: "primary",
        authorityRole:
          decision.authorityRole ??
          defaultTaskSourceAuthorityRole(decision.kind),
        routePolicy:
          decision.routePolicy ??
          defaultTaskSourceRoutePolicy(decision.kind, decision.reference),
      })),
  );
}

function normalizedSources(
  objective: string,
  prior: TaskSourceDecision[],
  supplied: Array<z.infer<typeof sourceInput>>,
): TaskSourceDecision[] {
  const explicit = supplied.map((source) => {
    const kind = source.kind ?? classifyTaskSource(source.reference);
    return {
      kind,
      reference: source.reference,
      origin: "explicit" as const,
      state: source.state ?? ("confirmed" as const),
      required: source.required ?? false,
      relationship: "primary" as const,
      authorityRole: defaultTaskSourceAuthorityRole(kind),
      routePolicy: defaultTaskSourceRoutePolicy(kind, source.reference),
    };
  });
  const detected = detectTaskSources(objective).map((source) => ({
    ...source,
    state: source.origin === "explicit" ? ("confirmed" as const) : source.state,
  }));
  const merged = new Map(
    [...prior, ...detected, ...normalizeTaskSourceDecisions(explicit)].map(
      (source) => [source.id, source],
    ),
  );
  return ensureTaskSourceDecisions(objective, [...merged.values()]).filter(
    (source) => !isMissingTaskSourceReference(source.reference),
  );
}

function compact<T extends Record<string, unknown>>(
  value: T,
  budgetChars: number,
  expandableIds: string[] = [],
) {
  return fitBudgetedResponse(value, {
    budgetChars,
    totalMatches: expandableIds.length,
    expandableIds,
    preserveKeys: ["taskId", "risk", "status", "gate", "findings"],
  });
}

async function requireCapsule(rootPath: string, id: string) {
  const capsule = await loadTaskResumeCapsule(rootPath, id);
  if (!capsule) throw new Error(`Task ${id} has no Project Atlas capsule.`);
  return capsule;
}

export function registerCoreTools(server: McpServer): void {
  server.registerTool(
    "atlas_prepare_task",
    {
      description:
        "Prepare one bounded frontend task: refresh the local graph, resolve only declared sources, rank reuse and return resumable handles.",
      inputSchema: {
        root_path: z.string(),
        objective: z.string().min(1).max(6_000),
        task_id: taskId.optional(),
        objective_confirmed: z.boolean().optional(),
        sources: z.array(sourceInput).max(12).optional(),
        selected_handles: z.array(z.string().max(260)).max(8).optional(),
        budget_chars: z.number().int().min(1_600).max(3_600).optional(),
      },
      annotations: {
        title: "Prepare frontend task",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      root_path,
      objective,
      task_id,
      objective_confirmed,
      sources,
      selected_handles,
      budget_chars,
    }) => {
      const id = task_id ?? `task-${randomUUID()}`;
      const prior = task_id
        ? await loadTaskResumeCapsule(root_path, task_id)
        : undefined;
      const effectiveObjective = mergedObjective(
        prior?.objective.text,
        objective,
      );
      const priorRisk = assessTaskRisk(prior?.objective.text ?? objective);
      const risk = assessTaskRisk(effectiveObjective);
      const approved =
        Boolean(objective_confirmed) ||
        (Boolean(prior?.objective.approved) && rank[risk.level] <= rank[priorRisk.level]);
      const decisions = normalizedSources(
        effectiveObjective,
        capsuleDecisions(prior),
        sources ?? [],
      );
      const budget = budget_chars ?? 3_600;
      await scanProject(root_path, { writeArtifacts: false });
      try {
        const context = await prepareTaskContext(
          root_path,
          {
            schemaVersion: 1,
            scope: "task",
            objective: effectiveObjective,
            objectiveConfirmed: approved,
            risk,
            sources: decisions,
          },
          {
            budgetChars: Math.max(1_600, budget - 280),
            topK: 3,
            taskId: id,
            ...(selected_handles ? { selectedHandles: selected_handles } : {}),
          },
        );
        const handles = taskContextResumeHandles(context);
        await writeTaskCheckpoint(root_path, {
          taskId: id,
          milestone:
            context.sourceReceiptIds.length > 0
              ? "source-resolved"
              : "batch-completed",
          objective: effectiveObjective,
          objectiveApproved: approved,
          decisions,
          sourceReceiptIds: context.sourceReceiptIds,
          handles,
          covered: ["repository orientation", "source gate", "bounded context"],
          remaining: ["lock change scope", "implementation", "validation"],
          budgetChars: budget,
          estimatedTokens: context.metrics.estimatedTokens,
          nextSafeAction:
            "Expand only a named unresolved handle, then lock the change scope.",
        });
        return text(
          compact(
            {
              ...context,
              taskId: id,
              risk,
              status: "ready",
            },
            budget,
            handles,
          ),
        );
      } catch (error) {
        await writeTaskCheckpoint(root_path, {
          taskId: id,
          status: "blocked",
          milestone: "blocked",
          objective: effectiveObjective,
          objectiveApproved: approved,
          decisions,
          sourceReceiptIds: [],
          handles: selected_handles ?? [],
          covered: ["repository orientation", "source gate"],
          remaining: [error instanceof Error ? error.message : String(error)],
          budgetChars: budget,
          nextSafeAction:
            "Resolve only the required source or objective decision named by the blocker.",
        });
        throw error;
      }
    },
  );

  server.registerTool(
    "atlas_expand_context",
    {
      description:
        "Expand exactly one code, design, memory, receipt, retrieval or manifest handle under a hard budget.",
      inputSchema: {
        root_path: z.string(),
        handle: z.string().min(1).max(320),
        response_format: z.enum(["concise", "detailed"]).optional(),
      },
      annotations: {
        title: "Expand Atlas context",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ root_path, handle, response_format }) => {
      const budget = response_format === "detailed" ? 3_000 : 1_600;
      if (/^receipt-[a-f0-9]{16}$/u.test(handle)) {
        return text(await expandSourceReceipt(root_path, handle, budget));
      }
      if (handle.startsWith("code:")) {
        const graph = await loadProjectGraph(root_path);
        return text(
          compact(
            buildComponentContext(graph, handle.slice(5)) as unknown as Record<
              string,
              unknown
            >,
            budget,
          ),
        );
      }
      if (handle.startsWith("memory:")) {
        return text(
          await getProjectMemoryItem(root_path, handle.slice(7), {
            budgetChars: budget,
          }),
        );
      }
      if (handle.startsWith("design:")) {
        const selector = handle.slice(7);
        const separator = selector.indexOf("::");
        const requestedFile = separator > 0 ? selector.slice(0, separator) : undefined;
        const node = separator > 0 ? selector.slice(separator + 2) : selector;
        const indexes = await listFigmaDesignIndexes(root_path);
        const matches = [];
        for (const index of indexes.filter(
          (candidate) => !requestedFile || candidate.file.key === requestedFile,
        )) {
          try {
            matches.push(
              await inspectFigmaDesignNode(root_path, index.file.key, node),
            );
          } catch {
            // Continue until the stable node identity is found in one index.
          }
        }
        if (matches.length !== 1) {
          throw new Error(
            matches.length === 0
              ? `Design handle ${handle} was not found.`
              : `Design handle ${handle} is ambiguous; include fileKey::nodeId.`,
          );
        }
        return text(
          compact(
            matches[0] as unknown as Record<string, unknown>,
            budget,
          ),
        );
      }
      if (handle.startsWith("retrieval:")) {
        const value = await loadTaskRetrievalResult(root_path, handle);
        return text(
          compact(
            { result: value },
            budget,
          ),
        );
      }
      if (handle.startsWith("manifest:")) {
        return text(
          compact(
            {
              manifest: await loadTaskExecutionManifest(root_path, handle),
            },
            budget,
          ),
        );
      }
      throw new Error(
        "Use a code:, design:, memory:, retrieval:, manifest: or receipt-* handle.",
      );
    },
  );

  server.registerTool(
    "atlas_lock_change_scope",
    {
      description:
        "Lock one primary component, up to two references and explicit exclusions; return bounded files, API, impact and pre-change findings.",
      inputSchema: {
        root_path: z.string(),
        task_id: taskId,
        primary_component: z.string().max(260).optional(),
        reference_components: z.array(z.string().max(260)).max(2).optional(),
        exclusions: z.array(z.string().max(260)).max(8).optional(),
      },
      annotations: {
        title: "Lock frontend change scope",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      root_path,
      task_id,
      primary_component,
      reference_components,
      exclusions,
    }) => {
      const capsule = await requireCapsule(root_path, task_id);
      const graph = await loadProjectGraph(root_path);
      const surface = buildChangeSurface(graph, capsule.objective.text, {
        ...(primary_component ? { primaryComponent: primary_component } : {}),
        ...(reference_components
          ? { secondaryComponents: reference_components }
          : {}),
        ...(exclusions ? { outOfScope: exclusions } : {}),
      });
      const files = surface.files.map((file) => file.path);
      const preflight = await checkBeforeChange(
        root_path,
        capsule.objective.text,
        { files, budgetChars: 1_600 },
      );
      const handles = [
        ...capsule.handles,
        ...(surface.primary ? [`code:${surface.primary.id}`] : []),
        ...surface.references.map((item) => `code:${item.component.id}`),
      ].filter((item, index, list) => list.indexOf(item) === index).slice(0, 8);
      await writeTaskCheckpoint(root_path, {
        taskId: task_id,
        milestone: "batch-completed",
        objective: capsule.objective.text,
        objectiveApproved: capsule.objective.approved,
        decisions: capsuleDecisions(capsule),
        ...(capsule.sourceRelations
          ? { sourceRelations: capsule.sourceRelations }
          : {}),
        sourceReceiptIds: capsule.sourceReceiptIds,
        handles,
        covered: ["sources", "bounded context", "locked change scope"],
        remaining: ["implementation", "validation"],
        budgetChars: capsule.budget.contextChars,
        estimatedTokens: capsule.budget.estimatedTokens,
        nextSafeAction: "Implement only the locked surface, then validate the diff.",
      });
      return text(
        compact(
          {
            taskId: task_id,
            status: "locked",
            risk: assessTaskRisk(capsule.objective.text),
            surface,
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
        confirmed_operations: z.array(confirmedOperation).max(100).optional(),
      },
      annotations: {
        title: "Validate frontend change",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ root_path, task_id, confirmed_operations }) => {
      const capsule = await requireCapsule(root_path, task_id);
      const validation = await validateDiff(root_path, {
        ...(confirmed_operations
          ? {
              confirmedOperations: confirmed_operations.map((operation) => ({
                method: operation.method.toUpperCase(),
                path: operation.path,
                ...(operation.operation_id
                  ? { operationId: operation.operation_id }
                  : {}),
              })),
            }
          : {}),
      });
      await writeTaskCheckpoint(root_path, {
        taskId: task_id,
        milestone: "change-validated",
        objective: capsule.objective.text,
        objectiveApproved: capsule.objective.approved,
        decisions: capsuleDecisions(capsule),
        ...(capsule.sourceRelations
          ? { sourceRelations: capsule.sourceRelations }
          : {}),
        sourceReceiptIds: capsule.sourceReceiptIds,
        handles: capsule.handles,
        covered: [...capsule.scope.covered, "diff validation"].slice(-8),
        remaining: ["record outcome"],
        budgetChars: capsule.budget.contextChars,
        estimatedTokens: capsule.budget.estimatedTokens,
        nextSafeAction:
          validation.findings.length > 0
            ? "Review the advisory findings, fix real regressions, then validate again."
            : "Record the verified task outcome.",
      });
      return text({
        taskId: task_id,
        status: validation.findings.length > 0 ? "warn" : "pass",
        ...validation,
      });
    },
  );

  server.registerTool(
    "atlas_task_state",
    {
      description:
        "Resume one compact task capsule or save a semantic checkpoint/blocker without repeating the objective and source ledger.",
      inputSchema: {
        root_path: z.string(),
        task_id: taskId,
        action: z.enum(["resume", "checkpoint", "block"]),
        milestone: z
          .enum(["source-resolved", "batch-completed", "change-validated"])
          .optional(),
        covered: z.array(z.string().max(240)).max(8).optional(),
        remaining: z.array(z.string().max(240)).max(8).optional(),
        next_action: z.string().min(1).max(500).optional(),
      },
      annotations: {
        title: "Read or save task state",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
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
    }) => {
      if (action === "resume") {
        return text(
          (await loadTaskResumeTransport(root_path, task_id)) ?? {
            status: "not-found",
            taskId: task_id,
          },
        );
      }
      const capsule = await requireCapsule(root_path, task_id);
      const blocked = action === "block";
      const saved = await writeTaskCheckpoint(root_path, {
        taskId: task_id,
        status: blocked ? "blocked" : "active",
        milestone: blocked ? "blocked" : (milestone ?? "batch-completed"),
        objective: capsule.objective.text,
        objectiveApproved: capsule.objective.approved,
        decisions: capsuleDecisions(capsule),
        ...(capsule.sourceRelations
          ? { sourceRelations: capsule.sourceRelations }
          : {}),
        sourceReceiptIds: capsule.sourceReceiptIds,
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
    "atlas_record_outcome",
    {
      description:
        "Close one task with verification and an idempotent reuse decision; optionally create one review-only durable-memory proposal.",
      inputSchema: {
        root_path: z.string(),
        task_id: taskId,
        result: z.enum(["success", "failure", "partial"]),
        summary: z.string().min(1).max(2_000),
        verification: z.array(z.string().max(500)).max(12),
        decision: z.enum([
          "reuse",
          "extend",
          "compose",
          "extract-and-reuse",
          "create",
        ]),
        rationale: z.string().min(1).max(1_500),
        selected_component_ids: z.array(z.string().max(260)).max(8).optional(),
        rejected_component_ids: z.array(z.string().max(260)).max(8).optional(),
        files: z.array(z.string().max(500)).max(100).optional(),
        memory_candidate: z
          .object({
            type: z
              .enum([
                "decision",
                "constraint",
                "convention",
                "integration",
                "known-issue",
                "note",
              ])
              .optional(),
            title: z.string().min(1).max(160),
            summary: z.string().min(1).max(1_000),
            confidence: z.number().min(0).max(1).optional(),
          })
          .optional(),
      },
      annotations: {
        title: "Record frontend task outcome",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      root_path,
      task_id,
      result,
      summary,
      verification,
      decision,
      rationale,
      selected_component_ids,
      rejected_component_ids,
      files,
      memory_candidate,
    }) => {
      const capsule = await requireCapsule(root_path, task_id);
      const componentDecision = await recordDecision({
        rootPath: root_path,
        taskId: task_id,
        intent: capsule.objective.text,
        decision: decision as DecisionKind,
        selectedComponentIds: selected_component_ids ?? [],
        rejectedComponentIds: rejected_component_ids ?? [],
        rationale,
      });
      const outcome = await recordProjectOutcome({
        rootPath: root_path,
        taskId: task_id,
        task: capsule.objective.text,
        result,
        summary,
        evidence: verification,
        relatedEntityIds: [
          componentDecision.id,
          ...(selected_component_ids ?? []),
        ],
        ...(files ? { files } : {}),
        budgetChars: 1_600,
      });
      const proposal = memory_candidate
        ? await proposeMemoryUpdate({
            rootPath: root_path,
            rationale: `Durable candidate from task ${task_id}: ${rationale}`,
            evidence: verification,
            items: [
              {
                type: memory_candidate.type ?? "note",
                title: memory_candidate.title,
                summary: memory_candidate.summary,
                confidence: memory_candidate.confidence ?? 0.8,
                authority: result === "success" ? "verified" : "observed",
                scope: "local",
                relations: [
                  { kind: "related_to", targetId: componentDecision.id },
                ],
              },
            ],
            budgetChars: 1_600,
          })
        : undefined;
      await writeTaskCheckpoint(root_path, {
        taskId: task_id,
        status: "completed",
        milestone: "completed",
        objective: capsule.objective.text,
        objectiveApproved: capsule.objective.approved,
        decisions: capsuleDecisions(capsule),
        ...(capsule.sourceRelations
          ? { sourceRelations: capsule.sourceRelations }
          : {}),
        sourceReceiptIds: capsule.sourceReceiptIds,
        handles: capsule.handles,
        covered: [...capsule.scope.covered, "outcome recorded"].slice(-8),
        remaining: [],
        budgetChars: capsule.budget.contextChars,
        estimatedTokens: capsule.budget.estimatedTokens,
        nextSafeAction: "Task complete; review any memory proposal in the GUI.",
      });
      return text(
        compact(
          {
            taskId: task_id,
            status: "completed",
            result,
            decision: componentDecision,
            outcome,
            ...(proposal ? { memoryProposal: proposal } : {}),
          },
          3_000,
          [componentDecision.id],
        ),
      );
    },
  );
}
