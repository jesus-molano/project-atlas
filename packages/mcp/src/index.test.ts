import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "./index.js";

describe("Component Atlas MCP surface", () => {
  it("exposes compact context tools without preview tools", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer();
    const client = new Client({
      name: "component-atlas-test",
      version: "0.1.0",
    });

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      expect(names).toContain("get_reuse_context");
      expect(names).toContain("scan_repository");
      expect(names).not.toContain("get_component_playground");
      expect(names).not.toContain("save_component_scenario");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
