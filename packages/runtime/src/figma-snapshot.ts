import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { fitBudgetedResponse } from "@component-atlas/memory";
import { projectStorageDirectory } from "@component-atlas/store";
import { canonicalJson } from "./change-surface-fingerprint.js";
import { resolveProjectIdentity } from "./identity.js";
import { writeImmutableArtifact } from "./immutable-artifact.js";
import {
  RECEIPT_ID_PATTERN,
  TASK_ID_PATTERN,
} from "./task-state-contract.js";
import { taskStateFileName } from "./task-state-paths.js";

export const FIGMA_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const MAX_FIGMA_SNAPSHOT_BYTES = 48 * 1_024;
export const MAX_FIGMA_SNAPSHOT_ITEMS = 256;
export const FIGMA_SNAPSHOT_HANDLE_PATTERN =
  /^figma-snapshot:([A-Za-z0-9_.:-]{1,160}):([a-f0-9]{16})$/u;

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const FIGMA_FILE_KEY_PATTERN = /^[A-Za-z0-9_-]{1,240}$/u;
const FIGMA_NODE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,240}$/u;
const FIGMA_ASSET_HANDLE_PATTERN =
  /^figma-asset:([A-Za-z0-9_.:-]{1,160}):[a-f0-9]{24}$/u;
const ARTIFACT_FILE_PATTERN = /^[a-f0-9]{64}\.json$/u;
const MAX_CATEGORY_ITEMS = 128;
const MAX_ARTIFACT_FILES = 512;
const MAX_OMITTED_ITEMS = 1_000_000;
const MAX_POINTER_BYTES = 2_048;
const CATEGORIES = [
  "nodes",
  "components",
  "styles",
  "states",
  "assets",
] as const;
const FORBIDDEN_SEMANTIC_CONTENT =
  /(?:\b(?:https?|file|data|blob|javascript):|<\s*\/?\s*svg\b|<\?xml|;base64,)/iu;

export type FigmaSnapshotCategory = (typeof CATEGORIES)[number];
export type FigmaSnapshotCoverageStatus =
  | "complete"
  | "partial"
  | "not-requested";

export interface FigmaSnapshotCoverageEntry {
  status: FigmaSnapshotCoverageStatus;
  omitted: number;
}

export type FigmaSnapshotCoverage = Record<
  FigmaSnapshotCategory,
  FigmaSnapshotCoverageEntry
>;

export interface FigmaSemanticProperty {
  name: string;
  value?: string;
}

export interface FigmaSemanticVariant {
  name: string;
  value: string;
}

export interface FigmaSemanticItem {
  id: string;
  name: string;
  type: string;
  nodeId?: string;
  tokenRefs: string[];
  properties: FigmaSemanticProperty[];
  variants: FigmaSemanticVariant[];
  assetRefs: string[];
}

export type FigmaSnapshotContent = Record<
  FigmaSnapshotCategory,
  FigmaSemanticItem[]
>;

export interface FigmaSnapshotIdentity {
  fileKey: string;
  nodeId?: string;
  version: string;
  lastModified: string;
}

export interface FigmaSnapshot {
  schemaVersion: typeof FIGMA_SNAPSHOT_SCHEMA_VERSION;
  handle: string;
  hash: string;
  taskId: string;
  revision: number;
  identity: FigmaSnapshotIdentity;
  observedAt: string;
  receiptIds: string[];
  coverage: FigmaSnapshotCoverage;
  content: FigmaSnapshotContent;
  previousHandle?: string;
  createdAt: string;
}

export interface PersistFigmaSnapshotInput {
  taskId: string;
  identity: FigmaSnapshotIdentity;
  observedAt: string;
  receiptIds: string[];
  coverage: FigmaSnapshotCoverage;
  content: FigmaSnapshotContent;
  previousHandle?: string;
  createdAt?: string;
}

export interface FigmaSnapshotCheckpointResult<TCheckpoint> {
  snapshot: FigmaSnapshot;
  checkpoint: TCheckpoint;
}

interface LatestFigmaSnapshotPointer {
  schemaVersion: 1;
  taskId: string;
  handle: string;
  hash: string;
  revision: number;
  updatedAt: string;
}

interface PreparedFigmaSnapshot {
  snapshot: FigmaSnapshot;
  previousPointer: LatestFigmaSnapshotPointer | undefined;
  publish: boolean;
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unsupported = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unsupported.length > 0) {
    throw new Error(`${label} contains unsupported field ${unsupported[0]}.`);
  }
}

function checkedText(
  value: unknown,
  maximum: number,
  label: string,
  semantic = false,
): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maximum ||
    /[\u0000-\u001f]/u.test(normalized) ||
    (semantic && FORBIDDEN_SEMANTIC_CONTENT.test(normalized))
  ) {
    throw new Error(`${label} is invalid or contains raw/temporary content.`);
  }
  return normalized;
}

function checkedTimestamp(value: unknown, label: string): string {
  const timestamp = checkedText(value, 80, label);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`${label} is invalid.`);
  }
  return timestamp;
}

function checkedRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 10_000) {
    throw new Error("Figma snapshot revision is invalid.");
  }
  return value as number;
}

function checkedStringList(
  value: unknown,
  maximumItems: number,
  maximumChars: number,
  label: string,
): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Error(`${label} exceeds its item limit.`);
  }
  const normalized = value.map((entry) =>
    checkedText(entry, maximumChars, label, true),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} contains duplicate entries.`);
  }
  return normalized.sort((left, right) => left.localeCompare(right));
}

function normalizeIdentity(value: unknown): FigmaSnapshotIdentity {
  const raw = record(value, "Figma snapshot identity");
  assertExactKeys(
    raw,
    ["fileKey", "nodeId", "version", "lastModified"],
    "Figma snapshot identity",
  );
  const fileKey = checkedText(raw.fileKey, 240, "Figma file key");
  if (!FIGMA_FILE_KEY_PATTERN.test(fileKey)) {
    throw new Error("Figma file key is invalid.");
  }
  const nodeId =
    raw.nodeId === undefined
      ? undefined
      : checkedText(raw.nodeId, 240, "Figma node ID");
  if (nodeId !== undefined && !FIGMA_NODE_ID_PATTERN.test(nodeId)) {
    throw new Error("Figma node ID is invalid.");
  }
  return {
    fileKey,
    ...(nodeId !== undefined ? { nodeId } : {}),
    version: checkedText(raw.version, 160, "Figma version", true),
    lastModified: checkedTimestamp(raw.lastModified, "Figma last-modified timestamp"),
  };
}

function normalizeProperty(value: unknown): FigmaSemanticProperty {
  const raw = record(value, "Figma semantic property");
  assertExactKeys(raw, ["name", "value"], "Figma semantic property");
  return {
    name: checkedText(raw.name, 120, "Figma property name", true),
    ...(raw.value !== undefined
      ? { value: checkedText(raw.value, 240, "Figma property value", true) }
      : {}),
  };
}

function normalizeVariant(value: unknown): FigmaSemanticVariant {
  const raw = record(value, "Figma semantic variant");
  assertExactKeys(raw, ["name", "value"], "Figma semantic variant");
  return {
    name: checkedText(raw.name, 120, "Figma variant name", true),
    value: checkedText(raw.value, 240, "Figma variant value", true),
  };
}

function normalizeItem(value: unknown, taskId: string): FigmaSemanticItem {
  const raw = record(value, "Figma semantic item");
  assertExactKeys(
    raw,
    [
      "id",
      "name",
      "type",
      "nodeId",
      "tokenRefs",
      "properties",
      "variants",
      "assetRefs",
    ],
    "Figma semantic item",
  );
  if (!Array.isArray(raw.properties) || raw.properties.length > 24) {
    throw new Error("Figma semantic properties exceed their item limit.");
  }
  if (!Array.isArray(raw.variants) || raw.variants.length > 24) {
    throw new Error("Figma semantic variants exceed their item limit.");
  }
  const properties = raw.properties.map(normalizeProperty);
  const variants = raw.variants.map(normalizeVariant);
  for (const [label, pairs] of [
    ["Figma semantic properties", properties],
    ["Figma semantic variants", variants],
  ] as const) {
    const keys = pairs.map((pair) => `${pair.name}\0${pair.value ?? ""}`);
    if (new Set(keys).size !== keys.length) {
      throw new Error(`${label} contain duplicate entries.`);
    }
  }
  const assetRefs = checkedStringList(
    raw.assetRefs,
    16,
    280,
    "Figma asset reference",
  );
  if (
    assetRefs.some((reference) => {
      const match = FIGMA_ASSET_HANDLE_PATTERN.exec(reference);
      return !match || match[1] !== taskId;
    })
  ) {
    throw new Error("Figma asset references must be immutable handles for this task.");
  }
  const nodeId =
    raw.nodeId === undefined
      ? undefined
      : checkedText(raw.nodeId, 240, "Figma semantic node ID");
  if (nodeId !== undefined && !FIGMA_NODE_ID_PATTERN.test(nodeId)) {
    throw new Error("Figma semantic node ID is invalid.");
  }
  return {
    id: checkedText(raw.id, 240, "Figma semantic item ID", true),
    name: checkedText(raw.name, 240, "Figma semantic item name", true),
    type: checkedText(raw.type, 80, "Figma semantic item type", true),
    ...(nodeId !== undefined ? { nodeId } : {}),
    tokenRefs: checkedStringList(raw.tokenRefs, 24, 240, "Figma token reference"),
    properties: properties.sort((left, right) =>
      `${left.name}\0${left.value ?? ""}`.localeCompare(
        `${right.name}\0${right.value ?? ""}`,
      ),
    ),
    variants: variants.sort((left, right) =>
      `${left.name}\0${left.value}`.localeCompare(`${right.name}\0${right.value}`),
    ),
    assetRefs,
  };
}

function normalizeCoverageEntry(
  value: unknown,
  category: FigmaSnapshotCategory,
): FigmaSnapshotCoverageEntry {
  const raw = record(value, `Figma ${category} coverage`);
  assertExactKeys(raw, ["status", "omitted"], `Figma ${category} coverage`);
  if (!(["complete", "partial", "not-requested"] as const).includes(
    raw.status as FigmaSnapshotCoverageStatus,
  )) {
    throw new Error(`Figma ${category} coverage status is invalid.`);
  }
  if (
    !Number.isInteger(raw.omitted) ||
    (raw.omitted as number) < 0 ||
    (raw.omitted as number) > MAX_OMITTED_ITEMS
  ) {
    throw new Error(`Figma ${category} omitted count is invalid.`);
  }
  const status = raw.status as FigmaSnapshotCoverageStatus;
  const omitted = raw.omitted as number;
  if ((status === "complete" || status === "not-requested") && omitted !== 0) {
    throw new Error(`Figma ${category} ${status} coverage cannot omit items.`);
  }
  if (status === "partial" && omitted === 0) {
    throw new Error(`Figma ${category} partial coverage requires an omitted count.`);
  }
  return { status, omitted };
}

function normalizeSemanticEvidence(
  coverageValue: unknown,
  contentValue: unknown,
  taskId: string,
): { coverage: FigmaSnapshotCoverage; content: FigmaSnapshotContent } {
  const rawCoverage = record(coverageValue, "Figma snapshot coverage");
  const rawContent = record(contentValue, "Figma snapshot content");
  assertExactKeys(rawCoverage, CATEGORIES, "Figma snapshot coverage");
  assertExactKeys(rawContent, CATEGORIES, "Figma snapshot content");
  const coverage = {} as FigmaSnapshotCoverage;
  const content = {} as FigmaSnapshotContent;
  let totalItems = 0;
  for (const category of CATEGORIES) {
    coverage[category] = normalizeCoverageEntry(rawCoverage[category], category);
    const rawItems = rawContent[category];
    if (!Array.isArray(rawItems) || rawItems.length > MAX_CATEGORY_ITEMS) {
      throw new Error(
        `Figma ${category} exceed their ${MAX_CATEGORY_ITEMS}-item limit.`,
      );
    }
    if (coverage[category].status === "not-requested" && rawItems.length > 0) {
      throw new Error(`Figma ${category} cannot be stored when not requested.`);
    }
    const items = rawItems.map((item) => normalizeItem(item, taskId));
    if (new Set(items.map((item) => item.id)).size !== items.length) {
      throw new Error(`Figma ${category} IDs must be unique.`);
    }
    content[category] = items.sort((left, right) => left.id.localeCompare(right.id));
    totalItems += items.length;
  }
  if (totalItems > MAX_FIGMA_SNAPSHOT_ITEMS) {
    throw new Error(
      `Figma snapshot exceeds its ${MAX_FIGMA_SNAPSHOT_ITEMS}-item limit.`,
    );
  }
  return { coverage, content };
}

function parseHandle(handle: string): { taskId: string; prefix: string } {
  const match = FIGMA_SNAPSHOT_HANDLE_PATTERN.exec(handle);
  if (!match) throw new Error("Figma snapshot handle is invalid.");
  return { taskId: match[1]!, prefix: match[2]! };
}

function normalizedSemanticInput(input: PersistFigmaSnapshotInput) {
  const raw = record(input, "Figma snapshot input");
  assertExactKeys(
    raw,
    [
      "taskId",
      "identity",
      "observedAt",
      "receiptIds",
      "coverage",
      "content",
      "previousHandle",
      "createdAt",
    ],
    "Figma snapshot input",
  );
  const taskId = checkedText(raw.taskId, 160, "Task ID");
  if (!TASK_ID_PATTERN.test(taskId)) throw new Error("Task ID is invalid.");
  if (!Array.isArray(raw.receiptIds) || raw.receiptIds.length === 0) {
    throw new Error("Figma snapshot requires at least one source receipt.");
  }
  const receiptIds = checkedStringList(
    raw.receiptIds,
    64,
    80,
    "Figma source receipt ID",
  );
  if (receiptIds.some((receiptId) => !RECEIPT_ID_PATTERN.test(receiptId))) {
    throw new Error("Figma snapshot source receipt ID is invalid.");
  }
  const semantic = normalizeSemanticEvidence(raw.coverage, raw.content, taskId);
  return {
    taskId,
    identity: normalizeIdentity(raw.identity),
    observedAt: checkedTimestamp(raw.observedAt, "Figma observation timestamp"),
    receiptIds,
    ...semantic,
  };
}

function snapshotSemanticArtifact(snapshot: FigmaSnapshot) {
  return {
    taskId: snapshot.taskId,
    identity: snapshot.identity,
    observedAt: snapshot.observedAt,
    receiptIds: snapshot.receiptIds,
    coverage: snapshot.coverage,
    content: snapshot.content,
  };
}

function assertArtifactBudget(value: unknown): void {
  const bytes = Buffer.byteLength(canonicalJson(value), "utf8");
  if (bytes > MAX_FIGMA_SNAPSHOT_BYTES) {
    throw new Error(
      `Figma snapshot exceeds its ${MAX_FIGMA_SNAPSHOT_BYTES}-byte storage budget.`,
    );
  }
}

function validateSnapshot(value: unknown): FigmaSnapshot {
  const raw = record(value, "Figma snapshot");
  assertExactKeys(
    raw,
    [
      "schemaVersion",
      "handle",
      "hash",
      "taskId",
      "revision",
      "identity",
      "observedAt",
      "receiptIds",
      "coverage",
      "content",
      "previousHandle",
      "createdAt",
    ],
    "Figma snapshot",
  );
  const handle = checkedText(raw.handle, 240, "Figma snapshot handle");
  const parsed = parseHandle(handle);
  const hash = checkedText(raw.hash, 64, "Figma snapshot hash");
  if (
    raw.schemaVersion !== FIGMA_SNAPSHOT_SCHEMA_VERSION ||
    !HASH_PATTERN.test(hash) ||
    !hash.startsWith(parsed.prefix)
  ) {
    throw new Error("Figma snapshot identity is invalid.");
  }
  const taskId = checkedText(raw.taskId, 160, "Task ID");
  if (!TASK_ID_PATTERN.test(taskId) || parsed.taskId !== taskId) {
    throw new Error("Figma snapshot task identity is invalid.");
  }
  const revision = checkedRevision(raw.revision);
  const receiptIds = checkedStringList(
    raw.receiptIds,
    64,
    80,
    "Figma source receipt ID",
  );
  if (
    receiptIds.length === 0 ||
    receiptIds.some((receiptId) => !RECEIPT_ID_PATTERN.test(receiptId))
  ) {
    throw new Error("Figma snapshot source receipt ID is invalid.");
  }
  const semantic = normalizeSemanticEvidence(raw.coverage, raw.content, taskId);
  const previousHandle =
    raw.previousHandle === undefined
      ? undefined
      : checkedText(raw.previousHandle, 240, "Previous Figma snapshot handle");
  if (previousHandle !== undefined) {
    const previous = parseHandle(previousHandle);
    if (previous.taskId !== taskId || revision === 1) {
      throw new Error("Figma snapshot predecessor is invalid.");
    }
  } else if (revision !== 1) {
    throw new Error("A revised Figma snapshot requires its predecessor.");
  }
  const snapshot: FigmaSnapshot = {
    schemaVersion: FIGMA_SNAPSHOT_SCHEMA_VERSION,
    handle,
    hash,
    taskId,
    revision,
    identity: normalizeIdentity(raw.identity),
    observedAt: checkedTimestamp(raw.observedAt, "Figma observation timestamp"),
    receiptIds,
    ...semantic,
    ...(previousHandle !== undefined ? { previousHandle } : {}),
    createdAt: checkedTimestamp(raw.createdAt, "Figma snapshot creation timestamp"),
  };
  const { handle: _handle, hash: _hash, createdAt: _createdAt, ...payload } = snapshot;
  if (digest(payload) !== hash) {
    throw new Error("Figma snapshot content hash is invalid.");
  }
  if (canonicalJson(snapshot) !== canonicalJson(raw)) {
    throw new Error("Figma snapshot contains non-canonical or raw content.");
  }
  assertArtifactBudget(snapshot);
  return snapshot;
}

async function snapshotRoot(rootPath: string): Promise<string> {
  const identity = await resolveProjectIdentity(rootPath);
  return path.join(
    projectStorageDirectory(identity.logicalId),
    "task-state",
    "figma-snapshots",
  );
}

async function artifactDirectory(rootPath: string, taskId: string): Promise<string> {
  return path.join(
    await snapshotRoot(rootPath),
    "artifacts",
    taskStateFileName(rootPath, taskId, "json").replace(/\.json$/u, ""),
  );
}

async function artifactPath(
  rootPath: string,
  taskId: string,
  hash: string,
): Promise<string> {
  return path.join(await artifactDirectory(rootPath, taskId), `${hash}.json`);
}

async function latestPointerPath(rootPath: string, taskId: string): Promise<string> {
  return path.join(
    await snapshotRoot(rootPath),
    "latest",
    taskStateFileName(rootPath, taskId, "json"),
  );
}

async function checkedReadFile(target: string, maximumBytes: number): Promise<string> {
  const metadata = await stat(target);
  if (!metadata.isFile() || metadata.size > maximumBytes) {
    throw new Error(`Figma snapshot storage exceeds its ${maximumBytes}-byte read limit.`);
  }
  const serialized = await readFile(target, "utf8");
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    throw new Error(`Figma snapshot storage exceeds its ${maximumBytes}-byte read limit.`);
  }
  return serialized;
}

function pointerFor(snapshot: FigmaSnapshot): LatestFigmaSnapshotPointer {
  return {
    schemaVersion: 1,
    taskId: snapshot.taskId,
    handle: snapshot.handle,
    hash: snapshot.hash,
    revision: snapshot.revision,
    updatedAt: snapshot.createdAt,
  };
}

function validatePointer(
  value: unknown,
  expectedTaskId: string,
): LatestFigmaSnapshotPointer {
  const raw = record(value, "Latest Figma snapshot pointer");
  assertExactKeys(
    raw,
    ["schemaVersion", "taskId", "handle", "hash", "revision", "updatedAt"],
    "Latest Figma snapshot pointer",
  );
  const taskId = checkedText(raw.taskId, 160, "Task ID");
  const handle = checkedText(raw.handle, 240, "Figma snapshot handle");
  const hash = checkedText(raw.hash, 64, "Figma snapshot hash");
  const parsed = parseHandle(handle);
  if (
    raw.schemaVersion !== 1 ||
    taskId !== expectedTaskId ||
    parsed.taskId !== taskId ||
    !HASH_PATTERN.test(hash) ||
    !hash.startsWith(parsed.prefix)
  ) {
    throw new Error("Latest Figma snapshot pointer is invalid.");
  }
  return {
    schemaVersion: 1,
    taskId,
    handle,
    hash,
    revision: checkedRevision(raw.revision),
    updatedAt: checkedTimestamp(raw.updatedAt, "Figma snapshot pointer timestamp"),
  };
}

async function readLatestPointer(
  rootPath: string,
  taskId: string,
): Promise<LatestFigmaSnapshotPointer | undefined> {
  try {
    return validatePointer(
      JSON.parse(
        await checkedReadFile(
          await latestPointerPath(rootPath, taskId),
          MAX_POINTER_BYTES,
        ),
      ),
      taskId,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeLatestPointer(
  rootPath: string,
  pointer: LatestFigmaSnapshotPointer,
): Promise<void> {
  const target = await latestPointerPath(rootPath, pointer.taskId);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(`${canonicalJson(pointer)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function withSnapshotWriteLock<T>(
  rootPath: string,
  taskId: string,
  action: () => Promise<T>,
): Promise<T> {
  const directory = path.join(await snapshotRoot(rootPath), "locks");
  await mkdir(directory, { recursive: true });
  const target = path.join(
    directory,
    taskStateFileName(rootPath, taskId, "json").replace(/\.json$/u, ".lock"),
  );
  let lock;
  try {
    lock = await open(target, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new Error(
      "Figma snapshot is locked by another writer. Do not remove the lock automatically; inspect ownership before explicit recovery.",
      { cause: error },
    );
  }
  try {
    await lock.writeFile(
      `${canonicalJson({ schemaVersion: 1, taskId, pid: process.pid, lockedAt: new Date().toISOString() })}\n`,
      "utf8",
    );
    await lock.sync();
    return await action();
  } finally {
    await lock.close();
    await rm(target, { force: true });
  }
}

function samePointer(
  left: LatestFigmaSnapshotPointer | undefined,
  right: LatestFigmaSnapshotPointer | undefined,
): boolean {
  return canonicalJson(left ?? null) === canonicalJson(right ?? null);
}

async function readStoredSnapshot(target: string): Promise<FigmaSnapshot> {
  return validateSnapshot(
    JSON.parse(await checkedReadFile(target, MAX_FIGMA_SNAPSHOT_BYTES + 1)),
  );
}

async function prepareSnapshotUnlocked(
  rootPath: string,
  input: PersistFigmaSnapshotInput,
): Promise<PreparedFigmaSnapshot> {
  const semantic = normalizedSemanticInput(input);
  const previousPointer = await readLatestPointer(rootPath, semantic.taskId);
  const latest = await loadLatestFigmaSnapshot(rootPath, semantic.taskId);
  if (
    latest &&
    canonicalJson(snapshotSemanticArtifact(latest)) === canonicalJson(semantic)
  ) {
    return { snapshot: latest, previousPointer, publish: false };
  }
  if (latest && input.previousHandle !== latest.handle) {
    throw new Error("A changed Figma snapshot must reference its latest revision.");
  }
  if (!latest && input.previousHandle !== undefined) {
    throw new Error("The initial Figma snapshot cannot reference a predecessor.");
  }
  const revision = latest ? latest.revision + 1 : 1;
  const payload = {
    schemaVersion: FIGMA_SNAPSHOT_SCHEMA_VERSION,
    taskId: semantic.taskId,
    revision,
    identity: semantic.identity,
    observedAt: semantic.observedAt,
    receiptIds: semantic.receiptIds,
    coverage: semantic.coverage,
    content: semantic.content,
    ...(latest ? { previousHandle: latest.handle } : {}),
  };
  const hash = digest(payload);
  const target = await artifactPath(rootPath, semantic.taskId, hash);
  let snapshot: FigmaSnapshot;
  try {
    snapshot = await readStoredSnapshot(target);
    if (snapshot.hash !== hash || canonicalJson(snapshotSemanticArtifact(snapshot)) !== canonicalJson(semantic)) {
      throw new Error("Stored Figma snapshot identity conflicts with its content hash.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    snapshot = validateSnapshot({
      ...payload,
      handle: `figma-snapshot:${semantic.taskId}:${hash.slice(0, 16)}`,
      hash,
      createdAt: input.createdAt ?? new Date().toISOString(),
    });
    await mkdir(path.dirname(target), { recursive: true });
    await writeImmutableArtifact(
      target,
      `${canonicalJson(snapshot)}\n`,
      "A Figma snapshot is immutable; create a new revision for changed evidence.",
    );
  }
  return { snapshot, previousPointer, publish: true };
}

async function publishPreparedSnapshot(
  rootPath: string,
  prepared: PreparedFigmaSnapshot,
): Promise<void> {
  if (!prepared.publish) return;
  const current = await readLatestPointer(rootPath, prepared.snapshot.taskId);
  if (!samePointer(current, prepared.previousPointer)) {
    throw new Error(
      "Latest Figma snapshot changed during its checkpoint; retry from the new latest revision.",
    );
  }
  await writeLatestPointer(rootPath, pointerFor(prepared.snapshot));
}

export async function persistFigmaSnapshot(
  rootPath: string,
  input: PersistFigmaSnapshotInput,
): Promise<FigmaSnapshot> {
  if (!TASK_ID_PATTERN.test(input.taskId)) throw new Error("Task ID is invalid.");
  return withSnapshotWriteLock(rootPath, input.taskId, async () => {
    const prepared = await prepareSnapshotUnlocked(rootPath, input);
    await publishPreparedSnapshot(rootPath, prepared);
    return prepared.snapshot;
  });
}

export async function persistFigmaSnapshotWithCheckpoint<TCheckpoint>(
  rootPath: string,
  input: PersistFigmaSnapshotInput,
  checkpoint: (snapshot: FigmaSnapshot) => Promise<TCheckpoint>,
): Promise<FigmaSnapshotCheckpointResult<TCheckpoint>> {
  if (!TASK_ID_PATTERN.test(input.taskId)) throw new Error("Task ID is invalid.");
  return withSnapshotWriteLock(rootPath, input.taskId, async () => {
    const prepared = await prepareSnapshotUnlocked(rootPath, input);
    const checkpointResult = await checkpoint(prepared.snapshot);
    await publishPreparedSnapshot(rootPath, prepared);
    return { snapshot: prepared.snapshot, checkpoint: checkpointResult };
  });
}

async function artifactNames(directory: string): Promise<string[]> {
  try {
    const names = (await readdir(directory)).filter((name) =>
      ARTIFACT_FILE_PATTERN.test(name),
    );
    if (names.length > MAX_ARTIFACT_FILES) {
      throw new Error(
        `Figma snapshot lookup exceeds its ${MAX_ARTIFACT_FILES}-file safety limit.`,
      );
    }
    return names;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function loadFigmaSnapshot(
  rootPath: string,
  handle: string,
): Promise<FigmaSnapshot> {
  const parsed = parseHandle(handle);
  const pointer = await readLatestPointer(rootPath, parsed.taskId);
  if (pointer?.handle === handle) {
    const snapshot = await readStoredSnapshot(
      await artifactPath(rootPath, parsed.taskId, pointer.hash),
    );
    if (
      snapshot.handle !== handle ||
      snapshot.hash !== pointer.hash ||
      snapshot.revision !== pointer.revision
    ) {
      throw new Error("Latest Figma snapshot pointer is stale or invalid.");
    }
    return snapshot;
  }
  const directory = await artifactDirectory(rootPath, parsed.taskId);
  for (const name of await artifactNames(directory)) {
    if (!name.startsWith(parsed.prefix)) continue;
    const snapshot = await readStoredSnapshot(path.join(directory, name));
    if (snapshot.handle === handle) return snapshot;
  }
  throw new Error("Figma snapshot was not found.");
}

export async function loadLatestFigmaSnapshot(
  rootPath: string,
  taskId: string,
): Promise<FigmaSnapshot | undefined> {
  if (!TASK_ID_PATTERN.test(taskId)) throw new Error("Task ID is invalid.");
  const pointer = await readLatestPointer(rootPath, taskId);
  if (!pointer) return undefined;
  const snapshot = await readStoredSnapshot(
    await artifactPath(rootPath, taskId, pointer.hash),
  );
  if (
    snapshot.taskId !== taskId ||
    snapshot.handle !== pointer.handle ||
    snapshot.hash !== pointer.hash ||
    snapshot.revision !== pointer.revision
  ) {
    throw new Error("Latest Figma snapshot pointer is stale or invalid.");
  }
  return snapshot;
}

export async function expandFigmaSnapshot(
  rootPath: string,
  handle: string,
  budgetChars = 3_200,
) {
  const snapshot = await loadFigmaSnapshot(rootPath, handle);
  const items = CATEGORIES.flatMap((category) => snapshot.content[category]);
  const compactSnapshot =
    budgetChars <= 1_200
      ? {
          handle: snapshot.handle,
          revision: snapshot.revision,
          identity: snapshot.identity,
          coverage: snapshot.coverage,
          counts: Object.fromEntries(
            CATEGORIES.map((category) => [
              category,
              snapshot.content[category].length,
            ]),
          ),
          contentOmitted: true,
        }
      : snapshot;
  const response = fitBudgetedResponse(
    { schemaVersion: 1, snapshot: compactSnapshot },
    {
      budgetChars,
      totalMatches: items.length,
      expandableIds:
        compactSnapshot !== snapshot
          ? [snapshot.handle]
          : [
              snapshot.handle,
              ...snapshot.receiptIds,
              ...items.flatMap((item) => item.assetRefs),
            ],
      preserveKeys: ["identity", "coverage"],
    },
  );
  if (compactSnapshot !== snapshot) response.metrics.truncated = true;
  return response;
}
