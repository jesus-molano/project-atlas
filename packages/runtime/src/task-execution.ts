import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { projectStorageDirectory } from "@component-atlas/store";
import { resolveProjectIdentity } from "./identity.js";

const MANIFEST_SCHEMA_VERSION = 1 as const;
const RETRIEVAL_SCHEMA_VERSION = 1 as const;
const MAX_MANIFEST_BYTES = 8_192;
const MAX_RETRIEVAL_RESULT_BYTES = 12_000;
const TASK_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;
const DIGEST = /^[a-f0-9]{16,64}$/u;
const MANIFEST_HANDLE =
  /^manifest:([A-Za-z0-9_.:-]{1,160}):([a-f0-9]{16})$/u;
const RETRIEVAL_HANDLE =
  /^retrieval:([A-Za-z0-9_.:-]{1,160}):([a-z-]{2,32}):([a-f0-9]{16})$/u;

export type TaskExecutionPhase =
  | "intake"
  | "design"
  | "implementation"
  | "validation"
  | "closeout";

export interface TaskExecutionManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  taskId: string;
  checkoutId: string;
  head: string;
  objectiveHash: string;
  sourceLedgerHash: string;
  skills: Array<{
    id: string;
    digest: string;
    phase: TaskExecutionPhase;
  }>;
  references: Array<{
    id: string;
    digest: string;
    phase: TaskExecutionPhase;
  }>;
  scripts: Array<{
    id: string;
    interfaceVersion: string;
    digest: string;
  }>;
  retrievalKeys: string[];
  invalidatesOn: Array<
    "checkout-change" | "head-change" | "objective-change" | "source-ledger-change"
  >;
  updatedAt: string;
}

export interface TaskExecutionManifestInput
  extends Omit<
    TaskExecutionManifest,
    "schemaVersion" | "checkoutId" | "head" | "updatedAt"
  > {
  updatedAt?: string;
}

export interface TaskExecutionManifestProjection {
  handle: string;
  hash: string;
  sourceLedgerHash: string;
  retrievalBudgetId: string;
}

export type TaskRetrievalKind =
  | "reuse"
  | "task-context"
  | "figma-metadata"
  | "figma-subtree"
  | "figma-screenshot"
  | "figma-asset"
  | "secondary-code";

export type TaskRetrievalInvalidationReason =
  | "graph-changed"
  | "scope-changed"
  | "source-ledger-changed"
  | "user-requested";

interface TaskRetrievalEntry {
  kind: TaskRetrievalKind;
  key: string;
  handle: string;
  status: "active" | "completed" | "invalidated";
  createdAt: string;
  completedAt?: string;
  invalidatedAt?: string;
  invalidationReason?: TaskRetrievalInvalidationReason;
  resultHash?: string;
}

interface TaskRetrievalLedger {
  schemaVersion: typeof RETRIEVAL_SCHEMA_VERSION;
  taskId: string;
  budgetId: string;
  entries: TaskRetrievalEntry[];
  updatedAt: string;
}

export interface TaskRetrievalClaim {
  status: "granted" | "cached";
  handle: string;
  budgetId: string;
  priorResultAvailable: boolean;
}

export function reuseRetrievalKey(input: {
  projectId: string;
  checkoutId?: string;
  graphFingerprint?: string;
  intent: string;
  sourceLedgerHash?: string;
}): string {
  return JSON.stringify({
    projectId: input.projectId,
    checkoutId: input.checkoutId ?? "",
    graphFingerprint: input.graphFingerprint ?? "",
    intent: input.intent.trim().replace(/\s+/gu, " ").toLowerCase(),
    sourceLedgerHash: input.sourceLedgerHash ?? "",
  });
}

const RETRIEVAL_LIMITS: Record<TaskRetrievalKind, number> = {
  reuse: 1,
  "task-context": 2,
  "figma-metadata": 1,
  "figma-subtree": 5,
  "figma-screenshot": 2,
  "figma-asset": 8,
  "secondary-code": 5,
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function short(value: string, maximum: number): string {
  return value
    .trim()
    .replace(/[\u0000-\u001f]+/gu, " ")
    .slice(0, maximum);
}

function checkedTaskId(taskId: string): string {
  if (!TASK_ID.test(taskId)) throw new Error("Task ID is invalid.");
  return taskId;
}

async function taskExecutionRoot(rootPath: string): Promise<string> {
  const identity = await resolveProjectIdentity(rootPath);
  return path.join(
    projectStorageDirectory(identity.logicalId),
    "task-state",
  );
}

async function atomicJson(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

function normalizedManifest(
  input: TaskExecutionManifest,
): TaskExecutionManifest {
  if (
    input.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    !TASK_ID.test(input.taskId) ||
    !input.checkoutId ||
    !input.head ||
    !DIGEST.test(input.objectiveHash) ||
    !DIGEST.test(input.sourceLedgerHash)
  ) {
    throw new Error("Task execution manifest is invalid.");
  }
  const manifest: TaskExecutionManifest = {
    ...input,
    skills: input.skills.slice(0, 12).map((item) => ({
      id: short(item.id, 120),
      digest: item.digest,
      phase: item.phase,
    })),
    references: input.references.slice(0, 24).map((item) => ({
      id: short(item.id, 160),
      digest: item.digest,
      phase: item.phase,
    })),
    scripts: input.scripts.slice(0, 12).map((item) => ({
      id: short(item.id, 160),
      interfaceVersion: short(item.interfaceVersion, 40),
      digest: item.digest,
    })),
    retrievalKeys: [
      ...new Set(input.retrievalKeys.map((item) => short(item, 160))),
    ].slice(0, 24),
    invalidatesOn: [...new Set(input.invalidatesOn)].slice(0, 4),
  };
  if (
    [...manifest.skills, ...manifest.references, ...manifest.scripts].some(
      (item) => !DIGEST.test(item.digest),
    )
  ) {
    throw new Error("Task execution manifest contains an invalid digest.");
  }
  if (Buffer.byteLength(JSON.stringify(manifest), "utf8") > MAX_MANIFEST_BYTES) {
    throw new Error("Task execution manifest exceeds its 8 KB budget.");
  }
  return manifest;
}

export async function writeTaskExecutionManifest(
  rootPath: string,
  input: TaskExecutionManifestInput,
): Promise<TaskExecutionManifestProjection> {
  checkedTaskId(input.taskId);
  const identity = await resolveProjectIdentity(rootPath);
  const manifest = normalizedManifest({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    ...input,
    checkoutId: identity.checkoutId,
    head: identity.head ?? "unknown",
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  });
  const serialized = JSON.stringify(manifest);
  const manifestHash = hash(serialized);
  const handle = `manifest:${manifest.taskId}:${manifestHash.slice(0, 16)}`;
  const root = await taskExecutionRoot(rootPath);
  await atomicJson(
    path.join(root, "manifests", `${manifest.taskId}.json`),
    manifest,
  );
  return {
    handle,
    hash: manifestHash,
    sourceLedgerHash: manifest.sourceLedgerHash,
    retrievalBudgetId: `retrieval-budget:${manifest.taskId}`,
  };
}

export async function loadTaskExecutionManifest(
  rootPath: string,
  handle: string,
): Promise<TaskExecutionManifest> {
  const match = handle.match(MANIFEST_HANDLE);
  if (!match) throw new Error("Task execution manifest handle is invalid.");
  const [, taskId, expectedHash] = match;
  const root = await taskExecutionRoot(rootPath);
  const manifest = normalizedManifest(
    JSON.parse(
      await readFile(
        path.join(root, "manifests", `${taskId}.json`),
        "utf8",
      ),
    ) as TaskExecutionManifest,
  );
  if (hash(JSON.stringify(manifest)).slice(0, 16) !== expectedHash) {
    throw new Error("Task execution manifest hash does not match its handle.");
  }
  return manifest;
}

async function loadRetrievalLedger(
  rootPath: string,
  taskId: string,
): Promise<TaskRetrievalLedger> {
  const root = await taskExecutionRoot(rootPath);
  try {
    const ledger = JSON.parse(
      await readFile(
        path.join(root, "retrieval", `${taskId}.json`),
        "utf8",
      ),
    ) as TaskRetrievalLedger;
    if (
      ledger.schemaVersion !== RETRIEVAL_SCHEMA_VERSION ||
      ledger.taskId !== taskId ||
      !Array.isArray(ledger.entries)
    ) {
      throw new Error("Task retrieval ledger is invalid.");
    }
    return ledger;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      schemaVersion: RETRIEVAL_SCHEMA_VERSION,
      taskId,
      budgetId: `retrieval-budget:${taskId}`,
      entries: [],
      updatedAt: new Date().toISOString(),
    };
  }
}

async function saveRetrievalLedger(
  rootPath: string,
  ledger: TaskRetrievalLedger,
): Promise<void> {
  const root = await taskExecutionRoot(rootPath);
  await atomicJson(
    path.join(root, "retrieval", `${ledger.taskId}.json`),
    ledger,
  );
}

export async function claimTaskRetrieval(
  rootPath: string,
  input: {
    taskId: string;
    kind: TaskRetrievalKind;
    key: string;
    invalidationReason?: TaskRetrievalInvalidationReason;
    at?: string;
  },
): Promise<TaskRetrievalClaim> {
  const taskId = checkedTaskId(input.taskId);
  const key = hash(input.key);
  const ledger = await loadRetrievalLedger(rootPath, taskId);
  const matching = ledger.entries.find(
    (entry) =>
      entry.kind === input.kind &&
      entry.key === key &&
      entry.status === "completed",
  );
  if (matching && !input.invalidationReason) {
    return {
      status: "cached",
      handle: matching.handle,
      budgetId: ledger.budgetId,
      priorResultAvailable: Boolean(matching.resultHash),
    };
  }
  const now = input.at ?? new Date().toISOString();
  if (input.invalidationReason) {
    for (const entry of ledger.entries.filter(
      (candidate) =>
        candidate.kind === input.kind &&
        candidate.status !== "invalidated",
    )) {
      entry.status = "invalidated";
      entry.invalidatedAt = now;
      entry.invalidationReason = input.invalidationReason;
    }
  }
  const consumed = ledger.entries.filter(
    (entry) =>
      entry.kind === input.kind &&
      entry.status !== "invalidated",
  ).length;
  if (consumed >= RETRIEVAL_LIMITS[input.kind]) {
    throw new Error(
      `Task retrieval budget for ${input.kind} is exhausted. Provide an explicit valid invalidation reason before retrieving again.`,
    );
  }
  const handle = `retrieval:${taskId}:${input.kind}:${hash(
    `${key}\0${now}`,
  ).slice(0, 16)}`;
  ledger.entries.push({
    kind: input.kind,
    key,
    handle,
    status: "active",
    createdAt: now,
  });
  ledger.entries = ledger.entries.slice(-64);
  ledger.updatedAt = now;
  await saveRetrievalLedger(rootPath, ledger);
  return {
    status: "granted",
    handle,
    budgetId: ledger.budgetId,
    priorResultAvailable: false,
  };
}

export async function completeTaskRetrieval(
  rootPath: string,
  handle: string,
  result: unknown,
  at = new Date().toISOString(),
): Promise<void> {
  const match = handle.match(RETRIEVAL_HANDLE);
  if (!match) throw new Error("Task retrieval handle is invalid.");
  const [, taskId] = match;
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized, "utf8") > MAX_RETRIEVAL_RESULT_BYTES) {
    throw new Error("Task retrieval result exceeds its 12 KB storage budget.");
  }
  const resultHash = hash(serialized);
  const ledger = await loadRetrievalLedger(rootPath, taskId!);
  const entry = ledger.entries.find(
    (candidate) =>
      candidate.handle === handle && candidate.status === "active",
  );
  if (!entry) throw new Error("Task retrieval claim is not active.");
  const root = await taskExecutionRoot(rootPath);
  await atomicJson(
    path.join(root, "retrieval-results", `${resultHash}.json`),
    result,
  );
  entry.status = "completed";
  entry.completedAt = at;
  entry.resultHash = resultHash;
  ledger.updatedAt = at;
  await saveRetrievalLedger(rootPath, ledger);
}

export async function loadTaskRetrievalResult(
  rootPath: string,
  handle: string,
): Promise<unknown> {
  const match = handle.match(RETRIEVAL_HANDLE);
  if (!match) throw new Error("Task retrieval handle is invalid.");
  const [, taskId] = match;
  const ledger = await loadRetrievalLedger(rootPath, taskId!);
  const entry = ledger.entries.find(
    (candidate) =>
      candidate.handle === handle &&
      candidate.status === "completed" &&
      candidate.resultHash,
  );
  if (!entry?.resultHash) {
    throw new Error("Task retrieval result is unavailable.");
  }
  const root = await taskExecutionRoot(rootPath);
  return JSON.parse(
    await readFile(
      path.join(root, "retrieval-results", `${entry.resultHash}.json`),
      "utf8",
    ),
  ) as unknown;
}
