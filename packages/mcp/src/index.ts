#!/usr/bin/env node
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAdministrationTools } from "./administration-tools.js";
import { registerCodeTools } from "./code-tools.js";
import { registerCoreTools } from "./core-tools.js";
import { registerDesignTools } from "./design-tools.js";
import { registerMemoryTools } from "./memory-tools.js";
import { registerTaskTools } from "./task-tools.js";

export * from "./contract-cost.js";
export * from "./skill-cost.js";

export type McpProfile = "core" | "legacy";

export function createMcpServer(profile: McpProfile = "core"): McpServer {
  if (profile !== "core" && profile !== "legacy") {
    throw new Error("Project Atlas MCP profile must be core or legacy.");
  }
  const server = new McpServer({
    name: "component-atlas",
    version: "0.2.0",
  });

  if (profile === "core") {
    registerCoreTools(server);
  } else {
    registerAdministrationTools(server);
    registerCodeTools(server);
    registerDesignTools(server);
    registerMemoryTools(server);
    registerTaskTools(server);
  }
  return server;
}

export interface McpContractCost {
  mcpToolCount: number;
  mcpDescriptionChars: number;
  mcpSchemaChars: number;
  mcpSerializedChars: number;
  mcpContractHash: string;
}

const measuredContracts = new Map<McpProfile, Promise<McpContractCost>>();

export function measureMcpContractCost(
  profile: McpProfile = "core",
): Promise<McpContractCost> {
  const cached = measuredContracts.get(profile);
  if (cached) return cached;
  const measured = (async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createMcpServer(profile);
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
  measuredContracts.set(profile, measured);
  return measured;
}

export async function startMcpServer(profile: McpProfile = "core"): Promise<void> {
  const server = createMcpServer(profile);
  await server.connect(new StdioServerTransport());
}

export function parseMcpProfile(argumentsList: string[]): McpProfile {
  const profileIndex = argumentsList.indexOf("--profile");
  if (profileIndex < 0) return "core";
  const profile = argumentsList[profileIndex + 1];
  if (profile !== "core" && profile !== "legacy") {
    throw new Error("Project Atlas MCP --profile must be core or legacy.");
  }
  return profile;
}

const entryPath = process.argv[1];
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  Promise.resolve()
    .then(() => startMcpServer(parseMcpProfile(process.argv.slice(2))))
    .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
