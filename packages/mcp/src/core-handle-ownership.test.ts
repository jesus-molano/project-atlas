import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { writeTaskExecutionManifest } from "@component-atlas/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMcpServer } from "./index.js";

let rootPath: string;
let atlasHome: string;
let previousAtlasHome: string | undefined;

beforeEach(async () => {
  previousAtlasHome = process.env.PROJECT_ATLAS_HOME;
  rootPath = await mkdtemp(path.join(os.tmpdir(), "atlas-handle-project-"));
  atlasHome = await mkdtemp(path.join(os.tmpdir(), "atlas-handle-home-"));
  process.env.PROJECT_ATLAS_HOME = atlasHome;
});

afterEach(async () => {
  if (previousAtlasHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousAtlasHome;
  await Promise.all([
    rm(rootPath, { recursive: true, force: true }),
    rm(atlasHome, { recursive: true, force: true }),
  ]);
});

async function clientAndServer() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer("core");
  const client = new Client({
    name: "component-atlas-handle-ownership-test",
    version: "0.2.0",
  });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server };
}

describe("task-owned context handles", () => {
  it("requires and verifies the exact task for manifest expansion", async () => {
    const manifest = await writeTaskExecutionManifest(rootPath, {
      taskId: "task-owner-a",
      objectiveHash: "0".repeat(64),
      sourceLedgerHash: "1".repeat(64),
      skills: [],
      references: [],
      scripts: [],
      retrievalKeys: [],
      invalidatesOn: ["objective-change"],
    });
    const { client, server } = await clientAndServer();
    try {
      const missingTask = await client.callTool({
        name: "atlas_expand_context",
        arguments: { root_path: rootPath, handle: manifest.handle },
      });
      expect(missingTask.isError).toBe(true);
      expect(JSON.stringify(missingTask.content)).toMatch(/requires.*task_id/i);

      const crossTask = await client.callTool({
        name: "atlas_expand_context",
        arguments: {
          root_path: rootPath,
          task_id: "task-owner-b",
          handle: manifest.handle,
        },
      });
      expect(crossTask.isError).toBe(true);
      expect(JSON.stringify(crossTask.content)).toMatch(/different task/i);

      const selectedByOtherTask = await client.callTool({
        name: "atlas_prepare_task",
        arguments: {
          root_path: rootPath,
          task_id: "task-owner-b",
          objective: "Prepare a different task without importing foreign evidence.",
          objective_confirmed: true,
          selected_handles: [manifest.handle],
        },
      });
      expect(selectedByOtherTask.isError).toBe(true);
      expect(JSON.stringify(selectedByOtherTask.content)).toMatch(/different task/i);

      const owned = await client.callTool({
        name: "atlas_expand_context",
        arguments: {
          root_path: rootPath,
          task_id: "task-owner-a",
          handle: manifest.handle,
        },
      });
      expect(owned.isError).not.toBe(true);
      expect(owned.structuredContent).toMatchObject({
        manifest: { taskId: "task-owner-a" },
      });
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});
