import {
  getProjectMemoryItem,
  applyMemoryUpdate,
  orientProject,
  proposeMemoryUpdate,
  recordProjectOutcome,
  searchProjectMemory,
} from "@component-atlas/runtime";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  memoryDraft,
  text,
} from "./shared.js";

export function registerMemoryTools(server: McpServer): void {
  server.tool(
    "orient_project",
    "Return a hard-capped Project Atlas map: Code Atlas modules, Design Atlas files, memory sources/counts, current decisions, and expandable IDs.",
    {
      root_path: z.string(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
      refresh_memory: z.boolean().optional(),
    },
    async ({ root_path, budget_chars, refresh_memory }) =>
      text(
        await orientProject(root_path, {
          ...(budget_chars ? { budgetChars: budget_chars } : {}),
          ...(refresh_memory ? { refreshMemory: true } : {}),
        }),
      ),
  );

  server.tool(
    "search_project_memory",
    "Search typed, project-scoped memory. Returns a small page of summaries and expandable IDs; active memory only unless requested.",
    {
      root_path: z.string(),
      query: z.string(),
      types: z
        .array(
          z.enum([
            "project",
            "domain",
            "glossary-term",
            "subsystem",
            "module",
            "convention",
            "decision",
            "constraint",
            "integration",
            "known-issue",
            "fragile-area",
            "attempt",
            "outcome",
            "plan",
            "debt",
            "note",
          ]),
        )
        .optional(),
      statuses: z
        .array(
          z.enum([
            "proposed",
            "active",
            "superseded",
            "archived",
            "rejected",
          ]),
        )
        .optional(),
      tags: z.array(z.string()).optional(),
      limit: z.number().int().min(1).max(10).optional(),
      cursor: z.string().optional(),
      include_inactive: z.boolean().optional(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({
      root_path,
      query,
      types,
      statuses,
      tags,
      limit,
      cursor,
      include_inactive,
      budget_chars,
    }) =>
      text(
        await searchProjectMemory(root_path, query, {
          ...(types ? { types } : {}),
          ...(statuses ? { statuses } : {}),
          ...(tags ? { tags } : {}),
          ...(limit ? { limit } : {}),
          ...(cursor ? { cursor } : {}),
          ...(include_inactive ? { includeInactive: true } : {}),
          ...(budget_chars ? { budgetChars: budget_chars } : {}),
        }),
      ),
  );

  server.tool(
    "get_memory_item",
    "Expand one confirmed project-memory ID under a hard response budget.",
    {
      root_path: z.string(),
      id: z.string(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({ root_path, id, budget_chars }) =>
      text(
        await getProjectMemoryItem(root_path, id, {
          ...(budget_chars ? { budgetChars: budget_chars } : {}),
        }),
      ),
  );

  server.tool(
    "propose_memory_update",
    "Store a reviewable memory delta. It does not promote or write durable project knowledge.",
    {
      root_path: z.string(),
      rationale: z.string().min(1),
      evidence: z.array(z.string()).optional(),
      proposed_by: z.string().optional(),
      items: z.array(memoryDraft).min(1).max(20),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({
      root_path,
      rationale,
      evidence,
      proposed_by,
      items,
      budget_chars,
    }) =>
      text(
        await proposeMemoryUpdate({
          rootPath: root_path,
          rationale,
          items: items as unknown as Parameters<
            typeof proposeMemoryUpdate
          >[0]["items"],
          ...(evidence ? { evidence } : {}),
          ...(proposed_by ? { proposedBy: proposed_by } : {}),
          ...(budget_chars ? { budgetChars: budget_chars } : {}),
        }),
      ),
  );

  server.tool(
    "apply_memory_update",
    "Apply one reviewed proposal to local or canonical Markdown. Requires explicit confirmed=true, blocks unresolved decision-required findings, and requires canonical_confirmed=true for versionable canonical writes.",
    {
      root_path: z.string(),
      proposal_id: z.string(),
      confirmed: z.boolean(),
      target: z.enum(["local", "canonical"]).optional(),
      canonical_confirmed: z.boolean().optional(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({
      root_path,
      proposal_id,
      confirmed,
      target,
      canonical_confirmed,
      budget_chars,
    }) =>
      text(
        await applyMemoryUpdate(root_path, proposal_id, {
          confirmed,
          ...(target ? { target } : {}),
          ...(canonical_confirmed !== undefined
            ? { canonicalConfirmed: canonical_confirmed }
            : {}),
          ...(budget_chars ? { budgetChars: budget_chars } : {}),
        }),
      ),
  );

  server.tool(
    "record_outcome",
    "Record an observed or verified task outcome as local episodic memory. Durable decisions still require a separate proposal.",
    {
      root_path: z.string(),
      task: z.string().min(1),
      result: z.enum(["success", "failure", "partial"]),
      summary: z.string().min(1),
      evidence: z.array(z.string()).optional(),
      related_entity_ids: z.array(z.string()).optional(),
      files: z.array(z.string()).optional(),
      budget_chars: z.number().int().min(800).max(12000).optional(),
    },
    async ({
      root_path,
      task,
      result,
      summary,
      evidence,
      related_entity_ids,
      files,
      budget_chars,
    }) =>
      text(
        await recordProjectOutcome({
          rootPath: root_path,
          task,
          result,
          summary,
          ...(evidence ? { evidence } : {}),
          ...(related_entity_ids
            ? { relatedEntityIds: related_entity_ids }
            : {}),
          ...(files ? { files } : {}),
          ...(budget_chars ? { budgetChars: budget_chars } : {}),
        }),
      ),
  );
}
