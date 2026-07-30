#!/usr/bin/env node
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAdministrationTools } from "./administration-tools.js";
import { registerCodeTools } from "./code-tools.js";
import { registerDesignTools } from "./design-tools.js";
import { registerMemoryTools } from "./memory-tools.js";
import { registerTaskTools } from "./task-tools.js";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "component-atlas",
    version: "0.1.0",
  });

  registerAdministrationTools(server);
  registerCodeTools(server);
  registerDesignTools(server);
  registerMemoryTools(server);
  registerTaskTools(server);
  return server;
}

export interface McpContractCost {
  mcpToolCount: number;
  mcpDescriptionChars: number;
  mcpSchemaChars: number;
  mcpSerializedChars: number;
  mcpContractHash: string;
}

let measuredContract: Promise<McpContractCost> | undefined;

export function measureMcpContractCost(): Promise<McpContractCost> {
  measuredContract ??= (async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createMcpServer();
    const client = new Client({
      name: "project-atlas-context-cost",
      version: "0.1.0",
    });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    try {
      const listed = await client.listTools();
      const serialized = JSON.stringify(listed.tools);
      return {
        mcpToolCount: listed.tools.length,
        mcpDescriptionChars: listed.tools.reduce(
          (total, tool) => total + (tool.description?.length ?? 0),
          0,
        ),
        mcpSchemaChars: listed.tools.reduce(
          (total, tool) =>
            total +
            JSON.stringify(tool.inputSchema ?? {}).length +
            JSON.stringify(tool.outputSchema ?? {}).length,
          0,
        ),
        mcpSerializedChars: serialized.length,
        mcpContractHash: createHash("sha256")
          .update(serialized)
          .digest("hex"),
      };
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  })();
  return measuredContract;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}

const entryPath = process.argv[1];
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  startMcpServer().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
