import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fitBudgetedResponse } from "@component-atlas/memory";
import { projectStorageDirectory } from "@component-atlas/store";
import { resolveProjectIdentity } from "./identity.js";
import { writeImmutableArtifact } from "./immutable-artifact.js";
import { EXPANDABLE_HANDLE_PATTERN as SOURCE_HANDLE } from "./expandable-handle.js";
import type { GitDeltaEntry } from "./git-delta.js";
import {
  loadTaskObjectiveArtifact,
  validateTaskObjectiveReference,
  type TaskObjectiveReference,
} from "./task-objective.js";

const TASK_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;
const DELIVERY_HANDLE =
  /^delivery:([A-Za-z0-9_.:-]{1,160}):([a-f0-9]{16})$/u;
const HASH = /^[a-f0-9]{64}$/u;
const MAX_ARTIFACT_BYTES = 16 * 1024;
const MAX_SOURCE_HANDLES = 144;

export type TaskCompletionResult = "success" | "failure" | "partial";

export interface TaskCompletionVisualReview {
  receiptHandle: string;
  contractHandle: string;
  contractHash: string;
  reviewHash: string;
  result: "pass";
  captureCount: number;
  cleanupState: "clean";
}

export interface TaskCompletionReceipt {
  schemaVersion: 1;
  handle: string;
  taskId: string;
  /** Missing only on a legacy/unbound delivery receipt. */
  objective?: TaskObjectiveReference;
  hash: string;
  lockId: string;
  deltaHash: string;
  result: TaskCompletionResult;
  summary: string;
  verification: string[];
  files: string[];
  head?: string;
  checkoutId?: string;
  sourceHandles: string[];
  visualReview?: TaskCompletionVisualReview;
  completedAt: string;
}

export interface PersistTaskCompletionReceiptInput {
  taskId: string;
  objective?: TaskObjectiveReference;
  lockId: string;
  result: TaskCompletionResult;
  summary: string;
  verification: string[];
  validatedDelta: {
    deltaHash: string;
    changedFiles: Array<Pick<GitDeltaEntry, "path" | "previousPath">>;
  };
  head?: string;
  checkoutId?: string;
  sourceHandles?: string[];
  visualReview?: TaskCompletionVisualReview;
  completedAt?: string;
}

export interface ExpandTaskCompletionReceiptOptions {
  taskId?: string;
  budgetChars?: number;
}

type HashableReceipt = Omit<TaskCompletionReceipt, "handle" | "hash">;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function boundedText(value: string, maximum: number, label: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maximum ||
    /[\u0000-\u001f]/u.test(normalized)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function repositoryFile(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
  if (
    !normalized ||
    normalized.length > 260 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.split("/").some((segment) => segment === ".." || segment === "") ||
    /[\u0000-\u001f]/u.test(normalized)
  ) {
    throw new Error("Task completion file path is invalid.");
  }
  return normalized;
}

interface StoredPayloadInput {
  taskId: string;
  objective?: TaskObjectiveReference;
  lockId: string;
  deltaHash: string;
  result: TaskCompletionResult;
  summary: string;
  verification: string[];
  files: string[];
  head?: string;
  checkoutId?: string;
  sourceHandles?: string[];
  visualReview?: TaskCompletionVisualReview;
  completedAt: string;
}

function normalizedVisualReview(
  value: TaskCompletionVisualReview | undefined,
  taskId: string,
): TaskCompletionVisualReview | undefined {
  if (value === undefined) return undefined;
  const reviewHandle =
    /^visual-review:([A-Za-z0-9_.:-]{1,160}):([a-f0-9]{16})$/u.exec(
      value.receiptHandle,
    );
  const contractHandle =
    /^visual:vd-[A-Za-z0-9_-]+:([a-f0-9]{16})$/u.exec(value.contractHandle);
  if (
    !reviewHandle ||
    reviewHandle[1] !== taskId ||
    reviewHandle[2] !== value.reviewHash.slice(0, 16) ||
    !contractHandle ||
    contractHandle[1] !== value.contractHash.slice(0, 16) ||
    !HASH.test(value.contractHash) ||
    !HASH.test(value.reviewHash) ||
    value.result !== "pass" ||
    !Number.isInteger(value.captureCount) ||
    value.captureCount < 1 ||
    value.captureCount > 24 ||
    value.cleanupState !== "clean"
  ) {
    throw new Error("Task completion visual review binding is invalid.");
  }
  return { ...value };
}

function normalizedPayload(input: StoredPayloadInput): HashableReceipt {
  if (!TASK_ID.test(input.taskId)) throw new Error("Task ID is invalid.");
  if (!/^[a-f0-9]{24}$/u.test(input.lockId) || !HASH.test(input.deltaHash)) {
    throw new Error("Task completion validation binding is invalid.");
  }
  if (!["success", "failure", "partial"].includes(input.result)) {
    throw new Error("Task completion result is invalid.");
  }
  if (!Array.isArray(input.verification) || input.verification.length > 40) {
    throw new Error("Task completion verification is invalid.");
  }
  if (!Array.isArray(input.files) || input.files.length > 200) {
    throw new Error("Task completion files are invalid.");
  }
  if ((input.sourceHandles?.length ?? 0) > MAX_SOURCE_HANDLES) {
    throw new Error("Task completion source handles are invalid.");
  }
  if ((input.sourceHandles ?? []).some((handle) => !SOURCE_HANDLE.test(handle))) {
    throw new Error("Task completion source handles are invalid.");
  }
  if (!Number.isFinite(Date.parse(input.completedAt))) {
    throw new Error("Task completion timestamp is invalid.");
  }
  const visualReview = normalizedVisualReview(input.visualReview, input.taskId);
  const objective = input.objective
    ? validateTaskObjectiveReference(input.objective, input.taskId)
    : undefined;
  return {
    schemaVersion: 1,
    taskId: input.taskId,
    ...(objective ? { objective: { ...objective } } : {}),
    lockId: input.lockId,
    deltaHash: input.deltaHash,
    result: input.result,
    summary: boundedText(input.summary, 1_000, "Task completion summary"),
    verification: [
      ...new Set(
        input.verification.map((item) =>
          boundedText(item, 500, "Task completion verification item"),
        ),
      ),
    ],
    files: [...new Set(input.files.map(repositoryFile))].sort(),
    ...(input.head
      ? { head: boundedText(input.head, 64, "Task completion Git HEAD") }
      : {}),
    ...(input.checkoutId
      ? {
          checkoutId: boundedText(
            input.checkoutId,
            160,
            "Task completion checkout ID",
          ),
        }
      : {}),
    sourceHandles: [
      ...new Set(
        (input.sourceHandles ?? []).map((handle) =>
          boundedText(handle, 260, "Task completion source handle"),
        ),
      ),
    ].sort(),
    ...(visualReview ? { visualReview } : {}),
    completedAt: new Date(input.completedAt).toISOString(),
  };
}

function receiptHash(payload: HashableReceipt): string {
  return digest(JSON.stringify(payload));
}

function validateReceipt(value: unknown): TaskCompletionReceipt {
  if (!value || typeof value !== "object") {
    throw new Error("Task completion receipt is invalid.");
  }
  const receipt = value as TaskCompletionReceipt;
  const handle = DELIVERY_HANDLE.exec(receipt.handle);
  if (
    receipt.schemaVersion !== 1 ||
    !handle ||
    !TASK_ID.test(receipt.taskId) ||
    handle[1] !== receipt.taskId ||
    !HASH.test(receipt.hash) ||
    !/^[a-f0-9]{24}$/u.test(receipt.lockId) ||
    !HASH.test(receipt.deltaHash) ||
    handle[2] !== receipt.hash.slice(0, 16) ||
    !["success", "failure", "partial"].includes(receipt.result) ||
    !Array.isArray(receipt.verification) ||
    !Array.isArray(receipt.files) ||
    !Array.isArray(receipt.sourceHandles) ||
    !Number.isFinite(Date.parse(receipt.completedAt))
  ) {
    throw new Error("Task completion receipt is invalid.");
  }
  const normalized = normalizedPayload(receipt);
  if (
    receiptHash(normalized) !== receipt.hash ||
    JSON.stringify(normalized) !==
      JSON.stringify({
        schemaVersion: receipt.schemaVersion,
        taskId: receipt.taskId,
        ...(receipt.objective ? { objective: receipt.objective } : {}),
        lockId: receipt.lockId,
        deltaHash: receipt.deltaHash,
        result: receipt.result,
        summary: receipt.summary,
        verification: receipt.verification,
        files: receipt.files,
        ...(receipt.head ? { head: receipt.head } : {}),
        ...(receipt.checkoutId ? { checkoutId: receipt.checkoutId } : {}),
        sourceHandles: receipt.sourceHandles,
        ...(receipt.visualReview ? { visualReview: receipt.visualReview } : {}),
        completedAt: receipt.completedAt,
      })
  ) {
    throw new Error("Task completion receipt hash does not match its contents.");
  }
  return receipt;
}

async function receiptDirectory(rootPath: string): Promise<string> {
  const identity = await resolveProjectIdentity(rootPath);
  return path.join(
    projectStorageDirectory(identity.logicalId),
    "task-state",
    "delivery-receipts",
  );
}

function receiptFileName(handle: string): string {
  if (!DELIVERY_HANDLE.test(handle)) {
    throw new Error("Task completion receipt handle is invalid.");
  }
  return `${digest(handle)}.json`;
}

export async function persistTaskCompletionReceipt(
  rootPathInput: string,
  input: PersistTaskCompletionReceiptInput,
): Promise<TaskCompletionReceipt> {
  const rootPath = path.resolve(rootPathInput);
  const identity = await resolveProjectIdentity(rootPath);
  if (
    input.checkoutId &&
    identity.checkoutId &&
    input.checkoutId !== identity.checkoutId
  ) {
    throw new Error("Task completion checkout binding is invalid.");
  }
  if (input.objective) {
    await loadTaskObjectiveArtifact(rootPath, input.objective, input.taskId);
  }
  if (
    !input.validatedDelta ||
    !Array.isArray(input.validatedDelta.changedFiles) ||
    !HASH.test(input.validatedDelta.deltaHash)
  ) {
    throw new Error("A validated Git delta is required for task completion.");
  }
  const files = input.validatedDelta.changedFiles.flatMap((entry) => [
    entry.path,
    ...(entry.previousPath ? [entry.previousPath] : []),
  ]);
  const payload = normalizedPayload({
    taskId: input.taskId,
    ...(input.objective ? { objective: input.objective } : {}),
    lockId: input.lockId,
    deltaHash: input.validatedDelta.deltaHash,
    result: input.result,
    summary: input.summary,
    verification: input.verification,
    files,
    ...(input.head ? { head: input.head } : {}),
    ...(input.checkoutId ?? identity.checkoutId
      ? { checkoutId: input.checkoutId ?? identity.checkoutId }
      : {}),
    ...(input.sourceHandles ? { sourceHandles: input.sourceHandles } : {}),
    ...(input.visualReview ? { visualReview: input.visualReview } : {}),
    completedAt: input.completedAt ?? new Date().toISOString(),
  });
  const hash = receiptHash(payload);
  const receipt = validateReceipt({
    ...payload,
    handle: `delivery:${payload.taskId}:${hash.slice(0, 16)}`,
    hash,
  });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_ARTIFACT_BYTES) {
    throw new Error("Task completion receipt exceeds its 16 KB storage budget.");
  }
  const directory = await receiptDirectory(rootPath);
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, receiptFileName(receipt.handle));
  await writeImmutableArtifact(
    target,
    serialized,
    "Task completion receipts are immutable.",
  );
  return receipt;
}

export async function loadTaskCompletionReceipt(
  rootPathInput: string,
  handle: string,
  expectedTaskId?: string,
): Promise<TaskCompletionReceipt> {
  if (expectedTaskId !== undefined && !TASK_ID.test(expectedTaskId)) {
    throw new Error("Expected task ID is invalid.");
  }
  const rootPath = path.resolve(rootPathInput);
  const receipt = validateReceipt(
    JSON.parse(
      await readFile(
        path.join(await receiptDirectory(rootPath), receiptFileName(handle)),
        "utf8",
      ),
    ),
  );
  if (
    receipt.handle !== handle ||
    (expectedTaskId !== undefined && receipt.taskId !== expectedTaskId)
  ) {
    throw new Error("Task completion receipt identity is invalid.");
  }
  const identity = await resolveProjectIdentity(rootPath);
  if (
    receipt.checkoutId &&
    identity.checkoutId &&
    receipt.checkoutId !== identity.checkoutId
  ) {
    throw new Error("Task completion receipt belongs to a different checkout.");
  }
  if (receipt.objective) {
    await loadTaskObjectiveArtifact(rootPath, receipt.objective, receipt.taskId);
  }
  return receipt;
}

export async function expandTaskCompletionReceipt(
  rootPath: string,
  handle: string,
  options: ExpandTaskCompletionReceiptOptions = {},
) {
  const receipt = await loadTaskCompletionReceipt(rootPath, handle, options.taskId);
  return fitBudgetedResponse(
    {
      schemaVersion: 1,
      status: "complete",
      receipt,
      nextAction: "Use this immutable receipt as the technical delivery record.",
    },
    {
      budgetChars: options.budgetChars,
      totalMatches: 1,
      preserveKeys: ["status", "receipt"],
    },
  );
}
