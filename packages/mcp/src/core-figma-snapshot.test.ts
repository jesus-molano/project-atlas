import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  loadLatestFigmaSnapshot,
  writeTaskCheckpoint,
} from "@component-atlas/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFixture } from "../../../scripts/test-fixture-copy.mjs";
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
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-snapshot-home-"));
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
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-snapshot-root-"));
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

async function withCoreClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createMcpServer("core");
  const client = new Client({
    name: "component-atlas-figma-snapshot-test",
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

function snapshotPayload(receiptId: string) {
  const complete = { status: "complete", omitted: 0 } as const;
  const notRequested = { status: "not-requested", omitted: 0 } as const;
  return {
    identity: {
      file_key: "SnapshotFile",
      node_id: "39:2731",
      version: "v42",
      last_modified: "2026-08-23T09:55:00.000Z",
    },
    observed_at: "2026-08-23T10:00:00.000Z",
    receipt_ids: [receiptId],
    coverage: {
      nodes: complete,
      components: complete,
      styles: complete,
      states: complete,
      assets: notRequested,
    },
    content: {
      nodes: [
        {
          id: "39:2731",
          name: "Checkout / Desktop",
          type: "FRAME",
          node_id: "39:2731",
          token_refs: ["space.400", "color.surface.default"],
        },
      ],
      components: [
        {
          id: "component:button",
          name: "Button",
          type: "COMPONENT_SET",
          variants: [{ name: "State", value: "Default" }],
        },
      ],
      styles: [
        {
          id: "style:surface",
          name: "Surface / Default",
          type: "PAINT",
          token_refs: ["color.surface.default"],
        },
      ],
      states: [
        {
          id: "state:button:disabled",
          name: "Button / Disabled",
          type: "VARIANT",
          variants: [{ name: "State", value: "Disabled" }],
        },
      ],
      assets: [],
    },
  };
}

describe("core Figma semantic snapshots", () => {
  it("records, expands and revises an exact receipt-bound snapshot", async () => {
    const root = await createGitRoot();
    const taskId = "task-figma-snapshot";
    const objective = "Implement the exact Figma checkout node.";
    const source = {
      reference:
        "https://www.figma.com/design/SnapshotFile/Checkout?node-id=39-2731",
      kind: "figma" as const,
      state: "confirmed" as const,
      required: true,
      authority_role: "visual" as const,
      primary_adapter: "figma-desktop-mcp-local",
      fallback: "deny" as const,
      evidence: {
        adapter: "figma-desktop-mcp-local" as const,
        route: "figma-desktop-local",
        operation: "get_design_context",
        observed_at: "2026-08-23T10:00:00.000Z",
        freshness: "current" as const,
        scope: { kind: "selection" as const, id: "39:2731" },
        figma_version: "v42",
        figma_last_modified: "2026-08-23T09:55:00.000Z",
        figma_metadata: {
          document: {
            id: "0:0",
            name: "Checkout",
            type: "DOCUMENT",
            children: [
              {
                id: "39:2731",
                name: "Checkout / Desktop",
                type: "FRAME",
                children: [],
              },
            ],
          },
        },
        figma_format: "figma-rest" as const,
        figma_scope_node_id: "39:2731",
      },
    };
    const decisions = normalizedSources(objective, [], [source]);
    const [receiptId] = await bindSourceEvidence(
      root,
      decisions,
      [source],
      [],
    );
    await writeTaskCheckpoint(root, {
      taskId,
      milestone: "source-resolved",
      objective,
      objectiveApproved: true,
      decisions,
      sourceReceiptIds: [receiptId!],
      handles: [],
      covered: ["exact Figma source"],
      remaining: ["snapshot", "implementation"],
      budgetChars: 3_600,
      nextSafeAction: "Record the semantic Figma snapshot.",
    });

    await withCoreClient(async (client) => {
      const recorded = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "record-figma-snapshot",
          figma_snapshot: snapshotPayload(receiptId!),
        },
      });
      expect(recorded.isError, JSON.stringify(recorded.content)).not.toBe(true);
      const firstHandle = (
        recorded.structuredContent as { snapshot: { handle: string } }
      ).snapshot.handle;
      expect(firstHandle).toMatch(
        /^figma-snapshot:task-figma-snapshot:[a-f0-9]{16}$/u,
      );

      const metadataCheck = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "check-figma-snapshot",
          figma_snapshot: {
            file_key: "SnapshotFile",
            node_id: "39-2731",
            required_categories: ["nodes", "components", "states"],
          },
        },
      });
      expect(metadataCheck.isError, JSON.stringify(metadataCheck.content)).not.toBe(
        true,
      );
      expect(metadataCheck.structuredContent).toMatchObject({
        status: "metadata-required",
        snapshot: { handle: firstHandle },
        providerRead: "metadata-only",
        quotaWarning: expect.stringMatching(/quota/iu),
      });

      const reusable = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "check-figma-snapshot",
          source_receipt_id: receiptId,
          figma_snapshot: {
            file_key: "SnapshotFile",
            node_id: "39-2731",
            required_categories: ["nodes", "components", "states"],
          },
        },
      });
      expect(reusable.isError, JSON.stringify(reusable.content)).not.toBe(true);
      expect(reusable.structuredContent).toMatchObject({
        status: "reusable",
        snapshot: { handle: firstHandle, revision: 1 },
        providerRead: "skip-deep-read",
      });
      expect(
        JSON.stringify(reusable.structuredContent),
      ).not.toMatch(/quotaWarning/iu);

      const expanded = await client.callTool({
        name: "atlas_expand_context",
        arguments: {
          root_path: root,
          task_id: taskId,
          handle: firstHandle,
          response_format: "detailed",
        },
      });
      expect(expanded.isError, JSON.stringify(expanded.content)).not.toBe(true);
      expect(expanded.structuredContent).toMatchObject({
        snapshot: {
          handle: firstHandle,
          identity: { fileKey: "SnapshotFile", version: "v42" },
          coverage: { styles: { status: "complete", omitted: 0 } },
        },
      });
      expect(JSON.stringify(expanded)).not.toMatch(/document|children|figma\.com/iu);

      const mismatchedRevision = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "record-figma-snapshot",
          figma_snapshot: {
            ...snapshotPayload(receiptId!),
            identity: {
              ...snapshotPayload(receiptId!).identity,
              last_modified: "2026-08-23T09:56:00.000Z",
            },
          },
        },
      });
      expect(mismatchedRevision.isError).toBe(true);
      expect(JSON.stringify(mismatchedRevision.content)).toMatch(
        /exact current snapshot identity/i,
      );

      const unownedAsset = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "record-figma-snapshot",
          figma_snapshot: {
            ...snapshotPayload(receiptId!),
            previous_handle: firstHandle,
            content: {
              ...snapshotPayload(receiptId!).content,
              assets: [
                {
                  id: "asset:blocked",
                  name: "Blocked",
                  type: "IMAGE",
                  asset_refs: [
                    "figma-asset:task-other:00112233445566778899aabb",
                  ],
                },
              ],
            },
          },
        },
      });
      expect(unownedAsset.isError).toBe(true);

      const changedWithoutPredecessor = snapshotPayload(receiptId!);
      changedWithoutPredecessor.content.styles[0]!.token_refs = [
        "color.surface.raised",
      ];
      const rejected = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "record-figma-snapshot",
          figma_snapshot: changedWithoutPredecessor,
        },
      });
      expect(rejected.isError).toBe(true);

      const revised = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "record-figma-snapshot",
          figma_snapshot: {
            ...changedWithoutPredecessor,
            previous_handle: firstHandle,
          },
        },
      });
      expect(revised.isError, JSON.stringify(revised.content)).not.toBe(true);
      expect(revised.structuredContent).toMatchObject({
        snapshot: { revision: 2 },
      });
    });

    await expect(loadLatestFigmaSnapshot(root, taskId)).resolves.toMatchObject({
      revision: 2,
      content: {
        styles: [{ tokenRefs: ["color.surface.raised"] }],
      },
    });
  });
});
