import { describe, expect, it } from "vitest";
import {
  buildChangeSurface,
  buildComponentContext,
  buildImpactContext,
  buildReuseContext,
  searchComponentContext,
} from "./context.js";
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
    salary.events = [{ name: "save", payload: "amount: number" }];
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
      api: {
        events: [{ name: "save", payload: "amount: number" }],
        totalEvents: 1,
      },
      tests: ["test/MonthlySalaryDialog.test.ts"],
    });
    expect(context.nextActions.join(" ")).toContain("feature ownership");
    expect(JSON.stringify(context)).not.toContain("classTokens");

    const focused = buildComponentContext(graph, "MonthlySalaryDialog");
    expect(focused.component.name).toBe("MonthlySalaryDialog");
    expect(focused.relations.renders[0]?.name).toBe("UiModal");
    expect(focused.impact.transitiveConsumers).toBe(1);
    expect(focused.api.events).toEqual([
      { name: "save", payload: "amount: number" },
    ]);
    expect(focused.tests).toEqual(["test/MonthlySalaryDialog.test.ts"]);
    expect(JSON.stringify(focused)).not.toContain("classTokens");

    const search = searchComponentContext(graph, "monthly salary dialog", 3);
    expect(search[0]?.component).toMatchObject({
      name: "MonthlySalaryDialog",
      path: "components/MonthlySalaryDialog.vue",
    });
    expect(JSON.stringify(search)).not.toContain("renderedNames");

    const impact = buildImpactContext(graph, "MonthlySalaryDialog");
    expect(impact).toMatchObject({
      risk: "contained",
      directConsumers: 1,
      direct: [expect.objectContaining({ name: "SalaryPage" })],
      api: {
        props: [
          { name: "title", type: "string", required: true },
          { name: "amount", type: "string", required: true },
        ],
        events: [{ name: "save", payload: "amount: number" }],
      },
      tests: ["test/MonthlySalaryDialog.test.ts"],
    });

    const consumers = Array.from({ length: 25 }, (_, index) =>
      component(`ModalConsumer${index}`, "feature", [], ["UiModal"]),
    );
    const crowdedComponents = [modal, ...consumers];
    const crowdedGraph: ComponentGraph = {
      ...graph,
      components: crowdedComponents,
      edges: buildGraphEdges(crowdedComponents),
    };
    const crowdedImpact = buildImpactContext(crowdedGraph, "UiModal");
    expect(crowdedImpact).toMatchObject({
      risk: "high",
      directConsumers: 25,
      transitiveConsumers: 25,
    });
    expect(crowdedImpact.direct).toHaveLength(10);
    expect(crowdedImpact.transitive).toHaveLength(20);
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

  it("keeps one login challenge primary and Backoffice reference-only", () => {
    const otp = component("OtpInput", "public", []);
    const login = component(
      "LoginChallenge",
      "feature",
      ["challengeId"],
      ["OtpInput"],
    );
    const backoffice = component("BackofficeLogin", "feature", []);
    const profile = component("ProfileFingerprintModal", "feature", []);
    const graph: ComponentGraph = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      project: {
        id: "auth-fixture",
        name: "auth-fixture",
        rootPath: "/fixture",
        framework: "vue",
        scannedAt: new Date(0).toISOString(),
        sourceFiles: 4,
      },
      components: [otp, login, backoffice, profile],
      edges: buildGraphEdges([otp, login, backoffice, profile]),
      tokens: [],
    };

    const surface = buildChangeSurface(graph, "login OTP challenge", {
      primaryComponent: "LoginChallenge",
      secondaryComponents: ["BackofficeLogin"],
      outOfScope: ["ProfileFingerprintModal", "profile flow"],
    });

    expect(surface).toMatchObject({
      selection: "explicit",
      primary: { name: "LoginChallenge" },
      references: [
        {
          component: { name: "BackofficeLogin" },
          role: "secondary-reference",
        },
      ],
      outOfScope: ["ProfileFingerprintModal", "profile flow"],
    });
    expect(surface.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "components/LoginChallenge.vue",
          role: "implementation",
        }),
        expect.objectContaining({
          path: "components/OtpInput.vue",
          role: "dependency-reference",
        }),
      ]),
    );
    expect(JSON.stringify(surface)).not.toContain("classTokens");
  });
});
