import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ACTION_CENTER_SCHEMA_VERSION,
  GRAPH_SCHEMA_VERSION,
  type ActionCenterMutation,
  type ComponentGraph,
  type ProjectCapabilityReport,
} from "@component-atlas/core";
import type { MemoryItem } from "@component-atlas/memory";
import type { ProjectAtlasSnapshot } from "@component-atlas/runtime";
import { AtlasStore } from "@component-atlas/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildActionCenterSnapshot,
  executeActionMutation,
  executeBulkActionMutations,
} from "./action-center";

const capturedAt = "2026-07-26T12:00:00.000Z";
let dataRoot = "";
let previousDataRoot: string | undefined;

function memory(
  id: string,
  title: string,
  overrides: Partial<MemoryItem> = {},
): MemoryItem {
  return {
    schemaVersion: 1,
    id,
    projectId: "project",
    namespace: "project",
    type: "constraint",
    title,
    summary: `${title} summary`,
    status: "active",
    confidence: 1,
    authority: "decided",
    scope: "canonical",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    tags: [],
    provenance: { kind: "markdown" },
    supersedes: [],
    relations: [],
    ...overrides,
  };
}

function graph(): ComponentGraph {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    project: {
      id: "project",
      name: "Fixture",
      rootPath: "C:\\fixture",
      framework: "vue",
      scannedAt: capturedAt,
      sourceFiles: 0,
      identity: {
        logicalId: "project",
        repositoryFingerprint: "repository",
        source: "path",
        checkoutId: "checkout",
        worktreePath: "C:\\fixture",
      },
    },
    components: [],
    edges: [],
    tokens: [],
  };
}

function fixtureSnapshot(): ProjectAtlasSnapshot {
  return {
    fingerprint: "workspace-v1",
    capturedAt,
    graph: graph(),
    designIndexes: [],
    memoryItems: [
      memory("rule-one", "Rule one", {
        relations: [{ kind: "contradicts", targetId: "rule-two" }],
      }),
      memory("rule-two", "Rule two", {
        relations: [{ kind: "contradicts", targetId: "rule-one" }],
      }),
      memory("stale-one", "Stale one", { reviewAfter: "2025-01-01" }),
      memory("stale-two", "Stale two", { reviewAfter: "2025-02-01" }),
    ],
    memoryProposals: [],
    componentDecisions: [],
  };
}

function capabilities(): ProjectCapabilityReport {
  return {
    schemaVersion: 1,
    projectId: "project",
    checkedAt: capturedAt,
    observations: [],
  };
}

function mutation(
  item: ReturnType<typeof center>["items"][number],
  overrides: Partial<ActionCenterMutation> = {},
): ActionCenterMutation {
  return {
    schemaVersion: ACTION_CENTER_SCHEMA_VERSION,
    itemId: item.id,
    projectId: item.projectId,
    checkoutId: item.checkoutId,
    command: item.type === "contradiction"
      ? "resolve-contradiction"
      : "mark-reviewed",
    scope: "evidence",
    reason: "Reviewed against current evidence.",
    ...(item.options?.[0]
      ? {
          selectedOption: item.options[0].id,
          authorityHandle: item.options[0].id,
        }
      : {}),
    expectedWorkspaceFingerprint: "workspace-v1",
    expectedEvidenceFingerprint: item.evidenceFingerprint,
    idempotencyKey: `request:${item.id}`,
    ...overrides,
  };
}

function center() {
  return buildActionCenterSnapshot(
    fixtureSnapshot(),
    capabilities(),
    [],
    [],
  );
}

beforeEach(async () => {
  previousDataRoot = process.env.COMPONENT_ATLAS_HOME;
  dataRoot = await mkdtemp(path.join(os.tmpdir(), "atlas-action-center-"));
  process.env.COMPONENT_ATLAS_HOME = dataRoot;
});

afterEach(async () => {
  if (previousDataRoot === undefined) {
    delete process.env.COMPONENT_ATLAS_HOME;
  } else {
    process.env.COMPONENT_ATLAS_HOME = previousDataRoot;
  }
  await rm(dataRoot, { recursive: true, force: true });
});

describe("Action Center server orchestration", () => {
  it("projects contradictions once and records an idempotent authority choice", () => {
    const snapshot = center();
    const contradiction = snapshot.items.find(
      (item) => item.type === "contradiction",
    )!;
    expect(snapshot.items.filter((item) => item.type === "contradiction")).toHaveLength(1);
    expect(contradiction.evidence).toHaveLength(2);

    const input = mutation(contradiction);
    expect(executeActionMutation(snapshot, input)).toMatchObject({
      duplicate: false,
      resolution: {
        itemId: contradiction.id,
        state: "resolved",
        authorityHandle: contradiction.options![0]!.id,
      },
    });
    expect(executeActionMutation(snapshot, input)).toMatchObject({
      duplicate: true,
    });
  });

  it("rejects an entire safe bulk request before persistence when one fingerprint is stale", () => {
    const snapshot = center();
    const warnings = snapshot.items.filter(
      (item) => item.type === "warning" && item.state === "stale",
    );
    expect(warnings).toHaveLength(2);
    expect(() =>
      executeBulkActionMutations(snapshot, [
        mutation(warnings[0]!),
        mutation(warnings[1]!, { expectedEvidenceFingerprint: "old" }),
      ]),
    ).toThrow(/Evidence changed after review/);

    const store = new AtlasStore("project");
    try {
      expect(store.listActionResolutions("project", "checkout")).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("persists compatible safe triage as one batch", () => {
    const snapshot = center();
    const warnings = snapshot.items.filter(
      (item) => item.type === "warning" && item.state === "stale",
    );
    const results = executeBulkActionMutations(
      snapshot,
      warnings.map((item) => mutation(item)),
    );
    expect(results).toHaveLength(2);
    expect(results.every((result) => !result.duplicate)).toBe(true);

    const store = new AtlasStore("project");
    try {
      expect(store.listActionResolutions("project", "checkout")).toHaveLength(2);
    } finally {
      store.close();
    }
  });
});
