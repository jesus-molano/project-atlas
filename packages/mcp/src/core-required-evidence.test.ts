import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpServer } from "./index.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("core required source gate", () => {
  it("blocks before repository scan when consent has no retrieval receipt", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "atlas-required-gate-"));
    roots.push(rootPath);
    await execFileAsync("git", ["init"], { cwd: rootPath });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createMcpServer("core");
    const client = new Client({
      name: "component-atlas-required-source-test",
      version: "0.2.0",
    });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    try {
      const prepared = await client.callTool({
        name: "atlas_prepare_task",
        arguments: {
          root_path: rootPath,
          task_id: "required-source-without-evidence",
          objective: "Implement the catalog against the required API contract.",
          objective_confirmed: true,
          sources: [
            {
              kind: "openapi",
              reference: "https://api.example.test/openapi.json",
              state: "confirmed",
              required: true,
              authority_role: "contract",
            },
          ],
        },
      });
      expect(prepared.isError).not.toBe(true);
      expect(prepared.structuredContent).toMatchObject({
        status: "blocked",
        repositoryScanned: false,
        missingRequiredEvidence: [
          expect.objectContaining({ kind: "openapi" }),
        ],
      });
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});
