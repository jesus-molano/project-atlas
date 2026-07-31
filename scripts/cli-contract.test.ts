import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeProjectAtlasArguments } from "./project-atlas-arguments.mjs";
import { copyFixture } from "./test-fixture-copy.mjs";

const cliEntry = fileURLToPath(
  new URL("../packages/cli/dist/index.js", import.meta.url),
);
const codeFixture = fileURLToPath(
  new URL("../fixtures/vue-nuxt", import.meta.url),
);
const figmaFixture = fileURLToPath(
  new URL("../fixtures/figma/personal-no-dev-mode.xml", import.meta.url),
);
const legacyFixture = fileURLToPath(
  new URL(
    "../fixtures/legacy-component-atlas/react-project",
    import.meta.url,
  ),
);
const { createProgram } = await import(pathToFileURL(cliEntry).href);

function registeredCommandNames(): string[] {
  const program = createProgram() as {
    commands: Array<{ name: () => string }>;
  };
  return program.commands.map((command) => command.name());
}

function cli(args: string[]) {
  return spawnSync(process.execPath, [cliEntry, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
}

describe.sequential("CLI compact contracts", () => {
  let rootPath: string;
  let storageHome: string;
  let legacyHome: string;
  let previousStorageHome: string | undefined;
  let previousLegacyHome: string | undefined;

  beforeEach(async () => {
    previousStorageHome = process.env.PROJECT_ATLAS_HOME;
    previousLegacyHome = process.env.COMPONENT_ATLAS_HOME;
    storageHome = await mkdtemp(
      path.join(os.tmpdir(), "project-atlas-cli-storage-"),
    );
    legacyHome = await mkdtemp(
      path.join(os.tmpdir(), "component-atlas-cli-storage-"),
    );
    process.env.PROJECT_ATLAS_HOME = storageHome;
    process.env.COMPONENT_ATLAS_HOME = legacyHome;
    rootPath = await mkdtemp(path.join(os.tmpdir(), "project-atlas-cli-"));
    await copyFixture(codeFixture, rootPath);
    expect(cli(["scan", rootPath]).status).toBe(0);
  });

  afterEach(async () => {
    if (previousStorageHome === undefined) {
      delete process.env.PROJECT_ATLAS_HOME;
    } else {
      process.env.PROJECT_ATLAS_HOME = previousStorageHome;
    }
    if (previousLegacyHome === undefined) {
      delete process.env.COMPONENT_ATLAS_HOME;
    } else {
      process.env.COMPONENT_ATLAS_HOME = previousLegacyHome;
    }
    await Promise.all([
      rm(rootPath, { recursive: true, force: true }),
      rm(storageHome, { recursive: true, force: true }),
      rm(legacyHome, { recursive: true, force: true }),
    ]);
  });

  it("routes storage diagnostics as a CLI command instead of a project path", () => {
    const commandNames = registeredCommandNames();
    expect(
      normalizeProjectAtlasArguments(["storage", "--json"], commandNames),
    ).toEqual(["storage", "--json"]);
    expect(
      normalizeProjectAtlasArguments(["C:\\work\\checkout"], commandNames),
    ).toEqual(["open", "C:\\work\\checkout"]);
    expect(
      normalizeProjectAtlasArguments(
        ["storage", "migrate", rootPath, "--dry-run"],
        commandNames,
      ),
    ).toEqual(["storage", "migrate", rootPath, "--dry-run"]);
    const migration = cli([
      "storage",
      "migrate",
      rootPath,
      "--dry-run",
      "--json",
    ]);
    expect(migration.status).toBe(0);
    expect(JSON.parse(migration.stdout)).toMatchObject({
      mode: "dry-run",
      state: "not-found",
      source: { untouched: true },
    });
  });

  it("routes every registered top-level command from one source of truth", () => {
    const commandNames = registeredCommandNames();
    expect(commandNames).toEqual(
      expect.arrayContaining(["telemetry", "context-cost", "validate-diff"]),
    );

    for (const commandName of commandNames) {
      expect(
        normalizeProjectAtlasArguments([commandName, "--help"], commandNames),
      ).toEqual([commandName, "--help"]);
    }
    expect(
      normalizeProjectAtlasArguments(["C:\\work\\checkout"], commandNames),
    ).toEqual(["open", "C:\\work\\checkout"]);
  });

  it("migrates and removes a verified repository-local legacy directory", async () => {
    const legacyRoot = await mkdtemp(
      path.join(os.tmpdir(), "project-atlas-cli-legacy-"),
    );
    await copyFixture(legacyFixture, legacyRoot, { includeAtlasState: true });
    try {
      const result = cli([
        "storage",
        "migrate",
        legacyRoot,
        "--apply",
        "--remove-source",
        "--json",
      ]);
      expect(result.status, result.stderr).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report).toMatchObject({
        migration: {
          mode: "apply",
          state: "migrated",
          source: { untouched: true },
        },
        cleanup: {
          removedPath: path.join(legacyRoot, ".component-atlas"),
          projectStorageDeleted: false,
          repositoryDeleted: false,
        },
      });
      await expect(
        access(path.join(legacyRoot, ".component-atlas")),
      ).rejects.toThrow();
      await expect(
        access(report.cleanup.projectStoragePath),
      ).resolves.toBeUndefined();
      await expect(access(path.join(legacyRoot, "package.json"))).resolves
        .toBeUndefined();
    } finally {
      await rm(legacyRoot, { recursive: true, force: true });
    }
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
