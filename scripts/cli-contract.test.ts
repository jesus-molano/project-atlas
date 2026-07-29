import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectId } from "../packages/core/src/naming.js";
import { databasePath } from "../packages/store/src/index.js";
import { normalizeProjectAtlasArguments } from "./project-atlas-arguments.mjs";

const cliEntry = fileURLToPath(
  new URL("../packages/cli/dist/index.js", import.meta.url),
);
const codeFixture = fileURLToPath(
  new URL("../fixtures/vue-nuxt", import.meta.url),
);
const figmaFixture = fileURLToPath(
  new URL("../fixtures/figma/personal-no-dev-mode.xml", import.meta.url),
);

function cli(args: string[]) {
  return spawnSync(process.execPath, [cliEntry, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
}

describe.sequential("CLI compact contracts", () => {
  let rootPath: string;

  beforeEach(async () => {
    rootPath = await mkdtemp(path.join(os.tmpdir(), "project-atlas-cli-"));
    await cp(codeFixture, rootPath, { recursive: true });
    expect(cli(["scan", rootPath]).status).toBe(0);
  });

  afterEach(async () => {
    await Promise.all([
      rm(rootPath, { recursive: true, force: true }),
      rm(path.dirname(databasePath(projectId(rootPath))), {
        recursive: true,
        force: true,
      }),
    ]);
  });

  it("routes storage diagnostics as a CLI command instead of a project path", () => {
    expect(normalizeProjectAtlasArguments(["storage", "--json"])).toEqual([
      "storage",
      "--json",
    ]);
    expect(normalizeProjectAtlasArguments(["C:\\work\\checkout"])).toEqual([
      "open",
      "C:\\work\\checkout",
    ]);
  });

  it("enforces the reuse limit and shared response budget", () => {
    const result = cli([
      "context",
      rootPath,
      "settings form with validation",
      "--limit",
      "5",
      "--budget",
      "1600",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim().length).toBeLessThanOrEqual(1_600);
    expect(JSON.parse(result.stdout)).toMatchObject({
      candidates: expect.any(Array),
      metrics: {
        budgetChars: 1600,
        expandableIds: expect.any(Array),
      },
    });

    const invalid = cli([
      "context",
      rootPath,
      "settings form",
      "--limit",
      "6",
    ]);
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("Limit must not exceed 5");
  });

  it("hard-caps Figma map and list output", () => {
    const mapped = cli([
      "figma",
      "map",
      rootPath,
      "https://www.figma.com/design/PortableFixture/Portable-fixture",
      "--metadata",
      figmaFixture,
      "--format",
      "figma-mcp-xml",
      "--budget",
      "1600",
    ]);
    expect(mapped.status).toBe(0);
    expect(mapped.stdout.trim().length).toBeLessThanOrEqual(1_600);
    expect(JSON.parse(mapped.stdout)).toMatchObject({
      summary: expect.any(Object),
      metrics: { budgetChars: 1600 },
    });

    const listed = cli([
      "figma",
      "list",
      rootPath,
      "--budget",
      "1200",
    ]);
    expect(listed.status).toBe(0);
    expect(listed.stdout.trim().length).toBeLessThanOrEqual(1_200);
    expect(JSON.parse(listed.stdout)).toMatchObject({
      indexes: expect.any(Array),
      metrics: { budgetChars: 1200 },
    });
  });
});
