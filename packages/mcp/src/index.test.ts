import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { taskSourceId } from "@component-atlas/core";
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
      expect(names).toContain("get_change_surface");
      expect(names).toContain("scan_repository");
      expect(names).toContain("map_figma_file");
      expect(names).toContain("capture_figma_asset");
      expect(names).toContain("materialize_figma_asset");
      expect(names).toContain("purge_expired_figma_assets");
      expect(
        tools.tools.find((tool) => tool.name === "get_change_surface")
          ?.inputSchema,
      ).toMatchObject({
        required: expect.arrayContaining([
          "root_path",
          "task_id",
          "intent",
          "source_ledger_hash",
        ]),
      });
      expect(names).toContain("sync_figma_variables");
      expect(names).toContain("get_figma_variables");
      expect(names).toContain("find_design_candidates");
      expect(names).toContain("inspect_design_node");
      expect(names).toContain("orient_project");
      expect(names).toContain("search_project_memory");
      expect(names).toContain("get_memory_item");
      expect(names).toContain("get_task_context");
      expect(names).toContain("expand_source_receipt");
      expect(names).toContain("resume_task_capsule");
      expect(names).toContain("checkpoint_task");
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
          task_id: { type: "string" },
          source_decision_id: { type: "string" },
          enrichment: { type: "object" },
          force: { type: "boolean" },
        },
      });
      expect(
        tools.tools.find((tool) => tool.name === "get_task_context")
          ?.inputSchema,
      ).toMatchObject({
        properties: {
          task_id: {
            type: "string",
            pattern: "^[A-Za-z0-9_.:-]{1,160}$",
          },
          selected_handles: {
            type: "array",
            maxItems: 8,
          },
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
          source_relations: { type: "array", maxItems: 12 },
        },
      });
      expect(
        tools.tools.find((tool) => tool.name === "checkpoint_task")
          ?.inputSchema,
      ).toMatchObject({
        required: expect.arrayContaining([
          "root_path",
          "task_id",
          "milestone",
          "objective",
          "objective_approved",
          "budget_chars",
          "next_safe_action",
        ]),
        properties: {
          source_receipt_ids: { type: "array", maxItems: 20 },
          handles: { type: "array", maxItems: 8 },
          source_relations: { type: "array", maxItems: 12 },
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

      const changeSurface = await client.callTool({
        name: "get_change_surface",
        arguments: {
          root_path: rootPath,
          task_id: "task-change-surface",
          intent: "confirmation dialog for a destructive async action",
          out_of_scope: ["account profile"],
          source_ledger_hash: "0123456789abcdef0123456789abcdef",
        },
      });
      expect(changeSurface.structuredContent).toMatchObject({
        schemaVersion: 1,
        intent: "confirmation dialog for a destructive async action",
        files: expect.any(Array),
        outOfScope: ["account profile"],
        retrieval: {
          contextInjected: true,
        },
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

      const figmaReference =
        "https://www.figma.com/design/PersonalShop/Personal-shop";
      const figmaSourceDecisionId = taskSourceId("figma", figmaReference);
      const sourceCheckpoint = await client.callTool({
        name: "checkpoint_task",
        arguments: {
          root_path: rootPath,
          task_id: "task-mcp-e2e",
          milestone: "decision-confirmed",
          objective: "add study filter to search on mobile",
          objective_approved: true,
          source_decisions: [
            {
              kind: "figma",
              reference: figmaReference,
              origin: "manual",
              state: "confirmed",
              required: false,
              relationship: "primary",
              authorityRole: "visual",
              routePolicy: {
                primaryAdapter: "figma-desktop-mcp-local",
                fallback: "deny",
              },
            },
          ],
          source_receipt_ids: [],
          handles: [],
          covered: ["intake"],
          remaining: ["source synchronization"],
          budget_chars: 2800,
          next_safe_action: "Synchronize the confirmed Figma source.",
        },
      });
      expect(sourceCheckpoint.isError).not.toBe(true);

      const forbiddenFigmaFallback = await client.callTool({
        name: "map_figma_file",
        arguments: {
          root_path: rootPath,
          task_id: "task-mcp-e2e",
          source_decision_id: figmaSourceDecisionId,
          figma_url: figmaReference,
          metadata,
          format: "figma-mcp-xml",
          source_receipt: {
            adapter: "figma-remote-connector",
            route: "figma-remote:get-metadata",
            operation: "get_metadata",
            observed_at: "2026-07-29T11:59:00.000Z",
          },
        },
      });
      expect(forbiddenFigmaFallback.isError).toBe(true);

      const mapped = await client.callTool({
        name: "map_figma_file",
        arguments: {
          root_path: rootPath,
          task_id: "task-mcp-e2e",
          source_decision_id: figmaSourceDecisionId,
          figma_url: figmaReference,
          metadata,
          format: "figma-mcp-xml",
          source_receipt: {
            adapter: "figma-desktop-mcp-local",
            route: "http://127.0.0.1:3845/mcp",
            operation: "get_metadata",
            observed_at: "2026-07-29T12:00:00.000Z",
          },
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

      const confluenceReference = "confluence:470516116";
      const confluenceDecisionId = taskSourceId(
        "confluence",
        confluenceReference,
      );
      const figmaPageReference =
        "https://www.figma.com/design/PersonalShop/Personal-shop?node-id=0-10";
      const figmaPageDecisionId = taskSourceId("figma", figmaPageReference);
      const scopedDecisions = [
        {
          kind: "confluence" as const,
          reference: confluenceReference,
          origin: "manual" as const,
          state: "confirmed" as const,
          required: false,
          relationship: "primary" as const,
          authorityRole: "requirement" as const,
          routePolicy: {
            primaryAdapter: "atlassian-rovo",
            fallback: "deny" as const,
          },
        },
        {
          kind: "figma" as const,
          reference: figmaPageReference,
          origin: "manual" as const,
          state: "confirmed" as const,
          required: false,
          relationship: "primary" as const,
          authorityRole: "visual" as const,
          routePolicy: {
            primaryAdapter: "figma-desktop-mcp-local",
            fallback: "deny" as const,
          },
        },
      ];
      const scopedRelations = [
        {
          fromSourceId: confluenceDecisionId,
          toSourceId: figmaPageDecisionId,
          kind: "references-design" as const,
          targetScope: {
            provider: "figma" as const,
            kind: "selection" as const,
            id: "60:2",
          },
        },
      ];
      await client.callTool({
        name: "checkpoint_task",
        arguments: {
          root_path: rootPath,
          task_id: "task-figma-scope",
          milestone: "decision-confirmed",
          objective: "Match the confirmed responsive card design.",
          objective_approved: true,
          source_decisions: scopedDecisions,
          source_relations: scopedRelations,
          budget_chars: 2800,
          next_safe_action: "Map only the selected Figma scope.",
        },
      });
      const scopedMap = await client.callTool({
        name: "map_figma_file",
        arguments: {
          root_path: rootPath,
          task_id: "task-figma-scope",
          source_decision_id: figmaPageDecisionId,
          figma_url:
            "https://www.figma.com/design/PersonalShop/Personal-shop?node-id=60-2",
          metadata,
          format: "figma-mcp-xml",
          scope_node_id: "60:2",
          scope_page_id: "0:10",
          source_receipt: {
            adapter: "figma-desktop-mcp-local",
            route: "http://127.0.0.1:3845/mcp",
            operation: "get_metadata",
            observed_at: "2026-07-29T12:05:00.000Z",
          },
          budget_chars: 1600,
        },
      });
      expect(scopedMap.isError).not.toBe(true);
      const scopedContext = await client.callTool({
        name: "get_task_context",
        arguments: {
          root_path: rootPath,
          task_id: "task-figma-scope",
          task: "Match the confirmed responsive card design.",
          objective_confirmed: true,
          source_decisions: scopedDecisions,
          source_relations: scopedRelations,
          budget_chars: 2800,
        },
      });
      expect(
        scopedContext.isError,
        JSON.stringify(scopedContext),
      ).not.toBe(true);
      expect(scopedContext.structuredContent).toMatchObject({
        design: {
          candidates: [
            expect.objectContaining({
              id: "60:2",
              origin: "user-confirmed-target",
            }),
          ],
        },
      });

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
          task_id: "task-mcp-e2e",
          task: "add study filter to search on mobile",
          figma_file: "PersonalShop",
          budget_chars: 2800,
          source_decisions: [
            {
              kind: "figma",
              reference: figmaReference,
              origin: "manual",
              state: "confirmed",
              required: false,
              relationship: "primary",
              authorityRole: "visual",
              routePolicy: {
                primaryAdapter: "figma-desktop-mcp-local",
                fallback: "deny",
              },
            },
          ],
        },
      });
      expect(taskContext.structuredContent).toMatchObject({
        taskId: "task-mcp-e2e",
        memory: expect.arrayContaining([
          expect.objectContaining({ id: "decision-search-url-v2" }),
        ]),
        design: { available: true },
        metrics: { budgetChars: 2800 },
      });
      expect(
        JSON.stringify(taskContext.structuredContent).length,
      ).toBeLessThanOrEqual(2800);

      const resumed = await client.callTool({
        name: "resume_task_capsule",
        arguments: {
          root_path: rootPath,
          task_id: "task-mcp-e2e",
        },
      });
      expect(resumed.structuredContent).toMatchObject({
        format: expect.stringMatching(/^(?:toon|json)$/u),
        bytes: expect.any(Number),
        fallbackAvailable: true,
      });
      expect(
        (resumed.structuredContent as { bytes?: number } | undefined)?.bytes,
      ).toBeLessThanOrEqual(4_096);
      expect(
        (resumed.structuredContent as { body?: string } | undefined)?.body,
      ).toContain("task-mcp-e2e");

      const checkpoint = await client.callTool({
        name: "checkpoint_task",
        arguments: {
          root_path: rootPath,
          task_id: "task-mcp-e2e",
          status: "completed",
          milestone: "completed",
          objective: "add study filter to search on mobile",
          objective_approved: true,
          source_decisions: [],
          source_receipt_ids: [],
          handles: ["code:search-filters"],
          covered: ["implementation", "validation"],
          remaining: [],
          budget_chars: 2800,
          estimated_tokens: 700,
          next_safe_action: "No further action.",
        },
      });
      expect(checkpoint.structuredContent).toMatchObject({
        taskId: "task-mcp-e2e",
        status: "completed",
        milestone: "completed",
        nextSafeAction: "No further action.",
      });

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
