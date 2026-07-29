import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GRAPH_SCHEMA_VERSION,
  type ComponentGraph,
  type ComponentNode,
} from "@component-atlas/core";
import type { MemoryItem } from "@component-atlas/memory";
import { AtlasStore } from "./index.js";

let dataHome = "";

function component(sourceHash: string): ComponentNode {
  return {
    id: `button-${sourceHash}`,
    framework: "vue",
    name: "AtlasButton",
    effectiveName: "AtlasButton",
    sourcePath: `/checkout/components/AtlasButton.vue`,
    relativePath: "components/AtlasButton.vue",
    visibility: "public",
    exported: true,
    location: { line: 1, column: 1 },
    props: [],
    events: [],
    slots: [],
    models: [],
    renderedNames: [],
    imports: [],
    testPaths: [],
    classTokens: [],
    sourceHash,
  };
}

function graph(checkoutId: string, sourceHash: string): ComponentGraph {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    project: {
      id: "logical-project",
      name: "Atlas fixture",
      rootPath: `/worktrees/${checkoutId}`,
      framework: "vue",
      scannedAt: `2026-07-28T00:00:0${checkoutId === "one" ? "1" : "2"}.000Z`,
      sourceFiles: 1,
      identity: {
        logicalId: "logical-project",
        repositoryFingerprint: "repository",
        source: "remote",
        checkoutId,
        worktreePath: `/worktrees/${checkoutId}`,
      },
    },
    components: [component(sourceHash)],
    edges: [],
    tokens: [],
  };
}

function memory(
  id: string,
  summary: string,
  scope: "canonical" | "local",
  checkoutId?: string,
): MemoryItem {
  return {
    schemaVersion: 1,
    id,
    projectId: "logical-project",
    ...(checkoutId ? { checkoutId } : {}),
    namespace: "atlas",
    type: "decision",
    title: id,
    summary,
    status: "active",
    confidence: 1,
    authority: "decided",
    scope,
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    tags: [],
    provenance: { kind: "import" },
    supersedes: [],
    relations: [],
  };
}

describe.sequential("logical project component catalog", () => {
  beforeEach(async () => {
    dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-catalog-"));
    process.env.COMPONENT_ATLAS_HOME = dataHome;
  });

  afterEach(async () => {
    delete process.env.COMPONENT_ATLAS_HOME;
    await rm(dataHome, { recursive: true, force: true });
  });

  it("shares semantic identity while retaining checkout provenance", () => {
    const store = new AtlasStore("logical-project");
    try {
      store.replaceGraph(graph("one", "hash-a"));
      store.replaceGraph(graph("two", "hash-b"));
      const [entry] = store.listComponentCatalog("logical-project");
      expect(entry).toMatchObject({
        semanticKey: "vue:components/atlasbutton.vue#atlasbutton",
        divergent: true,
        provenance: {
          scope: "project",
          promotion: "derived",
          invalidatesOn: "rescan",
        },
      });
      expect(entry?.sightings.map((item) => item.checkoutId).sort()).toEqual([
        "one",
        "two",
      ]);

      store.replaceGraph({
        ...graph("one", "hash-a"),
        components: [],
      });
      expect(
        store.listComponentCatalog("logical-project")[0]?.sightings,
      ).toHaveLength(1);
      expect(
        store.listComponentCatalog("logical-project")[0]?.sightings[0]
          ?.checkoutId,
      ).toBe("two");
    } finally {
      store.close();
    }
  });

  it("keeps multiple exported symbols from one source file distinct", () => {
    const store = new AtlasStore("logical-project");
    try {
      const primary = component("hash-primary");
      const secondary: ComponentNode = {
        ...primary,
        id: "button-secondary",
        name: "AtlasButtonIcon",
        effectiveName: "AtlasButtonIcon",
        exportName: "AtlasButtonIcon",
        sourceHash: "hash-secondary",
      };
      store.replaceGraph({
        ...graph("one", "hash-primary"),
        components: [
          { ...primary, exportName: "default" },
          secondary,
        ],
      });

      expect(
        store
          .listComponentCatalog("logical-project")
          .map((entry) => entry.semanticKey)
          .sort(),
      ).toEqual([
        "vue:components/atlasbutton.vue#atlasbuttonicon",
        "vue:components/atlasbutton.vue#default",
      ]);
    } finally {
      store.close();
    }
  });

  it("keeps routes and layouts out of the reusable project catalog", () => {
    const store = new AtlasStore("logical-project");
    try {
      const reusable = component("hash-component");
      const route: ComponentNode = {
        ...reusable,
        id: "route-home",
        name: "HomePage",
        effectiveName: "HomePage",
        relativePath: "pages/index.vue",
        sourcePath: "/checkout/pages/index.vue",
        kind: "route",
        routePath: "/",
        exported: false,
      };
      store.replaceGraph({
        ...graph("one", "hash-component"),
        components: [reusable, route],
      });

      expect(store.listComponentCatalog("logical-project")).toHaveLength(1);
      expect(store.listComponentCatalog("logical-project")[0]?.name).toBe(
        "AtlasButton",
      );
    } finally {
      store.close();
    }
  });

  it("shares canonical memory without mixing checkout-local memory", () => {
    const store = new AtlasStore("logical-project");
    try {
      store.replaceGraph(graph("one", "hash-a"));
      store.replaceGraph(graph("two", "hash-b"));
      store.saveMemoryItem(
        "logical-project",
        memory("decision:shared", "Shared decision", "canonical"),
      );
      store.saveMemoryItem(
        "logical-project",
        memory("decision:branch", "Checkout one", "local", "one"),
      );
      store.saveMemoryItem(
        "logical-project",
        memory("decision:branch", "Checkout two", "local", "two"),
      );

      expect(
        store.listMemoryItems("logical-project").map((item) => item.summary),
      ).toEqual(["Shared decision"]);
      expect(
        store
          .listMemoryItems("logical-project", "one")
          .map((item) => item.summary)
          .sort(),
      ).toEqual(["Checkout one", "Shared decision"]);
      expect(
        store
          .listMemoryItems("logical-project", "two")
          .map((item) => item.summary)
          .sort(),
      ).toEqual(["Checkout two", "Shared decision"]);
      expect(
        store.loadMemoryItem("logical-project", "decision:branch", "one")
          ?.summary,
      ).toBe("Checkout one");
      expect(
        store.loadMemoryItem("logical-project", "decision:branch", "two")
          ?.summary,
      ).toBe("Checkout two");
    } finally {
      store.close();
    }
  });
});
