import {
  assertSourceReceiptMatchesDecision,
  createSourceReceipt,
  sourceIdentityFromReference,
} from "@component-atlas/core";
import {
  captureFigmaAsset,
  findTaskDesignCandidates,
  fitBudgetedResponse,
  getFigmaDesignVariables,
  inspectFigmaDesignNode,
  recordDesignCoverageLedger,
  listFigmaDesignIndexes,
  loadFigmaAssetMetadata,
  loadTaskRetrievalResult,
  mapFigmaDesign,
  materializeFigmaAsset,
  purgeExpiredFigmaAssets,
  loadConfirmedTaskSourceDecision,
  claimTaskRetrieval,
  completeTaskRetrieval,
  syncFigmaDesignVariables,
  type MapFigmaDesignInput,
} from "@component-atlas/runtime";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  figmaVariableCatalogSchema,
  text,
} from "./shared.js";

export function registerDesignTools(server: McpServer): void {
  server.tool(
    "map_figma_file",
    "Create or incrementally update a lightweight local Figma map from sparse get_metadata XML or a depth-limited REST response. Does not fetch deep design context or write to Figma.",
    {
      root_path: z.string(),
      figma_url: z.string(),
      task_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/u).optional(),
      source_decision_id: z.string().max(160).optional(),
      metadata: z.union([z.string(), z.record(z.unknown())]),
      format: z
        .enum(["auto", "figma-mcp-xml", "figma-rest"])
        .optional(),
      file_name: z.string().optional(),
      version: z.string().optional(),
      last_modified: z.string().optional(),
      scope_node_id: z.string().optional(),
      scope_page_id: z.string().optional(),
      scope_page_name: z.string().optional(),
      source_receipt: z
        .object({
          source_decision_id: z.string().max(160).optional(),
          adapter: z.enum([
            "figma-desktop-mcp-local",
            "figma-remote-connector",
            "atlas-cache",
            "manual-import",
            "other",
          ]),
          route: z.string().min(1).max(500),
          operation: z.string().min(1).max(160),
          observed_at: z.string().datetime().optional(),
          freshness: z.enum(["current", "stale", "unknown"]).optional(),
          fallback: z
            .object({
              from_adapter: z.enum([
                "figma-desktop-mcp-local",
                "figma-remote-connector",
                "atlas-cache",
                "manual-import",
                "other",
              ]),
              condition: z.string().min(1).max(500),
              identity_preserved: z.boolean(),
            })
            .optional(),
        })
        .optional(),
      enrichment: z
        .object({
          libraries: z
            .union([z.array(z.unknown()), z.record(z.unknown())])
            .optional(),
          codeConnect: z.record(z.unknown()).optional(),
          devResources: z.array(z.unknown()).optional(),
          devStatusByNode: z.record(z.unknown()).optional(),
          devStatusProvenanceByNode: z
            .record(z.enum(["observed", "user-confirmed"]))
            .optional(),
          devStatusAvailability: z
            .enum(["available", "source-unavailable"])
            .optional(),
          variableCatalog: z.unknown().optional(),
        })
        .optional(),
      force: z.boolean().optional(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({
      root_path,
      figma_url,
      task_id,
      source_decision_id,
      metadata,
      format,
      file_name,
      version,
      last_modified,
      scope_node_id,
      scope_page_id,
      scope_page_name,
      source_receipt,
      enrichment,
      force,
      budget_chars,
    }) => {
      if (Boolean(task_id) !== Boolean(source_decision_id)) {
        throw new Error(
          "Authoritative Figma mapping requires both task_id and source_decision_id.",
        );
      }
      const observedIdentity = sourceIdentityFromReference("figma", figma_url);
      const authoritativeDecision =
        task_id && source_decision_id
          ? await loadConfirmedTaskSourceDecision(
              root_path,
              task_id,
              source_decision_id,
            )
          : undefined;
      if (authoritativeDecision && authoritativeDecision.kind !== "figma") {
        throw new Error("The task source decision is not a Figma source.");
      }
      if (authoritativeDecision && !source_receipt) {
        throw new Error(
          "Authoritative Figma mapping requires route evidence in source_receipt.",
        );
      }
      const confirmedReference =
        authoritativeDecision?.reference ?? figma_url;
      const identity = sourceIdentityFromReference(
        "figma",
        confirmedReference,
      );
      if (
        identity.fileKey !== observedIdentity.fileKey ||
        (identity.host &&
          observedIdentity.host &&
          identity.host !== observedIdentity.host)
      ) {
        throw new Error(
          "The observed Figma scope belongs to a different confirmed file.",
        );
      }
      const exactNodeId =
        scope_node_id ?? observedIdentity.nodeId ?? identity.nodeId;
      const sourceScopeId = identity.nodeId ?? identity.fileKey!;
      const scopeRelation =
        exactNodeId
          ? {
              kind:
                sourceScopeId === exactNodeId
                  ? ("same-scope" as const)
                  : ("contained-scope" as const),
              sourceId: sourceScopeId,
              targetId: exactNodeId,
            }
          : undefined;
      const receipt = source_receipt
        ? createSourceReceipt({
            sourceDecisionId:
              authoritativeDecision?.id ??
              source_receipt.source_decision_id ??
              "unbound-figma-observation",
            provider: "figma",
            requested: identity,
            resolved: {
              ...identity,
              ...(version ? { version } : {}),
            },
            adapter: source_receipt.adapter,
            route: source_receipt.route,
            operation: source_receipt.operation,
            scope: exactNodeId
              ? {
                  kind: "node",
                  id: exactNodeId,
                  ...(identity.fileKey
                    ? { parentId: identity.fileKey }
                    : {}),
                }
              : { kind: "file", id: identity.fileKey! },
            ...(scopeRelation ? { scopeRelation } : {}),
            observedAt:
              source_receipt.observed_at ?? new Date().toISOString(),
            ...(source_receipt.fallback
              ? {
                  fallback: {
                    fromAdapter: source_receipt.fallback.from_adapter,
                    condition: source_receipt.fallback.condition,
                    identityPreserved:
                      source_receipt.fallback.identity_preserved,
                  },
                }
              : {}),
            coverage: authoritativeDecision ? "exact" : "candidate",
            freshness: source_receipt.freshness ?? "current",
          })
        : undefined;
      if (authoritativeDecision && receipt) {
        assertSourceReceiptMatchesDecision(
          {
            id: authoritativeDecision.id,
            kind: authoritativeDecision.kind,
            reference: authoritativeDecision.reference,
            state: authoritativeDecision.state,
            ...(authoritativeDecision.routePolicy
              ? { routePolicy: authoritativeDecision.routePolicy }
              : {}),
          },
          receipt,
        );
      }
      const result = await mapFigmaDesign({
          rootPath: root_path,
          figmaUrl: figma_url,
          ...(authoritativeDecision
            ? { confirmedSourceReference: authoritativeDecision.reference }
            : {}),
          metadata,
          ...(format ? { format } : {}),
          ...(file_name ? { fileName: file_name } : {}),
          ...(version ? { version } : {}),
          ...(last_modified ? { lastModified: last_modified } : {}),
          ...(scope_node_id ? { scopeNodeId: scope_node_id } : {}),
          ...(scope_page_id ? { scopePageId: scope_page_id } : {}),
          ...(scope_page_name ? { scopePageName: scope_page_name } : {}),
          ...(receipt ? { sourceReceipt: receipt } : {}),
          ...(enrichment
            ? {
                enrichment:
                  enrichment as NonNullable<
                    MapFigmaDesignInput["enrichment"]
                  >,
              }
            : {}),
          ...(force ? { force: true } : {}),
        });
      const summary = result.summary;
      return text(
        fitBudgetedResponse(result as unknown as Record<string, unknown>, {
          budgetChars: budget_chars,
          totalMatches: summary.stats.nodes,
          expandableIds: summary.pages.flatMap((page) =>
            page.mainNodes.map((node) => node.id),
          ),
          preserveFirstKeys: ["summary", "gate"],
        }),
      );
    },
  );

  server.tool(
    "capture_figma_asset",
    "Capture one selected Figma Desktop MCP localhost asset into ProjectAtlas temp storage. Returns only a handle, hash, format, size, provenance, and expiry; never returns SVG or binary bodies and never persists the localhost URL.",
    {
      root_path: z.string(),
      task_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/u),
      source_receipt_id: z.string().regex(/^receipt-[a-f0-9]{16}$/u),
      asset_url: z.string().url(),
      scope_node_id: z.string().min(1).max(160),
      asset_node_id: z.string().min(1).max(160).optional(),
      file_name: z.string().min(1).max(160).optional(),
      ttl_minutes: z.number().int().min(1).max(1440).optional(),
      invalidation_reason: z
        .enum([
          "graph-changed",
          "scope-changed",
          "source-ledger-changed",
          "user-requested",
        ])
        .optional(),
    },
    async ({
      root_path,
      task_id,
      source_receipt_id,
      asset_url,
      scope_node_id,
      asset_node_id,
      file_name,
      ttl_minutes,
      invalidation_reason,
    }) => {
      const claim = await claimTaskRetrieval(root_path, {
        taskId: task_id,
        kind: "figma-asset",
        key: JSON.stringify({
          sourceReceiptId: source_receipt_id,
          sourceUrl: asset_url,
          scopeNodeId: scope_node_id,
          assetNodeId: asset_node_id ?? "",
        }),
        ...(invalidation_reason
          ? { invalidationReason: invalidation_reason }
          : {}),
      });
      if (claim.status === "cached") {
        const cached = (await loadTaskRetrievalResult(
          root_path,
          claim.handle,
        )) as { handle?: unknown };
        if (typeof cached.handle !== "string") {
          throw new Error("Cached Figma asset handle is invalid.");
        }
        const asset = await loadFigmaAssetMetadata(cached.handle).catch(() => {
          throw new Error(
            "Cached Figma asset handle is unavailable. Retry with an explicit invalidation reason.",
          );
        });
        if (Date.parse(asset.expiresAt) <= Date.now()) {
          throw new Error(
            "Cached Figma asset handle expired. Purge it and retry with an explicit invalidation reason.",
          );
        }
        return text({
          status: "cached",
          asset,
          retrieval: {
            handle: claim.handle,
            budgetId: claim.budgetId,
            contextInjected: false,
          },
        });
      }
      const asset = await captureFigmaAsset({
        rootPath: root_path,
        taskId: task_id,
        sourceReceiptId: source_receipt_id,
        sourceUrl: asset_url,
        scopeNodeId: scope_node_id,
        ...(asset_node_id ? { assetNodeId: asset_node_id } : {}),
        ...(file_name ? { fileName: file_name } : {}),
        ...(ttl_minutes ? { ttlMs: ttl_minutes * 60_000 } : {}),
      });
      await completeTaskRetrieval(root_path, claim.handle, asset);
      return text({
        asset,
        retrieval: {
          handle: claim.handle,
          budgetId: claim.budgetId,
          contextInjected: true,
        },
      });
    },
  );

  server.tool(
    "materialize_figma_asset",
    "Write one explicitly selected, validated Figma asset handle to a new checkout-relative production asset path. Refuses overwrite, path escape, active/external SVG content, expired or tampered handles, and Atlas/Codex state paths.",
    {
      root_path: z.string(),
      asset_handle: z
        .string()
        .regex(/^figma-asset:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{24}$/u),
      destination_path: z.string().min(1).max(500),
    },
    async ({ root_path, asset_handle, destination_path }) =>
      text(
        await materializeFigmaAsset({
          rootPath: root_path,
          handle: asset_handle,
          destinationPath: destination_path,
        }),
      ),
  );

  server.tool(
    "purge_expired_figma_assets",
    "Purge only expired ProjectAtlas-owned Figma temp assets. Never scans or deletes checkout files.",
    {
      task_id: z
        .string()
        .regex(/^[A-Za-z0-9_.:-]{1,160}$/u)
        .optional(),
    },
    async ({ task_id }) =>
      text(
        await purgeExpiredFigmaAssets({
          ...(task_id ? { taskId: task_id } : {}),
        }),
      ),
  );

  server.tool(
    "sync_figma_variables",
    "Persist a bounded, read-only audit of Figma Variables for an already mapped file. Use availability=global only with an explicitly confirmed file-global read result. Desktop get_variable_defs is selection-only and must never be submitted as a global catalog. Stores no credentials and never writes to Figma.",
    {
      root_path: z.string(),
      figma_file: z.string(),
      catalog: figmaVariableCatalogSchema,
      synced_at: z.string().datetime().optional(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({
      root_path,
      figma_file,
      catalog,
      synced_at,
      budget_chars,
    }) => {
      const result = await syncFigmaDesignVariables({
        rootPath: root_path,
        figmaFile: figma_file,
        catalog,
        ...(synced_at ? { syncedAt: synced_at } : {}),
      });
      return text(
        fitBudgetedResponse(result as unknown as Record<string, unknown>, {
          budgetChars: budget_chars,
          totalMatches: result.variables.totalVariables,
          expandableIds: result.variables.collections.map(
            (collection) => collection.id,
          ),
          preserveFirstKeys: ["variables"],
        }),
      );
    },
  );

  server.tool(
    "get_figma_variables",
    "Read the compact cached file-global Variables catalog. Collection summaries are the default. Variable names/types and exact aliases/values are returned only when explicitly requested and previously synchronized from an authorized global source.",
    {
      root_path: z.string(),
      figma_file: z.string(),
      collection_id: z.string().optional(),
      variable_ids: z.array(z.string()).max(500).optional(),
      include_variables: z.boolean().optional(),
      include_values: z.boolean().optional(),
      limit: z.number().int().min(1).max(500).optional(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({
      root_path,
      figma_file,
      collection_id,
      variable_ids,
      include_variables,
      include_values,
      limit,
      budget_chars,
    }) => {
      const result = await getFigmaDesignVariables(
        root_path,
        figma_file,
        {
          ...(collection_id ? { collectionId: collection_id } : {}),
          ...(variable_ids ? { variableIds: variable_ids } : {}),
          ...(include_variables ? { includeVariables: true } : {}),
          ...(include_values ? { includeValues: true } : {}),
          ...(limit ? { limit } : {}),
        },
      );
      return text(
        fitBudgetedResponse(result as unknown as Record<string, unknown>, {
          budgetChars: budget_chars,
          totalMatches: result.totalVariables,
          expandableIds:
            result.variables.length > 0
              ? result.variables.map((variable) => variable.id)
              : result.collections.map((collection) => collection.id),
          preserveFirstKeys: [
            "availability",
            "source",
            "collections",
            "expansion",
          ],
        }),
      );
    },
  );

  server.tool(
    "list_figma_indexes",
    "List compact cached Figma file maps for one repository.",
    {
      root_path: z.string(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({ root_path, budget_chars }) => {
      const indexes = await listFigmaDesignIndexes(root_path);
      return text(
        fitBudgetedResponse(
          { indexes } as Record<string, unknown>,
          {
            budgetChars: budget_chars,
            totalMatches: indexes.length,
            expandableIds: indexes.map((index) => index.file.key),
            preserveFirstKeys: ["indexes"],
          },
        ),
      );
    },
  );

  server.tool(
    "find_design_candidates",
    "Rank a few explainable cached Figma nodes for a task and cross-check them with Code Atlas. Returns a decision/uncertainty gate; it never loads deep node context.",
    {
      root_path: z.string(),
      task: z.string().min(1),
      figma_file: z.string().optional(),
      limit: z.number().int().min(1).max(10).optional(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({ root_path, task, figma_file, limit, budget_chars }) => {
      const result = await findTaskDesignCandidates(root_path, task, {
          ...(figma_file ? { figmaFile: figma_file } : {}),
          ...(limit ? { limit } : {}),
        });
      return text(
        fitBudgetedResponse(result as unknown as Record<string, unknown>, {
          budgetChars: budget_chars,
          totalMatches: result.candidates.length,
          expandableIds: result.candidates.map((item) => item.node.id),
          preserveFirstKeys: ["candidates", "gate"],
        }),
      );
    },
  );

  server.tool(
    "inspect_design_node",
    "Inspect one confirmed cached Figma node and return its hierarchy, states, findings, and exact handoff for get_design_context, get_screenshot, and selection variables. Does not call Figma itself.",
    {
      root_path: z.string(),
      figma_file: z.string(),
      node: z.string().describe("Confirmed node ID, exact name/path, or node URL."),
      task_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/u).optional(),
    },
    async ({ root_path, figma_file, node, task_id }) => {
      const inspection = await inspectFigmaDesignNode(
        root_path,
        figma_file,
        node,
      );
      const ledger = task_id
        ? await recordDesignCoverageLedger(root_path, {
            taskId: task_id,
            plan: inspection.retrievalPlan,
            receiptIds: inspection.sourceReceipts.map((receipt) => receipt.id),
          })
        : undefined;
      return text({
        ...inspection,
        ...(ledger
          ? {
              coverageLedger: {
                id: ledger.id,
                hash: ledger.hash,
                selectedNodeIds: inspection.retrievalPlan.selectedNodeIds,
              },
            }
          : {}),
      });
    },
  );
}
