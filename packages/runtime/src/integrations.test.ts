import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { databasePath } from "@component-atlas/store";
import {
  clearTaskEvaluations,
  getProjectCapabilities,
  listTaskEvaluations,
  mapFigmaDesign,
  recordTaskEvaluation,
  reportProjectCapabilities,
  scanProject,
  syncFigmaDesignVariables,
} from "./index.js";

const temporary: string[] = [];

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-integrations-"));
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-data-"));
  temporary.push(root, dataHome);
  process.env.PROJECT_ATLAS_HOME = dataHome;
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "integration-fixture", dependencies: { vue: "^3.0.0" } }),
  );
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

describe("capability observations and private evaluation metrics", () => {
  it("merges live session observations with conservative local inference", async () => {
    const root = await fixture();
    await scanProject(root, { writeArtifacts: false });
    await reportProjectCapabilities(root, [
      { id: "github", state: "connected" },
      { id: "figma", state: "unavailable", detail: "Not connected in this session." },
    ]);
    const report = await getProjectCapabilities(root);
    expect(report.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "github",
          kind: "connector",
          state: "connected",
          provenance: "session-report",
        }),
        expect.objectContaining({
          id: "code-connect",
          kind: "enrichment",
          state: "unknown",
        }),
        expect.objectContaining({
          id: "ready-for-dev",
          state: "unknown",
          detail: "No design source is indexed.",
        }),
        expect.objectContaining({
          id: "figma-variables",
          state: "unknown",
          detail: "No design source is indexed.",
        }),
        expect.objectContaining({
          id: "code-connect",
          state: "unknown",
          detail: "No design source is indexed.",
        }),
      ]),
    );
  });

  it("stores only bounded task metrics and a one-way task fingerprint", async () => {
    const root = await fixture();
    const graph = await scanProject(root, { writeArtifacts: false });
    const sensitiveTask = "Improve the private checkout interaction";
    await recordTaskEvaluation({
      rootPath: root,
      task: sensitiveTask,
      topThreeCorrect: true,
      falseDuplicateCount: 1,
      necessaryQuestions: 1,
      unnecessaryQuestions: 0,
      contextChars: 3100,
      preparationMs: 2200,
      conflictCount: 1,
      reworkRequired: false,
    });
    const records = await listTaskEvaluations(root);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      topThreeCorrect: true,
      contextChars: 3100,
      falseDuplicateCount: 1,
    });
    expect(JSON.stringify(records[0])).not.toContain(sensitiveTask);
    const database = await readFile(databasePath(graph.project.id));
    expect(database.toString("utf8")).not.toContain(sensitiveTask);
    await expect(
      recordTaskEvaluation({
        rootPath: root,
        task: "invalid",
        contextChars: 100_001,
      }),
    ).rejects.toThrow("contextChars");
    expect(await clearTaskEvaluations(root)).toEqual({ cleared: 1 });
    expect(await listTaskEvaluations(root)).toEqual([]);
  });

  it("audits Variables access without treating a non-exposed field as absence", async () => {
    const root = await fixture();
    await scanProject(root, { writeArtifacts: false });
    await mapFigmaDesign({
      rootPath: root,
      figmaUrl: "https://www.figma.com/design/CapabilityFixture/Capability",
      metadata:
        '<canvas id="1:1" name="Page"><frame id="2:1" name="Card" /></canvas>',
      format: "figma-mcp-xml",
    });
    expect(
      (await getProjectCapabilities(root)).observations.find(
        (item) => item.id === "figma-variables",
      ),
    ).toMatchObject({
      state: "not-exposed",
      detail: expect.stringContaining("no absence is inferred"),
    });

    await syncFigmaDesignVariables({
      rootPath: root,
      figmaFile: "CapabilityFixture",
      catalog: {
        availability: "permission-required",
        source: "none",
      },
    });
    expect(
      (await getProjectCapabilities(root)).observations.find(
        (item) => item.id === "figma-variables",
      ),
    ).toMatchObject({
      state: "permission-required",
      detail: expect.stringContaining("no absence is inferred"),
    });

    await syncFigmaDesignVariables({
      rootPath: root,
      figmaFile: "CapabilityFixture",
      catalog: {
        availability: "selection-only",
        source: "figma-selection",
      },
    });
    expect(
      (await getProjectCapabilities(root)).observations.find(
        (item) => item.id === "figma-variables",
      ),
    ).toMatchObject({
      state: "detected",
      detail: expect.stringContaining("not a global Variables catalog"),
    });
  });
});
