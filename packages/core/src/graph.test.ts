import { describe, expect, it } from "vitest";
import {
  buildGraphEdges,
  compareComponents,
  componentImpact,
  searchComponents,
} from "./graph.js";
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
      searchComponents(
        { ...graph, components: [modal] },
        "confirmation sheet",
      )[0]?.component.name,
    ).toBe("UiModal");
    expect(
      graph.edges.some(
        (edge) =>
          edge.kind === "renders" &&
          edge.source === salary.id &&
          edge.target === modal.id,
      ),
    ).toBe(true);
  });

  it("terminates on cyclic render graphs without reporting the target as its own consumer", () => {
    const left = component("LeftPanel", [], []);
    const right = component("RightPanel", [], []);
    const graph: ComponentGraph = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      project: {
        id: "cyclic-fixture",
        name: "cyclic-fixture",
        rootPath: "/fixture",
        framework: "vue",
        scannedAt: new Date(0).toISOString(),
        sourceFiles: 2,
      },
      components: [left, right],
      edges: [
        {
          id: "left-right",
          kind: "renders",
          source: left.id,
          target: right.id,
        },
        {
          id: "right-left",
          kind: "renders",
          source: right.id,
          target: left.id,
        },
        {
          id: "left-left",
          kind: "renders",
          source: left.id,
          target: left.id,
        },
      ],
      tokens: [],
    };

    const impact = componentImpact(graph, left.id);
    expect(impact.directConsumers.map((item) => item.id)).toEqual([right.id]);
    expect(impact.transitiveConsumers.map((item) => item.id)).toEqual([right.id]);
  });

  it("bounds similarity edges for large families with the same public shape", () => {
    const family = Array.from({ length: 300 }, (_, index) =>
      component(`ListItem${String(index).padStart(3, "0")}`, ["label"], []),
    );
    const similarities = buildGraphEdges(family).filter(
      (edge) => edge.kind === "similar_to",
    );
    expect(similarities.length).toBeGreaterThan(0);
    expect(similarities.length).toBeLessThanOrEqual(family.length * 8);
  });
});
