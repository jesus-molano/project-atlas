import {
  getProjectCapabilities,
  graphSummary,
  recordTaskEvaluation,
  reportProjectCapabilities,
  scanProject,
} from "@component-atlas/runtime";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  text,
} from "./shared.js";

export function registerAdministrationTools(server: McpServer): void {
  server.tool(
    "scan_repository",
    "Index Astro, Vue/Nuxt, or React/Next frontend nodes and refresh the local graph.",
    {
      root_path: z.string().describe("Absolute repository root."),
      framework: z.enum(["vue", "react", "astro"]).optional(),
    },
    async ({ root_path, framework }) => {
      const graph = await scanProject(root_path, framework ? { framework } : {});
      return text(graphSummary(graph));
    },
  );

  server.tool(
    "get_source_capabilities",
    "Return connector and enrichment state observed for this project, with provenance and last check time. It never probes credentials or external systems.",
    { root_path: z.string() },
    async ({ root_path }) => text(await getProjectCapabilities(root_path)),
  );

  server.tool(
    "report_source_capabilities",
    "Record bounded capability observations from the current agent session. This stores no credentials and performs no external writes.",
    {
      root_path: z.string(),
      observations: z
        .array(
          z.object({
            id: z.enum([
              "figma",
              "atlassian-rovo",
              "github",
              "ready-for-dev",
              "figma-variables",
              "code-connect",
              "figma-libraries",
            ]),
            state: z.enum([
              "connected",
              "detected",
              "unavailable",
              "not-exposed",
              "permission-required",
              "unknown",
              "degraded",
            ]),
            detail: z.string().max(240).optional(),
          }),
        )
        .min(1)
        .max(16),
    },
    async ({ root_path, observations }) =>
      text(
        await reportProjectCapabilities(
          root_path,
          observations.map((item) => ({
            id: item.id,
            state: item.state,
            ...(item.detail ? { detail: item.detail } : {}),
          })),
        ),
      ),
  );

  server.tool(
    "record_task_evaluation",
    "Opt in to storing bounded, content-free task quality metrics locally. Task text is hashed and never persisted.",
    {
      root_path: z.string(),
      task: z.string().min(1).max(2000),
      top_three_correct: z.boolean().optional(),
      false_duplicate_count: z.number().int().min(0).max(100).optional(),
      necessary_questions: z.number().int().min(0).max(20).optional(),
      unnecessary_questions: z.number().int().min(0).max(20).optional(),
      context_chars: z.number().int().min(0).max(100000).optional(),
      preparation_ms: z.number().int().min(0).max(3600000).optional(),
      conflict_count: z.number().int().min(0).max(100).optional(),
      rework_required: z.boolean().optional(),
    },
    async ({
      root_path,
      task,
      top_three_correct,
      false_duplicate_count,
      necessary_questions,
      unnecessary_questions,
      context_chars,
      preparation_ms,
      conflict_count,
      rework_required,
    }) =>
      text(
        await recordTaskEvaluation({
          rootPath: root_path,
          task,
          ...(top_three_correct === undefined
            ? {}
            : { topThreeCorrect: top_three_correct }),
          ...(false_duplicate_count === undefined
            ? {}
            : { falseDuplicateCount: false_duplicate_count }),
          ...(necessary_questions === undefined
            ? {}
            : { necessaryQuestions: necessary_questions }),
          ...(unnecessary_questions === undefined
            ? {}
            : { unnecessaryQuestions: unnecessary_questions }),
          ...(context_chars === undefined ? {} : { contextChars: context_chars }),
          ...(preparation_ms === undefined
            ? {}
            : { preparationMs: preparation_ms }),
          ...(conflict_count === undefined
            ? {}
            : { conflictCount: conflict_count }),
          ...(rework_required === undefined
            ? {}
            : { reworkRequired: rework_required }),
        }),
      ),
  );
}
