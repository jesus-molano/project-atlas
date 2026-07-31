import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

const cliEntry = fileURLToPath(
  new URL("../../cli/dist/index.js", import.meta.url),
);
const coreProfile = JSON.parse(
  await readFile(
    fileURLToPath(new URL("../core-profile.json", import.meta.url)),
    "utf8",
  ),
) as { tools: string[] };

describe("Project Atlas CLI MCP profile", () => {
  it("starts the real CLI with exactly the core tool contract", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cliEntry, "mcp"],
      stderr: "pipe",
    });
    const client = new Client({
      name: "project-atlas-cli-profile-test",
      version: "0.1.0",
    });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(coreProfile.tools);
    } finally {
      await client.close();
    }
  });
});
