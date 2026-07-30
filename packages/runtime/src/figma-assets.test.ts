import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
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
} from "./figma-assets.js";
import {
  persistSourceReceipts,
  writeTaskCheckpoint,
} from "./task-state.js";

let rootPath: string;
let dataHome: string;
let previousDataHome: string | undefined;
let receiptId: string;
const taskId = "task-assets";
const reference =
  "https://www.figma.com/design/FileKey/Auth?node-id=39-2731";
const sourceDecisionId = taskSourceId("figma", reference);

beforeEach(async () => {
  previousDataHome = process.env.PROJECT_ATLAS_HOME;
  rootPath = await mkdtemp(path.join(os.tmpdir(), "atlas-assets-project-"));
  dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-assets-state-"));
  process.env.PROJECT_ATLAS_HOME = dataHome;
  const decisions: TaskSourceDecision[] = [
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
  await writeTaskCheckpoint(rootPath, {
    taskId,
    milestone: "source-resolved",
    objective: "Implement the selected OTP challenge",
    objectiveApproved: true,
    decisions,
    sourceReceiptIds: [],
    handles: [],
    covered: ["Figma selection"],
    remaining: ["selected icons"],
    budgetChars: 2_400,
    nextSafeAction: "Capture only selected assets by handle.",
  });
  const identity = sourceIdentityFromReference("figma", reference);
  const receipt = createSourceReceipt({
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
  receiptId = receipt.id;
  await persistSourceReceipts(rootPath, [receipt]);
});

afterEach(async () => {
  if (previousDataHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousDataHome;
  await Promise.all([
    rm(rootPath, { recursive: true, force: true }),
    rm(dataHome, { recursive: true, force: true }),
  ]);
});

describe("Figma asset handles", () => {
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
      handle: expect.stringMatching(/^figma-asset:task-assets:/),
      fileName: "otp-eye.svg",
      format: "svg",
      ephemeral: true,
    });
    expect(JSON.stringify(metadata)).not.toMatch(/<svg|localhost:3845/iu);
    expect(await readdir(rootPath)).toEqual(before);

    const materialized = await materializeFigmaAsset({
      rootPath,
      handle: metadata.handle,
      destinationPath: "src/assets/otp-eye.svg",
      at: "2026-07-29T12:30:00.000Z",
    });
    expect(materialized.projectPath).toBe("src/assets/otp-eye.svg");
    expect(await readFile(path.join(rootPath, materialized.projectPath), "utf8"))
      .toBe(svg.toString("utf8"));
    expect(JSON.stringify(materialized)).not.toMatch(/localhost:3845|<svg/iu);
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
});
