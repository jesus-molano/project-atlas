import {
  createHash,
} from "node:crypto";
import {
  access,
  lstat,
  readFile,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import {
  parseSourceReceipt,
  type ComponentDecision,
  type DecisionKind,
} from "@component-atlas/core";
import {
  assertMemoryContentSafe,
  parseMemoryMarkdown,
} from "@component-atlas/memory";
import type { AtlasStore } from "@component-atlas/store";

export const MIGRATION_SCHEMA_VERSION = 1 as const;
export const LEGACY_DIRECTORY = ".component-atlas";
const MIGRATION_DIRECTORY = path.join(
  "migrations",
  "repository-local-v1",
);
export const MIGRATION_STATUS_FILE = path.join(MIGRATION_DIRECTORY, "status.json");
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
  "not-applicable",
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

export interface PlannedFile {
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

export interface LegacyProjectArtifact {
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

export interface LegacyDatabasePlan {
  sourcePath?: string;
  sourceProjectId?: string;
  sourceSnapshot?: ReturnType<AtlasStore["readProjectSnapshot"]>;
  currentSnapshot?: ReturnType<AtlasStore["readProjectSnapshot"]>;
  importableRecords: number;
  alreadyImportedRecords: number;
  conflictingRecords: number;
  invalidReason?: string;
}

export interface MigrationStatusFile {
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

export function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export function slash(value: string): string {
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

export async function hashFile(filePath: string): Promise<string> {
  return digest(await readFile(filePath));
}

export async function assertNoSymlinkPath(
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

export async function readPreviousRun(
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

export async function readMigrationStatusFile(
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

export async function walkRegularFiles(
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

export async function planRepositoryFiles(
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
