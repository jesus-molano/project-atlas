import { describe, expect, it } from "vitest";
import {
  GRAPH_SCHEMA_VERSION,
  type ComponentGraph,
} from "@component-atlas/core";
import {
  buildProjectSearchViewModel,
  type ProjectAtlasSnapshot,
} from "./view-models.js";

describe("project search view model", () => {
  it("finds exact JavaScript and server-side entities without component aliases", () => {
    const graph: ComponentGraph = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      project: {
        id: "search-fixture",
        name: "search-fixture",
        rootPath: "/fixture",
        framework: "vue",
        scannedAt: new Date(0).toISOString(),
        sourceFiles: 1,
      },
      components: [],
      entities: [
        {
          id: "vue:service:server/api/profile.get.ts#profile.get",
          kind: "service",
          framework: "vue",
          name: "profile.get",
          sourcePath: "/fixture/server/api/profile.get.ts",
          relativePath: "server/api/profile.get.ts",
          exported: true,
          exportName: "profile.get",
          location: { line: 1, column: 1 },
          sourceHash: "profile",
          resolution: "exact",
          provenance: {
            sourcePath: "server/api/profile.get.ts",
            symbol: "profile.get",
            analyzer: "typescript-program",
          },
        },
      ],
      edges: [],
      tokens: [],
    };
    const snapshot: ProjectAtlasSnapshot = {
      fingerprint: "fixture",
      capturedAt: new Date(0).toISOString(),
      graph,
      designIndexes: [],
      memoryItems: [],
      memoryProposals: [],
      componentDecisions: [],
    };

    const result = buildProjectSearchViewModel(
      snapshot,
      "server/api/profile.get.ts",
    );

    expect(result.counts.code).toBe(1);
    expect(result.results[0]).toMatchObject({
      kind: "service",
      title: "profile.get",
      subtitle: "server/api/profile.get.ts",
      reasons: expect.arrayContaining(["exact path"]),
      target: {
        section: "code",
        id: "vue:service:server/api/profile.get.ts#profile.get",
      },
    });
  });
});
