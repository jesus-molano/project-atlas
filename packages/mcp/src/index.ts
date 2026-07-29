#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  assessTaskRisk,
  assertSourceReceiptMatchesDecision,
  buildChangeSurface,
  buildComponentContext,
  buildImpactContext,
  buildReuseContext,
  buildSimilarityContext,
  componentContextLink,
  componentContextReference,
  componentImpact,
  createSourceReceipt,
  findComponent,
  normalizeTaskSourceDecisions,
  normalizeTaskSourceRelations,
  searchComponentContext,
  searchComponents,
  sourceIdentityFromReference,
  similarComponents,
  type ComponentGraph,
  type ComponentNode,
  type DecisionKind,
} from "@component-atlas/core";
import {
  captureFigmaAsset,
  findTaskDesignCandidates,
  fitBudgetedResponse,
  getFigmaDesignVariables,
  getProjectMemoryItem,
  getProjectCapabilities,
  getTaskContext,
  expandSourceReceipt,
  graphSummary,
  indexProjectMemory,
  inspectFigmaDesignNode,
  listFigmaDesignIndexes,
  loadFigmaAssetMetadata,
  loadTaskRetrievalResult,
  loadProjectGraph,
  mapFigmaDesign,
  materializeFigmaAsset,
  applyMemoryUpdate,
  checkBeforeChange,
  orientProject,
  prepareTaskContext,
  proposeMemoryUpdate,
  purgeExpiredFigmaAssets,
  recordDecision,
  recordProjectOutcome,
  recordTaskEvaluation,
  loadTaskResumeTransport,
  loadConfirmedTaskSourceDecision,
  claimTaskRetrieval,
  changeSurfaceRetrievalKey,
  completeTaskRetrieval,
  reuseRetrievalKey,
  reportProjectCapabilities,
  scanProject,
  searchProjectMemory,
  syncFigmaDesignVariables,
  taskContextResumeHandles,
  writeTaskExecutionManifest,
  writeTaskCheckpoint,
  type MapFigmaDesignInput,
} from "@component-atlas/runtime";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const taskSourceDecisionSchema = z.object({
  id: z.string().optional(),
  kind: z.enum([
    "jira",
    "confluence",
    "figma",
    "github",
    "openapi",
    "other",
  ]),
  reference: z.string(),
  origin: z.enum(["explicit", "inferred", "manual"]),
  state: z.enum([
    "pending",
    "confirmed",
    "omitted",
    "unavailable",
    "replaced",
  ]),
  required: z.boolean(),
  replacementFor: z.string().optional(),
  parentSourceId: z.string().optional(),
  relationship: z
    .enum(["primary", "search-candidate", "linked-secondary"])
    .optional(),
  authorityRole: z
    .enum([
      "requirement",
      "visual",
      "contract",
      "implementation-reference",
    ])
    .optional(),
  routePolicy: z
    .object({
      primaryAdapter: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/u),
      fallback: z.enum(["deny", "ask", "allow-list"]),
      allowedFallbackAdapters: z
        .array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/u))
        .max(8)
        .optional(),
    })
    .optional(),
  decidedAt: z.string().optional(),
});

const taskSourceRelationSchema = z.object({
  id: z.string().optional(),
  fromSourceId: z.string().max(160),
  toSourceId: z.string().max(160),
  kind: z.enum([
    "references-design",
    "constrains-contract",
    "secondary-implementation-reference",
  ]),
  targetScope: z
    .object({
      provider: z.enum([
        "jira",
        "confluence",
        "figma",
        "github",
        "openapi",
        "other",
      ]),
      kind: z.enum([
        "file",
        "page",
        "node",
        "selection",
        "operation",
        "unknown",
      ]),
      id: z.string().min(1).max(500),
    })
    .optional(),
  confirmedAt: z.string().datetime().optional(),
});

function text(value: unknown) {
  const serialized = JSON.stringify(value) ?? "null";
  const jsonValue = JSON.parse(serialized) as unknown;
  const structuredContent =
    jsonValue !== null && typeof jsonValue === "object" && !Array.isArray(jsonValue)
      ? (jsonValue as Record<string, unknown>)
      : Array.isArray(jsonValue)
        ? { items: jsonValue }
        : { value: jsonValue };
  return {
    content: [
      {
        type: "text" as const,
        text:
          jsonValue &&
          typeof jsonValue === "object" &&
          !Array.isArray(jsonValue) &&
          "metrics" in jsonValue
            ? `Project Atlas returned compact structured context: ${
                (
                  jsonValue as {
                    metrics?: {
                      usedChars?: number;
                      estimatedTokens?: number;
                      truncated?: boolean;
                    };
                  }
                ).metrics?.usedChars ?? serialized.length
              } chars, ~${(
                jsonValue as {
                  metrics?: { estimatedTokens?: number };
                }
              ).metrics?.estimatedTokens ?? Math.ceil(serialized.length / 4)} tokens${
                (
                  jsonValue as {
                    metrics?: { truncated?: boolean };
                  }
                ).metrics?.truncated
                  ? ", truncated to budget"
                  : ""
              }.`
            : `Project Atlas returned structured context (${serialized.length} chars).`,
      },
    ],
    structuredContent,
  };
}

function requireComponent(graph: ComponentGraph, selector: string) {
  const component = findComponent(graph, selector);
  if (!component) {
    throw new Error(`Component "${selector}" was not found in ${graph.project.name}.`);
  }
  return component;
}

const figmaVariableCatalogSchema = z
  .object({
    availability: z.enum([
      "global",
      "selection-only",
      "unavailable",
      "permission-required",
    ]),
    source: z
      .enum([
        "figma-desktop-mcp-global",
        "figma-variables-rest",
        "figma-selection",
        "none",
      ])
      .optional(),
    detailLevel: z.enum(["catalog", "expanded"]).optional(),
    valuesIncluded: z.boolean().optional(),
    totalCollections: z.number().int().min(0).optional(),
    totalVariables: z.number().int().min(0).optional(),
    meta: z.record(z.unknown()).optional(),
    variableCollections: z
      .union([z.array(z.unknown()), z.record(z.unknown())])
      .optional(),
    collections: z
      .union([z.array(z.unknown()), z.record(z.unknown())])
      .optional(),
    variables: z
      .union([z.array(z.unknown()), z.record(z.unknown())])
      .optional(),
    note: z.string().max(500).optional(),
  })
  .passthrough()
  .superRefine((catalog, context) => {
    if (
      catalog.availability === "global" &&
      catalog.source !== "figma-desktop-mcp-global" &&
      catalog.source !== "figma-variables-rest"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source"],
        message:
          "Global availability requires an explicitly confirmed file-global source.",
      });
    }
  });

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "component-atlas",
    version: "0.1.0",
  });

  server.tool(
    "scan_repository",
    "Index Astro, Vue/Nuxt, or React/Next frontend nodes and refresh the local graph.",
    {
      root_path: z.string().describe("Absolute repository root."),
      framework: z.enum(["vue", "react", "astro"]).optional(),
    },
    async ({ root_path, framework }) => {
      const graph = await scanProject(root_path, framework ? { framework } : {});
      return text(graphSummary(graph));
    },
  );

  server.tool(
    "get_source_capabilities",
    "Return connector and enrichment state observed for this project, with provenance and last check time. It never probes credentials or external systems.",
    { root_path: z.string() },
    async ({ root_path }) => text(await getProjectCapabilities(root_path)),
  );

  server.tool(
    "report_source_capabilities",
    "Record bounded capability observations from the current agent session. This stores no credentials and performs no external writes.",
    {
      root_path: z.string(),
      observations: z
        .array(
          z.object({
            id: z.enum([
              "figma",
              "atlassian-rovo",
              "github",
              "ready-for-dev",
              "figma-variables",
              "code-connect",
              "figma-libraries",
            ]),
            state: z.enum([
              "connected",
              "detected",
              "unavailable",
              "not-exposed",
              "permission-required",
              "unknown",
              "degraded",
            ]),
            detail: z.string().max(240).optional(),
          }),
        )
        .min(1)
        .max(16),
    },
    async ({ root_path, observations }) =>
      text(
        await reportProjectCapabilities(
          root_path,
          observations.map((item) => ({
            id: item.id,
            state: item.state,
            ...(item.detail ? { detail: item.detail } : {}),
          })),
        ),
      ),
  );

  server.tool(
    "record_task_evaluation",
    "Opt in to storing bounded, content-free task quality metrics locally. Task text is hashed and never persisted.",
    {
      root_path: z.string(),
      task: z.string().min(1).max(2000),
      top_three_correct: z.boolean().optional(),
      false_duplicate_count: z.number().int().min(0).max(100).optional(),
      necessary_questions: z.number().int().min(0).max(20).optional(),
      unnecessary_questions: z.number().int().min(0).max(20).optional(),
      context_chars: z.number().int().min(0).max(100000).optional(),
      preparation_ms: z.number().int().min(0).max(3600000).optional(),
      conflict_count: z.number().int().min(0).max(100).optional(),
      rework_required: z.boolean().optional(),
    },
    async ({
      root_path,
      task,
      top_three_correct,
      false_duplicate_count,
      necessary_questions,
      unnecessary_questions,
      context_chars,
      preparation_ms,
      conflict_count,
      rework_required,
    }) =>
      text(
        await recordTaskEvaluation({
          rootPath: root_path,
          task,
          ...(top_three_correct === undefined
            ? {}
            : { topThreeCorrect: top_three_correct }),
          ...(false_duplicate_count === undefined
            ? {}
            : { falseDuplicateCount: false_duplicate_count }),
          ...(necessary_questions === undefined
            ? {}
            : { necessaryQuestions: necessary_questions }),
          ...(unnecessary_questions === undefined
            ? {}
            : { unnecessaryQuestions: unnecessary_questions }),
          ...(context_chars === undefined ? {} : { contextChars: context_chars }),
          ...(preparation_ms === undefined
            ? {}
            : { preparationMs: preparation_ms }),
          ...(conflict_count === undefined
            ? {}
            : { conflictCount: conflict_count }),
          ...(rework_required === undefined
            ? {}
            : { reworkRequired: rework_required }),
        }),
      ),
  );

  server.tool(
    "search_components",
    "Search reusable components by intent, name, prop, child component, or path. Returns compact references unless raw is true.",
    {
      root_path: z.string(),
      query: z.string(),
      limit: z.number().int().min(1).max(50).optional(),
      raw: z.boolean().optional(),
    },
    async ({ root_path, query, limit, raw }) => {
      const graph = await loadProjectGraph(root_path);
      return text(
        raw
          ? searchComponents(graph, query, limit ?? 10)
          : searchComponentContext(graph, query, limit ?? 10),
      );
    },
  );

  server.tool(
    "get_reuse_context",
    "Return a compact mental map of candidates, scopes, APIs, relationships, similarity, and change impact for a frontend intent.",
    {
      root_path: z.string(),
      intent: z.string().min(1),
      task_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/u).optional(),
      limit: z.number().int().min(1).max(5).optional(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
      invalidation_reason: z
        .enum([
          "graph-changed",
          "scope-changed",
          "source-ledger-changed",
          "user-requested",
        ])
        .optional(),
    },
    async ({
      root_path,
      intent,
      task_id,
      limit,
      budget_chars,
      invalidation_reason,
    }) => {
      const graph = await loadProjectGraph(root_path);
      const claim = task_id
        ? await claimTaskRetrieval(root_path, {
            taskId: task_id,
            kind: "reuse",
            key: reuseRetrievalKey({
              projectId: graph.project.id,
              intent,
              ...(graph.project.identity?.checkoutId
                ? { checkoutId: graph.project.identity.checkoutId }
                : {}),
              ...(graph.project.scan?.fingerprint
                ? { graphFingerprint: graph.project.scan.fingerprint }
                : {}),
            }),
            ...(invalidation_reason
              ? { invalidationReason: invalidation_reason }
              : {}),
          })
        : undefined;
      if (claim?.status === "cached") {
        return text({
          status: "cached",
          handle: claim.handle,
          budgetId: claim.budgetId,
          contextInjected: false,
          nextSafeAction:
            "Reuse the prior compact selection; expand a named component only if required.",
        });
      }
      const context = buildReuseContext(graph, intent, limit ?? 3);
      const response = fitBudgetedResponse(
        context as unknown as Record<string, unknown>,
        {
          budgetChars: budget_chars,
          totalMatches: context.candidates.length,
          expandableIds: context.candidates.map(
            (candidate) => candidate.component.id,
          ),
        },
      );
      if (claim) {
        await completeTaskRetrieval(root_path, claim.handle, context);
      }
      return text({
        ...response,
        ...(claim
          ? {
              retrieval: {
                handle: claim.handle,
                budgetId: claim.budgetId,
                contextInjected: true,
              },
            }
          : {}),
      });
    },
  );

  server.tool(
    "get_change_surface",
    "Lock one compact implementation surface after reuse selection: one primary component, at most two reference-only components, bounded files/API/impact, and explicit exclusions. Repeated scope returns only its retrieval handle.",
    {
      root_path: z.string(),
      task_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/u),
      intent: z.string().min(1),
      primary_component: z.string().min(1).optional(),
      secondary_components: z.array(z.string().min(1)).max(2).optional(),
      out_of_scope: z.array(z.string().min(1)).max(8).optional(),
      source_ledger_hash: z.string().regex(/^[a-f0-9]{16,64}$/u),
      budget_chars: z.number().int().min(800).max(6000).optional(),
      invalidation_reason: z
        .enum([
          "graph-changed",
          "scope-changed",
          "source-ledger-changed",
          "user-requested",
        ])
        .optional(),
    },
    async ({
      root_path,
      task_id,
      intent,
      primary_component,
      secondary_components,
      out_of_scope,
      source_ledger_hash,
      budget_chars,
      invalidation_reason,
    }) => {
      const graph = await loadProjectGraph(root_path);
      const claim = await claimTaskRetrieval(root_path, {
        taskId: task_id,
        kind: "change-surface",
        key: changeSurfaceRetrievalKey({
          projectId: graph.project.id,
          intent,
          ...(graph.project.identity?.checkoutId
            ? { checkoutId: graph.project.identity.checkoutId }
            : {}),
          ...(graph.project.scan?.fingerprint
            ? { graphFingerprint: graph.project.scan.fingerprint }
            : {}),
          ...(primary_component
            ? { primaryComponent: primary_component }
            : {}),
          ...(secondary_components
            ? { secondaryComponents: secondary_components }
            : {}),
          ...(out_of_scope ? { outOfScope: out_of_scope } : {}),
          sourceLedgerHash: source_ledger_hash,
        }),
        ...(invalidation_reason
          ? { invalidationReason: invalidation_reason }
          : {}),
      });
      if (claim.status === "cached") {
        return text({
          status: "cached",
          handle: claim.handle,
          budgetId: claim.budgetId,
          contextInjected: false,
          nextSafeAction:
            "Keep the previously locked primary, references, files, and exclusions.",
        });
      }
      const surface = buildChangeSurface(graph, intent, {
        ...(primary_component ? { primaryComponent: primary_component } : {}),
        ...(secondary_components
          ? { secondaryComponents: secondary_components }
          : {}),
        ...(out_of_scope ? { outOfScope: out_of_scope } : {}),
      });
      await completeTaskRetrieval(root_path, claim.handle, surface);
      const response = fitBudgetedResponse(
        surface as unknown as Record<string, unknown>,
        {
          budgetChars: budget_chars ?? 2_800,
          totalMatches: surface.references.length + (surface.primary ? 1 : 0),
          expandableIds: [
            ...(surface.primary ? [surface.primary.id] : []),
            ...surface.references.map((item) => item.component.id),
          ],
        },
      );
      return text({
        ...response,
        retrieval: {
          handle: claim.handle,
          budgetId: claim.budgetId,
          contextInjected: true,
        },
      });
    },
  );

  server.tool(
    "get_component",
    "Get compact API, scope, tests, relationships, similarity, and impact for one component. Set raw only for low-level index diagnostics.",
    {
      root_path: z.string(),
      component: z.string().describe("Component id, name, runtime name, or path."),
      raw: z.boolean().optional(),
    },
    async ({ root_path, component: selector, raw }) => {
      const graph = await loadProjectGraph(root_path);
      if (!raw) return text(buildComponentContext(graph, selector));
      const component = requireComponent(graph, selector);
      const relatedEdges = graph.edges.filter(
        (edge) => edge.source === component.id || edge.target === component.id,
      );
      return text({ component, edges: relatedEdges });
    },
  );

  server.tool(
    "find_similar_components",
    "Find compact structurally similar components with explainable evidence.",
    {
      root_path: z.string(),
      component: z.string(),
      limit: z.number().int().min(1).max(20).optional(),
      raw: z.boolean().optional(),
    },
    async ({ root_path, component: selector, limit, raw }) => {
      const graph = await loadProjectGraph(root_path);
      const component = requireComponent(graph, selector);
      return text(
        raw
          ? similarComponents(graph, component.id).slice(0, limit ?? 5)
          : buildSimilarityContext(graph, selector, limit ?? 5),
      );
    },
  );

  server.tool(
    "list_component_usages",
    "List components rendered by this component and components that render it.",
    {
      root_path: z.string(),
      component: z.string(),
      raw: z.boolean().optional(),
    },
    async ({ root_path, component: selector, raw }) => {
      const graph = await loadProjectGraph(root_path);
      const component = requireComponent(graph, selector);
      const byId = new Map(graph.components.map((item) => [item.id, item]));
      const renders = graph.edges
        .filter((edge) => edge.kind === "renders" && edge.source === component.id)
        .map((edge) => byId.get(edge.target))
        .filter((item): item is ComponentNode => Boolean(item));
      const renderedBy = graph.edges
        .filter((edge) => edge.kind === "renders" && edge.target === component.id)
        .map((edge) => byId.get(edge.source))
        .filter((item): item is ComponentNode => Boolean(item));
      return text(
        raw
          ? { component: component.effectiveName, renders, renderedBy }
          : {
              component: componentContextReference(component),
              renders: renders.map(componentContextLink),
              renderedBy: renderedBy.map(componentContextLink),
            },
      );
    },
  );

  server.tool(
    "analyze_prop_change_impact",
    "Estimate direct and transitive consumers affected by a component API change.",
    {
      root_path: z.string(),
      component: z.string(),
      proposed_change: z.string().optional(),
      raw: z.boolean().optional(),
    },
    async ({ root_path, component: selector, proposed_change, raw }) => {
      const graph = await loadProjectGraph(root_path);
      const component = requireComponent(graph, selector);
      if (!raw) {
        return text({
          ...buildImpactContext(graph, selector),
          proposedChange: proposed_change,
        });
      }
      return text({
        component,
        proposedChange: proposed_change,
        ...componentImpact(graph, component.id),
      });
    },
  );

  server.tool(
    "record_component_decision",
    "Record the required reuse/extend/compose/extract/create decision and rationale. Defaults to the current checkout; project promotion requires explicit confirmation.",
    {
      root_path: z.string(),
      intent: z.string(),
      decision: z.enum([
        "reuse",
        "extend",
        "compose",
        "extract-and-reuse",
        "create",
      ]),
      selected_component_ids: z.array(z.string()).optional(),
      rejected_component_ids: z.array(z.string()).optional(),
      rationale: z.string().min(1),
      author: z.string().optional(),
      scope: z.enum(["checkout", "project"]).optional(),
      confirmed_project_scope: z.boolean().optional(),
    },
    async ({
      root_path,
      intent,
      decision,
      selected_component_ids,
      rejected_component_ids,
      rationale,
      author,
      scope,
      confirmed_project_scope,
    }) =>
      text(
        await recordDecision({
          rootPath: root_path,
          intent,
          decision: decision as DecisionKind,
          selectedComponentIds: selected_component_ids ?? [],
          rejectedComponentIds: rejected_component_ids ?? [],
          rationale,
          ...(author ? { author } : {}),
          ...(scope ? { scope } : {}),
          ...(confirmed_project_scope
            ? { confirmedProjectScope: true }
            : {}),
        }),
      ),
  );

  server.tool(
    "map_figma_file",
    "Create or incrementally update a lightweight local Figma map from sparse get_metadata XML or a depth-limited REST response. Does not fetch deep design context or write to Figma.",
    {
      root_path: z.string(),
      figma_url: z.string(),
      task_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/u).optional(),
      source_decision_id: z.string().max(160).optional(),
      metadata: z.union([z.string(), z.record(z.unknown())]),
      format: z
        .enum(["auto", "figma-mcp-xml", "figma-rest"])
        .optional(),
      file_name: z.string().optional(),
      version: z.string().optional(),
      last_modified: z.string().optional(),
      scope_node_id: z.string().optional(),
      scope_page_id: z.string().optional(),
      scope_page_name: z.string().optional(),
      source_receipt: z
        .object({
          source_decision_id: z.string().max(160).optional(),
          adapter: z.enum([
            "figma-desktop-mcp-local",
            "figma-remote-connector",
            "atlas-cache",
            "manual-import",
            "other",
          ]),
          route: z.string().min(1).max(500),
          operation: z.string().min(1).max(160),
          observed_at: z.string().datetime().optional(),
          freshness: z.enum(["current", "stale", "unknown"]).optional(),
          fallback: z
            .object({
              from_adapter: z.enum([
                "figma-desktop-mcp-local",
                "figma-remote-connector",
                "atlas-cache",
                "manual-import",
                "other",
              ]),
              condition: z.string().min(1).max(500),
              identity_preserved: z.boolean(),
            })
            .optional(),
        })
        .optional(),
      enrichment: z
        .object({
          libraries: z
            .union([z.array(z.unknown()), z.record(z.unknown())])
            .optional(),
          codeConnect: z.record(z.unknown()).optional(),
          devResources: z.array(z.unknown()).optional(),
          devStatusByNode: z.record(z.unknown()).optional(),
          devStatusProvenanceByNode: z
            .record(z.enum(["observed", "user-confirmed"]))
            .optional(),
          devStatusAvailability: z
            .enum(["available", "source-unavailable"])
            .optional(),
          variableCatalog: z.unknown().optional(),
        })
        .optional(),
      force: z.boolean().optional(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({
      root_path,
      figma_url,
      task_id,
      source_decision_id,
      metadata,
      format,
      file_name,
      version,
      last_modified,
      scope_node_id,
      scope_page_id,
      scope_page_name,
      source_receipt,
      enrichment,
      force,
      budget_chars,
    }) => {
      if (Boolean(task_id) !== Boolean(source_decision_id)) {
        throw new Error(
          "Authoritative Figma mapping requires both task_id and source_decision_id.",
        );
      }
      const observedIdentity = sourceIdentityFromReference("figma", figma_url);
      const authoritativeDecision =
        task_id && source_decision_id
          ? await loadConfirmedTaskSourceDecision(
              root_path,
              task_id,
              source_decision_id,
            )
          : undefined;
      if (authoritativeDecision && authoritativeDecision.kind !== "figma") {
        throw new Error("The task source decision is not a Figma source.");
      }
      if (authoritativeDecision && !source_receipt) {
        throw new Error(
          "Authoritative Figma mapping requires route evidence in source_receipt.",
        );
      }
      const confirmedReference =
        authoritativeDecision?.reference ?? figma_url;
      const identity = sourceIdentityFromReference(
        "figma",
        confirmedReference,
      );
      if (
        identity.fileKey !== observedIdentity.fileKey ||
        (identity.host &&
          observedIdentity.host &&
          identity.host !== observedIdentity.host)
      ) {
        throw new Error(
          "The observed Figma scope belongs to a different confirmed file.",
        );
      }
      const exactNodeId =
        scope_node_id ?? observedIdentity.nodeId ?? identity.nodeId;
      const sourceScopeId = identity.nodeId ?? identity.fileKey!;
      const scopeRelation =
        exactNodeId
          ? {
              kind:
                sourceScopeId === exactNodeId
                  ? ("same-scope" as const)
                  : ("contained-scope" as const),
              sourceId: sourceScopeId,
              targetId: exactNodeId,
            }
          : undefined;
      const receipt = source_receipt
        ? createSourceReceipt({
            sourceDecisionId:
              authoritativeDecision?.id ??
              source_receipt.source_decision_id ??
              "unbound-figma-observation",
            provider: "figma",
            requested: identity,
            resolved: {
              ...identity,
              ...(version ? { version } : {}),
            },
            adapter: source_receipt.adapter,
            route: source_receipt.route,
            operation: source_receipt.operation,
            scope: exactNodeId
              ? {
                  kind: "node",
                  id: exactNodeId,
                  ...(identity.fileKey
                    ? { parentId: identity.fileKey }
                    : {}),
                }
              : { kind: "file", id: identity.fileKey! },
            ...(scopeRelation ? { scopeRelation } : {}),
            observedAt:
              source_receipt.observed_at ?? new Date().toISOString(),
            ...(source_receipt.fallback
              ? {
                  fallback: {
                    fromAdapter: source_receipt.fallback.from_adapter,
                    condition: source_receipt.fallback.condition,
                    identityPreserved:
                      source_receipt.fallback.identity_preserved,
                  },
                }
              : {}),
            coverage: authoritativeDecision ? "exact" : "candidate",
            freshness: source_receipt.freshness ?? "current",
          })
        : undefined;
      if (authoritativeDecision && receipt) {
        assertSourceReceiptMatchesDecision(
          {
            id: authoritativeDecision.id,
            kind: authoritativeDecision.kind,
            reference: authoritativeDecision.reference,
            state: authoritativeDecision.state,
            ...(authoritativeDecision.routePolicy
              ? { routePolicy: authoritativeDecision.routePolicy }
              : {}),
          },
          receipt,
        );
      }
      const result = await mapFigmaDesign({
          rootPath: root_path,
          figmaUrl: figma_url,
          ...(authoritativeDecision
            ? { confirmedSourceReference: authoritativeDecision.reference }
            : {}),
          metadata,
          ...(format ? { format } : {}),
          ...(file_name ? { fileName: file_name } : {}),
          ...(version ? { version } : {}),
          ...(last_modified ? { lastModified: last_modified } : {}),
          ...(scope_node_id ? { scopeNodeId: scope_node_id } : {}),
          ...(scope_page_id ? { scopePageId: scope_page_id } : {}),
          ...(scope_page_name ? { scopePageName: scope_page_name } : {}),
          ...(receipt ? { sourceReceipt: receipt } : {}),
          ...(enrichment
            ? {
                enrichment:
                  enrichment as NonNullable<
                    MapFigmaDesignInput["enrichment"]
                  >,
              }
            : {}),
          ...(force ? { force: true } : {}),
        });
      const summary = result.summary;
      return text(
        fitBudgetedResponse(result as unknown as Record<string, unknown>, {
          budgetChars: budget_chars,
          totalMatches: summary.stats.nodes,
          expandableIds: summary.pages.flatMap((page) =>
            page.mainNodes.map((node) => node.id),
          ),
          preserveFirstKeys: ["summary", "gate"],
        }),
      );
    },
  );

  server.tool(
    "capture_figma_asset",
    "Capture one selected Figma Desktop MCP localhost asset into ProjectAtlas temp storage. Returns only a handle, hash, format, size, provenance, and expiry; never returns SVG or binary bodies and never persists the localhost URL.",
    {
      root_path: z.string(),
      task_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/u),
      source_receipt_id: z.string().regex(/^receipt-[a-f0-9]{16}$/u),
      asset_url: z.string().url(),
      scope_node_id: z.string().min(1).max(160),
      asset_node_id: z.string().min(1).max(160).optional(),
      file_name: z.string().min(1).max(160).optional(),
      ttl_minutes: z.number().int().min(1).max(1440).optional(),
      invalidation_reason: z
        .enum([
          "graph-changed",
          "scope-changed",
          "source-ledger-changed",
          "user-requested",
        ])
        .optional(),
    },
    async ({
      root_path,
      task_id,
      source_receipt_id,
      asset_url,
      scope_node_id,
      asset_node_id,
      file_name,
      ttl_minutes,
      invalidation_reason,
    }) => {
      const claim = await claimTaskRetrieval(root_path, {
        taskId: task_id,
        kind: "figma-asset",
        key: JSON.stringify({
          sourceReceiptId: source_receipt_id,
          sourceUrl: asset_url,
          scopeNodeId: scope_node_id,
          assetNodeId: asset_node_id ?? "",
        }),
        ...(invalidation_reason
          ? { invalidationReason: invalidation_reason }
          : {}),
      });
      if (claim.status === "cached") {
        const cached = (await loadTaskRetrievalResult(
          root_path,
          claim.handle,
        )) as { handle?: unknown };
        if (typeof cached.handle !== "string") {
          throw new Error("Cached Figma asset handle is invalid.");
        }
        const asset = await loadFigmaAssetMetadata(cached.handle).catch(() => {
          throw new Error(
            "Cached Figma asset handle is unavailable. Retry with an explicit invalidation reason.",
          );
        });
        if (Date.parse(asset.expiresAt) <= Date.now()) {
          throw new Error(
            "Cached Figma asset handle expired. Purge it and retry with an explicit invalidation reason.",
          );
        }
        return text({
          status: "cached",
          asset,
          retrieval: {
            handle: claim.handle,
            budgetId: claim.budgetId,
            contextInjected: false,
          },
        });
      }
      const asset = await captureFigmaAsset({
        rootPath: root_path,
        taskId: task_id,
        sourceReceiptId: source_receipt_id,
        sourceUrl: asset_url,
        scopeNodeId: scope_node_id,
        ...(asset_node_id ? { assetNodeId: asset_node_id } : {}),
        ...(file_name ? { fileName: file_name } : {}),
        ...(ttl_minutes ? { ttlMs: ttl_minutes * 60_000 } : {}),
      });
      await completeTaskRetrieval(root_path, claim.handle, asset);
      return text({
        asset,
        retrieval: {
          handle: claim.handle,
          budgetId: claim.budgetId,
          contextInjected: true,
        },
      });
    },
  );

  server.tool(
    "materialize_figma_asset",
    "Write one explicitly selected, validated Figma asset handle to a new checkout-relative production asset path. Refuses overwrite, path escape, active/external SVG content, expired or tampered handles, and Atlas/Codex state paths.",
    {
      root_path: z.string(),
      asset_handle: z
        .string()
        .regex(/^figma-asset:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{24}$/u),
      destination_path: z.string().min(1).max(500),
    },
    async ({ root_path, asset_handle, destination_path }) =>
      text(
        await materializeFigmaAsset({
          rootPath: root_path,
          handle: asset_handle,
          destinationPath: destination_path,
        }),
      ),
  );

  server.tool(
    "purge_expired_figma_assets",
    "Purge only expired ProjectAtlas-owned Figma temp assets. Never scans or deletes checkout files.",
    {
      task_id: z
        .string()
        .regex(/^[A-Za-z0-9_.:-]{1,160}$/u)
        .optional(),
    },
    async ({ task_id }) =>
      text(
        await purgeExpiredFigmaAssets({
          ...(task_id ? { taskId: task_id } : {}),
        }),
      ),
  );

  server.tool(
    "sync_figma_variables",
    "Persist a bounded, read-only audit of Figma Variables for an already mapped file. Use availability=global only with an explicitly confirmed file-global read result. Desktop get_variable_defs is selection-only and must never be submitted as a global catalog. Stores no credentials and never writes to Figma.",
    {
      root_path: z.string(),
      figma_file: z.string(),
      catalog: figmaVariableCatalogSchema,
      synced_at: z.string().datetime().optional(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({
      root_path,
      figma_file,
      catalog,
      synced_at,
      budget_chars,
    }) => {
      const result = await syncFigmaDesignVariables({
        rootPath: root_path,
        figmaFile: figma_file,
        catalog,
        ...(synced_at ? { syncedAt: synced_at } : {}),
      });
      return text(
        fitBudgetedResponse(result as unknown as Record<string, unknown>, {
          budgetChars: budget_chars,
          totalMatches: result.variables.totalVariables,
          expandableIds: result.variables.collections.map(
            (collection) => collection.id,
          ),
          preserveFirstKeys: ["variables"],
        }),
      );
    },
  );

  server.tool(
    "get_figma_variables",
    "Read the compact cached file-global Variables catalog. Collection summaries are the default. Variable names/types and exact aliases/values are returned only when explicitly requested and previously synchronized from an authorized global source.",
    {
      root_path: z.string(),
      figma_file: z.string(),
      collection_id: z.string().optional(),
      variable_ids: z.array(z.string()).max(500).optional(),
      include_variables: z.boolean().optional(),
      include_values: z.boolean().optional(),
      limit: z.number().int().min(1).max(500).optional(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({
      root_path,
      figma_file,
      collection_id,
      variable_ids,
      include_variables,
      include_values,
      limit,
      budget_chars,
    }) => {
      const result = await getFigmaDesignVariables(
        root_path,
        figma_file,
        {
          ...(collection_id ? { collectionId: collection_id } : {}),
          ...(variable_ids ? { variableIds: variable_ids } : {}),
          ...(include_variables ? { includeVariables: true } : {}),
          ...(include_values ? { includeValues: true } : {}),
          ...(limit ? { limit } : {}),
        },
      );
      return text(
        fitBudgetedResponse(result as unknown as Record<string, unknown>, {
          budgetChars: budget_chars,
          totalMatches: result.totalVariables,
          expandableIds:
            result.variables.length > 0
              ? result.variables.map((variable) => variable.id)
              : result.collections.map((collection) => collection.id),
          preserveFirstKeys: [
            "availability",
            "source",
            "collections",
            "expansion",
          ],
        }),
      );
    },
  );

  server.tool(
    "list_figma_indexes",
    "List compact cached Figma file maps for one repository.",
    {
      root_path: z.string(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({ root_path, budget_chars }) => {
      const indexes = await listFigmaDesignIndexes(root_path);
      return text(
        fitBudgetedResponse(
          { indexes } as Record<string, unknown>,
          {
            budgetChars: budget_chars,
            totalMatches: indexes.length,
            expandableIds: indexes.map((index) => index.file.key),
            preserveFirstKeys: ["indexes"],
          },
        ),
      );
    },
  );

  server.tool(
    "find_design_candidates",
    "Rank a few explainable cached Figma nodes for a task and cross-check them with Code Atlas. Returns a decision/uncertainty gate; it never loads deep node context.",
    {
      root_path: z.string(),
      task: z.string().min(1),
      figma_file: z.string().optional(),
      limit: z.number().int().min(1).max(10).optional(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({ root_path, task, figma_file, limit, budget_chars }) => {
      const result = await findTaskDesignCandidates(root_path, task, {
          ...(figma_file ? { figmaFile: figma_file } : {}),
          ...(limit ? { limit } : {}),
        });
      return text(
        fitBudgetedResponse(result as unknown as Record<string, unknown>, {
          budgetChars: budget_chars,
          totalMatches: result.candidates.length,
          expandableIds: result.candidates.map((item) => item.node.id),
          preserveFirstKeys: ["candidates", "gate"],
        }),
      );
    },
  );

  server.tool(
    "inspect_design_node",
    "Inspect one confirmed cached Figma node and return its hierarchy, states, findings, and exact handoff for get_design_context, get_screenshot, and selection variables. Does not call Figma itself.",
    {
      root_path: z.string(),
      figma_file: z.string(),
      node: z.string().describe("Confirmed node ID, exact name/path, or node URL."),
    },
    async ({ root_path, figma_file, node }) =>
      text(await inspectFigmaDesignNode(root_path, figma_file, node)),
  );

  server.tool(
    "orient_project",
    "Return a hard-capped Project Atlas map: Code Atlas modules, Design Atlas files, memory sources/counts, current decisions, and expandable IDs.",
    {
      root_path: z.string(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
      refresh_memory: z.boolean().optional(),
    },
    async ({ root_path, budget_chars, refresh_memory }) =>
      text(
        await orientProject(root_path, {
          ...(budget_chars ? { budgetChars: budget_chars } : {}),
          ...(refresh_memory ? { refreshMemory: true } : {}),
        }),
      ),
  );

  server.tool(
    "search_project_memory",
    "Search typed, project-scoped memory. Returns a small page of summaries and expandable IDs; active memory only unless requested.",
    {
      root_path: z.string(),
      query: z.string(),
      types: z
        .array(
          z.enum([
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
            "outcome",
            "plan",
            "debt",
            "note",
          ]),
        )
        .optional(),
      statuses: z
        .array(
          z.enum([
            "proposed",
            "active",
            "superseded",
            "archived",
            "rejected",
          ]),
        )
        .optional(),
      tags: z.array(z.string()).optional(),
      limit: z.number().int().min(1).max(10).optional(),
      cursor: z.string().optional(),
      include_inactive: z.boolean().optional(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({
      root_path,
      query,
      types,
      statuses,
      tags,
      limit,
      cursor,
      include_inactive,
      budget_chars,
    }) =>
      text(
        await searchProjectMemory(root_path, query, {
          ...(types ? { types } : {}),
          ...(statuses ? { statuses } : {}),
          ...(tags ? { tags } : {}),
          ...(limit ? { limit } : {}),
          ...(cursor ? { cursor } : {}),
          ...(include_inactive ? { includeInactive: true } : {}),
          ...(budget_chars ? { budgetChars: budget_chars } : {}),
        }),
      ),
  );

  server.tool(
    "get_memory_item",
    "Expand one confirmed project-memory ID under a hard response budget.",
    {
      root_path: z.string(),
      id: z.string(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({ root_path, id, budget_chars }) =>
      text(
        await getProjectMemoryItem(root_path, id, {
          ...(budget_chars ? { budgetChars: budget_chars } : {}),
        }),
      ),
  );

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

  const memoryRelation = z.object({
    kind: z.enum([
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
    ]),
    targetId: z.string(),
    summary: z.string().optional(),
  });
  const memoryDraft = z.object({
    id: z.string().optional(),
    namespace: z.string().optional(),
    type: z.enum([
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
      "outcome",
      "plan",
      "debt",
      "note",
    ]),
    title: z.string().min(1),
    summary: z.string().min(1),
    body: z.string().optional(),
    status: z.enum(["proposed", "active", "archived", "rejected"]).optional(),
    confidence: z.number().min(0).max(1),
    authority: z.enum(["observed", "inferred", "decided", "verified"]),
    scope: z.enum(["canonical", "local", "episodic"]).optional(),
    verifiedAt: z.string().optional(),
    owner: z.string().optional(),
    tags: z.array(z.string()).optional(),
    supersedes: z.array(z.string()).optional(),
    expiresAt: z.string().optional(),
    reviewAfter: z.string().optional(),
    relations: z.array(memoryRelation).optional(),
  });

  server.tool(
    "propose_memory_update",
    "Store a reviewable memory delta. It does not promote or write durable project knowledge.",
    {
      root_path: z.string(),
      rationale: z.string().min(1),
      evidence: z.array(z.string()).optional(),
      proposed_by: z.string().optional(),
      items: z.array(memoryDraft).min(1).max(20),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({
      root_path,
      rationale,
      evidence,
      proposed_by,
      items,
      budget_chars,
    }) =>
      text(
        await proposeMemoryUpdate({
          rootPath: root_path,
          rationale,
          items: items as unknown as Parameters<
            typeof proposeMemoryUpdate
          >[0]["items"],
          ...(evidence ? { evidence } : {}),
          ...(proposed_by ? { proposedBy: proposed_by } : {}),
          ...(budget_chars ? { budgetChars: budget_chars } : {}),
        }),
      ),
  );

  server.tool(
    "apply_memory_update",
    "Apply one reviewed proposal to local or canonical Markdown. Requires explicit confirmed=true, blocks unresolved decision-required findings, and requires canonical_confirmed=true for versionable canonical writes.",
    {
      root_path: z.string(),
      proposal_id: z.string(),
      confirmed: z.boolean(),
      target: z.enum(["local", "canonical"]).optional(),
      canonical_confirmed: z.boolean().optional(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({
      root_path,
      proposal_id,
      confirmed,
      target,
      canonical_confirmed,
      budget_chars,
    }) =>
      text(
        await applyMemoryUpdate(root_path, proposal_id, {
          confirmed,
          ...(target ? { target } : {}),
          ...(canonical_confirmed !== undefined
            ? { canonicalConfirmed: canonical_confirmed }
            : {}),
          ...(budget_chars ? { budgetChars: budget_chars } : {}),
        }),
      ),
  );

  server.tool(
    "record_outcome",
    "Record an observed or verified task outcome as local episodic memory. Durable decisions still require a separate proposal.",
    {
      root_path: z.string(),
      task: z.string().min(1),
      result: z.enum(["success", "failure", "partial"]),
      summary: z.string().min(1),
      evidence: z.array(z.string()).optional(),
      related_entity_ids: z.array(z.string()).optional(),
      files: z.array(z.string()).optional(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({
      root_path,
      task,
      result,
      summary,
      evidence,
      related_entity_ids,
      files,
      budget_chars,
    }) =>
      text(
        await recordProjectOutcome({
          rootPath: root_path,
          task,
          result,
          summary,
          ...(evidence ? { evidence } : {}),
          ...(related_entity_ids
            ? { relatedEntityIds: related_entity_ids }
            : {}),
          ...(files ? { files } : {}),
          ...(budget_chars ? { budgetChars: budget_chars } : {}),
        }),
      ),
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}

const entryPath = process.argv[1];
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  startMcpServer().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
