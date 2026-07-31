import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createSourceReceipt,
  sourceIdentityFromReference,
  taskSourceId,
  type TaskSourceDecision,
} from "@component-atlas/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertFigmaDesktopAssetUrl,
  captureFigmaAsset,
  loadFigmaAssetMetadata,
  materializeFigmaAsset,
  purgeExpiredFigmaAssets,
  purgeTaskFigmaAssets,
} from "./figma-assets.js";
import {
  persistSourceReceipts,
  writeTaskCheckpoint,
} from "./task-state.js";

let rootPath: string;
let dataHome: string;
let previousDataHome: string | undefined;
let receiptId: string;
const additionalRoots: string[] = [];
const taskId = "task-assets";
const reference =
  "https://www.figma.com/design/FileKey/Auth?node-id=39-2731";
const sourceDecisionId = taskSourceId("figma", reference);

function sourceDecisions(): TaskSourceDecision[] {
  return [
    {
      id: sourceDecisionId,
      kind: "figma",
      reference,
      origin: "explicit",
      state: "confirmed",
      required: true,
      authorityRole: "visual",
      routePolicy: {
        primaryAdapter: "figma-desktop-mcp-local",
        fallback: "deny",
      },
    },
  ];
}

function sourceReceipt() {
  const identity = sourceIdentityFromReference("figma", reference);
  return createSourceReceipt({
    sourceDecisionId,
    provider: "figma",
    requested: identity,
    resolved: identity,
    adapter: "figma-desktop-mcp-local",
    route: "http://127.0.0.1:3845/mcp",
    operation: "get_design_context",
    scope: {
      kind: "selection",
      id: "2064:5554",
      parentId: "39:2731",
    },
    scopeRelation: {
      kind: "contained-scope",
      sourceId: "39:2731",
      targetId: "2064:5554",
    },
    observedAt: "2026-07-29T12:00:00.000Z",
    coverage: "exact",
    freshness: "current",
  });
}

async function provisionCheckout(checkoutRoot: string): Promise<string> {
  const receipt = sourceReceipt();
  await writeTaskCheckpoint(checkoutRoot, {
    taskId,
    milestone: "source-resolved",
    objective: "Implement the selected OTP challenge",
    objectiveApproved: true,
    decisions: sourceDecisions(),
    sourceReceiptIds: [],
    handles: [],
    covered: ["Figma selection"],
    remaining: ["selected icons"],
    budgetChars: 2_400,
    nextSafeAction: "Capture only selected assets by handle.",
  });
  await persistSourceReceipts(checkoutRoot, [receipt]);
  return receipt.id;
}

beforeEach(async () => {
  previousDataHome = process.env.PROJECT_ATLAS_HOME;
  rootPath = await mkdtemp(path.join(os.tmpdir(), "atlas-assets-project-"));
  dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-assets-state-"));
  process.env.PROJECT_ATLAS_HOME = dataHome;
  receiptId = await provisionCheckout(rootPath);
});

afterEach(async () => {
  if (previousDataHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousDataHome;
  await Promise.all([
    rm(rootPath, { recursive: true, force: true }),
    rm(dataHome, { recursive: true, force: true }),
    ...additionalRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  ]);
});

describe("Figma asset handles", () => {
  async function temporaryTaskEntries(): Promise<string[]> {
    const assetsRoot = path.join(dataHome, "temp", "assets");
    const taskDirectories = await readdir(assetsRoot, { withFileTypes: true });
    const entries = await Promise.all(
      taskDirectories
        .filter((entry) => entry.isDirectory())
        .map(async (entry) =>
          (await readdir(path.join(assetsRoot, entry.name))).map((name) =>
            path.join(assetsRoot, entry.name, name),
          ),
        ),
    );
    return entries.flat();
  }

  async function metadataFile(handle: string): Promise<string> {
    const shortHash = handle.split(":").at(-1)!;
    const match = (await temporaryTaskEntries()).find((entry) =>
      entry.endsWith(`${shortHash}.json`),
    );
    if (!match) throw new Error(`Missing metadata fixture for ${handle}.`);
    return match;
  }

  it("keeps SVG bodies out of transport and materializes only an explicit asset", async () => {
    const before = await readdir(rootPath);
    const svg = Buffer.from(
      "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 20 20\"><path d=\"M1 1h18v18H1z\"/></svg>",
    );
    const load = vi.fn(async () => ({
      body: svg,
      contentType: "image/svg+xml",
    }));
    const metadata = await captureFigmaAsset(
      {
        rootPath,
        taskId,
        sourceReceiptId: receiptId,
        sourceUrl: "http://localhost:3845/assets/eye.svg",
        scopeNodeId: "2064:5554",
        assetNodeId: "2064:5600",
        fileName: "otp-eye.svg",
        at: "2026-07-29T12:00:00.000Z",
      },
      load,
    );

    expect(load).toHaveBeenCalledWith(
      "http://localhost:3845/assets/eye.svg",
      5_000_000,
    );
    expect(metadata).toMatchObject({
      schemaVersion: 2,
      handle: expect.stringMatching(/^figma-asset:task-assets:/),
      checkoutId: expect.stringMatching(/^[a-f0-9]{20}$/u),
      fileName: "otp-eye.svg",
      format: "svg",
      ephemeral: true,
    });
    expect(JSON.stringify(metadata)).not.toMatch(/<svg|localhost:3845/iu);
    expect(await readdir(rootPath)).toEqual(before);
    expect((await temporaryTaskEntries()).filter((entry) => entry.endsWith(".svg")))
      .toHaveLength(1);

    const otherCheckout = await mkdtemp(
      path.join(os.tmpdir(), "atlas-assets-other-checkout-"),
    );
    try {
      await expect(
        materializeFigmaAsset({
          rootPath: otherCheckout,
          handle: metadata.handle,
          destinationPath: "src/assets/otp-eye.svg",
          at: "2026-07-29T12:30:00.000Z",
        }),
      ).rejects.toThrow(/different checkout/i);
    } finally {
      await rm(otherCheckout, { recursive: true, force: true });
    }

    const materialized = await materializeFigmaAsset({
      rootPath,
      handle: metadata.handle,
      destinationPath: "src/assets/otp-eye.svg",
      at: "2026-07-29T12:30:00.000Z",
    });
    expect(materialized.projectPath).toBe("src/assets/otp-eye.svg");
    expect(materialized.temporaryAssetRemoved).toBe(true);
    expect(await readFile(path.join(rootPath, materialized.projectPath), "utf8"))
      .toBe(svg.toString("utf8"));
    expect(JSON.stringify(materialized)).not.toMatch(/localhost:3845|<svg/iu);
    expect((await temporaryTaskEntries()).filter((entry) => entry.endsWith(".svg")))
      .toHaveLength(0);
    await expect(loadFigmaAssetMetadata(metadata.handle, rootPath)).resolves
      .toMatchObject({ handle: metadata.handle, checkoutId: metadata.checkoutId });
    await expect(
      materializeFigmaAsset({
        rootPath,
        handle: metadata.handle,
        destinationPath: "src/assets/otp-eye.svg",
        at: "2026-07-29T12:30:00.000Z",
      }),
    ).rejects.toThrow(/already exists/i);
  });

  it("rejects unsafe routes, active SVG, path escapes, and purges expired temp", async () => {
    expect(() =>
      assertFigmaDesktopAssetUrl(
        "http://localhost:3845/assets/safe.svg",
      ),
    ).not.toThrow();
    expect(() =>
      assertFigmaDesktopAssetUrl(
        "https://localhost:3845/assets/safe.svg",
      ),
    ).toThrow(/Desktop MCP/);
    expect(() =>
      assertFigmaDesktopAssetUrl(
        "http://localhost:3845/not-assets/safe.svg",
      ),
    ).toThrow(/Desktop MCP/);
    expect(() =>
      assertFigmaDesktopAssetUrl(
        "http://localhost:3845/assets/%2e%2e/mcp",
      ),
    ).toThrow(/Desktop MCP|path/i);

    await expect(
      captureFigmaAsset(
        {
          rootPath,
          taskId,
          sourceReceiptId: receiptId,
          sourceUrl: "http://localhost:3845/assets/unsafe.svg",
          scopeNodeId: "2064:5554",
        },
        async () => ({
          body: Buffer.from(
            "<svg><script src=\"http://localhost:3845/x.js\"/></svg>",
          ),
          contentType: "image/svg+xml",
        }),
      ),
    ).rejects.toThrow(/active|external|local Desktop/i);

    const safe = await captureFigmaAsset(
      {
        rootPath,
        taskId,
        sourceReceiptId: receiptId,
        sourceUrl: "http://localhost:3845/assets/safe.svg",
        scopeNodeId: "2064:5554",
        ttlMs: 60_000,
        at: "2026-07-29T12:00:00.000Z",
      },
      async () => ({
        body: Buffer.from("<svg><path d=\"M0 0h1v1z\"/></svg>"),
        contentType: "image/svg+xml",
      }),
    );
    await expect(
      materializeFigmaAsset({
        rootPath,
        handle: safe.handle,
        destinationPath: "../escape.svg",
        at: "2026-07-29T12:00:30.000Z",
      }),
    ).rejects.toThrow(/escapes the checkout/i);
    expect(
      await purgeExpiredFigmaAssets({
        taskId,
        at: "2026-07-29T12:02:00.000Z",
      }),
    ).toMatchObject({ removed: 1 });
    await expect(loadFigmaAssetMetadata(safe.handle)).rejects.toThrow();
    await expect(access(path.join(rootPath, ".component-atlas"))).rejects.toThrow();
  });

  it("reads legacy ephemeral metadata only for cleanup and purges every task asset", async () => {
    const legacy = await captureFigmaAsset(
      {
        rootPath,
        taskId,
        sourceReceiptId: receiptId,
        sourceUrl: "http://localhost:3845/assets/legacy.svg",
        scopeNodeId: "2064:5554",
        ttlMs: 60_000,
        at: "2026-07-29T12:00:00.000Z",
      },
      async () => ({
        body: Buffer.from("<svg><path d=\"M0 0h3v3z\"/></svg>"),
        contentType: "image/svg+xml",
      }),
    );
    const legacyPath = await metadataFile(legacy.handle);
    const legacyMetadata = JSON.parse(await readFile(legacyPath, "utf8")) as
      Record<string, unknown>;
    legacyMetadata.schemaVersion = 1;
    delete legacyMetadata.checkoutId;
    await writeFile(legacyPath, `${JSON.stringify(legacyMetadata, null, 2)}\n`);

    await expect(loadFigmaAssetMetadata(legacy.handle)).resolves.toMatchObject({
      schemaVersion: 1,
      handle: legacy.handle,
    });
    await expect(loadFigmaAssetMetadata(legacy.handle, rootPath)).rejects.toThrow(
      /legacy|recapture/i,
    );
    await expect(
      purgeTaskFigmaAssets({ rootPath, taskId }),
    ).resolves.toMatchObject({ inspected: 1, removed: 0, retained: 1 });
    await expect(loadFigmaAssetMetadata(legacy.handle)).resolves.toMatchObject({
      schemaVersion: 1,
    });
    await expect(
      purgeExpiredFigmaAssets({
        taskId,
        at: "2026-07-29T12:02:00.000Z",
      }),
    ).resolves.toMatchObject({ inspected: 1, removed: 1 });

    const first = await captureFigmaAsset(
      {
        rootPath,
        taskId,
        sourceReceiptId: receiptId,
        sourceUrl: "http://localhost:3845/assets/first.svg",
        scopeNodeId: "2064:5554",
      },
      async () => ({
        body: Buffer.from("<svg><path d=\"M0 0h4v4z\"/></svg>"),
        contentType: "image/svg+xml",
      }),
    );
    const second = await captureFigmaAsset(
      {
        rootPath,
        taskId,
        sourceReceiptId: receiptId,
        sourceUrl: "http://localhost:3845/assets/second.svg",
        scopeNodeId: "2064:5554",
      },
      async () => ({
        body: Buffer.from("<svg><path d=\"M0 0h5v5z\"/></svg>"),
        contentType: "image/svg+xml",
      }),
    );
    const otherCheckout = await mkdtemp(
      path.join(os.tmpdir(), "atlas-assets-shared-task-"),
    );
    additionalRoots.push(otherCheckout);
    await provisionCheckout(otherCheckout);
    const otherAsset = await captureFigmaAsset(
      {
        rootPath: otherCheckout,
        taskId,
        sourceReceiptId: receiptId,
        sourceUrl: "http://localhost:3845/assets/other-checkout.svg",
        scopeNodeId: "2064:5554",
      },
      async () => ({
        body: Buffer.from("<svg><path d=\"M0 0h6v6z\"/></svg>"),
        contentType: "image/svg+xml",
      }),
    );
    await expect(
      purgeTaskFigmaAssets({ rootPath, taskId }),
    ).resolves.toMatchObject({
      inspected: 3,
      removed: 2,
      retained: 1,
    });
    await expect(loadFigmaAssetMetadata(first.handle)).rejects.toThrow();
    await expect(loadFigmaAssetMetadata(second.handle)).rejects.toThrow();
    await expect(
      loadFigmaAssetMetadata(otherAsset.handle, otherCheckout),
    ).resolves.toMatchObject({ handle: otherAsset.handle });
    await expect(
      purgeTaskFigmaAssets({ rootPath: otherCheckout, taskId }),
    ).resolves.toMatchObject({ inspected: 1, removed: 1, retained: 0 });
    await expect(loadFigmaAssetMetadata(otherAsset.handle)).rejects.toThrow();
    await expect(temporaryTaskEntries()).resolves.toEqual([]);
  });
});
