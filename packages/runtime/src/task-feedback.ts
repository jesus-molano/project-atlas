import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { projectStorageDirectory } from "@component-atlas/store";
import { canonicalJson } from "./change-surface-fingerprint.js";
import { resolveProjectIdentity } from "./identity.js";

export type TaskFeedbackKind = "note" | "correction" | "decision" | "scope-change" | "review-finding";
export type TaskFeedbackStatus = "pending" | "resolved";

export interface TaskFeedbackEvent {
  schemaVersion: 1;
  handle: string;
  hash: string;
  taskId: string;
  feedbackId: string;
  revision: number;
  kind: TaskFeedbackKind;
  status: TaskFeedbackStatus;
  message: string;
  origin: string;
  required: boolean;
  impact: "none" | "criterion" | "contract" | "scope";
  evidenceRefs: string[];
  affectedCriterionIds: string[];
  contractPatch?: unknown;
  previousHandle?: string;
  createdAt: string;
}

export interface PersistTaskFeedbackInput {
  taskId: string;
  feedbackId: string;
  kind: TaskFeedbackKind;
  status?: TaskFeedbackStatus;
  message: string;
  origin?: string;
  required?: boolean;
  impact?: "none" | "criterion" | "contract" | "scope";
  evidenceRefs?: string[];
  affectedCriterionIds?: string[];
  contractPatch?: unknown;
  previousHandle?: string;
  createdAt?: string;
}

const TASK_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;
const FEEDBACK_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const HANDLE = /^feedback:([A-Za-z0-9_.:-]{1,160}):([a-f0-9]{16})$/u;
const MAX_FEEDBACK_ARTIFACT_BYTES = 32 * 1_024;
const MAX_FEEDBACK_ARTIFACTS = 2_048;

function text(value: string, maximum: number, label: string): string {
  const normalized = value.trim().replace(/[\u0000-\u001f]+/gu, " ");
  if (!normalized || normalized.length > maximum) throw new Error(`${label} is invalid.`);
  return normalized;
}
function strings(values: string[] = [], maximum: number, limit: number, label: string): string[] {
  if (!Array.isArray(values) || values.length > limit) throw new Error(`${label} is invalid.`);
  return [...new Set(values.map((value) => text(value, maximum, label)))].sort();
}
function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

async function feedbackRoot(rootPath: string): Promise<string> {
  const identity = await resolveProjectIdentity(rootPath);
  return path.join(
    projectStorageDirectory(identity.logicalId),
    "task-state",
    "feedback",
  );
}
async function directory(rootPath: string, taskId: string): Promise<string> {
  return path.join(await feedbackRoot(rootPath), "artifacts", taskId);
}
async function writeAtomic(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${canonicalJson(value)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

function validateFeedbackEvent(
  value: unknown,
  expectedTaskId?: string,
  expectedHandle?: string,
): TaskFeedbackEvent {
  if (!value || typeof value !== "object") {
    throw new Error("Task feedback artifact is invalid.");
  }
  const event = value as TaskFeedbackEvent;
  const match = typeof event.handle === "string" ? HANDLE.exec(event.handle) : null;
  const evidenceRefs = Array.isArray(event.evidenceRefs) &&
    event.evidenceRefs.every((item) => typeof item === "string")
    ? strings(event.evidenceRefs, 320, 24, "Task feedback evidence reference")
    : undefined;
  const affectedCriterionIds = Array.isArray(event.affectedCriterionIds) &&
    event.affectedCriterionIds.every((item) => typeof item === "string")
    ? strings(event.affectedCriterionIds, 120, 64, "Task feedback criterion ID")
    : undefined;
  const previous = event.previousHandle ? HANDLE.exec(event.previousHandle) : null;
  if (
    event.schemaVersion !== 1 ||
    !match ||
    !TASK_ID.test(event.taskId) ||
    match[1] !== event.taskId ||
    (expectedTaskId !== undefined && event.taskId !== expectedTaskId) ||
    (expectedHandle !== undefined && event.handle !== expectedHandle) ||
    !FEEDBACK_ID.test(event.feedbackId) ||
    !Number.isInteger(event.revision) ||
    event.revision < 1 ||
    !["note", "correction", "decision", "scope-change", "review-finding"].includes(
      event.kind,
    ) ||
    !["pending", "resolved"].includes(event.status) ||
    typeof event.message !== "string" ||
    text(event.message, 2_000, "Task feedback message") !== event.message ||
    typeof event.origin !== "string" ||
    text(event.origin, 160, "Task feedback origin") !== event.origin ||
    typeof event.required !== "boolean" ||
    !["none", "criterion", "contract", "scope"].includes(event.impact) ||
    !evidenceRefs ||
    canonicalJson(evidenceRefs) !== canonicalJson(event.evidenceRefs) ||
    !affectedCriterionIds ||
    canonicalJson(affectedCriterionIds) !== canonicalJson(event.affectedCriterionIds) ||
    !DIGEST.test(event.hash) ||
    event.hash.slice(0, 16) !== match[2] ||
    !Number.isFinite(Date.parse(event.createdAt)) ||
    (event.revision === 1 && event.previousHandle !== undefined) ||
    (event.revision > 1 && (!previous || previous[1] !== event.taskId))
  ) {
    throw new Error("Task feedback artifact is invalid.");
  }
  const { handle: _handle, hash: _hash, ...payload } = event;
  if (hash(payload) !== event.hash) {
    throw new Error("Task feedback content hash is invalid.");
  }
  if (
    Buffer.byteLength(canonicalJson(event), "utf8") >
    MAX_FEEDBACK_ARTIFACT_BYTES
  ) {
    throw new Error("Task feedback artifact exceeds its 32 KB budget.");
  }
  return event;
}

async function withFeedbackWriteLock<T>(
  rootPath: string,
  taskId: string,
  action: () => Promise<T>,
): Promise<T> {
  const lockDirectory = path.join(await feedbackRoot(rootPath), "locks");
  await mkdir(lockDirectory, { recursive: true });
  const lockPath = path.join(
    lockDirectory,
    `${createHash("sha256").update(taskId, "utf8").digest("hex")}.lock`,
  );
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new Error(
      "Task feedback is locked by another writer. Inspect ownership before explicit recovery.",
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
    await rm(lockPath, { force: true });
  }
}

export async function loadTaskFeedbackEvent(rootPath: string, handle: string): Promise<TaskFeedbackEvent> {
  const match = HANDLE.exec(handle);
  if (!match) throw new Error("Task feedback handle is invalid.");
  const target = path.join(await directory(rootPath, match[1]!), `${match[2]}.json`);
  return validateFeedbackEvent(
    JSON.parse(await readFile(target, "utf8")),
    match[1],
    handle,
  );
}

export async function loadTaskFeedbackQueue(rootPath: string, taskId: string): Promise<TaskFeedbackEvent[]> {
  if (!TASK_ID.test(taskId)) throw new Error("Task ID is invalid.");
  const dir = await directory(rootPath, taskId);
  const byFeedback = new Map<string, TaskFeedbackEvent[]>();
  try {
    const names = (await readdir(dir)).filter((entry) => entry.endsWith(".json"));
    if (names.length > MAX_FEEDBACK_ARTIFACTS) {
      throw new Error(
        `Task feedback exceeds its ${MAX_FEEDBACK_ARTIFACTS}-artifact safety limit.`,
      );
    }
    for (const name of names) {
      const event = validateFeedbackEvent(
        JSON.parse(await readFile(path.join(dir, name), "utf8")),
        taskId,
      );
      const revisions = byFeedback.get(event.feedbackId) ?? [];
      revisions.push(event);
      byFeedback.set(event.feedbackId, revisions);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const latest: TaskFeedbackEvent[] = [];
  for (const revisions of byFeedback.values()) {
    revisions.sort((left, right) => left.revision - right.revision);
    for (let index = 0; index < revisions.length; index += 1) {
      const event = revisions[index]!;
      const predecessor = revisions[index - 1];
      if (
        event.revision !== index + 1 ||
        (predecessor !== undefined && event.previousHandle !== predecessor.handle)
      ) {
        throw new Error("Task feedback revision chain is invalid.");
      }
    }
    latest.push(revisions.at(-1)!);
  }
  return latest.toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.feedbackId.localeCompare(right.feedbackId),
  );
}

export async function expandTaskFeedbackEvent(rootPath: string, handle: string) {
  return { schemaVersion: 1 as const, feedback: await loadTaskFeedbackEvent(rootPath, handle) };
}

/** Persists one immutable feedback event. A changed event must chain from the current revision. */
async function persistTaskFeedbackEventUnlocked(rootPath: string, input: PersistTaskFeedbackInput): Promise<TaskFeedbackEvent> {
  if (!TASK_ID.test(input.taskId) || !FEEDBACK_ID.test(input.feedbackId)) throw new Error("Task feedback identity is invalid.");
  if (!(["note", "correction", "decision", "scope-change", "review-finding"] as const).includes(input.kind)) throw new Error("Task feedback kind is invalid.");
  const dir = await directory(rootPath, input.taskId);
  const latest = (await loadTaskFeedbackQueue(rootPath, input.taskId)).find(
    (event) => event.feedbackId === input.feedbackId,
  );
  const defaultRequired = input.kind !== "note";
  const defaultImpact = input.kind === "scope-change" ? "scope" : input.kind === "correction" || input.kind === "decision" ? "contract" : input.affectedCriterionIds?.length ? "criterion" : "none";
  const normalizedMessage = text(input.message, 2_000, "Task feedback message");
  const normalizedOrigin = text(input.origin ?? "user", 160, "Task feedback origin");
  const normalizedEvidence = strings(input.evidenceRefs, 320, 24, "Task feedback evidence reference");
  const normalizedCriteria = strings(input.affectedCriterionIds, 120, 64, "Task feedback criterion ID");
  const status = input.status ?? "pending";
  const required = input.required ?? defaultRequired;
  const impact = input.impact ?? defaultImpact;
  if (latest && input.previousHandle === undefined) {
    const same = latest.kind === input.kind && latest.status === status && latest.message === normalizedMessage && latest.origin === normalizedOrigin && latest.required === required && latest.impact === impact && canonicalJson(latest.evidenceRefs) === canonicalJson(normalizedEvidence) && canonicalJson(latest.affectedCriterionIds) === canonicalJson(normalizedCriteria) && canonicalJson(latest.contractPatch ?? null) === canonicalJson(input.contractPatch ?? null);
    if (same) return latest;
  }
  if (latest && input.previousHandle !== latest.handle) throw new Error("A changed feedback event must reference its latest revision.");
  if (!latest && input.previousHandle !== undefined) throw new Error("The initial feedback event cannot reference a predecessor.");
  const payload = {
    schemaVersion: 1 as const, taskId: input.taskId, feedbackId: input.feedbackId,
    revision: (latest?.revision ?? 0) + 1, kind: input.kind, status,
    message: normalizedMessage, origin: normalizedOrigin, required, impact,
    evidenceRefs: normalizedEvidence, affectedCriterionIds: normalizedCriteria,
    ...(input.contractPatch !== undefined ? { contractPatch: input.contractPatch } : {}),
    ...(latest ? { previousHandle: latest.handle } : {}), createdAt: input.createdAt ?? new Date().toISOString(),
  };
  const digest = hash(payload);
  const event = validateFeedbackEvent({
    ...payload,
    handle: `feedback:${input.taskId}:${digest.slice(0, 16)}`,
    hash: digest,
  });
  const target = path.join(dir, `${digest.slice(0, 16)}.json`);
  try {
    const existing = validateFeedbackEvent(
      JSON.parse(await readFile(target, "utf8")),
      input.taskId,
      event.handle,
    );
    if (canonicalJson(existing) !== canonicalJson(event)) throw new Error("Task feedback artifact conflicts with its content hash.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeAtomic(target, event);
  }
  return event;
}

export async function persistTaskFeedbackEvent(
  rootPath: string,
  input: PersistTaskFeedbackInput,
): Promise<TaskFeedbackEvent> {
  if (!TASK_ID.test(input.taskId) || !FEEDBACK_ID.test(input.feedbackId)) {
    throw new Error("Task feedback identity is invalid.");
  }
  return withFeedbackWriteLock(rootPath, input.taskId, () =>
    persistTaskFeedbackEventUnlocked(rootPath, input),
  );
}
