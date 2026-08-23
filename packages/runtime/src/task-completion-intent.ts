import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { projectStorageDirectory } from "@component-atlas/store";
import { resolveProjectIdentity } from "./identity.js";
import { writeImmutableArtifact } from "./immutable-artifact.js";
import { taskStateFileName } from "./task-state-paths.js";
import { EXPANDABLE_HANDLE_PATTERN as EXPANDABLE_HANDLE } from "./task-state-contract.js";
import {
  loadTaskCompletionReceipt,
  type TaskCompletionResult,
} from "./task-completion-receipt.js";
import {
  loadTaskObjectiveArtifact,
  validateTaskObjectiveReference,
  type TaskObjectiveReference,
} from "./task-objective.js";

const TASK_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const LOCK_ID = /^[a-f0-9]{24}$/u;
const DELIVERY_HANDLE =
  /^delivery:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{16}$/u;
const RECEIPT_ID = /^receipt-(?:[a-f0-9]{16}|[a-f0-9]{64})$/u;
const MAX_ARTIFACT_BYTES = 16 * 1024;
const MAX_SOURCE_RECEIPTS = 128;

export interface TaskCompletionIntentRequest {
  result: TaskCompletionResult;
  summary: string;
  verification: string[];
  files: string[];
}

export interface TaskCompletionIntentBindings {
  head: string;
  /** Missing only on a legacy/unbound completion claim. */
  objective?: TaskObjectiveReference;
  lockId?: string;
  deltaHash?: string;
  sourceReceiptIds?: string[];
  handles?: string[];
  visualReview?: {
    handle: string;
    contractHandle: string;
    hash: string;
    result: "pass" | "fix-and-recapture" | "blocked";
  };
  checkoutId?: string;
}

export interface TaskCompletionIntent {
  schemaVersion: 1;
  taskId: string;
  requestHash: string;
  request: TaskCompletionIntentRequest;
  bindings: TaskCompletionIntentBindings;
  completedAt: string;
}

export interface TaskCompletionProjection {
  taskId: string;
  status: "completed";
  ready: boolean;
  result: TaskCompletionResult;
  summary: string;
  verification: string[];
  files: string[];
  sourceReceiptIds: string[];
  deliveryReceipt: string | null;
  handles: string[];
  memory: "not-written";
}

export interface TaskCompletionCommit {
  schemaVersion: 1;
  taskId: string;
  requestHash: string;
  completedAt: string;
  projection: TaskCompletionProjection;
}

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

function normalizedFile(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
  if (
    !normalized ||
    normalized.length > 260 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.split("/").some((segment) => !segment || segment === "..") ||
    /[\u0000-\u001f]/u.test(normalized)
  ) {
    throw new Error("Task completion file path is invalid.");
  }
  return normalized;
}

export function normalizeTaskCompletionIntentRequest(
  request: TaskCompletionIntentRequest,
): TaskCompletionIntentRequest {
  if (!["success", "failure", "partial"].includes(request.result)) {
    throw new Error("Task completion result is invalid.");
  }
  if (
    !Array.isArray(request.verification) ||
    request.verification.length === 0 ||
    request.verification.length > 12 ||
    !Array.isArray(request.files) ||
    request.files.length > 100
  ) {
    throw new Error("Task completion evidence is invalid.");
  }
  return {
    result: request.result,
    summary: boundedText(request.summary, 1_000, "Task completion summary"),
    verification: [
      ...new Set(
        request.verification.map((item) =>
          boundedText(item, 500, "Task completion verification item"),
        ),
      ),
    ],
    files: [...new Set(request.files.map(normalizedFile))].sort(),
  };
}

function normalizeBindings(
  bindings: TaskCompletionIntentBindings,
  taskId?: string,
): TaskCompletionIntentBindings {
  const head = boundedText(bindings.head, 64, "Task completion Git HEAD");
  if (bindings.lockId && !LOCK_ID.test(bindings.lockId)) {
    throw new Error("Task completion lock binding is invalid.");
  }
  if (bindings.deltaHash && !HASH.test(bindings.deltaHash)) {
    throw new Error("Task completion delta binding is invalid.");
  }
  const visualReview = bindings.visualReview;
  const objective = bindings.objective
    ? validateTaskObjectiveReference(bindings.objective, taskId)
    : undefined;
  if (
    visualReview &&
    (!/^visual-review:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{16}$/u.test(
      visualReview.handle,
    ) ||
      !/^visual:vd-[A-Za-z0-9_-]+:[a-f0-9]{16}$/u.test(
        visualReview.contractHandle,
      ) ||
      !HASH.test(visualReview.hash) ||
      !["pass", "fix-and-recapture", "blocked"].includes(
        visualReview.result,
      ))
  ) {
    throw new Error("Task completion visual review binding is invalid.");
  }
  if (
    bindings.sourceReceiptIds &&
    (!Array.isArray(bindings.sourceReceiptIds) ||
      bindings.sourceReceiptIds.length > MAX_SOURCE_RECEIPTS ||
      bindings.sourceReceiptIds.some((id) => !RECEIPT_ID.test(id)))
  ) {
    throw new Error("Task completion source receipt bindings are invalid.");
  }
  if (
    bindings.handles &&
    (!Array.isArray(bindings.handles) ||
      bindings.handles.length > 8 ||
      bindings.handles.some((handle) => !EXPANDABLE_HANDLE.test(handle)))
  ) {
    throw new Error("Task completion context handle bindings are invalid.");
  }
  return {
    head,
    ...(objective ? { objective: { ...objective } } : {}),
    ...(bindings.lockId ? { lockId: bindings.lockId } : {}),
    ...(bindings.deltaHash ? { deltaHash: bindings.deltaHash } : {}),
    ...(bindings.sourceReceiptIds
      ? { sourceReceiptIds: [...new Set(bindings.sourceReceiptIds)] }
      : {}),
    ...(bindings.handles
      ? { handles: [...new Set(bindings.handles)] }
      : {}),
    ...(visualReview
      ? {
          visualReview: {
            handle: visualReview.handle,
            contractHandle: visualReview.contractHandle,
            hash: visualReview.hash,
            result: visualReview.result,
          },
        }
      : {}),
    ...(bindings.checkoutId
      ? {
          checkoutId: boundedText(
            bindings.checkoutId,
            160,
            "Task completion checkout ID",
          ),
        }
      : {}),
  };
}

function intentHash(
  request: TaskCompletionIntentRequest,
  bindings: TaskCompletionIntentBindings,
): string {
  return digest(JSON.stringify({ request, bindings }));
}

function validateIntent(value: unknown): TaskCompletionIntent {
  if (!value || typeof value !== "object") {
    throw new Error("Task completion intent is invalid.");
  }
  const intent = value as TaskCompletionIntent;
  const request = normalizeTaskCompletionIntentRequest(intent.request);
  const bindings = normalizeBindings(intent.bindings, intent.taskId);
  const visualHandle = bindings.visualReview
    ? /^visual-review:([A-Za-z0-9_.:-]{1,160}):([a-f0-9]{16})$/u.exec(
        bindings.visualReview.handle,
      )
    : undefined;
  if (
    intent.schemaVersion !== 1 ||
    !TASK_ID.test(intent.taskId) ||
    !HASH.test(intent.requestHash) ||
    !Number.isFinite(Date.parse(intent.completedAt)) ||
    intent.requestHash !== intentHash(request, bindings) ||
    (bindings.visualReview !== undefined &&
      (!visualHandle ||
        visualHandle[1] !== intent.taskId ||
        visualHandle[2] !== bindings.visualReview.hash.slice(0, 16))) ||
    JSON.stringify(request) !== JSON.stringify(intent.request) ||
    JSON.stringify(bindings) !== JSON.stringify(intent.bindings)
  ) {
    throw new Error("Task completion intent hash or binding is invalid.");
  }
  return intent;
}

function validateProjection(
  value: TaskCompletionProjection,
  taskId: string,
): TaskCompletionProjection {
  if (
    value.taskId !== taskId ||
    value.status !== "completed" ||
    !["success", "failure", "partial"].includes(value.result) ||
    value.ready !== (value.result === "success") ||
    value.memory !== "not-written" ||
    !Array.isArray(value.verification) ||
    value.verification.length === 0 ||
    value.verification.length > 40 ||
    !Array.isArray(value.files) ||
    value.files.length > 200 ||
    !Array.isArray(value.sourceReceiptIds) ||
    value.sourceReceiptIds.length > MAX_SOURCE_RECEIPTS ||
    value.sourceReceiptIds.some((id) => !RECEIPT_ID.test(id)) ||
    !Array.isArray(value.handles) ||
    value.handles.length > 8 ||
    value.handles.some((handle) => !EXPANDABLE_HANDLE.test(handle)) ||
    (value.deliveryReceipt !== null &&
      !DELIVERY_HANDLE.test(value.deliveryReceipt))
  ) {
    throw new Error("Task completion projection is invalid.");
  }
  const normalized = {
    summary: boundedText(value.summary, 1_000, "Task completion summary"),
    verification: [
      ...new Set(
        value.verification.map((item) =>
          boundedText(item, 500, "Task completion verification item"),
        ),
      ),
    ],
    files: [...new Set(value.files.map(normalizedFile))].sort(),
  };
  if (
    normalized.summary !== value.summary ||
    JSON.stringify(normalized.verification) !==
      JSON.stringify(value.verification) ||
    JSON.stringify(normalized.files) !== JSON.stringify(value.files)
  ) {
    throw new Error("Task completion projection is not normalized.");
  }
  return value;
}

function validateCommit(value: unknown): TaskCompletionCommit {
  if (!value || typeof value !== "object") {
    throw new Error("Task completion commit is invalid.");
  }
  const commit = value as TaskCompletionCommit;
  if (
    commit.schemaVersion !== 1 ||
    !TASK_ID.test(commit.taskId) ||
    !HASH.test(commit.requestHash) ||
    !Number.isFinite(Date.parse(commit.completedAt))
  ) {
    throw new Error("Task completion commit is invalid.");
  }
  validateProjection(commit.projection, commit.taskId);
  return commit;
}

async function assertProjectionMatchesIntent(
  rootPath: string,
  intent: TaskCompletionIntent,
  projection: TaskCompletionProjection,
): Promise<void> {
  const requestedVerification = intent.request.verification;
  const extraVerification = projection.verification.slice(
    requestedVerification.length,
  );
  const requestedPrefixMatches = requestedVerification.every(
    (item, index) => projection.verification[index] === item,
  );
  const expectedVisualExtra = intent.bindings.visualReview
    ? intent.request.result === "success"
      ? extraVerification.length === 1 &&
        extraVerification[0] ===
          `visual-review:${intent.bindings.visualReview.hash}`
      : extraVerification.length === 1 &&
        extraVerification[0] ===
          `visual-review-outcome:${intent.bindings.visualReview.handle}:${intent.bindings.visualReview.result}`
    : extraVerification.length === 0;
  if (
    projection.result !== intent.request.result ||
    projection.summary !== intent.request.summary ||
    !requestedPrefixMatches ||
    !expectedVisualExtra
  ) {
    throw new Error(
      "Task completion projection diverges from its claimed result, summary or verification evidence.",
    );
  }
  if (
    intent.bindings.sourceReceiptIds !== undefined &&
    JSON.stringify(projection.sourceReceiptIds) !==
      JSON.stringify(intent.bindings.sourceReceiptIds)
  ) {
    throw new Error(
      "Task completion source receipts diverge from the durable intent.",
    );
  }
  if (intent.bindings.handles !== undefined) {
    const expectedHandles = [
      ...new Set([
        ...(projection.deliveryReceipt ? [projection.deliveryReceipt] : []),
        ...(intent.bindings.visualReview
          ? [intent.bindings.visualReview.handle]
          : []),
        ...intent.bindings.handles,
      ]),
    ].slice(0, 8);
    const requiredHandles = [
      ...(projection.deliveryReceipt ? [projection.deliveryReceipt] : []),
      ...(intent.bindings.visualReview
        ? [intent.bindings.visualReview.handle]
        : []),
    ];
    let expectedIndex = 0;
    const orderedSubset = projection.handles.every((handle) => {
      const index = expectedHandles.indexOf(handle, expectedIndex);
      if (index < 0) return false;
      expectedIndex = index + 1;
      return true;
    });
    if (
      !orderedSubset ||
      requiredHandles.some((handle) => !projection.handles.includes(handle))
    ) {
      throw new Error(
        "Task completion context handles diverge from the durable intent.",
      );
    }
  }
  if (projection.deliveryReceipt === null) {
    if (JSON.stringify(projection.files) !== JSON.stringify(intent.request.files)) {
      throw new Error(
        "Task completion files diverge from the claimed non-delivery payload.",
      );
    }
    return;
  }
  if (!intent.bindings.lockId || !intent.bindings.deltaHash) {
    throw new Error(
      "A delivery projection requires the lock and delta bindings claimed by the intent.",
    );
  }
  const delivery = await loadTaskCompletionReceipt(
    rootPath,
    projection.deliveryReceipt,
    intent.taskId,
  );
  const expectedDeliverySources = [
    ...new Set([
      ...(intent.bindings.visualReview
        ? [
            intent.bindings.visualReview.contractHandle,
            intent.bindings.visualReview.handle,
          ]
        : []),
      ...(intent.bindings.sourceReceiptIds ?? []),
      ...(intent.bindings.handles ?? []),
    ]),
  ].sort();
  if (
    delivery.completedAt !== intent.completedAt ||
    JSON.stringify(delivery.objective) !==
      JSON.stringify(intent.bindings.objective) ||
    delivery.lockId !== intent.bindings.lockId ||
    delivery.deltaHash !== intent.bindings.deltaHash ||
    delivery.head !== intent.bindings.head ||
    (intent.bindings.checkoutId !== undefined &&
      delivery.checkoutId !== intent.bindings.checkoutId) ||
    delivery.result !== projection.result ||
    delivery.summary !== projection.summary ||
    JSON.stringify(delivery.verification) !==
      JSON.stringify(projection.verification) ||
    JSON.stringify(delivery.files) !== JSON.stringify(projection.files) ||
    ((intent.bindings.sourceReceiptIds !== undefined ||
      intent.bindings.handles !== undefined) &&
      JSON.stringify(delivery.sourceHandles) !==
        JSON.stringify(expectedDeliverySources))
  ) {
    throw new Error(
      "Task completion projection differs from its immutable delivery receipt.",
    );
  }
}

async function taskStateRoot(rootPath: string): Promise<string> {
  const identity = await resolveProjectIdentity(rootPath);
  return path.join(projectStorageDirectory(identity.logicalId), "task-state");
}

async function artifactPath(
  rootPath: string,
  taskId: string,
  kind: "completion-intents" | "completion-commits",
): Promise<string> {
  return path.join(
    await taskStateRoot(rootPath),
    kind,
    taskStateFileName(rootPath, taskId, "json"),
  );
}

async function optionalJson<T>(
  target: string,
  validate: (value: unknown) => T,
): Promise<T | undefined> {
  try {
    return validate(JSON.parse(await readFile(target, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function loadTaskCompletionIntent(
  rootPathInput: string,
  taskId: string,
): Promise<TaskCompletionIntent | undefined> {
  if (!TASK_ID.test(taskId)) throw new Error("Task ID is invalid.");
  const rootPath = path.resolve(rootPathInput);
  const intent = await optionalJson(
    await artifactPath(rootPath, taskId, "completion-intents"),
    validateIntent,
  );
  if (intent && intent.taskId !== taskId) {
    throw new Error("Task completion intent belongs to a different task.");
  }
  if (intent?.bindings.objective) {
    await loadTaskObjectiveArtifact(
      rootPath,
      intent.bindings.objective,
      taskId,
    );
  }
  return intent;
}

export function assertTaskCompletionIntentRequest(
  intent: TaskCompletionIntent,
  requestInput: TaskCompletionIntentRequest,
): TaskCompletionIntentRequest {
  const request = normalizeTaskCompletionIntentRequest(requestInput);
  if (JSON.stringify(intent.request) !== JSON.stringify(request)) {
    throw new Error(
      "Task completion is already claimed with a different result, summary or evidence payload.",
    );
  }
  return request;
}

export async function claimTaskCompletionIntent(
  rootPathInput: string,
  input: {
    taskId: string;
    request: TaskCompletionIntentRequest;
    bindings: TaskCompletionIntentBindings;
    completedAt?: string;
  },
): Promise<TaskCompletionIntent> {
  if (!TASK_ID.test(input.taskId)) throw new Error("Task ID is invalid.");
  const rootPath = path.resolve(rootPathInput);
  const request = normalizeTaskCompletionIntentRequest(input.request);
  const bindings = normalizeBindings(input.bindings, input.taskId);
  if (bindings.objective) {
    await loadTaskObjectiveArtifact(rootPath, bindings.objective, input.taskId);
  }
  const completedAt = input.completedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(completedAt))) {
    throw new Error("Task completion timestamp is invalid.");
  }
  const proposed = validateIntent({
    schemaVersion: 1,
    taskId: input.taskId,
    requestHash: intentHash(request, bindings),
    request,
    bindings,
    completedAt: new Date(completedAt).toISOString(),
  });
  const target = await artifactPath(
    rootPath,
    input.taskId,
    "completion-intents",
  );
  await mkdir(path.dirname(target), { recursive: true });
  const serialized = `${JSON.stringify(proposed, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_ARTIFACT_BYTES) {
    throw new Error("Task completion intent exceeds its 16 KB storage budget.");
  }
  try {
    await writeImmutableArtifact(
      target,
      serialized,
      "Task completion is already claimed by another payload.",
    );
    return proposed;
  } catch (error) {
    const existing = await loadTaskCompletionIntent(rootPath, input.taskId);
    if (!existing) throw error;
    if (existing.requestHash !== proposed.requestHash) {
      throw new Error(
        "Task completion is already claimed with different payload or workspace bindings.",
        { cause: error },
      );
    }
    return existing;
  }
}

export async function loadTaskCompletionCommit(
  rootPathInput: string,
  taskId: string,
): Promise<TaskCompletionCommit | undefined> {
  if (!TASK_ID.test(taskId)) throw new Error("Task ID is invalid.");
  const rootPath = path.resolve(rootPathInput);
  const commit = await optionalJson(
    await artifactPath(rootPath, taskId, "completion-commits"),
    validateCommit,
  );
  if (commit && commit.taskId !== taskId) {
    throw new Error("Task completion commit belongs to a different task.");
  }
  if (commit) {
    const intent = await loadTaskCompletionIntent(rootPath, taskId);
    if (
      !intent ||
      intent.requestHash !== commit.requestHash ||
      intent.completedAt !== commit.completedAt
    ) {
      throw new Error("Task completion commit differs from its durable intent.");
    }
    await assertProjectionMatchesIntent(rootPath, intent, commit.projection);
  }
  return commit;
}

export async function commitTaskCompletionIntent(
  rootPathInput: string,
  intent: TaskCompletionIntent,
  projectionInput: TaskCompletionProjection,
): Promise<TaskCompletionCommit> {
  const rootPath = path.resolve(rootPathInput);
  const claimed = await loadTaskCompletionIntent(rootPath, intent.taskId);
  if (
    !claimed ||
    claimed.requestHash !== intent.requestHash ||
    claimed.completedAt !== intent.completedAt
  ) {
    throw new Error("Task completion commit does not match the durable claim.");
  }
  const projection = validateProjection(projectionInput, intent.taskId);
  await assertProjectionMatchesIntent(rootPath, claimed, projection);
  const commit = validateCommit({
    schemaVersion: 1,
    taskId: intent.taskId,
    requestHash: intent.requestHash,
    completedAt: intent.completedAt,
    projection,
  });
  const serialized = `${JSON.stringify(commit, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_ARTIFACT_BYTES) {
    throw new Error("Task completion commit exceeds its 16 KB storage budget.");
  }
  const target = await artifactPath(
    rootPath,
    intent.taskId,
    "completion-commits",
  );
  await mkdir(path.dirname(target), { recursive: true });
  await writeImmutableArtifact(
    target,
    serialized,
    "Task completion commit is immutable.",
  );
  return commit;
}
