import { describe, expect, it } from "vitest";
import { buildGraphEdges, compareComponents, searchComponents } from "./graph.js";
import {
  GRAPH_SCHEMA_VERSION,
  type ComponentGraph,
  type ComponentNode,
} from "./types.js";

function component(
  name: string,
  props: string[],
  renderedNames: string[],
): ComponentNode {
  return {
    id: `vue:${name}.vue#${name}`,
    framework: "vue",
    name,
    effectiveName: name,
    sourcePath: `/${name}.vue`,
    relativePath: `${name}.vue`,
    visibility: "feature",
    exported: true,
    location: { line: 1, column: 1 },
    props: props.map((prop) => ({
      name: prop,
      type: "string",
      required: true,
    })),
    events: [],
    slots: [],
    models: [],
    renderedNames,
    imports: [],
    testPaths: [],
    classTokens: ["rounded", "surface"],
    sourceHash: name,
  };
}

describe("component graph", () => {
  const salary = component(
    "MonthlySalaryDialog",
    ["title", "amount"],
    ["UiModal", "UiButton"],
  );
  const savings = component(
    "MonthlySavingsDialog",
    ["title", "amount"],
    ["UiModal", "UiButton"],
  );

  it("produces explainable similarity", () => {
    const evidence = compareComponents(salary, savings);
    expect(evidence.score).toBeGreaterThan(0.7);
    expect(evidence.reasons.join(" ")).toContain("shared props");
  });

  it("searches and connects known component names", () => {
    const modal = component("UiModal", ["title"], []);
    const graph: ComponentGraph = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      project: {
        id: "fixture",
        name: "fixture",
        rootPath: "/fixture",
        framework: "vue",
        scannedAt: new Date(0).toISOString(),
        sourceFiles: 3,
      },
      components: [salary, savings, modal],
      edges: buildGraphEdges([salary, savings, modal]),
      tokens: [],
    };
    expect(searchComponents(graph, "salary")[0]?.component.name).toBe(
      "MonthlySalaryDialog",
    );
    expect(
      graph.edges.some(
        (edge) =>
          edge.kind === "renders" &&
          edge.source === salary.id &&
          edge.target === modal.id,
      ),
    ).toBe(true);
  });
});
