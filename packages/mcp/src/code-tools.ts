import {
  buildChangeSurface,
  buildComponentContext,
  buildImpactContext,
  buildReuseContext,
  buildSimilarityContext,
  componentContextLink,
  componentContextReference,
  componentImpact,
  searchComponentContext,
  searchComponents,
  similarComponents,
  type ComponentNode,
  type DecisionKind,
} from "@component-atlas/core";
import {
  fitBudgetedResponse,
  loadProjectGraph,
  recordDecision,
  claimTaskRetrieval,
  changeSurfaceRetrievalKey,
  completeTaskRetrieval,
  reuseRetrievalKey,
  validateDiff,
} from "@component-atlas/runtime";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  requireComponent,
  text,
} from "./shared.js";

export function registerCodeTools(server: McpServer): void {
  server.tool(
    "validate_diff",
    "Validate the current local diff against the Project Theme Fingerprint, reuse evidence, and explicitly confirmed OpenAPI operations. Findings are compact advisory warnings.",
    {
      root_path: z.string(),
      confirmed_operations: z
        .array(
          z.object({
            method: z.string().min(1),
            path: z.string().min(1),
            operation_id: z.string().optional(),
          }),
        )
        .max(100)
        .optional(),
    },
    async ({ root_path, confirmed_operations }) =>
      text(
        await validateDiff(root_path, {
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
    "Return a compact mental map of 1-5 ranked candidates (3 by default), scopes, APIs, relationships, similarity, and change impact for a frontend intent.",
    {
      root_path: z.string(),
      intent: z.string().min(1),
      task_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/u).optional(),
      limit: z
        .number()
        .int()
        .min(1)
        .max(5)
        .optional()
        .describe("Number of candidates to return: 1-5, default 3."),
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
}
