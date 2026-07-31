import {
  buildComponentContext,
  SOURCE_RECEIPT_ID_PATTERN,
} from "@component-atlas/core";
import {
  expandSourceReceipt,
  expandTaskCompletionReceipt,
  expandVisualEvidenceContract,
  expandVisualReviewReceipt,
  getProjectMemoryItem,
  inspectFigmaDesignNode,
  listFigmaDesignIndexes,
  loadProjectGraph,
  loadTaskExecutionManifest,
  loadTaskRetrievalResult,
} from "@component-atlas/runtime";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { expandEntityContext } from "./core-context-handles.js";
import { assertTaskBoundHandle } from "./core-handle-ownership.js";
import { compact } from "./core-tool-helpers.js";
import { text } from "./shared.js";

const taskId = z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/u);

export function registerCoreExpandContext(server: McpServer): void {
  server.registerTool(
    "atlas_expand_context",
    {
      description:
        "Expand exactly one code, entity, design, visual, delivery, memory, receipt, retrieval or manifest handle under a hard budget.",
      inputSchema: {
        root_path: z.string(),
        handle: z.string().min(1).max(320),
        task_id: taskId.optional(),
        response_format: z.enum(["concise", "detailed"]).optional(),
      },
      annotations: {
        title: "Expand Atlas context",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ root_path, handle, task_id, response_format }) => {
      const budget = response_format === "detailed" ? 3_000 : 1_600;
      if (SOURCE_RECEIPT_ID_PATTERN.test(handle)) {
        if (!task_id) {
          throw new Error(
            "Expanding a source receipt requires its exact task_id binding.",
          );
        }
        await assertTaskBoundHandle(root_path, task_id, handle);
        return text(await expandSourceReceipt(root_path, handle, budget));
      }
      if (handle.startsWith("visual:")) {
        if (!task_id) {
          throw new Error(
            "Expanding a visual contract requires its exact task_id binding.",
          );
        }
        await assertTaskBoundHandle(root_path, task_id, handle);
        return text(
          await expandVisualEvidenceContract(root_path, handle, budget),
        );
      }
      if (handle.startsWith("visual-review:")) {
        if (!task_id) {
          throw new Error(
            "Expanding a visual review requires its exact task_id binding.",
          );
        }
        await assertTaskBoundHandle(root_path, task_id, handle);
        return text(
          await expandVisualReviewReceipt(
            root_path,
            handle,
            task_id,
            budget,
          ),
        );
      }
      if (handle.startsWith("delivery:")) {
        if (!task_id) {
          throw new Error(
            "Expanding a delivery receipt requires its exact task_id binding.",
          );
        }
        await assertTaskBoundHandle(root_path, task_id, handle);
        return text(
          await expandTaskCompletionReceipt(root_path, handle, {
            taskId: task_id,
            budgetChars: budget,
          }),
        );
      }
      if (handle.startsWith("code:")) {
        const graph = await loadProjectGraph(root_path);
        return text(
          compact(
            buildComponentContext(graph, handle.slice(5)) as unknown as Record<
              string,
              unknown
            >,
            budget,
          ),
        );
      }
      if (handle.startsWith("entity:")) {
        return text(
          await expandEntityContext(root_path, handle.slice(7), budget),
        );
      }
      if (handle.startsWith("memory:")) {
        try {
          return text(
            await getProjectMemoryItem(root_path, handle, {
              budgetChars: budget,
            }),
          );
        } catch (exactError) {
          try {
            return text(
              await getProjectMemoryItem(root_path, handle.slice(7), {
                budgetChars: budget,
              }),
            );
          } catch {
            throw exactError;
          }
        }
      }
      if (handle.startsWith("design:")) {
        const selector = handle.slice(7);
        const separator = selector.indexOf("::");
        const requestedFile =
          separator > 0 ? selector.slice(0, separator) : undefined;
        const node = separator > 0 ? selector.slice(separator + 2) : selector;
        const indexes = await listFigmaDesignIndexes(root_path);
        const matches = [];
        for (const index of indexes.filter(
          (candidate) => !requestedFile || candidate.file.key === requestedFile,
        )) {
          try {
            matches.push(
              await inspectFigmaDesignNode(root_path, index.file.key, node),
            );
          } catch {
            // Continue until the stable node identity is found in one index.
          }
        }
        if (matches.length !== 1) {
          throw new Error(
            matches.length === 0
              ? `Design handle ${handle} was not found.`
              : `Design handle ${handle} is ambiguous; include fileKey::nodeId.`,
          );
        }
        return text(
          compact(
            matches[0] as unknown as Record<string, unknown>,
            budget,
          ),
        );
      }
      if (handle.startsWith("retrieval:")) {
        if (!task_id) {
          throw new Error(
            "Expanding a retrieval result requires its exact task_id binding.",
          );
        }
        await assertTaskBoundHandle(root_path, task_id, handle);
        const value = await loadTaskRetrievalResult(root_path, handle, task_id);
        return text(compact({ result: value }, budget));
      }
      if (handle.startsWith("manifest:")) {
        if (!task_id) {
          throw new Error(
            "Expanding an execution manifest requires its exact task_id binding.",
          );
        }
        await assertTaskBoundHandle(root_path, task_id, handle);
        return text(
          compact(
            {
              manifest: await loadTaskExecutionManifest(
                root_path,
                handle,
                task_id,
              ),
            },
            budget,
          ),
        );
      }
      throw new Error(
        "Use a code:, entity:, design:, visual:, visual-review:, delivery:, memory:, retrieval:, manifest: or receipt-* handle.",
      );
    },
  );
}
