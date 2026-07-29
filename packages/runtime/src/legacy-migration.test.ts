import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  GRAPH_SCHEMA_VERSION,
  type ComponentDecision,
  type ComponentGraph,
} from "@component-atlas/core";
import { AtlasStore, projectStorageDirectory } from "@component-atlas/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  migrateLegacyProjectStorage,
  removeMigratedLegacyProjectStorage,
} from "./legacy-migration.js";
import { resolveProjectIdentity } from "./identity.js";
import { loadTaskResumeCapsule } from "./task-state.js";

const fixtureRoot = path.resolve(
  import.meta.dirname,
  "../../../fixtures/legacy-component-atlas/react-project",
);
const temporaryRoots: string[] = [];
let previousStorageHome: string | undefined;
let previousComponentHome: string | undefined;
let legacyDataHome: string;

async function snapshotDirectory(
  rootPath: string,
  prefix = "",
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(path.join(rootPath, prefix), {
    withFileTypes: true,
  })) {
    if (entry.name === ".git") continue;
    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      Object.assign(result, await snapshotDirectory(rootPath, relativePath));
    } else {
      result[relativePath.replaceAll("\\", "/")] = createHash("sha256")
        .update(await readFile(path.join(rootPath, relativePath)))
        .digest("hex");
    }
  }
  return result;
}

async function legacyProjectFixture(): Promise<string> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "atlas-legacy-project-"));
  temporaryRoots.push(rootPath);
  await cp(fixtureRoot, rootPath, { recursive: true });
  const projectFile = path.join(rootPath, ".component-atlas", "project.json");
  const project = JSON.parse(await readFile(projectFile, "utf8")) as {
    project: {
      rootPath: string;
      identity: { worktreePath: string };
    };
  };
  project.project.rootPath = rootPath;
  project.project.identity.worktreePath = rootPath;
  await writeFile(projectFile, `${JSON.stringify(project, null, 2)}\n`, "utf8");
  await writeFile(
    path.join(rootPath, ".gitignore"),
    ".component-atlas/\n",
    "utf8",
  );
  execFileSync("git", ["init", "-b", "main"], {
    cwd: rootPath,
    stdio: "ignore",
    windowsHide: true,
  });
  execFileSync("git", ["config", "user.name", "Atlas Migration Test"], {
    cwd: rootPath,
    windowsHide: true,
  });
  execFileSync("git", ["config", "user.email", "atlas@example.invalid"], {
    cwd: rootPath,
    windowsHide: true,
  });
  execFileSync("git", ["add", ".gitignore", "package.json", "src"], {
    cwd: rootPath,
    windowsHide: true,
  });
  execFileSync("git", ["commit", "-m", "Legacy fixture"], {
    cwd: rootPath,
    stdio: "ignore",
    windowsHide: true,
  });
  return rootPath;
}

function gitStatus(rootPath: string): string {
  return execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    {
      cwd: rootPath,
      encoding: "utf8",
      windowsHide: true,
    },
  );
}

beforeEach(async () => {
  previousStorageHome = process.env.PROJECT_ATLAS_HOME;
  const storageHome = await mkdtemp(
    path.join(os.tmpdir(), "atlas-legacy-storage-"),
  );
  temporaryRoots.push(storageHome);
  process.env.PROJECT_ATLAS_HOME = storageHome;
  previousComponentHome = process.env.COMPONENT_ATLAS_HOME;
  legacyDataHome = await mkdtemp(
    path.join(os.tmpdir(), "component-atlas-legacy-storage-"),
  );
  temporaryRoots.push(legacyDataHome);
  process.env.COMPONENT_ATLAS_HOME = legacyDataHome;
});

afterEach(async () => {
  if (previousStorageHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousStorageHome;
  if (previousComponentHome === undefined) delete process.env.COMPONENT_ATLAS_HOME;
  else process.env.COMPONENT_ATLAS_HOME = previousComponentHome;
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((rootPath) => rm(rootPath, { recursive: true, force: true })),
  );
});

describe("repository-local legacy migration", () => {
  it("reports every real legacy category without writing during dry-run", async () => {
    const rootPath = await legacyProjectFixture();
    const beforeFiles = await snapshotDirectory(rootPath);
    const beforeStatus = gitStatus(rootPath);

    const report = await migrateLegacyProjectStorage(rootPath, {
      mode: "dry-run",
    });

    expect(report.state).toBe("ready");
    expect(
      Object.fromEntries(
        report.categories.map((category) => [
          category.category,
          category.detected,
        ]),
      ),
    ).toMatchObject({
      project: 1,
      catalog: 1,
      decisions: 1,
      memory: 1,
      "task-state": 2,
      database: 0,
    });
    expect(report.categories.find((item) => item.category === "catalog")?.note)
      .toContain("no queryable code graph");
    expect(report.source.untouched).toBe(true);
    expect(await snapshotDirectory(rootPath)).toEqual(beforeFiles);
    expect(gitStatus(rootPath)).toBe(beforeStatus);
    await expect(
      access(projectStorageDirectory(report.project.id)),
    ).rejects.toThrow();
  });

  it("imports content, is idempotent, and removes only verified legacy source", async () => {
    const rootPath = await legacyProjectFixture();
    const beforeStatus = gitStatus(rootPath);
    const beforeProject = await readFile(path.join(rootPath, "package.json"));

    const applied = await migrateLegacyProjectStorage(rootPath, {
      mode: "apply",
    });

    expect(applied.state).toBe("migrated");
    expect(applied.totals.invalid).toBe(0);
    expect(gitStatus(rootPath)).toBe(beforeStatus);
    expect(
      await readFile(
        path.join(applied.project.storagePath, "catalog.md"),
        "utf8",
      ),
    ).toContain("LegacyButton");
    expect(
      await readFile(
        path.join(
          applied.project.storagePath,
          "decisions",
          "2026-07-28-reuse-legacy-button.md",
        ),
        "utf8",
      ),
    ).toContain("Reuse the established button");
    const store = new AtlasStore(applied.project.id);
    try {
      const snapshot = store.readProjectSnapshot(
        applied.project.id,
        applied.project.checkoutId,
        { includeAllMemory: true },
      );
      expect(snapshot.componentDecisions).toEqual([
        expect.objectContaining({
          intent: "Reuse the established button",
          scope: "checkout",
          checkoutId: applied.project.checkoutId,
        }),
      ]);
      expect(snapshot.memoryItems).toEqual([
        expect.objectContaining({
          id: "legacy-button-rule",
          scope: "local",
          checkoutId: applied.project.checkoutId,
        }),
      ]);
    } finally {
      store.close();
    }
    expect(
      await loadTaskResumeCapsule(rootPath, "task-legacy"),
    ).toMatchObject({
      taskId: "task-legacy",
      objective: { text: "Continue the legacy button task" },
    });
    const status = await migrateLegacyProjectStorage(rootPath, {
      mode: "status",
    });
    expect(status.state).toBe("up-to-date");
    expect(status.totals.importable).toBe(0);
    expect(status.totals.alreadyImported).toBe(6);
    await expect(
      removeMigratedLegacyProjectStorage(rootPath, { confirmed: false }),
    ).rejects.toThrow(/confirmation/i);
    const legacyCatalogPath = path.join(
      rootPath,
      ".component-atlas",
      "catalog.md",
    );
    const legacyCatalog = await readFile(legacyCatalogPath, "utf8");
    await writeFile(legacyCatalogPath, `${legacyCatalog}\nchanged\n`, "utf8");
    await expect(
      removeMigratedLegacyProjectStorage(rootPath, { confirmed: true }),
    ).rejects.toThrow(/changed|verified/i);
    await writeFile(legacyCatalogPath, legacyCatalog, "utf8");
    const unexpectedPath = path.join(
      rootPath,
      ".component-atlas",
      "unexpected.txt",
    );
    await writeFile(unexpectedPath, "do not delete me", "utf8");
    await expect(
      removeMigratedLegacyProjectStorage(rootPath, { confirmed: true }),
    ).rejects.toThrow(/unrecognized|verified/i);
    await expect(
      access(path.join(rootPath, ".component-atlas")),
    ).resolves.toBeUndefined();
    await rm(unexpectedPath);

    const cleanup = await removeMigratedLegacyProjectStorage(rootPath, {
      confirmed: true,
    });

    expect(cleanup.removedFiles).toBe(6);
    expect(cleanup.projectStorageDeleted).toBe(false);
    await expect(
      access(path.join(rootPath, ".component-atlas")),
    ).rejects.toThrow();
    expect(await readFile(path.join(rootPath, "package.json"))).toEqual(
      beforeProject,
    );
    await expect(access(applied.project.storagePath)).resolves.toBeUndefined();
    expect(
      (await resolveProjectIdentity(rootPath, { fresh: true })).logicalId,
    ).toBe(applied.project.id);
  });

  it("opens the old ComponentAtlas database read-only and imports its graph and decisions", async () => {
    const rootPath = await legacyProjectFixture();
    const projectId = "0123456789abcdef0123";
    const oldCheckoutId = "abcdef0123456789abcd";
    const legacyDatabasePath = path.join(
      legacyDataHome,
      "projects",
      projectId,
      "atlas.sqlite",
    );
    const legacyStore = new AtlasStore(projectId, {
      filePath: legacyDatabasePath,
    });
    const graph: ComponentGraph = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      project: {
        id: projectId,
        name: "legacy-atlas-react",
        rootPath,
        framework: "react",
        scannedAt: "2026-07-28T10:00:00.000Z",
        sourceFiles: 1,
        identity: {
          logicalId: projectId,
          repositoryFingerprint: "0123456789abcdef",
          source: "path",
          checkoutId: oldCheckoutId,
          worktreePath: rootPath,
        },
      },
      components: [
        {
          id: "legacy-button",
          framework: "react",
          name: "LegacyButton",
          effectiveName: "LegacyButton",
          sourcePath: path.join(rootPath, "src", "LegacyButton.tsx"),
          relativePath: "src/LegacyButton.tsx",
          visibility: "public",
          exported: true,
          location: { line: 1, column: 1 },
          props: [],
          events: [],
          slots: [],
          models: [],
          renderedNames: [],
          imports: [],
          testPaths: [],
          classTokens: [],
          sourceHash: "legacy-source-hash",
        },
      ],
      edges: [],
      tokens: [],
    };
    const decision: ComponentDecision = {
      id: "legacy-db-decision",
      projectId,
      createdAt: "2026-07-28T10:15:00.000Z",
      intent: "Reuse from legacy database",
      decision: "reuse",
      selectedComponentIds: ["legacy-button"],
      rejectedComponentIds: [],
      rationale: "The database retained the queryable decision.",
      scope: "checkout",
      checkoutId: oldCheckoutId,
    };
    try {
      legacyStore.replaceGraph(graph);
      legacyStore.saveDecision(decision);
    } finally {
      legacyStore.close();
    }
    const sourceBefore = await readFile(legacyDatabasePath);
    const legacyStorageBefore = await snapshotDirectory(legacyDataHome);

    const dryRun = await migrateLegacyProjectStorage(rootPath, {
      mode: "dry-run",
    });
    expect(dryRun.source.legacyDatabasePath).toBe(legacyDatabasePath);
    expect(
      dryRun.categories.find((category) => category.category === "database"),
    ).toMatchObject({ detected: 1, importable: 2 });
    expect(await snapshotDirectory(legacyDataHome)).toEqual(
      legacyStorageBefore,
    );

    const applied = await migrateLegacyProjectStorage(rootPath, {
      mode: "apply",
    });

    const target = new AtlasStore(applied.project.id);
    try {
      expect(
        target.loadGraph(applied.project.id, applied.project.checkoutId),
      ).toMatchObject({
        project: {
          rootPath,
          identity: { checkoutId: applied.project.checkoutId },
        },
        components: [expect.objectContaining({ id: "legacy-button" })],
      });
      expect(
        target.listDecisions(applied.project.id, applied.project.checkoutId),
      ).toEqual([
        expect.objectContaining({
          id: "legacy-db-decision",
          checkoutId: applied.project.checkoutId,
        }),
      ]);
    } finally {
      target.close();
    }
    expect(await readFile(legacyDatabasePath)).toEqual(sourceBefore);
    expect(await snapshotDirectory(legacyDataHome)).toEqual(
      legacyStorageBefore,
    );
  });
});
