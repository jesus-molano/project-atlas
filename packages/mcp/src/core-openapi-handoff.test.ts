import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  loadPersistedSourceReceipt,
  loadTaskResumeCapsule,
} from "@component-atlas/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { copyFixture } from "../../../scripts/test-fixture-copy.mjs";
import { createMcpServer } from "./index.js";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

async function createFixture(): Promise<{ rootPath: string; atlasHome: string }> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "atlas-openapi-core-"));
  const atlasHome = await mkdtemp(path.join(os.tmpdir(), "atlas-openapi-home-"));
  temporaryRoots.push(rootPath, atlasHome);
  await copyFixture(
    fileURLToPath(new URL("../../../fixtures/vue-nuxt", import.meta.url)),
    rootPath,
  );
  await execFileAsync("git", ["init"], { cwd: rootPath });
  await execFileAsync("git", ["add", "."], { cwd: rootPath });
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
    { cwd: rootPath },
  );
  return { rootPath, atlasHome };
}

async function assertDirectoryOmits(root: string, marker: string): Promise<void> {
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(target);
      } else if (entry.isFile()) {
        expect((await readFile(target)).includes(Buffer.from(marker))).toBe(false);
      }
    }
  }
}

afterEach(async () => {
  delete process.env.PROJECT_ATLAS_HOME;
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe.sequential("core OpenAPI transient handoff", () => {
  it("rejects a credentialized objective before creating task state", async () => {
    const { rootPath, atlasHome } = await createFixture();
    process.env.PROJECT_ATLAS_HOME = atlasHome;
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createMcpServer("core");
    const client = new Client({
      name: "atlas-core-secret-url-guard",
      version: "0.2.0",
    });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    try {
      const rejected = await client.callTool({
        name: "atlas_prepare_task",
        arguments: {
          root_path: rootPath,
          task_id: "task-secret-url-rejected",
          objective:
            "Use https://api.example.test/openapi.json?access_token=private as the contract.",
          objective_confirmed: true,
        },
      });
      expect(rejected.isError).toBe(true);
      expect(JSON.stringify(rejected)).not.toContain("access_token=private");
      await expect(
        loadTaskResumeCapsule(rootPath, "task-secret-url-rejected"),
      ).resolves.toBeUndefined();
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it("returns only core-callable next steps while legacy guidance stays isolated", async () => {
    const { rootPath, atlasHome } = await createFixture();
    process.env.PROJECT_ATLAS_HOME = atlasHome;
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createMcpServer("core");
    const client = new Client({ name: "atlas-core-next-steps", version: "0.2.0" });
    const [legacyClientTransport, legacyServerTransport] =
      InMemoryTransport.createLinkedPair();
    const legacyServer = createMcpServer("legacy");
    const legacyClient = new Client({
      name: "atlas-legacy-tool-names",
      version: "0.2.0",
    });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
      legacyServer.connect(legacyServerTransport),
      legacyClient.connect(legacyClientTransport),
    ]);
    try {
      const prepared = await client.callTool({
        name: "atlas_prepare_task",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-next-steps",
          objective: "Update the existing confirmation dialog.",
          objective_confirmed: true,
          budget_chars: 3_600,
        },
      });
      expect(prepared.isError).not.toBe(true);
      const nextSteps = (prepared.structuredContent as { nextSteps?: string[] })
        .nextSteps;
      expect(nextSteps).toEqual(
        expect.arrayContaining([
          expect.stringContaining("atlas_expand_context"),
          expect.stringContaining("atlas_lock_change_scope"),
        ]),
      );
      const coreNames = new Set(
        (await client.listTools()).tools.map((tool) => tool.name),
      );
      const legacyOnlyNames = (await legacyClient.listTools()).tools
        .map((tool) => tool.name)
        .filter((name) => !coreNames.has(name));
      expect(
        legacyOnlyNames.filter((name) =>
          nextSteps?.some((step) => step.includes(name)),
        ),
      ).toEqual([]);
    } finally {
      await Promise.all([
        client.close(),
        server.close(),
        legacyClient.close(),
        legacyServer.close(),
      ]);
    }
  });

  it("uses private inline content without refetch, derives multiple operation receipts and never persists the body", async () => {
    const { rootPath, atlasHome } = await createFixture();
    process.env.PROJECT_ATLAS_HOME = atlasHome;
    const marker = "SENSITIVE_PRIVATE_OPENAPI_BODY_MUST_NOT_PERSIST";
    const content = JSON.stringify({
      openapi: "3.1.0",
      info: {
        title: "Private orders API",
        version: "1.0.0",
        description: marker,
      },
      paths: {
        "/v1/orders/{orderId}": {
          get: {
            operationId: "getOrder",
            summary: "Load the order detail",
            parameters: [
              {
                name: "orderId",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: { 200: { description: "Order" } },
          },
        },
        "/v1/orders/{orderId}/cancel": {
          post: {
            operationId: "cancelOrder",
            summary: "Cancel the selected order",
            responses: { 204: { description: "Cancelled" } },
          },
        },
        "/v1/admin/audit": {
          get: {
            operationId: "getAuditLog",
            summary: "Read administrative audit history",
            responses: { 200: { description: "Audit" } },
          },
        },
      },
    });
    const contentHash = `sha256:${createHash("sha256")
      .update(content)
      .digest("hex")}`;
    const reference = "https://swagger.internal.example.test/openapi.json";
    const taskId = "task-private-openapi";
    const source = {
      kind: "openapi",
      reference,
      state: "confirmed",
      required: true,
      authority_role: "contract",
      primary_adapter: "openapi-internal-connector",
      fallback: "deny",
      evidence: {
        adapter: "openapi-internal-connector",
        route: "internal-connector:read-openapi",
        operation: "read_openapi_document",
        observed_at: "2026-07-31T18:00:00.000Z",
        freshness: "current",
        content_hash: contentHash,
        openapi_content: content,
      },
    };
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createMcpServer("core");
    const client = new Client({
      name: "atlas-private-openapi-handoff",
      version: "0.2.0",
    });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    try {
      const prepare = () =>
        client.callTool({
          name: "atlas_prepare_task",
          arguments: {
            root_path: rootPath,
            task_id: taskId,
            objective:
              "Implement the order detail and cancel order flow from the private contract.",
            objective_confirmed: true,
            sources: [source],
            budget_chars: 3_600,
          },
        });
      const prepared = await prepare();
      expect(
        prepared.isError,
        JSON.stringify(prepared.structuredContent ?? prepared.content),
      ).not.toBe(true);
      expect(
        JSON.stringify(prepared.structuredContent ?? prepared.content),
      ).not.toContain(marker);
      const projected = prepared.structuredContent as {
        status: string;
        code?: Array<{ id: string }>;
        api?: {
          operationIndex: Array<{
            method: string;
            path: string;
            sourceReceiptIds: string[];
          }>;
          operations: Array<{
            method: string;
            path: string;
            sourceReceiptIds: string[];
          }>;
        };
        sourceReceiptIds: string[];
      };
      expect(projected.status).toBe("ready");
      expect(projected.api?.operationIndex).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: "GET", path: "/v1/orders/{orderId}" }),
          expect.objectContaining({
            method: "POST",
            path: "/v1/orders/{orderId}/cancel",
          }),
        ]),
      );
      expect(projected.api?.operationIndex).toHaveLength(2);
      expect(projected.api?.operations?.[0]).toMatchObject({
        method: "GET",
        path: "/v1/orders/{orderId}",
      });

      const receipts = await Promise.all(
        projected.sourceReceiptIds.map((receiptId) =>
          loadPersistedSourceReceipt(rootPath, receiptId),
        ),
      );
      const operationReceipts = receipts.filter(
        (receipt) => receipt.provider === "openapi" && receipt.scope.kind === "operation",
      );
      expect(operationReceipts).toHaveLength(2);
      expect(operationReceipts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            contentHash,
            resolved: expect.objectContaining({
              method: "GET",
              path: "/v1/orders/{orderId}",
            }),
          }),
          expect.objectContaining({
            contentHash,
            resolved: expect.objectContaining({
              method: "POST",
              path: "/v1/orders/{orderId}/cancel",
            }),
          }),
        ]),
      );

      const retried = await prepare();
      expect(retried.isError).not.toBe(true);
      expect(
        (retried.structuredContent as { sourceReceiptIds: string[] })
          .sourceReceiptIds,
      ).toEqual(projected.sourceReceiptIds);

      const continued = await client.callTool({
        name: "atlas_prepare_task",
        arguments: {
          root_path: rootPath,
          task_id: taskId,
          objective:
            "Implement the order detail and cancel order flow from the private contract.",
          objective_confirmed: true,
          budget_chars: 3_600,
        },
      });
      expect(
        continued.isError,
        JSON.stringify(continued.structuredContent ?? continued.content),
      ).not.toBe(true);
      expect(continued.structuredContent).toMatchObject({
        status: "ready",
        api: {
          format: "mixed",
          operationIndex: expect.arrayContaining([
            expect.objectContaining({
              method: "GET",
              path: "/v1/orders/{orderId}",
            }),
            expect.objectContaining({
              method: "POST",
              path: "/v1/orders/{orderId}/cancel",
            }),
          ]),
        },
        sourceReceiptIds: projected.sourceReceiptIds,
      });

      const lockArguments = {
        root_path: rootPath,
        task_id: taskId,
        primary_surface: {
          kind: "api",
          id: "orders-detail-and-cancel",
          path: "app/components/feature/ConfirmDialog.vue",
        },
        allowed_files: ["app/components/feature/ConfirmDialog.vue"],
        decision: "not-applicable",
        rationale:
          "This contract validation targets an API surface; component reuse remains outside this fixture assertion.",
        exclusions: ["administrative audit history"],
      };
      const locked = await client.callTool({
        name: "atlas_lock_change_scope",
        arguments: lockArguments,
      });
      expect(locked.isError).not.toBe(true);
      const capsule = await loadTaskResumeCapsule(rootPath, taskId);
      expect(capsule?.changeSurface?.evidence.sourceLedger.confirmedOperations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: "GET", path: "/v1/orders/{orderId}" }),
          expect.objectContaining({
            method: "POST",
            path: "/v1/orders/{orderId}/cancel",
          }),
        ]),
      );
      const invalidationReason =
        "Refresh the locked visual asset evidence without changing API authority.";
      const preparedRelock = await client.callTool({
        name: "atlas_prepare_task",
        arguments: {
          root_path: rootPath,
          task_id: taskId,
          objective:
            "Implement the order detail and cancel order flow from the private contract.",
          objective_confirmed: true,
          invalidation_reason: invalidationReason,
          budget_chars: 3_600,
        },
      });
      expect(
        preparedRelock.isError,
        JSON.stringify(preparedRelock.structuredContent ?? preparedRelock.content),
      ).not.toBe(true);
      expect(preparedRelock.structuredContent).toMatchObject({
        status: "relock-required",
        api: {
          format: "mixed",
          operationIndex: expect.arrayContaining([
            expect.objectContaining({
              method: "GET",
              path: "/v1/orders/{orderId}",
            }),
            expect.objectContaining({
              method: "POST",
              path: "/v1/orders/{orderId}/cancel",
            }),
          ]),
        },
      });
      const relocked = await client.callTool({
        name: "atlas_lock_change_scope",
        arguments: {
          ...lockArguments,
          invalidation_reason: invalidationReason,
        },
      });
      expect(relocked.isError).not.toBe(true);
      expect(relocked.structuredContent).toMatchObject({
        status: "locked",
        lock: { revision: 2 },
      });
      const validated = await client.callTool({
        name: "atlas_validate_change",
        arguments: { root_path: rootPath, task_id: taskId },
      });
      expect(validated.isError).not.toBe(true);
      expect(validated.structuredContent).toMatchObject({
        apiValidation: {
          coverage: "partial",
          detector: "direct-literal-calls",
          confirmedOperations: 2,
          limitations: [
            "wrappers",
            "sdk-methods",
            "variable-or-template-paths",
          ],
        },
      });

      const expanded = await client.callTool({
        name: "atlas_expand_context",
        arguments: {
          root_path: rootPath,
          task_id: taskId,
          handle: operationReceipts[0]!.id,
          response_format: "concise",
        },
      });
      expect(expanded.structuredContent).toMatchObject({
        receipt: {
          provider: "openapi",
          scope: { kind: "operation" },
          contentHash,
        },
      });
      await assertDirectoryOmits(atlasHome, marker);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});
