#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import {
  buildComponentContext,
  buildImpactContext,
  buildReuseContext,
  buildSimilarityContext,
  componentContextLink,
  componentContextReference,
  componentImpact,
  findComponent,
  searchComponentContext,
  searchComponents,
  similarComponents,
  type ComponentGraph,
  type ComponentNode,
  type DecisionKind,
} from "@component-atlas/core";
import {
  findTaskDesignCandidates,
  fitBudgetedResponse,
  getProjectMemoryItem,
  getTaskContext,
  graphSummary,
  indexProjectMemory,
  inspectFigmaDesignNode,
  listFigmaDesignIndexes,
  loadProjectGraph,
  mapFigmaDesign,
  applyMemoryUpdate,
  checkBeforeChange,
  orientProject,
  proposeMemoryUpdate,
  recordDecision,
  recordProjectOutcome,
  scanProject,
  searchProjectMemory,
  type MapFigmaDesignInput,
} from "@component-atlas/runtime";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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
            : `Component Atlas returned structured context (${serialized.length} chars).`,
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

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "component-atlas",
    version: "0.1.0",
  });

  server.tool(
    "scan_repository",
    "Index Vue/Nuxt or React/Next components and refresh the local graph.",
    {
      root_path: z.string().describe("Absolute repository root."),
      framework: z.enum(["vue", "react"]).optional(),
    },
    async ({ root_path, framework }) => {
      const graph = await scanProject(root_path, framework ? { framework } : {});
      return text(graphSummary(graph));
    },
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
      limit: z.number().int().min(1).max(5).optional(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({ root_path, intent, limit, budget_chars }) => {
      const graph = await loadProjectGraph(root_path);
      const context = buildReuseContext(graph, intent, limit ?? 3);
      return text(
        fitBudgetedResponse(context as unknown as Record<string, unknown>, {
          budgetChars: budget_chars,
          totalMatches: context.candidates.length,
          expandableIds: context.candidates.map(
            (candidate) => candidate.component.id,
          ),
        }),
      );
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
    "Record the required reuse/extend/compose/extract/create decision and rationale.",
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
    },
    async ({
      root_path,
      intent,
      decision,
      selected_component_ids,
      rejected_component_ids,
      rationale,
      author,
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
        }),
      ),
  );

  server.tool(
    "map_figma_file",
    "Create or incrementally update a lightweight local Figma map from sparse get_metadata XML or a depth-limited REST response. Does not fetch deep design context or write to Figma.",
    {
      root_path: z.string(),
      figma_url: z.string(),
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
      enrichment: z
        .object({
          libraries: z
            .union([z.array(z.unknown()), z.record(z.unknown())])
            .optional(),
          codeConnect: z.record(z.unknown()).optional(),
          devResources: z.array(z.unknown()).optional(),
          devStatusByNode: z.record(z.unknown()).optional(),
          devStatusAvailability: z
            .enum(["available", "source-unavailable"])
            .optional(),
          variableCatalog: z.unknown().optional(),
        })
        .optional(),
      force: z.boolean().optional(),
    },
    async ({
      root_path,
      figma_url,
      metadata,
      format,
      file_name,
      version,
      last_modified,
      scope_node_id,
      scope_page_id,
      scope_page_name,
      enrichment,
      force,
    }) =>
      text(
        await mapFigmaDesign({
          rootPath: root_path,
          figmaUrl: figma_url,
          metadata,
          ...(format ? { format } : {}),
          ...(file_name ? { fileName: file_name } : {}),
          ...(version ? { version } : {}),
          ...(last_modified ? { lastModified: last_modified } : {}),
          ...(scope_node_id ? { scopeNodeId: scope_node_id } : {}),
          ...(scope_page_id ? { scopePageId: scope_page_id } : {}),
          ...(scope_page_name ? { scopePageName: scope_page_name } : {}),
          ...(enrichment
            ? {
                enrichment:
                  enrichment as NonNullable<
                    MapFigmaDesignInput["enrichment"]
                  >,
              }
            : {}),
          ...(force ? { force: true } : {}),
        }),
      ),
  );

  server.tool(
    "list_figma_indexes",
    "List compact cached Figma file maps for one repository.",
    { root_path: z.string() },
    async ({ root_path }) => text(await listFigmaDesignIndexes(root_path)),
  );

  server.tool(
    "find_design_candidates",
    "Rank a few explainable cached Figma nodes for a task and cross-check them with Component Atlas. Returns a decision/uncertainty gate; it never loads deep node context.",
    {
      root_path: z.string(),
      task: z.string().min(1),
      figma_file: z.string().optional(),
      limit: z.number().int().min(1).max(10).optional(),
    },
    async ({ root_path, task, figma_file, limit }) =>
      text(
        await findTaskDesignCandidates(root_path, task, {
          ...(figma_file ? { figmaFile: figma_file } : {}),
          ...(limit ? { limit } : {}),
        }),
      ),
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
    "Build one hard-capped task bundle from Project Memory, Code Atlas, and optional Design Atlas using a shared budget.",
    {
      root_path: z.string(),
      task: z.string().min(1),
      figma_file: z.string().optional(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
      top_k: z.number().int().min(1).max(10).optional(),
      refresh_memory: z.boolean().optional(),
    },
    async ({
      root_path,
      task,
      figma_file,
      budget_chars,
      top_k,
      refresh_memory,
    }) =>
      text(
        await getTaskContext(root_path, task, {
          ...(figma_file ? { figmaFile: figma_file } : {}),
          ...(budget_chars ? { budgetChars: budget_chars } : {}),
          ...(top_k ? { topK: top_k } : {}),
          ...(refresh_memory ? { refreshMemory: true } : {}),
        }),
      ),
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
    "Apply one reviewed proposal to local or canonical Markdown. Requires explicit confirmed=true and rejects secret-like content.",
    {
      root_path: z.string(),
      proposal_id: z.string(),
      confirmed: z.boolean(),
      target: z.enum(["local", "canonical"]).optional(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({
      root_path,
      proposal_id,
      confirmed,
      target,
      budget_chars,
    }) =>
      text(
        await applyMemoryUpdate(root_path, proposal_id, {
          confirmed,
          ...(target ? { target } : {}),
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
