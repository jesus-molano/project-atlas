import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "./index.js";

describe("Project Atlas MCP surface", () => {
  it("exposes the complete compact Project Atlas tool contract", async () => {
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
      expect(names).toContain("map_figma_file");
      expect(names).toContain("sync_figma_variables");
      expect(names).toContain("get_figma_variables");
      expect(names).toContain("find_design_candidates");
      expect(names).toContain("inspect_design_node");
      expect(names).toContain("orient_project");
      expect(names).toContain("search_project_memory");
      expect(names).toContain("get_memory_item");
      expect(names).toContain("get_task_context");
      expect(names).toContain("check_before_change");
      expect(names).toContain("propose_memory_update");
      expect(names).toContain("apply_memory_update");
      expect(names).toContain("record_outcome");
      expect(names).toContain("get_source_capabilities");
      expect(names).toContain("report_source_capabilities");
      expect(names).toContain("record_task_evaluation");
      for (const name of [
        "search_components",
        "get_component",
        "find_similar_components",
        "list_component_usages",
        "analyze_prop_change_impact",
      ]) {
        expect(
          tools.tools.find((tool) => tool.name === name)?.inputSchema,
        ).toMatchObject({
          properties: {
            raw: { type: "boolean" },
          },
        });
      }
      expect(
        tools.tools.find((tool) => tool.name === "map_figma_file")?.inputSchema,
      ).toMatchObject({
        required: expect.arrayContaining([
          "root_path",
          "figma_url",
          "metadata",
        ]),
        properties: {
          enrichment: { type: "object" },
          force: { type: "boolean" },
        },
      });
      expect(
        tools.tools.find((tool) => tool.name === "get_task_context")
          ?.inputSchema,
      ).toMatchObject({
        properties: {
          budget_chars: {
            type: "integer",
            minimum: 800,
            maximum: 12000,
          },
          top_k: {
            type: "integer",
            minimum: 1,
            maximum: 10,
          },
        },
      });
      expect(
        tools.tools.find((tool) => tool.name === "sync_figma_variables")
          ?.inputSchema,
      ).toMatchObject({
        required: expect.arrayContaining([
          "root_path",
          "figma_file",
          "catalog",
        ]),
      });
      expect(
        tools.tools.find((tool) => tool.name === "get_figma_variables")
          ?.inputSchema,
      ).toMatchObject({
        properties: {
          include_variables: { type: "boolean" },
          include_values: { type: "boolean" },
          limit: { type: "integer", maximum: 500 },
        },
      });
      expect(
        tools.tools.find((tool) => tool.name === "apply_memory_update")
          ?.inputSchema,
      ).toMatchObject({
        required: expect.arrayContaining([
          "root_path",
          "proposal_id",
          "confirmed",
        ]),
        properties: {
          canonical_confirmed: { type: "boolean" },
        },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("serves compact Atlas and no-Dev-Mode Figma context end to end", async () => {
    const rootPath = await mkdtemp(
      path.join(os.tmpdir(), "component-atlas-mcp-"),
    );
    const source = fileURLToPath(
      new URL("../../../fixtures/vue-nuxt", import.meta.url),
    );
    await cp(source, rootPath, { recursive: true });
    const metadata = await readFile(
      new URL(
        "../../../fixtures/figma/personal-no-dev-mode.xml",
        import.meta.url,
      ),
      "utf8",
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createMcpServer();
    const client = new Client({
      name: "component-atlas-integration-test",
      version: "0.1.0",
    });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      const scan = await client.callTool({
        name: "scan_repository",
        arguments: { root_path: rootPath },
      });
      expect(scan.structuredContent).toMatchObject({
        framework: "vue",
        components: expect.any(Number),
      });

      const context = await client.callTool({
        name: "get_reuse_context",
        arguments: {
          root_path: rootPath,
          intent: "confirmation dialog for a destructive async action",
        },
      });
      expect(context.structuredContent).toMatchObject({
        candidates: expect.any(Array),
        nextActions: expect.any(Array),
        metrics: {
          budgetChars: 3600,
          usedChars: expect.any(Number),
          estimatedTokens: expect.any(Number),
        },
      });
      expect(
        (
          context.content as
            | Array<{ type: string; text?: string }>
            | undefined
        )?.[0]?.text,
      ).toMatch(/compact structured context/);
      expect(
        (context.structuredContent as { metrics?: unknown } | undefined)
          ?.metrics,
      ).toMatchObject({
        totalMatches: expect.any(Number),
        expandableIds: expect.any(Array),
      });

      const invalidReuseLimit = await client.callTool({
        name: "get_reuse_context",
        arguments: {
          root_path: rootPath,
          intent: "confirmation dialog",
          limit: 6,
        },
      });
      expect(invalidReuseLimit.isError).toBe(true);

      const mapped = await client.callTool({
        name: "map_figma_file",
        arguments: {
          root_path: rootPath,
          figma_url:
            "https://www.figma.com/design/PersonalShop/Personal-shop",
          metadata,
          format: "figma-mcp-xml",
          budget_chars: 1_600,
        },
      });
      expect(mapped.structuredContent).toMatchObject({
        status: "created",
        summary: {
          stats: { readyForDev: 0 },
        },
        metrics: {
          budgetChars: 1600,
          usedChars: expect.any(Number),
        },
      });
      expect(JSON.stringify(mapped.structuredContent).length).toBeLessThanOrEqual(
        1_600,
      );

      const invalidGlobalVariables = await client.callTool({
        name: "sync_figma_variables",
        arguments: {
          root_path: rootPath,
          figma_file: "PersonalShop",
          catalog: {
            availability: "global",
            source: "figma-selection",
          },
        },
      });
      expect(invalidGlobalVariables.isError).toBe(true);

      const variableSync = await client.callTool({
        name: "sync_figma_variables",
        arguments: {
          root_path: rootPath,
          figma_file: "PersonalShop",
          synced_at: "2026-07-28T12:00:00.000Z",
          catalog: {
            availability: "global",
            source: "figma-desktop-mcp-global",
            meta: {
              variableCollections: {
                "VariableCollectionId:theme": {
                  id: "VariableCollectionId:theme",
                  name: "Theme",
                  modes: [{ modeId: "mode:light", name: "Light" }],
                  variableIds: ["VariableID:space"],
                },
              },
              variables: {
                "VariableID:space": {
                  id: "VariableID:space",
                  name: "space/control",
                  variableCollectionId: "VariableCollectionId:theme",
                  resolvedType: "FLOAT",
                  valuesByMode: { "mode:light": 8 },
                },
              },
            },
          },
        },
      });
      expect(variableSync.structuredContent).toMatchObject({
        status: "updated",
        variables: {
          availability: "global",
          detailLevel: "catalog",
          totalCollections: 1,
          totalVariables: 1,
        },
      });
      const variableCatalog = await client.callTool({
        name: "get_figma_variables",
        arguments: {
          root_path: rootPath,
          figma_file: "PersonalShop",
        },
      });
      expect(variableCatalog.structuredContent).toMatchObject({
        availability: "global",
        collections: [expect.objectContaining({ name: "Theme" })],
        variables: [],
        expansion: {
          requested: false,
          persisted: false,
        },
      });

      const candidates = await client.callTool({
        name: "find_design_candidates",
        arguments: {
          root_path: rootPath,
          task: "añadir cupón en checkout móvil",
          figma_file: "PersonalShop",
          budget_chars: 1_600,
        },
      });
      expect(candidates.structuredContent).toMatchObject({
        gate: {
          status: "blocked",
          questions: expect.any(Array),
        },
      });
      const candidateContent = candidates.structuredContent as
        | {
            candidates?: Array<{
              node?: { id?: string; status?: string };
            }>;
          }
        | undefined;
      const ranked = candidateContent?.candidates;
      expect(ranked?.[0]?.node).toMatchObject({
        id: "60:2",
        status: "none",
      });
      expect(
        JSON.stringify(candidates.structuredContent).length,
      ).toBeLessThanOrEqual(1_600);

      const inspection = await client.callTool({
        name: "inspect_design_node",
        arguments: {
          root_path: rootPath,
          figma_file: "PersonalShop",
          node: "60:2",
        },
      });
      expect(inspection.structuredContent).toMatchObject({
        node: { id: "60:2", devStatus: "none" },
        deepContextRequest: {
          requiredTools: ["get_design_context", "get_screenshot"],
        },
      });

      const orientation = await client.callTool({
        name: "orient_project",
        arguments: {
          root_path: rootPath,
          budget_chars: 1600,
          refresh_memory: true,
        },
      });
      expect(orientation.structuredContent).toMatchObject({
        codeAtlas: { components: expect.any(Number) },
        projectMemory: { counts: { total: 5 } },
        metrics: {
          budgetChars: 1600,
          usedChars: expect.any(Number),
        },
      });
      expect(
        JSON.stringify(orientation.structuredContent).length,
      ).toBeLessThanOrEqual(1600);

      const taskContext = await client.callTool({
        name: "get_task_context",
        arguments: {
          root_path: rootPath,
          task: "add study filter to search on mobile",
          figma_file: "PersonalShop",
          budget_chars: 2800,
        },
      });
      expect(taskContext.structuredContent).toMatchObject({
        memory: expect.arrayContaining([
          expect.objectContaining({ id: "decision-search-url-v2" }),
        ]),
        design: { available: true },
        metrics: { budgetChars: 2800 },
      });
      expect(
        JSON.stringify(taskContext.structuredContent).length,
      ).toBeLessThanOrEqual(2800);

      const gate = await client.callTool({
        name: "check_before_change",
        arguments: {
          root_path: rootPath,
          intent: "add a study search filter stored in the URL",
          files: ["app/components/feature/SearchFilters.vue"],
          budget_chars: 3000,
        },
      });
      expect(gate.structuredContent).toMatchObject({
        gate: {
          status: "blocked",
          questions: expect.any(Array),
        },
        findings: expect.arrayContaining([
          expect.objectContaining({ code: "memory-contradiction" }),
          expect.objectContaining({ code: "failed-attempt" }),
        ]),
        metrics: { budgetChars: 3000 },
      });
    } finally {
      await client.close();
      await server.close();
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});
