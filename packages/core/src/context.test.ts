import { describe, expect, it } from "vitest";
import { buildReuseContext } from "./context.js";
import { buildGraphEdges } from "./graph.js";
import {
  GRAPH_SCHEMA_VERSION,
  type ComponentGraph,
  type ComponentNode,
} from "./types.js";

function component(
  name: string,
  visibility: ComponentNode["visibility"],
  props: string[],
  renderedNames: string[] = [],
): ComponentNode {
  return {
    id: `vue:${name}.vue#${name}`,
    framework: "vue",
    name,
    effectiveName: name,
    sourcePath: `/components/${name}.vue`,
    relativePath: `components/${name}.vue`,
    visibility,
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
    testPaths: [`test/${name}.test.ts`],
    classTokens: ["surface", "rounded"],
    sourceHash: name,
  };
}

describe("reuse context", () => {
  it("returns a compact candidate neighborhood and decision hints", () => {
    const modal = component("UiModal", "public", ["title"]);
    const salary = component(
      "MonthlySalaryDialog",
      "feature",
      ["title", "amount"],
      ["UiModal"],
    );
    const savings = component(
      "MonthlySavingsDialog",
      "feature",
      ["title", "amount"],
      ["UiModal"],
    );
    const page = component("SalaryPage", "feature", [], ["MonthlySalaryDialog"]);
    const components = [modal, salary, savings, page];
    const graph: ComponentGraph = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      project: {
        id: "fixture",
        name: "fixture",
        rootPath: "/fixture",
        framework: "vue",
        scannedAt: new Date(0).toISOString(),
        sourceFiles: components.length,
      },
      components,
      edges: buildGraphEdges(components),
      tokens: [],
    };

    const context = buildReuseContext(graph, "salary dialog", 3);

    expect(context.candidates[0]).toMatchObject({
      component: {
        name: "MonthlySalaryDialog",
        scope: "feature",
      },
      relations: {
        renders: [expect.objectContaining({ name: "UiModal" })],
        similar: [
          expect.objectContaining({
            component: expect.objectContaining({ name: "MonthlySavingsDialog" }),
          }),
        ],
      },
      impact: {
        directConsumers: 1,
        transitiveConsumers: 1,
      },
    });
    expect(context.nextActions.join(" ")).toContain("feature ownership");
    expect(JSON.stringify(context)).not.toContain("classTokens");
  });

  it("requires a concrete intent", () => {
    const graph: ComponentGraph = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      project: {
        id: "fixture",
        name: "fixture",
        rootPath: "/fixture",
        framework: "vue",
        scannedAt: new Date(0).toISOString(),
        sourceFiles: 0,
      },
      components: [],
      edges: [],
      tokens: [],
    };

    expect(() => buildReuseContext(graph, "   ")).toThrow("non-empty");
  });
});
