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
  graphSummary,
  inspectFigmaDesignNode,
  listFigmaDesignIndexes,
  loadProjectGraph,
  mapFigmaDesign,
  recordDecision,
  scanProject,
  type MapFigmaDesignInput,
} from "@component-atlas/runtime";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

function text(value: unknown) {
  const serialized = JSON.stringify(value, null, 2) ?? "null";
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
        text: serialized,
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
    },
    async ({ root_path, intent, limit }) => {
      const graph = await loadProjectGraph(root_path);
      return text(buildReuseContext(graph, intent, limit ?? 3));
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
      enrichment: z
        .object({
          libraries: z
            .union([z.array(z.unknown()), z.record(z.unknown())])
            .optional(),
          codeConnect: z.record(z.unknown()).optional(),
          devResources: z.array(z.unknown()).optional(),
          devStatusByNode: z.record(z.unknown()).optional(),
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
