import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { databasePath } from "@component-atlas/store";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearContextCostAudits,
  contextCostReport,
  exportContextCostAudits,
  importContextCostAudits,
  listContextCostAudits,
  recordContextCostAudit,
  scanProject,
} from "./index.js";

const temporary: string[] = [];

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-context-cost-"));
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-cost-data-"));
  temporary.push(root, dataHome);
  process.env.PROJECT_ATLAS_HOME = dataHome;
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "context-cost-fixture",
      dependencies: { vue: "^3.0.0" },
    }),
  );
  await scanProject(root, { writeArtifacts: false });
  return root;
}

afterEach(async () => {
  delete process.env.PROJECT_ATLAS_HOME;
  await Promise.all(
    temporary.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("content-free context cost audits", () => {
  it("stores SDK usage, reports median/P95, and never persists task text", async () => {
    const root = await fixture();
    const task = "Update the private billing form without storing this text";
    const common = {
      rootPath: root,
      mode: "benchmark" as const,
      contract: {
        mcpToolCount: 33,
        mcpDescriptionChars: 4_671,
        mcpSchemaChars: 25_787,
        mcpSerializedChars: 33_807,
        skillChars: 28_190,
        skillReferenceChars: 16_070,
        measurement: "exact" as const,
      },
    };
    await recordContextCostAudit({
      ...common,
      auditId: "cost-small-1",
      task,
      taskType: "small",
      recordedAt: "2026-01-01T00:00:00.000Z",
      context: { promptChars: 4_000, compactContextChars: 1_200 },
      interaction: { completed: true },
      usage: {
        inputTokens: 1_000,
        cachedInputTokens: 600,
        outputTokens: 120,
      },
    });
    await recordContextCostAudit({
      ...common,
      auditId: "cost-frontend-1",
      task: `${task} with route and store integration`,
      taskType: "frontend",
      recordedAt: "2026-01-02T00:00:00.000Z",
      context: { promptChars: 8_000, compactContextChars: 3_600 },
      interaction: { completed: true, questionCount: 1 },
      usage: {
        inputTokens: 3_000,
        cachedInputTokens: 1_500,
        outputTokens: 400,
      },
    });
    await recordContextCostAudit({
      ...common,
      auditId: "cost-complex-1",
      task: `${task} with confirmed Figma and OpenAPI evidence`,
      taskType: "complex",
      recordedAt: "2026-01-03T00:00:00.000Z",
      context: {
        promptChars: 12_000,
        compactContextChars: 6_000,
        receiptCount: 3,
        receiptBytes: 900,
      },
      interaction: { completed: false, retryCount: 1 },
    });

    const records = await listContextCostAudits(root);
    expect(records).toHaveLength(3);
    expect(records[0]?.tokens.source).toBe("character-fallback");
    expect(records[2]?.tokens).toMatchObject({
      source: "sdk",
      input: 1_000,
      cachedInput: 600,
      output: 120,
    });
    const report = await contextCostReport(root);
    expect(report.groups.find((group) => group.taskType === "all")).toMatchObject({
      runs: 3,
      inputTokens: {
        count: 3,
        median: 3_000,
      },
      completionRate: 0.6667,
    });
    const graph = await scanProject(root, { writeArtifacts: false });
    const database = await readFile(databasePath(graph.project.id));
    expect(database.toString("utf8")).not.toContain(task);
    const exported = await exportContextCostAudits(root);
    expect(JSON.stringify(exported)).not.toContain(task);
    expect(JSON.stringify(exported)).not.toContain(root);
    expect(await clearContextCostAudits(root)).toEqual({ cleared: 3 });
    expect(await importContextCostAudits(root, exported)).toMatchObject({
      imported: 3,
      sourceFingerprint: exported.sourceFingerprint,
    });
    expect(await listContextCostAudits(root)).toHaveLength(3);
  });

  it("upserts one turn idempotently and rejects unbounded metrics", async () => {
    const root = await fixture();
    const base = {
      rootPath: root,
      auditId: "cost-idempotent",
      task: "Inspect one component",
      taskType: "small" as const,
      mode: "benchmark" as const,
      recordedAt: "2026-01-01T00:00:00.000Z",
    };
    await recordContextCostAudit(base);
    await recordContextCostAudit({
      ...base,
      interaction: { completed: true },
    });
    expect(await listContextCostAudits(root)).toHaveLength(1);
    await expect(
      recordContextCostAudit({
        ...base,
        context: { promptChars: 10_000_001 },
      }),
    ).rejects.toThrow("promptChars");
  });
});
