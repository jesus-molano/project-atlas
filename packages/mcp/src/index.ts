#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import {
  componentImpact,
  findComponent,
  searchComponents,
  similarComponents,
  type ComponentGraph,
  type DecisionKind,
} from "@component-atlas/core";
import {
  getComponentPlayground,
  graphSummary,
  loadProjectGraph,
  recordDecision,
  savePreviewScenario,
  scanProject,
} from "@component-atlas/runtime";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

function text(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
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
    "Search reusable components by intent, name, prop, child component, or path.",
    {
      root_path: z.string(),
      query: z.string(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    async ({ root_path, query, limit }) => {
      const graph = await loadProjectGraph(root_path);
      return text(searchComponents(graph, query, limit ?? 10));
    },
  );

  server.tool(
    "get_component",
    "Get a component's source, public API, scope, tests, and relationships.",
    {
      root_path: z.string(),
      component: z.string().describe("Component id, name, runtime name, or path."),
    },
    async ({ root_path, component: selector }) => {
      const graph = await loadProjectGraph(root_path);
      const component = requireComponent(graph, selector);
      const relatedEdges = graph.edges.filter(
        (edge) => edge.source === component.id || edge.target === component.id,
      );
      return text({ component, edges: relatedEdges });
    },
  );

  server.tool(
    "find_similar_components",
    "Find structurally similar components with explainable evidence.",
    {
      root_path: z.string(),
      component: z.string(),
    },
    async ({ root_path, component: selector }) => {
      const graph = await loadProjectGraph(root_path);
      const component = requireComponent(graph, selector);
      return text(similarComponents(graph, component.id));
    },
  );

  server.tool(
    "list_component_usages",
    "List components rendered by this component and components that render it.",
    {
      root_path: z.string(),
      component: z.string(),
    },
    async ({ root_path, component: selector }) => {
      const graph = await loadProjectGraph(root_path);
      const component = requireComponent(graph, selector);
      const byId = new Map(graph.components.map((item) => [item.id, item]));
      const renders = graph.edges
        .filter((edge) => edge.kind === "renders" && edge.source === component.id)
        .map((edge) => byId.get(edge.target))
        .filter(Boolean);
      const renderedBy = graph.edges
        .filter((edge) => edge.kind === "renders" && edge.target === component.id)
        .map((edge) => byId.get(edge.source))
        .filter(Boolean);
      return text({ component: component.effectiveName, renders, renderedBy });
    },
  );

  server.tool(
    "analyze_prop_change_impact",
    "Estimate direct and transitive consumers affected by a component API change.",
    {
      root_path: z.string(),
      component: z.string(),
      proposed_change: z.string().optional(),
    },
    async ({ root_path, component: selector, proposed_change }) => {
      const graph = await loadProjectGraph(root_path);
      const component = requireComponent(graph, selector);
      return text({
        component,
        proposedChange: proposed_change,
        ...componentImpact(graph, component.id),
      });
    },
  );

  server.tool(
    "get_component_playground",
    "Return inferred controls, semantic design tokens, CSS pipeline fidelity, renderability, and saved preview scenarios for a component.",
    {
      root_path: z.string(),
      component: z.string(),
    },
    async ({ root_path, component }) =>
      text(await getComponentPlayground(root_path, component)),
  );

  server.tool(
    "save_component_scenario",
    "Save a deterministic prop, token, viewport, and background state that humans and agents can reopen.",
    {
      root_path: z.string(),
      component: z.string(),
      name: z.string().min(1),
      id: z.string().optional(),
      props: z.record(z.unknown()).optional(),
      tokens: z.record(z.string()).optional(),
      viewport: z
        .object({
          width: z.number().int().min(240).max(2560),
          height: z.number().int().min(200).max(1600),
        })
        .optional(),
      background: z.string().optional(),
      notes: z.string().optional(),
    },
    async ({
      root_path,
      component,
      name,
      id,
      props,
      tokens,
      viewport,
      background,
      notes,
    }) =>
      text(
        await savePreviewScenario({
          rootPath: root_path,
          component,
          name,
          ...(id ? { id } : {}),
          props: props ?? {},
          tokens: tokens ?? {},
          ...(viewport ? { viewport } : {}),
          ...(background ? { background } : {}),
          ...(notes ? { notes } : {}),
        }),
      ),
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
