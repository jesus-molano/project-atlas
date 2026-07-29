import { createHash, randomUUID } from "node:crypto";
import {
  access,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  GRAPH_SCHEMA_VERSION,
  parseSourceReceipt,
  type ComponentDecision,
  type ComponentGraph,
  type DecisionKind,
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

const MIGRATION_SCHEMA_VERSION = 1 as const;
const LEGACY_DIRECTORY = ".component-atlas";
const MIGRATION_DIRECTORY = path.join(
  "migrations",
  "repository-local-v1",
);
const MIGRATION_STATUS_FILE = path.join(MIGRATION_DIRECTORY, "status.json");
const ALLOWED_TASK_STATE_DIRECTORIES = new Set([
  "capsules",
  "final",
  "journals",
  "ledgers",
  "manifests",
  "receipts",
  "retrieval",
  "retrieval-results",
]);
const DECISION_KINDS = new Set<DecisionKind>([
  "reuse",
  "extend",
  "compose",
  "extract-and-reuse",
  "create",
]);

export type LegacyMigrationMode = "status" | "dry-run" | "apply";
export type LegacyMigrationCategory =
  | "project"
  | "catalog"
  | "decisions"
  | "memory"
  | "task-state"
  | "database";

export interface LegacyMigrationCategoryReport {
  category: LegacyMigrationCategory;
  detected: number;
  bytes: number;
  importable: number;
  alreadyImported: number;
  conflictsPreserved: number;
  invalid: number;
  imported: number;
  note?: string;
}

export interface LegacyMigrationPreviousRun {
  completedAt: string;
  sourceRoot: string;
  sourceFingerprint: string;
  importedFiles: number;
  importedDatabaseRecords: number;
}

export interface LegacyProjectMigrationReport {
  schemaVersion: typeof MIGRATION_SCHEMA_VERSION;
  mode: LegacyMigrationMode;
  state:
    | "not-found"
    | "ready"
    | "partial"
    | "up-to-date"
    | "migrated";
  project: {
    rootPath: string;
    id: string;
    checkoutId: string;
    storagePath: string;
  };
  source: {
    rootPath: string;
    untouched: true;
    artifactProjectId?: string;
    legacyDatabasePath?: string;
  };
  categories: LegacyMigrationCategoryReport[];
  warnings: string[];
  previousRun?: LegacyMigrationPreviousRun;
  totals: {
    detected: number;
    importable: number;
    alreadyImported: number;
    conflictsPreserved: number;
    invalid: number;
    imported: number;
  };
}

interface PlannedFile {
  category: Exclude<LegacyMigrationCategory, "database">;
  sourcePath: string;
  sourceRelativePath: string;
  targetPath: string;
  targetRelativePath: string;
  bytes: number;
  hash: string;
  action:
    | "import"
    | "already-imported"
    | "preserve-conflict"
    | "invalid";
  reason?: string;
  content?: string;
}

interface LegacyProjectArtifact {
  schemaVersion?: number;
  project?: {
    id?: string;
    name?: string;
    rootPath?: string;
    framework?: string;
    scannedAt?: string;
    sourceFiles?: number;
    identity?: {
      source?: string;
      repositoryFingerprint?: string;
      checkoutId?: string;
    };
  };
}

interface LegacyDatabasePlan {
  sourcePath?: string;
  sourceProjectId?: string;
  sourceSnapshot?: ReturnType<AtlasStore["readProjectSnapshot"]>;
  currentSnapshot?: ReturnType<AtlasStore["readProjectSnapshot"]>;
  importableRecords: number;
  alreadyImportedRecords: number;
  conflictingRecords: number;
  invalidReason?: string;
}

interface MigrationStatusFile {
  schemaVersion: typeof MIGRATION_SCHEMA_VERSION;
  completedAt: string;
  sourceRoot: string;
  sourceFingerprint: string;
  importedFiles: number;
  importedDatabaseRecords: number;
  sourceFiles: Array<{
    relativePath: string;
    hash: string;
    bytes: number;
  }>;
}

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function slash(value: string): string {
  return value.replaceAll("\\", "/");
}

function inside(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return (
    relative !== "" &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

async function hashFile(filePath: string): Promise<string> {
  return digest(await readFile(filePath));
}

async function assertNoSymlinkPath(
  storagePath: string,
  targetPath: string,
): Promise<void> {
  const relative = path.relative(storagePath, targetPath);
  const segments = relative.split(path.sep).filter(Boolean);
  let current = storagePath;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(
          `Storage target traverses a symbolic link: ${current}`,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
}

async function regularTargetHash(filePath: string): Promise<string> {
  const metadata = await lstat(filePath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("Existing migration target is not a regular file.");
  }
  return hashFile(filePath);
}

async function readPreviousRun(
  storagePath: string,
): Promise<LegacyMigrationPreviousRun | undefined> {
  try {
    const parsed = await readMigrationStatusFile(storagePath);
    if (!parsed) return undefined;
    if (
      typeof parsed.completedAt !== "string" ||
      typeof parsed.sourceRoot !== "string" ||
      typeof parsed.sourceFingerprint !== "string" ||
      typeof parsed.importedFiles !== "number" ||
      typeof parsed.importedDatabaseRecords !== "number"
    ) {
      return undefined;
    }
    return {
      completedAt: parsed.completedAt,
      sourceRoot: parsed.sourceRoot,
      sourceFingerprint: parsed.sourceFingerprint,
      importedFiles: parsed.importedFiles,
      importedDatabaseRecords: parsed.importedDatabaseRecords,
    };
  } catch {
    return undefined;
  }
}

async function readMigrationStatusFile(
  storagePath: string,
): Promise<MigrationStatusFile | undefined> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(storagePath, MIGRATION_STATUS_FILE), "utf8"),
    ) as Partial<MigrationStatusFile>;
    if (
      parsed.schemaVersion !== MIGRATION_SCHEMA_VERSION ||
      typeof parsed.completedAt !== "string" ||
      typeof parsed.sourceRoot !== "string" ||
      typeof parsed.sourceFingerprint !== "string" ||
      typeof parsed.importedFiles !== "number" ||
      typeof parsed.importedDatabaseRecords !== "number" ||
      !Array.isArray(parsed.sourceFiles) ||
      parsed.sourceFiles.some(
        (file) =>
          typeof file?.relativePath !== "string" ||
          typeof file.hash !== "string" ||
          typeof file.bytes !== "number",
      )
    ) {
      return undefined;
    }
    return parsed as MigrationStatusFile;
  } catch {
    return undefined;
  }
}

async function regularFile(
  sourcePath: string,
  maximumBytes: number,
): Promise<{ bytes: number; hash: string; content: string }> {
  const metadata = await lstat(sourcePath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("Only regular files are eligible for migration.");
  }
  if (metadata.size > maximumBytes) {
    throw new Error(
      `File exceeds the ${maximumBytes} byte migration limit.`,
    );
  }
  const buffer = await readFile(sourcePath);
  return {
    bytes: buffer.byteLength,
    hash: digest(buffer),
    content: buffer.toString("utf8"),
  };
}

async function walkRegularFiles(
  directory: string,
  prefix = "",
): Promise<Array<{ absolutePath: string; relativePath: string }>> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: Array<{ absolutePath: string; relativePath: string }> = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const relativePath = path.join(prefix, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      files.push({ absolutePath, relativePath });
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await walkRegularFiles(absolutePath, relativePath)));
    } else {
      files.push({ absolutePath, relativePath });
    }
  }
  return files;
}

function parseJson(content: string, label: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function validateTaskState(
  relativePath: string,
  content: string,
): void {
  const normalized = slash(relativePath);
  const [directory, fileName, ...extra] = normalized.split("/");
  if (
    !directory ||
    !fileName ||
    extra.length > 0 ||
    !ALLOWED_TASK_STATE_DIRECTORIES.has(directory)
  ) {
    throw new Error("Task-state path is not part of a recognized legacy category.");
  }
  if (directory === "journals") {
    if (!fileName.endsWith(".ndjson")) {
      throw new Error("Legacy journals must use the .ndjson extension.");
    }
    const lines = content.split(/\r?\n/u).filter(Boolean);
    if (lines.length === 0) throw new Error("Legacy journal is empty.");
    for (const line of lines) parseJson(line, "Legacy journal entry");
    return;
  }
  if (!fileName.endsWith(".json")) {
    throw new Error("Legacy task state must use the .json extension.");
  }
  const parsed = parseJson(content, "Legacy task state");
  if (directory === "receipts") parseSourceReceipt(parsed);
}

export function parseLegacyDecisionMarkdown(
  content: string,
  options: {
    projectId: string;
    checkoutId: string;
    sourceHash: string;
  },
): ComponentDecision {
  const field = (name: string): string | undefined =>
    content.match(new RegExp(`^- ${name}: (.+)$`, "mu"))?.[1]?.trim();
  const intent = field("Intent");
  const decisionValue = field("Decision");
  const createdAt = field("Recorded");
  const scopeValue = field("Scope");
  const rationale = content.match(/## Rationale\s+([\s\S]+)$/u)?.[1]?.trim();
  if (
    !intent ||
    !decisionValue ||
    !DECISION_KINDS.has(decisionValue as DecisionKind) ||
    !createdAt ||
    !Number.isFinite(Date.parse(createdAt)) ||
    !scopeValue ||
    !rationale
  ) {
    throw new Error("Legacy component decision Markdown is invalid.");
  }
  const scope = scopeValue.startsWith("project") ? "project" : "checkout";
  const values = (name: string): string[] => {
    const value = field(name);
    return !value || value === "none"
      ? []
      : value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 64);
  };
  const id = createHash("sha256")
    .update(
      `legacy-decision\0${options.projectId}\0${options.sourceHash}`,
    )
    .digest("hex")
    .slice(0, 24);
  return {
    id,
    projectId: options.projectId,
    createdAt,
    intent,
    decision: decisionValue as DecisionKind,
    selectedComponentIds: values("Selected"),
    rejectedComponentIds: values("Rejected"),
    rationale,
    scope,
    ...(scope === "checkout" ? { checkoutId: options.checkoutId } : {}),
    provenance: {
      scope,
      origin: "agent-observation",
      observedAt: createdAt,
      projectId: options.projectId,
      ...(scope === "checkout" ? { checkoutId: options.checkoutId } : {}),
      promotion: scope === "project" ? "confirmed" : "requires-confirmation",
      invalidatesOn:
        scope === "project" ? "explicit-replacement" : "checkout-change",
    },
  };
}

async function plannedTarget(
  storagePath: string,
  preferredRelativePath: string,
  sourceRelativePath: string,
  sourceHash: string,
): Promise<{
  action: PlannedFile["action"];
  targetPath: string;
  targetRelativePath: string;
  reason?: string;
}> {
  const preferred = path.join(storagePath, preferredRelativePath);
  if (!inside(storagePath, preferred)) {
    return {
      action: "invalid",
      targetPath: preferred,
      targetRelativePath: preferredRelativePath,
      reason: "Resolved target escapes the project storage boundary.",
    };
  }
  if (!(await exists(preferred))) {
    await assertNoSymlinkPath(storagePath, path.dirname(preferred));
    return {
      action: "import",
      targetPath: preferred,
      targetRelativePath: preferredRelativePath,
    };
  }
  try {
    if ((await regularTargetHash(preferred)) === sourceHash) {
      return {
        action: "already-imported",
        targetPath: preferred,
        targetRelativePath: preferredRelativePath,
      };
    }
  } catch {
    return {
      action: "invalid",
      targetPath: preferred,
      targetRelativePath: preferredRelativePath,
      reason: "Existing target is not a readable regular file.",
    };
  }
  const archiveRelativePath = path.join(
    MIGRATION_DIRECTORY,
    "source",
    sourceRelativePath,
  );
  const archive = path.join(storagePath, archiveRelativePath);
  if (!inside(storagePath, archive)) {
    return {
      action: "invalid",
      targetPath: archive,
      targetRelativePath: archiveRelativePath,
      reason: "Conflict archive target escapes the storage boundary.",
    };
  }
  if (!(await exists(archive))) {
    await assertNoSymlinkPath(storagePath, path.dirname(archive));
    return {
      action: "preserve-conflict",
      targetPath: archive,
      targetRelativePath: archiveRelativePath,
      reason:
        "The active target differs; the legacy source will be preserved without overwriting it.",
    };
  }
  return (await regularTargetHash(archive)) === sourceHash
    ? {
        action: "already-imported",
        targetPath: archive,
        targetRelativePath: archiveRelativePath,
      }
    : {
        action: "invalid",
        targetPath: archive,
        targetRelativePath: archiveRelativePath,
        reason: "Both the active target and its conflict archive differ.",
      };
}

async function planFile(
  input: {
    category: PlannedFile["category"];
    legacyRoot: string;
    storagePath: string;
    sourcePath: string;
    sourceRelativePath: string;
    preferredRelativePath: string;
    maximumBytes: number;
    validate?: (content: string) => void;
  },
): Promise<PlannedFile> {
  try {
    const source = await regularFile(input.sourcePath, input.maximumBytes);
    input.validate?.(source.content);
    const target = await plannedTarget(
      input.storagePath,
      input.preferredRelativePath,
      input.sourceRelativePath,
      source.hash,
    );
    return {
      category: input.category,
      sourcePath: input.sourcePath,
      sourceRelativePath: slash(input.sourceRelativePath),
      targetPath: target.targetPath,
      targetRelativePath: slash(target.targetRelativePath),
      bytes: source.bytes,
      hash: source.hash,
      action: target.action,
      ...(target.reason ? { reason: target.reason } : {}),
      content: source.content,
    };
  } catch (error) {
    return {
      category: input.category,
      sourcePath: input.sourcePath,
      sourceRelativePath: slash(input.sourceRelativePath),
      targetPath: input.storagePath,
      targetRelativePath: "",
      bytes: 0,
      hash: "",
      action: "invalid",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function planRepositoryFiles(
  legacyRoot: string,
  storagePath: string,
  projectId: string,
  checkoutId: string,
  projectName: string,
): Promise<{ files: PlannedFile[]; artifact?: LegacyProjectArtifact }> {
  const files: PlannedFile[] = [];
  let artifact: LegacyProjectArtifact | undefined;
  const projectSource = path.join(legacyRoot, "project.json");
  if (await exists(projectSource)) {
    const planned = await planFile({
      category: "project",
      legacyRoot,
      storagePath,
      sourcePath: projectSource,
      sourceRelativePath: "project.json",
      preferredRelativePath: "project.json",
      maximumBytes: 256 * 1024,
      validate(content) {
        const parsed = parseJson(
          content,
          "Legacy project artifact",
        ) as LegacyProjectArtifact;
        if (!parsed.project || typeof parsed.project.id !== "string") {
          throw new Error("Legacy project artifact has no project identity.");
        }
        artifact = parsed;
      },
    });
    files.push(planned);
  }
  const catalogSource = path.join(legacyRoot, "catalog.md");
  if (await exists(catalogSource)) {
    files.push(
      await planFile({
        category: "catalog",
        legacyRoot,
        storagePath,
        sourcePath: catalogSource,
        sourceRelativePath: "catalog.md",
        preferredRelativePath: "catalog.md",
        maximumBytes: 2 * 1024 * 1024,
        validate(content) {
          if (!content.trimStart().startsWith("#")) {
            throw new Error("Legacy catalog is not recognizable Markdown.");
          }
        },
      }),
    );
  }
  for (const [category, directoryName, maximumBytes] of [
    ["decisions", "decisions", 256 * 1024],
    ["memory", "memory", 512 * 1024],
    ["task-state", "task-state", 1024 * 1024],
  ] as const) {
    const directory = path.join(legacyRoot, directoryName);
    for (const source of await walkRegularFiles(directory)) {
      const sourceRelativePath = path.join(directoryName, source.relativePath);
      const preferredRelativePath =
        category === "memory"
          ? path.join("memory", "local", source.relativePath)
          : path.join(directoryName, source.relativePath);
      files.push(
        await planFile({
          category,
          legacyRoot,
          storagePath,
          sourcePath: source.absolutePath,
          sourceRelativePath,
          preferredRelativePath,
          maximumBytes,
          validate(content) {
            if (category === "decisions") {
              if (!source.relativePath.endsWith(".md")) {
                throw new Error("Legacy decisions must use the .md extension.");
              }
              parseLegacyDecisionMarkdown(content, {
                projectId,
                checkoutId,
                sourceHash: digest(content),
              });
            } else if (category === "memory") {
              if (!source.relativePath.endsWith(".md")) {
                throw new Error("Legacy memory must use the .md extension.");
              }
              const parsed = parseMemoryMarkdown(content, {
                projectId,
                projectName,
                sourcePath: slash(preferredRelativePath),
                defaultScope: "local",
              });
              assertMemoryContentSafe(parsed);
            } else {
              validateTaskState(source.relativePath, content);
            }
          },
        }),
      );
    }
  }
  return { files, ...(artifact ? { artifact } : {}) };
}

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
  let importedSemanticRecords = 0;
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
    importedDatabaseRecords = await importDatabase(databasePlan, identity);
    importedSemanticRecords = await importMarkdownSemantics(
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
