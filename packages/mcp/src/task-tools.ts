import { randomUUID } from "node:crypto";
import {
  assessTaskRisk,
  normalizeTaskSourceDecisions,
  normalizeTaskSourceRelations,
} from "@component-atlas/core";
import {
  expandSourceReceipt,
  checkBeforeChange,
  prepareTaskContext,
  loadTaskResumeTransport,
  taskContextResumeHandles,
  writeTaskExecutionManifest,
  writeTaskCheckpoint,
} from "@component-atlas/runtime";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  taskSourceDecisionSchema,
  taskSourceRelationSchema,
  text,
} from "./shared.js";

export function registerTaskTools(server: McpServer): void {
  server.tool(
    "get_task_context",
    "After task/source intake clears, build one hard-capped bundle of handles and receipt IDs. No index or receipt bodies are injected.",
    {
      root_path: z.string(),
      task: z.string().min(1),
      task_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/u).optional(),
      figma_file: z.string().optional(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
      top_k: z.number().int().min(1).max(10).optional(),
      refresh_memory: z.boolean().optional(),
      selected_handles: z
        .array(z.string().regex(/^(?:code|design|memory):[^\u0000-\u001f]{1,240}$/u))
        .max(8)
        .optional(),
      objective_confirmed: z.boolean().optional(),
      source_decisions: z.array(taskSourceDecisionSchema).max(12).optional(),
      source_relations: z.array(taskSourceRelationSchema).max(12).optional(),
    },
    async ({
      root_path,
      task,
      task_id,
      figma_file,
      budget_chars,
      top_k,
      refresh_memory,
      selected_handles,
      objective_confirmed,
      source_decisions,
      source_relations,
    }) => {
      const resolvedTaskId = task_id ?? `task-${randomUUID()}`;
      const decisions = normalizeTaskSourceDecisions(source_decisions ?? []);
      const relations = normalizeTaskSourceRelations(
        source_relations ?? [],
        decisions,
      );
      const budgetChars = budget_chars ?? 4_200;
      await writeTaskCheckpoint(root_path, {
        taskId: resolvedTaskId,
        milestone: "risk-boundary",
        objective: task,
        objectiveApproved: objective_confirmed ?? false,
        decisions,
        sourceRelations: relations,
        sourceReceiptIds: [],
        handles: selected_handles ?? [],
        covered: ["task intake"],
        remaining: ["source preflight", "bounded context"],
        budgetChars,
        nextSafeAction:
          "Run the source gate before composing bounded task context.",
      });
      try {
        const context = await prepareTaskContext(
          root_path,
          {
            schemaVersion: 1,
            scope: "task",
            objective: task,
            objectiveConfirmed: objective_confirmed ?? false,
            risk: assessTaskRisk(task),
            sources: decisions,
            relations,
          },
          {
            ...(figma_file ? { figmaFile: figma_file } : {}),
            ...(budget_chars ? { budgetChars: budget_chars } : {}),
            ...(top_k ? { topK: top_k } : {}),
            ...(refresh_memory ? { refreshMemory: true } : {}),
            ...(selected_handles ? { selectedHandles: selected_handles } : {}),
            taskId: resolvedTaskId,
            sourceLedgerHash: JSON.stringify({
              decisions: decisions.map((decision) => [
                decision.id,
                decision.state,
                decision.reference,
                decision.authorityRole,
                decision.routePolicy,
              ]),
              relations,
            }),
          },
        );
        await writeTaskCheckpoint(root_path, {
          taskId: resolvedTaskId,
          milestone:
            context.sourceReceiptIds.length > 0
              ? "source-resolved"
              : "batch-completed",
          objective: task,
          objectiveApproved: objective_confirmed ?? false,
          decisions,
          sourceRelations: relations,
          sourceReceiptIds: context.sourceReceiptIds,
          handles: taskContextResumeHandles(context),
          covered: ["task intake", "source preflight", "bounded context"],
          remaining: ["implementation", "validation"],
          budgetChars: context.metrics.budgetChars,
          estimatedTokens: context.metrics.estimatedTokens,
          nextSafeAction:
            "Expand only the required handles or receipt IDs, then run check_before_change.",
        });
        return text({ ...context, taskId: resolvedTaskId });
      } catch (error) {
        await writeTaskCheckpoint(root_path, {
          taskId: resolvedTaskId,
          status: "blocked",
          milestone: "blocked",
          objective: task,
          objectiveApproved: objective_confirmed ?? false,
          decisions,
          sourceRelations: relations,
          sourceReceiptIds: [],
          handles: selected_handles ?? [],
          covered: ["task intake"],
          remaining: [
            error instanceof Error ? error.message : "Task preparation blocked.",
          ],
          budgetChars,
          nextSafeAction:
            "Resolve the blocking source or decision, then retry with the same task_id.",
        }).catch(() => undefined);
        throw error;
      }
    },
  );

  server.tool(
    "expand_source_receipt",
    "Expand one SourceReceipt by immutable ID under a hard budget. Task context returns only these IDs.",
    {
      root_path: z.string(),
      receipt_id: z.string().regex(/^receipt-[a-f0-9]{16}$/u),
      budget_chars: z.number().int().min(800).max(3000).optional(),
    },
    async ({ root_path, receipt_id, budget_chars }) =>
      text(await expandSourceReceipt(root_path, receipt_id, budget_chars)),
  );

  server.tool(
    "register_task_manifest",
    "Register skill/reference/script digests and retrieval keys once for a task. Bodies stay out of the manifest and resumed context.",
    {
      root_path: z.string(),
      task_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/u),
      objective_hash: z.string().regex(/^[a-f0-9]{16,64}$/u),
      source_ledger_hash: z.string().regex(/^[a-f0-9]{16,64}$/u),
      skills: z
        .array(
          z.object({
            id: z.string().min(1).max(120),
            digest: z.string().regex(/^[a-f0-9]{16,64}$/u),
            phase: z.enum([
              "intake",
              "design",
              "implementation",
              "validation",
              "closeout",
            ]),
          }),
        )
        .max(12),
      references: z
        .array(
          z.object({
            id: z.string().min(1).max(160),
            digest: z.string().regex(/^[a-f0-9]{16,64}$/u),
            phase: z.enum([
              "intake",
              "design",
              "implementation",
              "validation",
              "closeout",
            ]),
          }),
        )
        .max(24)
        .optional(),
      scripts: z
        .array(
          z.object({
            id: z.string().min(1).max(160),
            interface_version: z.string().min(1).max(40),
            digest: z.string().regex(/^[a-f0-9]{16,64}$/u),
          }),
        )
        .max(12)
        .optional(),
      retrieval_keys: z.array(z.string().max(160)).max(24).optional(),
    },
    async ({
      root_path,
      task_id,
      objective_hash,
      source_ledger_hash,
      skills,
      references,
      scripts,
      retrieval_keys,
    }) =>
      text(
        await writeTaskExecutionManifest(root_path, {
          taskId: task_id,
          objectiveHash: objective_hash,
          sourceLedgerHash: source_ledger_hash,
          skills,
          references: references ?? [],
          scripts: (scripts ?? []).map((script) => ({
            id: script.id,
            interfaceVersion: script.interface_version,
            digest: script.digest,
          })),
          retrievalKeys: retrieval_keys ?? [],
          invalidatesOn: [
            "checkout-change",
            "head-change",
            "objective-change",
            "source-ledger-change",
          ],
        }),
      ),
  );

  server.tool(
    "resume_task_capsule",
    "Load only the bounded task checkpoint transport after compaction/resume; expand referenced IDs separately on demand.",
    {
      root_path: z.string(),
      task_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/u),
    },
    async ({ root_path, task_id }) =>
      text(
        (await loadTaskResumeTransport(root_path, task_id)) ?? {
          status: "not-found",
        },
      ),
  );

  server.tool(
    "checkpoint_task",
    "Persist one compact semantic milestone for compaction-safe resume. Do not call after every action; receipt and handle bodies stay out of the capsule.",
    {
      root_path: z.string(),
      task_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/u),
      status: z.enum(["active", "blocked", "completed"]).optional(),
      milestone: z.enum([
        "objective-approved",
        "decision-confirmed",
        "source-resolved",
        "batch-completed",
        "change-validated",
        "blocked",
        "risk-boundary",
        "completed",
      ]),
      objective: z.string().min(1).max(6_000),
      objective_approved: z.boolean(),
      source_decisions: z.array(taskSourceDecisionSchema).max(12).optional(),
      source_relations: z.array(taskSourceRelationSchema).max(12).optional(),
      source_receipt_ids: z
        .array(z.string().regex(/^receipt-[a-f0-9]{16}$/u))
        .max(20)
        .optional(),
      handles: z
        .array(
          z.string().regex(
            /^(?:(?:code|design|memory):[^\u0000-\u001f]{1,240}|manifest:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{16}|retrieval:[A-Za-z0-9_.:-]{1,160}:[a-z-]{2,32}:[a-f0-9]{16})$/u,
          ),
        )
        .max(8)
        .optional(),
      execution_manifest: z
        .object({
          handle: z
            .string()
            .regex(/^manifest:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{16}$/u),
          hash: z.string().regex(/^[a-f0-9]{16,64}$/u),
          source_ledger_hash: z.string().regex(/^[a-f0-9]{16,64}$/u),
          retrieval_budget_id: z
            .string()
            .regex(/^retrieval-budget:[A-Za-z0-9_.:-]{1,160}$/u),
        })
        .optional(),
      active_policy: z
        .object({
          visual_mode: z.enum(["fidelity", "inherit", "explore"]).optional(),
          invention_budget: z.union([
            z.literal(0),
            z.literal(1),
            z.literal(2),
            z.literal(3),
          ]).optional(),
          excluded_surfaces: z.array(z.string().max(80)).max(6).optional(),
          auth_mode: z.enum(["real", "dev-mock-no-session"]).optional(),
          auth_mock_guard: z
            .object({
              schema_version: z.literal(1),
              mode: z.literal("dev-mock-no-session"),
              adapter_id: z.string().regex(/^[A-Za-z0-9._-]{1,120}$/u),
              environment: z.enum(["development", "test"]),
              challenge_only: z.literal(true),
              profile_flow_untouched: z.literal(true),
              accepts_real_credentials: z.literal(false),
              reads_existing_session: z.literal(false),
              creates_session: z.literal(false),
              issues_tokens: z.literal(false),
              writes_auth_cookies: z.literal(false),
              production_enabled: z.literal(false),
            })
            .optional(),
        })
        .optional(),
      covered: z.array(z.string().max(240)).max(8).optional(),
      remaining: z.array(z.string().max(240)).max(8).optional(),
      budget_chars: z.number().int().min(800).max(12_000),
      estimated_tokens: z.number().int().min(0).max(100_000).optional(),
      next_safe_action: z.string().min(1).max(500),
    },
    async ({
      root_path,
      task_id,
      status,
      milestone,
      objective,
      objective_approved,
      source_decisions,
      source_relations,
      source_receipt_ids,
      handles,
      execution_manifest,
      active_policy,
      covered,
      remaining,
      budget_chars,
      estimated_tokens,
      next_safe_action,
    }) => {
      const decisions = normalizeTaskSourceDecisions(source_decisions ?? []);
      const capsule = await writeTaskCheckpoint(root_path, {
        taskId: task_id,
        ...(status ? { status } : {}),
        milestone,
        objective,
        objectiveApproved: objective_approved,
        decisions,
        sourceRelations: normalizeTaskSourceRelations(
          source_relations ?? [],
          decisions,
        ),
        sourceReceiptIds: source_receipt_ids ?? [],
        handles: handles ?? [],
        ...(execution_manifest
          ? {
              executionManifest: {
                handle: execution_manifest.handle,
                hash: execution_manifest.hash,
                sourceLedgerHash: execution_manifest.source_ledger_hash,
                retrievalBudgetId: execution_manifest.retrieval_budget_id,
              },
            }
          : {}),
        ...(active_policy
          ? {
              activePolicy: {
                ...(active_policy.visual_mode
                  ? { visualMode: active_policy.visual_mode }
                  : {}),
                ...(active_policy.invention_budget !== undefined
                  ? { inventionBudget: active_policy.invention_budget }
                  : {}),
                ...(active_policy.excluded_surfaces
                  ? { excludedSurfaces: active_policy.excluded_surfaces }
                  : {}),
                ...(active_policy.auth_mode
                  ? { authMode: active_policy.auth_mode }
                  : {}),
                ...(active_policy.auth_mock_guard
                  ? {
                      authMockGuard: {
                        schemaVersion:
                          active_policy.auth_mock_guard.schema_version,
                        mode: active_policy.auth_mock_guard.mode,
                        adapterId: active_policy.auth_mock_guard.adapter_id,
                        environment:
                          active_policy.auth_mock_guard.environment,
                        challengeOnly:
                          active_policy.auth_mock_guard.challenge_only,
                        profileFlowUntouched:
                          active_policy.auth_mock_guard
                            .profile_flow_untouched,
                        acceptsRealCredentials:
                          active_policy.auth_mock_guard
                            .accepts_real_credentials,
                        readsExistingSession:
                          active_policy.auth_mock_guard
                            .reads_existing_session,
                        createsSession:
                          active_policy.auth_mock_guard.creates_session,
                        issuesTokens:
                          active_policy.auth_mock_guard.issues_tokens,
                        writesAuthCookies:
                          active_policy.auth_mock_guard
                            .writes_auth_cookies,
                        productionEnabled:
                          active_policy.auth_mock_guard
                            .production_enabled,
                      },
                    }
                  : {}),
              },
            }
          : {}),
        covered: covered ?? [],
        remaining: remaining ?? [],
        budgetChars: budget_chars,
        ...(estimated_tokens !== undefined ? { estimatedTokens: estimated_tokens } : {}),
        nextSafeAction: next_safe_action,
      });
      return text({
        taskId: capsule.taskId,
        status: capsule.status,
        milestone,
        updatedAt: capsule.updatedAt,
        nextSafeAction: capsule.nextSafeAction,
      });
    },
  );

  server.tool(
    "check_before_change",
    "Run the project-memory gate before editing: current contradictions, stale rules, fragile areas, and failed attempts with evidence and recommendations.",
    {
      root_path: z.string(),
      intent: z.string().min(1),
      files: z.array(z.string()).optional(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({ root_path, intent, files, budget_chars }) =>
      text(
        await checkBeforeChange(root_path, intent, {
          ...(files ? { files } : {}),
          ...(budget_chars ? { budgetChars: budget_chars } : {}),
        }),
      ),
  );
}
