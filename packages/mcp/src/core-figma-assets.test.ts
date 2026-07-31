import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  captureFigmaAsset,
  loadFigmaAssetMetadata,
  loadTaskResumeCapsule,
  materializeFigmaAsset,
  writeTaskCheckpoint,
} from "@component-atlas/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFixture } from "../../../scripts/test-fixture-copy.mjs";
import { registerCoreLifecycleTools } from "./core-lifecycle-tools.js";
import {
  bindSourceEvidence,
  normalizedSources,
} from "./core-source-evidence.js";
import { createMcpServer } from "./index.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
let previousAtlasHome: string | undefined;

beforeEach(async () => {
  previousAtlasHome = process.env.PROJECT_ATLAS_HOME;
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-core-assets-home-"));
  roots.push(dataHome);
  process.env.PROJECT_ATLAS_HOME = dataHome;
});

afterEach(async () => {
  if (previousAtlasHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousAtlasHome;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createGitRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-core-assets-"));
  roots.push(root);
  await copyFixture(
    fileURLToPath(new URL("../../../fixtures/vue-nuxt", import.meta.url)),
    root,
  );
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Project Atlas Test",
      "-c",
      "user.email=atlas@example.invalid",
      "commit",
      "-m",
      "fixture",
    ],
    { cwd: root },
  );
  return root;
}

async function withClient<T>(
  server: McpServer,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "component-atlas-core-figma-asset-test",
    version: "0.2.0",
  });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  try {
    return await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

async function emitVisualSelection(
  taskId: string,
  handle: string,
  hash: string,
  expiresAt: string,
): Promise<string> {
  const handleMatch = /^visual:(vd-[A-Za-z0-9_-]+):[a-f0-9]{16}$/u.exec(
    handle,
  );
  if (!handleMatch || hash.length !== 64 || !handle.endsWith(hash.slice(0, 16))) {
    throw new Error("Invalid visual selection test fixture.");
  }
  const owner = "component-atlas-visual-direction/v1";
  const sessionId = handleMatch[1]!;
  const taskFingerprint = createHash("sha256").update(taskId).digest("hex");
  const proof = createHash("sha256")
    .update(
      [owner, taskFingerprint, sessionId, handle, hash, expiresAt].join("\0"),
    )
    .digest("hex")
    .slice(0, 16);
  const receipt = `selection-receipt:v1:${taskFingerprint.slice(
    0,
    16,
  )}:${sessionId}:${hash.slice(0, 16)}:${Date.parse(expiresAt).toString(
    36,
  )}:${proof}`;
  const sessionPath = path.join(
    process.env.PROJECT_ATLAS_HOME!,
    "temp",
    "visual-direction",
    sessionId,
  );
  await mkdir(sessionPath, { recursive: true });
  await writeFile(
    path.join(sessionPath, ".visual-direction-session.json"),
    JSON.stringify({
      owner,
      sessionId,
      taskFingerprint,
      state: "selected",
      selection: {
        directionHash: hash,
        contractHandle: handle,
        expiresAt,
        selectionReceipt: receipt,
      },
      artifacts: [],
    }),
  );
  return receipt;
}

async function temporaryAssetEntries(): Promise<string[]> {
  const assetsRoot = path.join(
    process.env.PROJECT_ATLAS_HOME!,
    "temp",
    "assets",
  );
  const taskDirectories = await readdir(assetsRoot, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
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

function svgForAsset(sourceUrl: string): Buffer {
  const index = Number(/asset-(\d+)/u.exec(sourceUrl)?.[1] ?? 0);
  const size = index + 2;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h${size}v${size}z"/></svg>`,
  );
}

describe("core Figma asset lifecycle", () => {
  it("governs capture, full-ledger lock/relock, materialization and completion cleanup end to end", async () => {
    const root = await createGitRoot();
    const taskId = "ATL-42";
    const objective = "Implement the exact Figma checkout assets";
    const reference =
      "https://www.figma.com/design/CoreAssets/Checkout?node-id=2064-5554";
    const baseObservedAt = Date.now() - 60_000;
    const source = {
      reference,
      kind: "figma" as const,
      state: "confirmed" as const,
      required: true,
      authority_role: "visual" as const,
      primary_adapter: "figma-desktop-mcp-local",
      fallback: "deny" as const,
      evidence: {
        adapter: "figma-desktop-mcp-local" as const,
        route: "http://127.0.0.1:3845/mcp",
        operation: "get_design_context",
        observed_at: new Date(baseObservedAt).toISOString(),
        freshness: "current" as const,
        scope: {
          kind: "selection" as const,
          id: "2064:5554",
          parent_id: "39:2731",
        },
        figma_metadata: {
          document: {
            id: "0:0",
            name: "Core assets",
            type: "DOCUMENT",
            children: [
              {
                id: "39:2731",
                name: "Checkout",
                type: "FRAME",
                children: [
                  {
                    id: "2064:5554",
                    name: "Checkout icons",
                    type: "FRAME",
                    children: [],
                  },
                ],
              },
            ],
          },
        },
        figma_format: "figma-rest" as const,
        figma_scope_node_id: "2064:5554",
      },
    };
    const decisions = normalizedSources(objective, [], [source]);
    let receiptIds: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      receiptIds = await bindSourceEvidence(
        root,
        decisions,
        [
          {
            ...source,
            evidence: {
              ...source.evidence,
              observed_at: new Date(baseObservedAt + index * 1_000).toISOString(),
            },
          },
        ],
        receiptIds,
      );
    }
    expect(receiptIds).toHaveLength(8);
    const sourceReceiptId = [...receiptIds].sort().at(-1)!;
    await writeTaskCheckpoint(root, {
      taskId,
      milestone: "source-resolved",
      objective,
      objectiveApproved: true,
      decisions,
      sourceReceiptIds: receiptIds,
      handles: ["code:existing-0", "code:existing-1"],
      covered: ["confirmed Figma selection"],
      remaining: ["capture selected assets", "lock destinations"],
      budgetChars: 3_600,
      nextSafeAction: "Capture only the selected Figma assets.",
    });

    const foreignTaskId = "task-foreign-figma-assets";
    const foreignSources = [
      {
        ...source,
        reference:
          "https://www.figma.com/design/ForeignAssets/Profile?node-id=50-100",
        evidence: {
          ...source.evidence,
          scope: {
            kind: "selection" as const,
            id: "50:200",
            parent_id: "50:100",
          },
          figma_metadata: {
            document: {
              id: "0:0",
              name: "Foreign assets",
              type: "DOCUMENT",
              children: [
                {
                  id: "50:100",
                  name: "Profile",
                  type: "FRAME",
                  children: [
                    {
                      id: "50:200",
                      name: "Profile icons",
                      type: "FRAME",
                      children: [],
                    },
                  ],
                },
              ],
            },
          },
          figma_scope_node_id: "50:200",
        },
      },
    ];
    const foreignDecisions = normalizedSources(
      "Implement a different Figma profile asset",
      [],
      foreignSources,
    );
    const [foreignReceiptId] = await bindSourceEvidence(
      root,
      foreignDecisions,
      foreignSources,
      [],
    );
    await writeTaskCheckpoint(root, {
      taskId: foreignTaskId,
      milestone: "source-resolved",
      objective: "Implement a different Figma profile asset",
      objectiveApproved: true,
      decisions: foreignDecisions,
      sourceReceiptIds: [foreignReceiptId!],
      handles: [],
      covered: ["confirmed foreign Figma selection"],
      remaining: ["capture selected asset"],
      budgetChars: 1_600,
      nextSafeAction: "Capture only the foreign task asset.",
    });
    const foreignAsset = await captureFigmaAsset(
      {
        rootPath: root,
        taskId: foreignTaskId,
        sourceReceiptId: foreignReceiptId!,
        sourceUrl: "http://localhost:3845/assets/foreign.svg",
        scopeNodeId: "50:200",
      },
      async () => ({
        body: Buffer.from("<svg><path d=\"M0 0h2v2z\"/></svg>"),
        contentType: "image/svg+xml",
      }),
    );
    const foreignOtherRoot = await createGitRoot();
    const [foreignOtherReceiptId] = await bindSourceEvidence(
      foreignOtherRoot,
      foreignDecisions,
      foreignSources,
      [],
    );
    await writeTaskCheckpoint(foreignOtherRoot, {
      taskId: foreignTaskId,
      milestone: "source-resolved",
      objective: "Implement a different Figma profile asset",
      objectiveApproved: true,
      decisions: foreignDecisions,
      sourceReceiptIds: [foreignOtherReceiptId!],
      handles: [],
      covered: ["confirmed foreign Figma selection"],
      remaining: ["capture selected asset"],
      budgetChars: 1_600,
      nextSafeAction: "Capture only the foreign task asset.",
    });
    const foreignOtherAsset = await captureFigmaAsset(
      {
        rootPath: foreignOtherRoot,
        taskId: foreignTaskId,
        sourceReceiptId: foreignOtherReceiptId!,
        sourceUrl: "http://localhost:3845/assets/foreign.svg",
        scopeNodeId: "50:200",
      },
      async () => ({
        body: Buffer.from("<svg><path d=\"M0 0h2v2z\"/></svg>"),
        contentType: "image/svg+xml",
      }),
    );
    expect(foreignOtherAsset.handle).not.toBe(foreignAsset.handle);

    const visualHash = createHash("sha256")
      .update("exact checkout direction")
      .digest("hex");
    const visualHandle = `visual:vd-core-assets:${visualHash.slice(0, 16)}`;
    const visualExpiresAt = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
    const selectionReceipt = await emitVisualSelection(
      taskId,
      visualHandle,
      visualHash,
      visualExpiresAt,
    );
    const lifecycleServer = new McpServer({
      name: "component-atlas-core-figma-assets",
      version: "0.2.0",
    });
    registerCoreLifecycleTools(lifecycleServer, {
      capture: (input) =>
        captureFigmaAsset(input, async (sourceUrl) => ({
          body: svgForAsset(sourceUrl),
          contentType: "image/svg+xml",
        })),
      materialize: (input) => materializeFigmaAsset(input),
    });
    const handles = await withClient(lifecycleServer, async (client) => {
      const attached = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "attach-evidence",
          visual_contract: {
            handle: visualHandle,
            hash: visualHash,
            selection_receipt: selectionReceipt,
            authority: "exact-figma",
            summary: "Exact Figma checkout direction and selected node.",
            figma: { file_key: "CoreAssets", node_id: "2064:5554" },
            receipt_ids: [sourceReceiptId],
            expires_at: visualExpiresAt,
          },
        },
      });
      expect(attached.isError).not.toBe(true);

      const crossedReceipt = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "capture-figma-asset",
          source_receipt_id: foreignReceiptId,
          asset_url: "http://localhost:3845/assets/foreign.svg",
          scope_node_id: "2064:5554",
        },
      });
      expect(crossedReceipt.isError).toBe(true);

      const capturedHandles: string[] = [];
      for (let index = 0; index < 6; index += 1) {
        const captured = await client.callTool({
          name: "atlas_task_state",
          arguments: {
            root_path: root,
            task_id: taskId,
            action: "capture-figma-asset",
            source_receipt_id: sourceReceiptId,
            asset_url: `http://localhost:3845/assets/asset-${index}.svg`,
            scope_node_id: "2064:5554",
          },
        });
        expect(captured.isError).not.toBe(true);
        expect(JSON.stringify(captured)).not.toMatch(/<svg|localhost:3845/iu);
        expect(captured.structuredContent).toMatchObject({
          taskId,
          status: "asset-captured",
          asset: {
            handle: expect.stringMatching(
              /^figma-asset:ATL-42:[a-f0-9]{24}$/u,
            ),
            checkoutId: expect.stringMatching(/^[a-f0-9]{20}$/u),
            sourceReceiptId,
            ephemeral: true,
          },
        });
        capturedHandles.push(
          (captured.structuredContent as { asset: { handle: string } }).asset
            .handle,
        );
      }
      const beforeLock = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "materialize-figma-asset",
          asset_handle: capturedHandles[0],
          destination_path: "assets/checkout-0.svg",
        },
      });
      expect(beforeLock.isError).toBe(true);
      return capturedHandles;
    });

    const preparedCapsule = await loadTaskResumeCapsule(root, taskId);
    expect(preparedCapsule).toMatchObject({
      handles: expect.arrayContaining([visualHandle, ...handles]),
      lifecycle: { phase: "prepared" },
    });
    expect(preparedCapsule?.handles).toHaveLength(8);

    const destinations = handles.map(
      (_handle, index) => `assets/checkout-${index}.svg`,
    );
    await withClient(createMcpServer("core"), async (client) => {
      const locked = await client.callTool({
        name: "atlas_lock_change_scope",
        arguments: {
          root_path: root,
          task_id: taskId,
          primary_surface: {
            kind: "files",
            id: "checkout-assets",
            path: destinations[0],
          },
          allowed_files: destinations,
          decision: "not-applicable",
          rationale: "Exact exported image files are not reusable code components.",
        },
      });
      expect(locked.isError, JSON.stringify(locked.content)).not.toBe(true);
      expect(locked.structuredContent).toMatchObject({
        status: "locked",
        lock: { revision: 1 },
      });
    });
    const firstLockedCapsule = await loadTaskResumeCapsule(root, taskId);
    const firstLock = firstLockedCapsule!.changeSurface!;
    expect(firstLock.evidence.handles).toHaveLength(8);
    expect(firstLock.evidence.handles).toEqual(
      expect.arrayContaining([visualHandle, ...handles]),
    );
    expect(firstLock.evidence.sourceLedger).toMatchObject({
      decisionCount: 1,
      receiptCount: 8,
    });
    expect(firstLock.evidence.sourceLedger.relationCount ?? 0).toBe(0);
    expect(firstLock.evidence.sourceLedger.receiptIds).toHaveLength(4);
    expect(firstLock.evidence.sourceLedger.receiptIds).not.toContain(
      sourceReceiptId,
    );
    expect(Buffer.byteLength(JSON.stringify(firstLock), "utf8")).toBeLessThanOrEqual(
      2_800,
    );
    expect(Buffer.byteLength(JSON.stringify(firstLockedCapsule), "utf8"))
      .toBeLessThanOrEqual(4_096);

    await withClient(createMcpServer("core"), async (client) => {
      const crossedTask = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "materialize-figma-asset",
          asset_handle: foreignAsset.handle,
          destination_path: destinations[0],
        },
      });
      expect(crossedTask.isError).toBe(true);
      const outsideLock = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "materialize-figma-asset",
          asset_handle: handles[0],
          destination_path: "assets/not-locked.svg",
        },
      });
      expect(outsideLock.isError).toBe(true);

      const materialized = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "materialize-figma-asset",
          asset_handle: handles[0],
          destination_path: `./${destinations[0]}`,
        },
      });
      expect(materialized.isError, JSON.stringify(materialized.content)).not.toBe(
        true,
      );
      expect(materialized.structuredContent).toMatchObject({
        taskId,
        status: "asset-materialized",
        asset: {
          handle: handles[0],
          projectPath: destinations[0],
          sourceReceiptId,
          temporaryAssetRemoved: true,
        },
        lock: { id: firstLock.lockId, revision: 1 },
      });
    });
    expect(await readFile(path.join(root, destinations[0]!), "utf8")).toBe(
      svgForAsset("asset-0").toString("utf8"),
    );
    const materializedHash = handles[0]!.split(":").at(-1)!;
    const afterMaterializeEntries = await temporaryAssetEntries();
    expect(
      afterMaterializeEntries.some((entry) =>
        entry.endsWith(`${materializedHash}.svg`),
      ),
    ).toBe(false);
    expect(
      afterMaterializeEntries.some((entry) =>
        entry.endsWith(`${materializedHash}.json`),
      ),
    ).toBe(true);

    const invalidationReason = "Add one newly selected exact Figma asset.";
    await withClient(createMcpServer("core"), async (client) => {
      const prepared = await client.callTool({
        name: "atlas_prepare_task",
        arguments: {
          root_path: root,
          task_id: taskId,
          objective,
          objective_confirmed: true,
          invalidation_reason: invalidationReason,
          budget_chars: 3_600,
        },
      });
      expect(prepared.isError, JSON.stringify(prepared.content)).not.toBe(true);
      expect(prepared.structuredContent).toMatchObject({
        taskId,
        status: "relock-required",
      });
    });

    const relockCaptureServer = new McpServer({
      name: "component-atlas-core-figma-assets-relock",
      version: "0.2.0",
    });
    registerCoreLifecycleTools(relockCaptureServer, {
      capture: (input) =>
        captureFigmaAsset(input, async (sourceUrl) => ({
          body: svgForAsset(sourceUrl),
          contentType: "image/svg+xml",
        })),
      materialize: (input) => materializeFigmaAsset(input),
    });
    const newHandle = await withClient(relockCaptureServer, async (client) => {
      const captured = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "capture-figma-asset",
          source_receipt_id: sourceReceiptId,
          asset_url: "http://localhost:3845/assets/asset-8.svg",
          scope_node_id: "2064:5554",
        },
      });
      expect(captured.isError, JSON.stringify(captured.content)).not.toBe(true);
      return (captured.structuredContent as { asset: { handle: string } }).asset
        .handle;
    });
    const newDestination = "assets/checkout-8.svg";
    await withClient(createMcpServer("core"), async (client) => {
      const relocked = await client.callTool({
        name: "atlas_lock_change_scope",
        arguments: {
          root_path: root,
          task_id: taskId,
          primary_surface: {
            kind: "files",
            id: "checkout-assets",
            path: destinations[0],
          },
          allowed_files: [...destinations, newDestination],
          decision: "not-applicable",
          rationale: "Exact exported image files are not reusable code components.",
          invalidation_reason: invalidationReason,
        },
      });
      expect(relocked.isError, JSON.stringify(relocked.content)).not.toBe(true);
      expect(relocked.structuredContent).toMatchObject({
        status: "locked",
        lock: { revision: 2 },
      });
    });
    const relockedCapsule = await loadTaskResumeCapsule(root, taskId);
    const relock = relockedCapsule!.changeSurface!;
    expect(relock.revision).toBe(2);
    expect(relock.gitBaseline.handle).toBe(firstLock.gitBaseline.handle);
    expect(relock.evidence.handles).toHaveLength(8);
    expect(relock.evidence.handles).toEqual(
      expect.arrayContaining([visualHandle, ...handles, newHandle]),
    );
    expect(Buffer.byteLength(JSON.stringify(relock), "utf8")).toBeLessThanOrEqual(
      2_800,
    );
    expect(Buffer.byteLength(JSON.stringify(relockedCapsule), "utf8"))
      .toBeLessThanOrEqual(4_096);

    await withClient(createMcpServer("core"), async (client) => {
      const materialized = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "materialize-figma-asset",
          asset_handle: newHandle,
          destination_path: newDestination,
        },
      });
      expect(materialized.isError, JSON.stringify(materialized.content)).not.toBe(
        true,
      );
      const expanded = await client.callTool({
        name: "atlas_expand_context",
        arguments: {
          root_path: root,
          task_id: taskId,
          handle: handles[0],
          response_format: "detailed",
        },
      });
      expect(expanded.isError).not.toBe(true);
      expect(expanded.structuredContent).toMatchObject({
        asset: { handle: handles[0], taskId, sourceReceiptId },
        bodyIncluded: false,
      });
      expect(JSON.stringify(expanded)).not.toMatch(/<svg|localhost:3845/iu);
      const crossedExpansion = await client.callTool({
        name: "atlas_expand_context",
        arguments: {
          root_path: root,
          task_id: taskId,
          handle: foreignAsset.handle,
        },
      });
      expect(crossedExpansion.isError).toBe(true);

      const validation = await client.callTool({
        name: "atlas_validate_change",
        arguments: { root_path: root, task_id: taskId },
      });
      expect(validation.isError, JSON.stringify(validation.content)).not.toBe(true);
      expect(validation.structuredContent).toMatchObject({
        status: "pass",
        blocking: false,
        changedFiles: expect.arrayContaining([
          expect.objectContaining({ path: destinations[0], untracked: true }),
          expect.objectContaining({ path: newDestination, untracked: true }),
        ]),
      });
    });
    await expect(loadTaskResumeCapsule(root, taskId)).resolves.toMatchObject({
      lifecycle: { phase: "validated" },
      validation: { lockId: relock.lockId },
    });

    await expect(
      loadFigmaAssetMetadata(foreignAsset.handle, root),
    ).resolves.toMatchObject({ taskId: foreignTaskId });
    await expect(
      loadFigmaAssetMetadata(foreignOtherAsset.handle, foreignOtherRoot),
    ).resolves.toMatchObject({ taskId: foreignTaskId });
    await withClient(createMcpServer("core"), async (client) => {
      const completionArguments = {
        root_path: root,
        task_id: foreignTaskId,
        action: "complete",
        result: "failure",
        summary: "Fixture task ended before implementation.",
        verification: ["No production files were written."],
      };
      const completed = await client.callTool({
        name: "atlas_task_state",
        arguments: completionArguments,
      });
      expect(completed.isError, JSON.stringify(completed.content)).not.toBe(true);
      await expect(loadFigmaAssetMetadata(foreignAsset.handle)).rejects.toThrow();
      await expect(
        loadFigmaAssetMetadata(foreignOtherAsset.handle, foreignOtherRoot),
      ).resolves.toMatchObject({ handle: foreignOtherAsset.handle });
      const repeated = await client.callTool({
        name: "atlas_task_state",
        arguments: completionArguments,
      });
      expect(repeated.isError, JSON.stringify(repeated.content)).not.toBe(true);
      await expect(
        loadFigmaAssetMetadata(foreignOtherAsset.handle, foreignOtherRoot),
      ).resolves.toMatchObject({ handle: foreignOtherAsset.handle });
      const otherCompleted = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          ...completionArguments,
          root_path: foreignOtherRoot,
        },
      });
      expect(
        otherCompleted.isError,
        JSON.stringify(otherCompleted.content),
      ).not.toBe(true);
      await expect(loadFigmaAssetMetadata(foreignOtherAsset.handle)).rejects.toThrow();
    });
    await expect(access(path.join(root, "assets/not-locked.svg"))).rejects.toThrow();
  });
});
