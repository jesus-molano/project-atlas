import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assessLatestFigmaSnapshotReuse,
  expandFigmaSnapshot,
  loadFigmaSnapshot,
  loadLatestFigmaSnapshot,
  persistFigmaSnapshot,
  persistFigmaSnapshotWithCheckpoint,
  type PersistFigmaSnapshotInput,
} from "./figma-snapshot.js";

const roots: string[] = [];
let previousAtlasHome: string | undefined;

beforeEach(async () => {
  previousAtlasHome = process.env.PROJECT_ATLAS_HOME;
  const home = await mkdtemp(path.join(os.tmpdir(), "atlas-figma-snapshot-home-"));
  roots.push(home);
  process.env.PROJECT_ATLAS_HOME = home;
});

afterEach(async () => {
  if (previousAtlasHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousAtlasHome;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function repository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-figma-snapshot-project-"));
  roots.push(root);
  return root;
}

function emptyItem(id: string, name = id) {
  return {
    id,
    name,
    type: "FRAME",
    tokenRefs: [] as string[],
    properties: [] as Array<{ name: string; value?: string }>,
    variants: [] as Array<{ name: string; value: string }>,
    assetRefs: [] as string[],
  };
}

function snapshotInput(): PersistFigmaSnapshotInput {
  return {
    taskId: "task-figma-checkout",
    identity: {
      fileKey: "AtlasCheckoutFile",
      nodeId: "39:2731",
      version: "1842098345",
      lastModified: "2026-08-23T09:55:00.000Z",
    },
    observedAt: "2026-08-23T10:00:00.000Z",
    receiptIds: ["receipt-0123456789abcdef"],
    coverage: {
      nodes: { status: "complete", omitted: 0 },
      components: { status: "complete", omitted: 0 },
      styles: { status: "partial", omitted: 2 },
      states: { status: "complete", omitted: 0 },
      assets: { status: "not-requested", omitted: 0 },
    },
    content: {
      nodes: [
        {
          ...emptyItem("39:2731", "Checkout / Desktop"),
          nodeId: "39:2731",
          tokenRefs: ["color.surface.default", "space.400"],
        },
      ],
      components: [
        {
          ...emptyItem("component:button", "Button"),
          type: "COMPONENT_SET",
          properties: [{ name: "label" }],
          variants: [
            { name: "State", value: "Default" },
            { name: "Size", value: "Large" },
          ],
        },
      ],
      styles: [
        {
          ...emptyItem("style:surface", "Surface / Default"),
          type: "PAINT",
          tokenRefs: ["color.surface.default"],
        },
      ],
      states: [
        {
          ...emptyItem("state:button:disabled", "Button / Disabled"),
          type: "VARIANT",
          nodeId: "39:2750",
          variants: [{ name: "State", value: "Disabled" }],
        },
      ],
      assets: [],
    },
    createdAt: "2026-08-23T10:01:00.000Z",
  };
}

describe("Figma semantic snapshot", () => {
  it("assesses task-local reuse before a deep Figma read", async () => {
    const root = await repository();
    const snapshot = await persistFigmaSnapshot(root, snapshotInput());

    await expect(
      assessLatestFigmaSnapshotReuse(root, {
        taskId: snapshot.taskId,
        scope: { fileKey: "AtlasCheckoutFile", nodeId: "39:2731" },
        requiredCategories: ["nodes", "components"],
      }),
    ).resolves.toMatchObject({
      status: "metadata-required",
      snapshot: { handle: snapshot.handle },
      providerRead: "metadata-only",
      quotaWarning: expect.stringMatching(/quota/iu),
    });

    await expect(
      assessLatestFigmaSnapshotReuse(root, {
        taskId: snapshot.taskId,
        scope: { fileKey: "AtlasCheckoutFile", nodeId: "39-2731" },
        currentIdentity: snapshot.identity,
        requiredCategories: ["nodes", "components"],
      }),
    ).resolves.toMatchObject({
      status: "reusable",
      snapshot: { handle: snapshot.handle },
      providerRead: "skip-deep-read",
      missingCategories: [],
      changedIdentityFields: [],
    });

    await expect(
      assessLatestFigmaSnapshotReuse(root, {
        taskId: snapshot.taskId,
        scope: { fileKey: "AtlasCheckoutFile", nodeId: "39:2731" },
        currentIdentity: snapshot.identity,
        requiredCategories: ["styles"],
      }),
    ).resolves.toMatchObject({
      status: "refresh-required",
      providerRead: "bounded-deep-read",
      missingCategories: ["styles"],
      quotaWarning: expect.stringMatching(/quota/iu),
    });

    await expect(
      assessLatestFigmaSnapshotReuse(root, {
        taskId: snapshot.taskId,
        scope: { fileKey: "AtlasCheckoutFile", nodeId: "39:2731" },
        currentIdentity: { ...snapshot.identity, version: "1842098346" },
        requiredCategories: ["nodes"],
      }),
    ).resolves.toMatchObject({
      status: "refresh-required",
      changedIdentityFields: ["version"],
      providerRead: "bounded-deep-read",
    });

    await expect(
      assessLatestFigmaSnapshotReuse(root, {
        taskId: snapshot.taskId,
        scope: { fileKey: "AtlasCheckoutFile", nodeId: "99:1" },
        requiredCategories: ["nodes"],
      }),
    ).resolves.toMatchObject({
      status: "not-cached",
      providerRead: "bounded-deep-read",
    });
  });

  it("persists immutable content-addressed evidence and requires explicit revisions", async () => {
    const root = await repository();
    const first = await persistFigmaSnapshot(root, snapshotInput());

    expect(first).toMatchObject({
      handle: expect.stringMatching(
        /^figma-snapshot:task-figma-checkout:[a-f0-9]{16}$/u,
      ),
      revision: 1,
      identity: {
        fileKey: "AtlasCheckoutFile",
        nodeId: "39:2731",
        version: "1842098345",
        lastModified: "2026-08-23T09:55:00.000Z",
      },
    });
    await expect(loadFigmaSnapshot(root, first.handle)).resolves.toEqual(first);
    await expect(loadLatestFigmaSnapshot(root, first.taskId)).resolves.toEqual(first);

    const identical = await persistFigmaSnapshot(root, {
      ...snapshotInput(),
      createdAt: "2026-08-23T10:05:00.000Z",
    });
    expect(identical).toEqual(first);

    const changed = snapshotInput();
    changed.content.styles[0]!.tokenRefs = ["color.surface.raised"];
    await expect(persistFigmaSnapshot(root, changed)).rejects.toThrow(
      /latest revision/iu,
    );

    const second = await persistFigmaSnapshot(root, {
      ...changed,
      previousHandle: first.handle,
      createdAt: "2026-08-23T10:10:00.000Z",
    });
    expect(second).toMatchObject({ revision: 2, previousHandle: first.handle });
    expect(second.handle).not.toBe(first.handle);
    await expect(loadFigmaSnapshot(root, first.handle)).resolves.toEqual(first);
    await expect(loadLatestFigmaSnapshot(root, first.taskId)).resolves.toEqual(
      second,
    );
  });

  it("rejects item and byte overflows instead of silently truncating", async () => {
    const root = await repository();
    const tooMany = snapshotInput();
    tooMany.content.nodes = Array.from({ length: 129 }, (_, index) =>
      emptyItem(`node:${index}`),
    );
    await expect(persistFigmaSnapshot(root, tooMany)).rejects.toThrow(
      /128-item limit/iu,
    );

    const oversized = snapshotInput();
    oversized.content.nodes = Array.from({ length: 100 }, (_, index) => ({
      ...emptyItem(`node:${index}`, `${index}-${"n".repeat(220)}`),
      tokenRefs: Array.from(
        { length: 24 },
        (__, token) => `token.${index}.${token}.${"x".repeat(180)}`,
      ),
    }));
    await expect(persistFigmaSnapshot(root, oversized)).rejects.toThrow(
      /storage budget/iu,
    );
  });

  it("rejects raw payload fields, bodies, SVG and temporary URLs", async () => {
    const root = await repository();
    const rawPayload = snapshotInput() as PersistFigmaSnapshotInput & {
      rawPayload: unknown;
    };
    rawPayload.rawPayload = { document: { children: [] } };
    await expect(persistFigmaSnapshot(root, rawPayload)).rejects.toThrow(
      /unsupported field rawPayload/iu,
    );

    const body = snapshotInput();
    (body.content.nodes[0] as unknown as Record<string, unknown>).body =
      "raw MCP body";
    await expect(persistFigmaSnapshot(root, body)).rejects.toThrow(
      /unsupported field body/iu,
    );

    const svg = snapshotInput();
    svg.content.styles[0]!.name = "<svg><path /></svg>";
    await expect(persistFigmaSnapshot(root, svg)).rejects.toThrow(/raw\/temporary/iu);

    const temporaryUrl = snapshotInput();
    temporaryUrl.content.nodes[0]!.assetRefs = [
      "http://127.0.0.1:3845/assets/image.svg",
    ];
    await expect(persistFigmaSnapshot(root, temporaryUrl)).rejects.toThrow(
      /raw\/temporary|immutable handles/iu,
    );
  });

  it("requires explicit and internally consistent category coverage", async () => {
    const root = await repository();
    const incomplete = snapshotInput();
    incomplete.coverage.styles = { status: "partial", omitted: 0 };
    await expect(persistFigmaSnapshot(root, incomplete)).rejects.toThrow(
      /partial coverage requires an omitted count/iu,
    );

    const notRequested = snapshotInput();
    notRequested.coverage.nodes = { status: "not-requested", omitted: 0 };
    await expect(persistFigmaSnapshot(root, notRequested)).rejects.toThrow(
      /cannot be stored when not requested/iu,
    );
  });

  it("keeps the writer lock until checkpoint publication and never steals it", async () => {
    const root = await repository();
    const first = await persistFigmaSnapshot(root, snapshotInput());
    let releaseCheckpoint!: () => void;
    const holdCheckpoint = new Promise<void>((resolve) => {
      releaseCheckpoint = resolve;
    });
    let enteredCheckpoint!: () => void;
    const checkpointEntered = new Promise<void>((resolve) => {
      enteredCheckpoint = resolve;
    });
    const writerAInput = snapshotInput();
    writerAInput.previousHandle = first.handle;
    writerAInput.identity = { ...writerAInput.identity, version: "1842098346" };
    const writerA = persistFigmaSnapshotWithCheckpoint(
      root,
      writerAInput,
      async () => {
        enteredCheckpoint();
        await holdCheckpoint;
        return "capsule-checkpointed";
      },
    );
    await checkpointEntered;

    const writerBInput = snapshotInput();
    writerBInput.previousHandle = first.handle;
    writerBInput.identity = { ...writerBInput.identity, version: "1842098347" };
    await expect(persistFigmaSnapshot(root, writerBInput)).rejects.toThrow(
      /locked by another writer.*Do not remove/isu,
    );

    releaseCheckpoint();
    const result = await writerA;
    expect(result.checkpoint).toBe("capsule-checkpointed");
    await expect(loadLatestFigmaSnapshot(root, first.taskId)).resolves.toEqual(
      result.snapshot,
    );
  });

  it("expands a large snapshot within the requested context budget", async () => {
    const root = await repository();
    const input = snapshotInput();
    input.content.nodes = Array.from({ length: 40 }, (_, index) => ({
      ...emptyItem(`node:${index}`, `Checkout node ${index}`),
      tokenRefs: [`space.${index}`, `color.surface.${index}`],
    }));
    const snapshot = await persistFigmaSnapshot(root, input);
    const expanded = await expandFigmaSnapshot(root, snapshot.handle, 800);
    expect(JSON.stringify(expanded).length).toBeLessThanOrEqual(800);
    expect(expanded.metrics).toMatchObject({
      budgetChars: 800,
      truncated: true,
      totalMatches: 43,
    });
  });
});
