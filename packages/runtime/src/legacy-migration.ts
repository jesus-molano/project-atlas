import {
  randomUUID,
} from "node:crypto";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  GRAPH_SCHEMA_VERSION,
  type ComponentDecision,
  type ComponentGraph,
} from "@component-atlas/core";
import {
  assertMemoryContentSafe,
  parseMemoryMarkdown,
  type MemoryItem,
  type MemoryProposal,
} from "@component-atlas/memory";
import {
  AtlasStore,
  databasePath,
  legacyProjectAtlasStorageRoots,
  projectAtlasStorageRoot,
  projectAtlasTempRoot,
  projectStorageDirectory,
} from "@component-atlas/store";
import { resolveProjectIdentity } from "./identity.js";
import { taskStateFileName } from "./task-state-paths.js";
import {
  MIGRATION_SCHEMA_VERSION,
  LEGACY_DIRECTORY,
  MIGRATION_STATUS_FILE,
  digest,
  exists,
  slash,
  hashFile,
  assertNoSymlinkPath,
  readPreviousRun,
  readMigrationStatusFile,
  walkRegularFiles,
  parseLegacyDecisionMarkdown,
  planRepositoryFiles,
  type LegacyMigrationMode,
  type LegacyMigrationCategory,
  type LegacyMigrationCategoryReport,
  type LegacyProjectMigrationReport,
  type PlannedFile,
  type LegacyProjectArtifact,
  type LegacyDatabasePlan,
  type MigrationStatusFile,
} from "./legacy-migration-files.js";

export {
  parseLegacyDecisionMarkdown,
  type LegacyMigrationCategory,
  type LegacyMigrationCategoryReport,
  type LegacyMigrationMode,
  type LegacyMigrationPreviousRun,
  type LegacyProjectMigrationReport,
} from "./legacy-migration-files.js";

function databaseRecordKey(value: unknown): string {
  return digest(JSON.stringify(value));
}

function normalizedLegacyProposal(
  proposal: MemoryProposal,
  projectId: string,
): MemoryProposal {
  return {
    ...proposal,
    projectId,
  };
}

function normalizedLegacyDecision(
  decision: ComponentDecision,
  projectId: string,
  checkoutId: string,
): ComponentDecision {
  return {
    ...decision,
    projectId,
    ...(decision.scope === "checkout" ? { checkoutId } : {}),
  };
}

async function databaseSourceFiles(
  sourcePath: string,
): Promise<Array<{ path: string; suffix: string; hash: string }>> {
  const files: Array<{ path: string; suffix: string; hash: string }> = [];
  for (const suffix of ["", "-wal", "-shm"]) {
    const candidate = `${sourcePath}${suffix}`;
    if (!(await exists(candidate))) continue;
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(
        `Legacy database source must be a regular file: ${candidate}`,
      );
    }
    files.push({
      path: candidate,
      suffix,
      hash: await hashFile(candidate),
    });
  }
  if (!files.some((file) => file.suffix === "")) {
    throw new Error(`Legacy database does not exist: ${sourcePath}`);
  }
  return files;
}

async function withReadonlyDatabaseCopy<T>(
  sourcePath: string,
  read: (store: AtlasStore) => T,
): Promise<T> {
  const tempRoot = projectAtlasTempRoot();
  await mkdir(tempRoot, { recursive: true });
  const copyRoot = await mkdtemp(path.join(tempRoot, "legacy-db-read-"));
  const copyPath = path.join(copyRoot, "atlas.sqlite");
  try {
    let copied = false;
    for (let attempt = 0; attempt < 3 && !copied; attempt += 1) {
      const before = await databaseSourceFiles(sourcePath);
      await Promise.all(
        ["", "-wal", "-shm"].map((suffix) =>
          rm(`${copyPath}${suffix}`, { force: true }),
        ),
      );
      for (const file of before) {
        await copyFile(file.path, `${copyPath}${file.suffix}`);
      }
      const after = await databaseSourceFiles(sourcePath);
      copied =
        before.length === after.length &&
        before.every(
          (file, index) =>
            file.suffix === after[index]?.suffix &&
            file.hash === after[index]?.hash,
        );
    }
    if (!copied) {
      throw new Error(
        "Legacy database changed while it was being copied. Stop writers and retry.",
      );
    }
    const store = new AtlasStore("legacy-read-copy", {
      filePath: copyPath,
      readOnly: true,
    });
    try {
      return read(store);
    } finally {
      store.close();
    }
  } finally {
    await rm(copyRoot, { recursive: true, force: true });
  }
}

async function findLegacyDatabase(
  artifact: LegacyProjectArtifact | undefined,
  identity: Awaited<ReturnType<typeof resolveProjectIdentity>>,
  targetDatabasePath: string,
): Promise<LegacyDatabasePlan> {
  const ids = [
    artifact?.project?.id,
    identity.legacyPathId,
    identity.logicalId,
  ].filter((value): value is string => Boolean(value));
  const roots = [
    ...legacyProjectAtlasStorageRoots(),
    projectAtlasStorageRoot(),
  ];
  const candidates = [
    ...new Set(
      roots.flatMap((root) =>
        ids.map((id) => path.join(root, "projects", id, "atlas.sqlite")),
      ),
    ),
  ].filter(
    (candidate) =>
      path.resolve(candidate).toLowerCase() !==
      path.resolve(targetDatabasePath).toLowerCase(),
  );
  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue;
    try {
      const sourceMetadata = await lstat(candidate);
      if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isFile()) {
        return {
          sourcePath: candidate,
          importableRecords: 0,
          alreadyImportedRecords: 0,
          conflictingRecords: 0,
          invalidReason:
            "Legacy database must be a regular file, not a symbolic link.",
        };
      }
      const sourceRead = await withReadonlyDatabaseCopy(
        candidate,
        (sourceStore) => {
        let sourceProjectId: string | undefined;
        let sourceSnapshot:
          | ReturnType<AtlasStore["readProjectSnapshot"]>
          | undefined;
        for (const id of ids) {
          const snapshot = sourceStore.readProjectSnapshot(id, undefined, {
            includeAllMemory: true,
          });
          const scopedSnapshot = artifact?.project?.identity?.checkoutId
            ? sourceStore.readProjectSnapshot(
                id,
                artifact.project.identity.checkoutId,
                { includeAllMemory: true },
              )
            : snapshot;
          if (
            scopedSnapshot.graph ||
            scopedSnapshot.designIndexes.length > 0 ||
            scopedSnapshot.memoryItems.length > 0 ||
            scopedSnapshot.memoryProposals.length > 0 ||
            scopedSnapshot.componentDecisions.length > 0
          ) {
            sourceProjectId = id;
            sourceSnapshot = scopedSnapshot;
            break;
          }
        }
        if (!sourceProjectId || !sourceSnapshot) {
          return {
            sourcePath: candidate,
            importableRecords: 0,
            alreadyImportedRecords: 0,
            conflictingRecords: 0,
            invalidReason:
              "Legacy database contains no records for the detected project IDs.",
          };
        }
        return {
          sourceProjectId,
          sourceSnapshot,
        };
        },
      );
      if ("invalidReason" in sourceRead) {
        return {
          sourcePath: candidate,
          importableRecords: 0,
          alreadyImportedRecords: 0,
          conflictingRecords: 0,
          invalidReason: sourceRead.invalidReason,
        };
      }
      const { sourceProjectId, sourceSnapshot } = sourceRead;
      let currentSnapshot:
        | ReturnType<AtlasStore["readProjectSnapshot"]>
        | undefined;
      if (await exists(targetDatabasePath)) {
        currentSnapshot = await withReadonlyDatabaseCopy(
          targetDatabasePath,
          (targetStore) =>
            targetStore.readProjectSnapshot(
              identity.logicalId,
              identity.checkoutId,
              { includeAllMemory: true },
            ),
        );
      }
      const currentDesign = new Map(
        currentSnapshot?.designIndexes.map((item) => [item.file.key, item]),
      );
      const currentMemory = new Map(
        currentSnapshot?.memoryItems.map((item) => [
          `${item.scope}:${item.checkoutId ?? ""}:${item.id}`,
          item,
        ]),
      );
      const currentProposals = new Map(
        currentSnapshot?.memoryProposals.map((item) => [item.id, item]),
      );
      const currentDecisions = new Map(
        currentSnapshot?.componentDecisions.map((item) => [item.id, item]),
      );
      const normalizedGraph = sourceSnapshot.graph
        ? normalizedLegacyGraph(sourceSnapshot.graph, identity)
        : undefined;
      const normalizedMemory = sourceSnapshot.memoryItems.map((item) =>
        normalizedLegacyMemory(
          item,
          identity.logicalId,
          identity.checkoutId,
        ),
      );
      const normalizedProposals = sourceSnapshot.memoryProposals.map((item) =>
        normalizedLegacyProposal(item, identity.logicalId),
      );
      const normalizedDecisions = sourceSnapshot.componentDecisions.map((item) =>
        normalizedLegacyDecision(
          item,
          identity.logicalId,
          identity.checkoutId,
        ),
      );
      let importableRecords = normalizedGraph && !currentSnapshot?.graph ? 1 : 0;
      let alreadyImportedRecords = 0;
      let conflictingRecords = 0;
      if (normalizedGraph && currentSnapshot?.graph) {
        if (
          databaseRecordKey(normalizedGraph) ===
          databaseRecordKey(currentSnapshot.graph)
        ) {
          alreadyImportedRecords += 1;
        } else {
          conflictingRecords += 1;
        }
      }
      const compare = <T>(
        sourceItems: T[],
        current: Map<string, T>,
        key: (item: T) => string,
      ): void => {
        for (const item of sourceItems) {
          const existing = current.get(key(item));
          if (!existing) importableRecords += 1;
          else if (
            databaseRecordKey(existing) === databaseRecordKey(item)
          ) {
            alreadyImportedRecords += 1;
          } else {
            conflictingRecords += 1;
          }
        }
      };
      compare(
        sourceSnapshot.designIndexes,
        currentDesign,
        (item) => item.file.key,
      );
      compare(
        normalizedMemory,
        currentMemory,
        (item) => `${item.scope}:${item.checkoutId ?? ""}:${item.id}`,
      );
      compare(
        normalizedProposals,
        currentProposals,
        (item) => item.id,
      );
      compare(
        normalizedDecisions,
        currentDecisions,
        (item) => item.id,
      );
      return {
        sourcePath: candidate,
        sourceProjectId,
        sourceSnapshot,
        ...(currentSnapshot ? { currentSnapshot } : {}),
        importableRecords,
        alreadyImportedRecords,
        conflictingRecords,
      };
    } catch (error) {
      return {
        sourcePath: candidate,
        importableRecords: 0,
        alreadyImportedRecords: 0,
        conflictingRecords: 0,
        invalidReason:
          error instanceof Error ? error.message : String(error),
      };
    }
  }
  return {
    importableRecords: 0,
    alreadyImportedRecords: 0,
    conflictingRecords: 0,
  };
}

async function atomicCreateFromSource(
  file: PlannedFile,
  storagePath: string,
): Promise<void> {
  const currentHash = await hashFile(file.sourcePath);
  if (currentHash !== file.hash) {
    throw new Error(
      `Legacy source changed after planning: ${file.sourceRelativePath}`,
    );
  }
  await assertNoSymlinkPath(
    storagePath,
    path.dirname(file.targetPath),
  );
  await mkdir(path.dirname(file.targetPath), { recursive: true });
  const temporary = `${file.targetPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, await readFile(file.sourcePath), { flag: "wx" });
    await link(temporary, file.targetPath);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function bindMigratedTaskCapsules(
  files: PlannedFile[],
  storagePath: string,
  identity: Awaited<ReturnType<typeof resolveProjectIdentity>>,
): Promise<void> {
  for (const file of files.filter(
    (candidate) =>
      candidate.category === "task-state" &&
      /^task-state\/capsules\/[^/]+\.json$/u.test(
        slash(candidate.sourceRelativePath),
      ) &&
      candidate.content,
  )) {
    const parsed = JSON.parse(file.content!) as {
      taskId?: unknown;
      workspace?: { rootPath?: unknown };
    } & Record<string, unknown>;
    if (typeof parsed.taskId !== "string" || !parsed.workspace) continue;
    const target = path.join(
      storagePath,
      "task-state",
      "capsules",
      taskStateFileName(identity.worktreePath, parsed.taskId, "json"),
    );
    if (await exists(target)) continue;
    const normalized = {
      ...parsed,
      workspace: {
        ...parsed.workspace,
        rootPath: identity.worktreePath,
      },
    };
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, {
        flag: "wx",
      });
      await link(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

function normalizedLegacyGraph(
  graph: ComponentGraph,
  identity: Awaited<ReturnType<typeof resolveProjectIdentity>>,
): ComponentGraph {
  const {
    legacyPathId: _legacyPathId,
    ...identityMetadata
  } = identity;
  return {
    ...graph,
    schemaVersion: GRAPH_SCHEMA_VERSION,
    project: {
      ...graph.project,
      id: identity.logicalId,
      rootPath: identity.worktreePath,
      identity: identityMetadata,
    },
  };
}

function normalizedLegacyMemory(
  item: MemoryItem,
  projectId: string,
  checkoutId: string,
): MemoryItem {
  return {
    ...item,
    projectId,
    ...(item.scope === "canonical" ? {} : { checkoutId }),
  };
}

async function importDatabase(
  plan: LegacyDatabasePlan,
  identity: Awaited<ReturnType<typeof resolveProjectIdentity>>,
): Promise<number> {
  const source = plan.sourceSnapshot;
  if (!source) return 0;
  const target = new AtlasStore(identity.logicalId);
  let imported = 0;
  try {
    const current = target.readProjectSnapshot(
      identity.logicalId,
      identity.checkoutId,
      {
        includeAllMemory: true,
      },
    );
    if (source.graph && !current.graph) {
      target.replaceGraph(normalizedLegacyGraph(source.graph, identity));
      imported += 1;
    }
    const designKeys = new Set(current.designIndexes.map((item) => item.file.key));
    for (const item of source.designIndexes) {
      if (designKeys.has(item.file.key)) continue;
      target.saveDesignIndex(identity.logicalId, item);
      imported += 1;
    }
    const memoryKeys = new Set(
      current.memoryItems.map(
        (item) => `${item.scope}:${item.checkoutId ?? ""}:${item.id}`,
      ),
    );
    for (const item of source.memoryItems) {
      const normalized = normalizedLegacyMemory(
        item,
        identity.logicalId,
        identity.checkoutId,
      );
      const key = `${normalized.scope}:${normalized.checkoutId ?? ""}:${normalized.id}`;
      if (memoryKeys.has(key)) continue;
      target.saveMemoryItem(identity.logicalId, normalized, "import");
      imported += 1;
    }
    const proposalIds = new Set(current.memoryProposals.map((item) => item.id));
    for (const proposal of source.memoryProposals) {
      if (proposalIds.has(proposal.id)) continue;
      target.saveMemoryProposal(
        normalizedLegacyProposal(proposal, identity.logicalId),
      );
      imported += 1;
    }
    const decisionIds = new Set(
      current.componentDecisions.map((item) => item.id),
    );
    for (const decision of source.componentDecisions) {
      if (decisionIds.has(decision.id)) continue;
      target.saveDecision(
        normalizedLegacyDecision(
          decision,
          identity.logicalId,
          identity.checkoutId,
        ),
      );
      imported += 1;
    }
  } finally {
    target.close();
  }
  return imported;
}

async function importMarkdownSemantics(
  files: PlannedFile[],
  identity: Awaited<ReturnType<typeof resolveProjectIdentity>>,
  artifact: LegacyProjectArtifact | undefined,
  databasePlan: LegacyDatabasePlan,
): Promise<number> {
  const target = new AtlasStore(identity.logicalId);
  let imported = 0;
  try {
    const current = target.readProjectSnapshot(
      identity.logicalId,
      identity.checkoutId,
      {
        includeAllMemory: true,
      },
    );
    const decisionIds = new Set(
      current.componentDecisions.map((item) => item.id),
    );
    if ((databasePlan.sourceSnapshot?.componentDecisions.length ?? 0) === 0) {
      for (const file of files.filter(
        (candidate) =>
          candidate.category === "decisions" &&
          candidate.action !== "invalid" &&
          candidate.content,
      )) {
        const decision = parseLegacyDecisionMarkdown(file.content!, {
          projectId: identity.logicalId,
          checkoutId: identity.checkoutId,
          sourceHash: file.hash,
        });
        if (decisionIds.has(decision.id)) continue;
        target.saveDecision(decision);
        decisionIds.add(decision.id);
        imported += 1;
      }
    }
    if ((databasePlan.sourceSnapshot?.memoryItems.length ?? 0) === 0) {
      const memoryKeys = new Set(
        current.memoryItems.map(
          (item) => `${item.scope}:${item.checkoutId ?? ""}:${item.id}`,
        ),
      );
      for (const file of files.filter(
        (candidate) =>
          candidate.category === "memory" &&
          candidate.action !== "invalid" &&
          candidate.content,
      )) {
        const parsed = parseMemoryMarkdown(file.content!, {
          projectId: identity.logicalId,
          projectName:
            artifact?.project?.name ?? path.basename(identity.worktreePath),
          sourcePath: `atlas-storage/${file.targetRelativePath}`,
          defaultScope: "local",
        });
        const item: MemoryItem = {
          ...parsed,
          projectId: identity.logicalId,
          scope: parsed.scope === "episodic" ? "episodic" : "local",
          checkoutId: identity.checkoutId,
          bodyPath: `atlas-storage/${file.targetRelativePath}`,
          provenance: {
            ...parsed.provenance,
            kind: "import",
          },
        };
        assertMemoryContentSafe(item);
        const key = `${item.scope}:${item.checkoutId}:${item.id}`;
        if (memoryKeys.has(key)) continue;
        target.saveMemoryItem(identity.logicalId, item, "markdown");
        memoryKeys.add(key);
        imported += 1;
      }
    }
  } finally {
    target.close();
  }
  return imported;
}

async function atomicStatus(
  target: string,
  status: MigrationStatusFile,
): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

function categoryReports(
  files: PlannedFile[],
  databasePlan: LegacyDatabasePlan,
  importedFilesByCategory: Map<LegacyMigrationCategory, number>,
  importedDatabaseRecords: number,
): LegacyMigrationCategoryReport[] {
  const reports: LegacyMigrationCategoryReport[] = [];
  for (const category of [
    "project",
    "catalog",
    "decisions",
    "memory",
    "task-state",
  ] as const) {
    const categoryFiles = files.filter((file) => file.category === category);
    reports.push({
      category,
      detected: categoryFiles.length,
      bytes: categoryFiles.reduce((sum, file) => sum + file.bytes, 0),
      importable: categoryFiles.filter((file) => file.action === "import").length,
      alreadyImported: categoryFiles.filter(
        (file) => file.action === "already-imported",
      ).length,
      conflictsPreserved: categoryFiles.filter(
        (file) => file.action === "preserve-conflict",
      ).length,
      invalid: categoryFiles.filter((file) => file.action === "invalid").length,
      imported: importedFilesByCategory.get(category) ?? 0,
      ...(category === "catalog" && !databasePlan.sourceSnapshot?.graph
        ? {
            note:
              "Catalog Markdown can be preserved, but no queryable code graph can be reconstructed without the legacy SQLite database; run a scan after migration.",
          }
        : {}),
    });
  }
  reports.push({
    category: "database",
    detected: databasePlan.sourcePath ? 1 : 0,
    bytes: 0,
    importable: databasePlan.importableRecords,
    alreadyImported: databasePlan.alreadyImportedRecords,
    conflictsPreserved: databasePlan.conflictingRecords,
    invalid: databasePlan.invalidReason ? 1 : 0,
    imported: importedDatabaseRecords,
    ...(!databasePlan.sourcePath
      ? {
          note:
            "No legacy ComponentAtlas SQLite database was found. Repository-local text can still be migrated.",
        }
      : {}),
  });
  return reports;
}

function reportTotals(
  categories: LegacyMigrationCategoryReport[],
): LegacyProjectMigrationReport["totals"] {
  return categories.reduce(
    (total, category) => ({
      detected: total.detected + category.detected,
      importable: total.importable + category.importable,
      alreadyImported: total.alreadyImported + category.alreadyImported,
      conflictsPreserved:
        total.conflictsPreserved + category.conflictsPreserved,
      invalid: total.invalid + category.invalid,
      imported: total.imported + category.imported,
    }),
    {
      detected: 0,
      importable: 0,
      alreadyImported: 0,
      conflictsPreserved: 0,
      invalid: 0,
      imported: 0,
    },
  );
}

export async function migrateLegacyProjectStorage(
  inputPath: string,
  options: { mode?: LegacyMigrationMode } = {},
): Promise<LegacyProjectMigrationReport> {
  const mode = options.mode ?? "dry-run";
  const identity = await resolveProjectIdentity(inputPath, {
    fresh: true,
    ignoreLegacyArtifact: true,
  });
  const rootPath = identity.worktreePath;
  const sourceRoot = path.join(rootPath, LEGACY_DIRECTORY);
  const storagePath = projectStorageDirectory(identity.logicalId);
  const previousRun = await readPreviousRun(storagePath);
  const sourceExists = await exists(sourceRoot);
  if (!sourceExists) {
    const categories = categoryReports([], {
      importableRecords: 0,
      alreadyImportedRecords: 0,
      conflictingRecords: 0,
    }, new Map(), 0);
    return {
      schemaVersion: MIGRATION_SCHEMA_VERSION,
      mode,
      state: previousRun ? "up-to-date" : "not-found",
      project: {
        rootPath,
        id: identity.logicalId,
        checkoutId: identity.checkoutId,
        storagePath,
      },
      source: {
        rootPath: sourceRoot,
        untouched: true,
      },
      categories,
      warnings: [],
      ...(previousRun ? { previousRun } : {}),
      totals: reportTotals(categories),
    };
  }
  const sourceMetadata = await lstat(sourceRoot);
  if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isDirectory()) {
    throw new Error(
      "Legacy .component-atlas must be a real directory, not a symbolic link.",
    );
  }
  const initial = await planRepositoryFiles(
    sourceRoot,
    storagePath,
    identity.logicalId,
    identity.checkoutId,
    path.basename(rootPath),
  );
  const artifactName = initial.artifact?.project?.name ?? path.basename(rootPath);
  const planned =
    artifactName === path.basename(rootPath)
      ? initial
      : await planRepositoryFiles(
          sourceRoot,
          storagePath,
          identity.logicalId,
          identity.checkoutId,
          artifactName,
        );
  const databasePlan = await findLegacyDatabase(
    planned.artifact,
    identity,
    databasePath(identity.logicalId),
  );
  const warnings = planned.files
    .filter((file) => file.reason)
    .map((file) => `${file.sourceRelativePath}: ${file.reason}`);
  if (
    planned.artifact?.project?.rootPath &&
    path.resolve(planned.artifact.project.rootPath).toLowerCase() !==
      path.resolve(rootPath).toLowerCase()
  ) {
    warnings.push(
      `Legacy project.json was created for ${planned.artifact.project.rootPath}; explicit apply will bind local/checkout content to ${rootPath}.`,
    );
  }
  if (databasePlan.invalidReason) warnings.push(databasePlan.invalidReason);
  const importedFilesByCategory = new Map<
    LegacyMigrationCategory,
    number
  >();
  let importedDatabaseRecords = 0;
  if (mode === "apply") {
    for (const file of planned.files.filter(
      (candidate) =>
        candidate.action === "import" ||
        candidate.action === "preserve-conflict",
    )) {
      await atomicCreateFromSource(file, storagePath);
      importedFilesByCategory.set(
        file.category,
        (importedFilesByCategory.get(file.category) ?? 0) + 1,
      );
    }
    await bindMigratedTaskCapsules(
      planned.files,
      storagePath,
      identity,
    );
    importedDatabaseRecords = await importDatabase(databasePlan, identity);
    const importedSemanticRecords = await importMarkdownSemantics(
      planned.files,
      identity,
      planned.artifact,
      databasePlan,
    );
    const sourceFiles = planned.files
      .filter((file) => file.hash)
      .map((file) => ({
        relativePath: file.sourceRelativePath,
        hash: file.hash,
        bytes: file.bytes,
      }));
    const sourceFingerprint = digest(
      sourceFiles
        .map((file) => `${file.relativePath}\0${file.hash}\0${file.bytes}`)
        .join("\n"),
    );
    await atomicStatus(path.join(storagePath, MIGRATION_STATUS_FILE), {
      schemaVersion: MIGRATION_SCHEMA_VERSION,
      completedAt: new Date().toISOString(),
      sourceRoot,
      sourceFingerprint,
      importedFiles: [...importedFilesByCategory.values()].reduce(
        (sum, count) => sum + count,
        0,
      ),
      importedDatabaseRecords:
        importedDatabaseRecords + importedSemanticRecords,
      sourceFiles,
    });
  }
  const categories = categoryReports(
    planned.files,
    databasePlan,
    importedFilesByCategory,
    importedDatabaseRecords,
  );
  const totals = reportTotals(categories);
  const state =
    mode === "apply"
      ? totals.invalid > 0 || totals.conflictsPreserved > 0
        ? "partial"
        : "migrated"
      : totals.importable > 0 || totals.conflictsPreserved > 0
        ? "ready"
        : totals.invalid > 0
          ? "partial"
          : "up-to-date";
  return {
    schemaVersion: MIGRATION_SCHEMA_VERSION,
    mode,
    state,
    project: {
      rootPath,
      id: identity.logicalId,
      checkoutId: identity.checkoutId,
      storagePath,
    },
    source: {
      rootPath: sourceRoot,
      untouched: true,
      ...(planned.artifact?.project?.id
        ? { artifactProjectId: planned.artifact.project.id }
        : {}),
      ...(databasePlan.sourcePath
        ? { legacyDatabasePath: databasePlan.sourcePath }
        : {}),
    },
    categories,
    warnings,
    ...(previousRun ? { previousRun } : {}),
    totals,
  };
}

export interface LegacyProjectCleanupReport {
  schemaVersion: typeof MIGRATION_SCHEMA_VERSION;
  projectRoot: string;
  removedPath: string;
  removedFiles: number;
  projectStoragePath: string;
  projectStorageDeleted: false;
  repositoryDeleted: false;
}

export async function removeMigratedLegacyProjectStorage(
  inputPath: string,
  options: { confirmed: boolean },
): Promise<LegacyProjectCleanupReport> {
  if (options.confirmed !== true) {
    throw new Error(
      "Removing legacy .component-atlas requires explicit confirmation.",
    );
  }
  const migration = await migrateLegacyProjectStorage(inputPath, {
    mode: "status",
  });
  if (migration.state === "not-found") {
    throw new Error("No repository-local .component-atlas directory exists.");
  }
  if (
    migration.totals.importable > 0 ||
    migration.totals.invalid > 0 ||
    migration.categories
      .filter((category) => category.category !== "database")
      .some((category) => category.conflictsPreserved > 0)
  ) {
    throw new Error(
      "Legacy cleanup is blocked until every recognized repository-local file has been imported and verified.",
    );
  }
  const status = await readMigrationStatusFile(migration.project.storagePath);
  if (!status) {
    throw new Error(
      "Legacy cleanup requires a completed migration status record.",
    );
  }
  const sourceRoot = migration.source.rootPath;
  const sourceMetadata = await lstat(sourceRoot);
  if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isDirectory()) {
    throw new Error("Refusing to remove a symbolic or non-directory source.");
  }
  if (
    path.resolve(path.dirname(sourceRoot)).toLowerCase() !==
      path.resolve(migration.project.rootPath).toLowerCase() ||
    path.basename(sourceRoot) !== LEGACY_DIRECTORY
  ) {
    throw new Error("Legacy cleanup target is outside the selected project.");
  }
  const allFiles = await walkRegularFiles(sourceRoot);
  const current = await Promise.all(
    allFiles.map(async (file) => ({
      relativePath: slash(file.relativePath),
      hash: await hashFile(file.absolutePath),
      bytes: (await lstat(file.absolutePath)).size,
    })),
  );
  const expected = [...status.sourceFiles].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  current.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new Error(
      "Legacy cleanup is blocked because .component-atlas changed after migration or contains unrecognized files.",
    );
  }
  await rm(sourceRoot, { recursive: true });
  return {
    schemaVersion: MIGRATION_SCHEMA_VERSION,
    projectRoot: migration.project.rootPath,
    removedPath: sourceRoot,
    removedFiles: current.length,
    projectStoragePath: migration.project.storagePath,
    projectStorageDeleted: false,
    repositoryDeleted: false,
  };
}
