import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fitBudgetedResponse } from "@component-atlas/memory";
import { projectStorageDirectory } from "@component-atlas/store";
import { resolveProjectIdentity } from "./identity.js";
import { writeImmutableArtifact } from "./immutable-artifact.js";
import { parseVisualCaptureReceiptBinding } from "./visual-artifact-receipt.js";

const TASK_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;
const VISUAL_HANDLE = /^visual:vd-[A-Za-z0-9_-]+:[a-f0-9]{16}$/u;
const REVIEW_HANDLE =
  /^visual-review:([A-Za-z0-9_.:-]{1,160}):([a-f0-9]{16})$/u;
const HASH = /^[a-f0-9]{64}$/u;
const CONTRACT_HASH = /^[a-f0-9]{64}$/u;
const CAPTURE_HANDLE = /^artifact-([a-f0-9]{12})-[a-f0-9]{8}$/u;
const ARTIFACT_SESSION = /^vd-[A-Za-z0-9_-]+$/u;
const CLEANUP_RECEIPT =
  /^cleanup:v1:([a-f0-9]{16}):(vd-[A-Za-z0-9_-]+):(close|cancel|expired):([a-z0-9]+):([a-f0-9]{16})$/u;
const CLEANUP_OWNER = "component-atlas-visual-direction/v1";
const MAX_ARTIFACT_BYTES = 16 * 1024;

export interface VisualReviewCapture {
  handle: string;
  hash: string;
  receipt: string;
  viewport: string;
  state: string;
}

export interface VisualReviewReceipt {
  schemaVersion: 1;
  handle: string;
  hash: string;
  taskId: string;
  contractHandle: string;
  contractHash: string;
  artifactSessionId?: string;
  preliminaryReviewHandle?: string;
  stateMatrix: {
    surface: string;
    viewports: string[];
    requiredStates: string[];
  };
  captures: VisualReviewCapture[];
  coverage: {
    complete: boolean;
    coveredViewports: string[];
    coveredStates: string[];
  };
  result: "pass" | "fix-and-recapture" | "blocked";
  deviationCount: number;
  cleanup: {
    state: "clean" | "selected-retained" | "not-applicable" | "cleanup-pending";
    receipt?: string;
  };
  reviewedAt: string;
}

export interface PersistVisualReviewReceiptInput {
  taskId: string;
  contractHandle: string;
  contractHash: string;
  artifactSessionId?: string;
  preliminaryReviewHandle?: string;
  stateMatrix: VisualReviewReceipt["stateMatrix"];
  captures: VisualReviewCapture[];
  result: VisualReviewReceipt["result"];
  deviationCount: number;
  cleanup: VisualReviewReceipt["cleanup"];
  reviewedAt?: string;
}

export interface VisualCleanupReceiptMetadata {
  sessionId: string;
  reason: "close" | "cancel" | "expired";
  cleanedAt: string;
}

type ReviewPayload = Omit<VisualReviewReceipt, "handle" | "hash">;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function bounded(value: string, maximum: number, label: string): string {
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

function uniqueBounded(
  values: string[],
  maximumItems: number,
  label: string,
): string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > maximumItems) {
    throw new Error(`${label} is invalid.`);
  }
  const normalized = values.map((value) => bounded(value, 48, label));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return [...normalized].sort();
}

function cleanupDigest(
  taskId: string,
  sessionId: string,
  reason: string,
  cleanedAt: string,
): string {
  const taskFingerprint = digest(taskId);
  return digest(
    [CLEANUP_OWNER, taskFingerprint, sessionId, reason, cleanedAt].join("\0"),
  ).slice(0, 16);
}

export function assertVisualCleanupReceipt(
  taskId: string,
  receipt: string,
): VisualCleanupReceiptMetadata {
  if (!TASK_ID.test(taskId)) throw new Error("Visual cleanup task ID is invalid.");
  const match = CLEANUP_RECEIPT.exec(receipt);
  if (!match) throw new Error("Visual cleanup receipt is invalid.");
  const [, taskPrefix, sessionId, reason, encodedTime, proof] = match;
  const taskFingerprint = digest(taskId);
  const milliseconds = Number.parseInt(encodedTime!, 36);
  if (
    taskPrefix !== taskFingerprint.slice(0, 16) ||
    !Number.isSafeInteger(milliseconds) ||
    milliseconds <= 0
  ) {
    throw new Error("Visual cleanup receipt is not bound to this task.");
  }
  const cleanedAt = new Date(milliseconds).toISOString();
  if (proof !== cleanupDigest(taskId, sessionId!, reason!, cleanedAt)) {
    throw new Error("Visual cleanup receipt proof is invalid.");
  }
  return {
    sessionId: sessionId!,
    reason: reason! as VisualCleanupReceiptMetadata["reason"],
    cleanedAt,
  };
}

function normalizePayload(input: PersistVisualReviewReceiptInput): ReviewPayload {
  if (!TASK_ID.test(input.taskId)) throw new Error("Visual review task ID is invalid.");
  if (!VISUAL_HANDLE.test(input.contractHandle) || !CONTRACT_HASH.test(input.contractHash)) {
    throw new Error("Visual review contract binding is invalid.");
  }
  if (!Array.isArray(input.captures) || input.captures.length > 24) {
    throw new Error("Visual review captures are invalid.");
  }
  if (
    (input.captures.length > 0 &&
      (!input.artifactSessionId ||
        !ARTIFACT_SESSION.test(input.artifactSessionId))) ||
    (input.artifactSessionId !== undefined &&
      !ARTIFACT_SESSION.test(input.artifactSessionId)) ||
    (input.captures.length === 0 &&
      input.artifactSessionId !== undefined &&
      !["selected-retained", "clean"].includes(input.cleanup.state))
  ) {
    throw new Error(
      "Visual review captures and their artifact session ID must be declared together.",
    );
  }
  const viewports = uniqueBounded(input.stateMatrix.viewports, 6, "Review viewports");
  const requiredStates = uniqueBounded(
    input.stateMatrix.requiredStates,
    14,
    "Review required states",
  );
  const captures = input.captures.map((capture) => {
    const handle = bounded(capture.handle, 260, "Capture handle");
    const hash = capture.hash.trim();
    const handleMatch = CAPTURE_HANDLE.exec(handle);
    if (!handleMatch || !HASH.test(hash) || handleMatch[1] !== hash.slice(0, 12)) {
      throw new Error(
        "Capture handles must be temporary-artifact handles bound to their full SHA256 hash.",
      );
    }
    const receipt = bounded(capture.receipt, 260, "Capture receipt");
    const binding = parseVisualCaptureReceiptBinding({
      taskId: input.taskId,
      receipt,
      hash,
    });
    if (input.artifactSessionId !== binding.sessionId) {
      throw new Error(
        "Every capture receipt must belong to the declared visual artifact session.",
      );
    }
    const viewport = bounded(capture.viewport, 48, "Capture viewport");
    const state = bounded(capture.state, 48, "Capture state");
    if (!viewports.includes(viewport) || !requiredStates.includes(state)) {
      throw new Error("Every capture must belong to the declared state matrix.");
    }
    return { handle, hash, receipt, viewport, state };
  });
  const pairKeys = captures.map((capture) => `${capture.viewport}\0${capture.state}`);
  if (new Set(pairKeys).size !== pairKeys.length) {
    throw new Error("Visual review capture viewport/state pairs must be unique.");
  }
  const coveredViewports = [...new Set(captures.map((capture) => capture.viewport))].sort();
  const coveredStates = [...new Set(captures.map((capture) => capture.state))].sort();
  const complete =
    viewports.every((viewport) => coveredViewports.includes(viewport)) &&
    requiredStates.every((state) => coveredStates.includes(state));
  if (input.result === "pass" && !complete) {
    throw new Error(
      "A passing visual review must cover every declared viewport and required state.",
    );
  }
  if (input.result === "pass" && input.cleanup.state === "not-applicable") {
    throw new Error(
      "A passing review with registered temporary-artifact captures requires clean cleanup evidence.",
    );
  }
  if (!["pass", "fix-and-recapture", "blocked"].includes(input.result)) {
    throw new Error("Visual review result is invalid.");
  }
  if (
    !Number.isInteger(input.deviationCount) ||
    input.deviationCount < 0 ||
    input.deviationCount > 99
  ) {
    throw new Error("Visual review deviation count is invalid.");
  }
  if (
    !["clean", "selected-retained", "not-applicable", "cleanup-pending"].includes(
      input.cleanup.state,
    )
  ) {
    throw new Error("Visual review cleanup state is invalid.");
  }
  const reviewedAt = input.reviewedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(reviewedAt))) {
    throw new Error("Visual review timestamp is invalid.");
  }
  if (input.cleanup.state === "clean") {
    if (!input.cleanup.receipt) {
      throw new Error("Clean visual review state requires a cleanup receipt.");
    }
    const cleanup = assertVisualCleanupReceipt(input.taskId, input.cleanup.receipt);
    if (
      Date.parse(cleanup.cleanedAt) > Date.now() ||
      Date.parse(cleanup.cleanedAt) > Date.parse(reviewedAt)
    ) {
      throw new Error("Visual cleanup receipt timestamp is in the future.");
    }
    if (input.result === "pass" && cleanup.reason !== "close") {
      throw new Error("A passing clean review requires a normal close cleanup receipt.");
    }
    if (
      !input.artifactSessionId ||
      cleanup.sessionId !== input.artifactSessionId ||
      !input.preliminaryReviewHandle
    ) {
      throw new Error(
        "A clean visual review must close the capture session and reference its preliminary review.",
      );
    }
    const preliminary = REVIEW_HANDLE.exec(input.preliminaryReviewHandle);
    if (!preliminary || preliminary[1] !== input.taskId) {
      throw new Error("Preliminary visual review identity is invalid.");
    }
  } else if (input.cleanup.receipt) {
    throw new Error("Only clean cleanup may carry a cleanup receipt.");
  }
  if (
    input.cleanup.state !== "clean" &&
    input.preliminaryReviewHandle
  ) {
    throw new Error(
      "Only a final clean review may reference a preliminary review.",
    );
  }
  return {
    schemaVersion: 1,
    taskId: input.taskId,
    contractHandle: input.contractHandle,
    contractHash: input.contractHash,
    ...(input.artifactSessionId
      ? { artifactSessionId: input.artifactSessionId }
      : {}),
    ...(input.preliminaryReviewHandle
      ? { preliminaryReviewHandle: input.preliminaryReviewHandle }
      : {}),
    stateMatrix: {
      surface: bounded(input.stateMatrix.surface, 120, "Review surface"),
      viewports,
      requiredStates,
    },
    captures: captures.sort((left, right) =>
      `${left.viewport}\0${left.state}`.localeCompare(`${right.viewport}\0${right.state}`),
    ),
    coverage: { complete, coveredViewports, coveredStates },
    result: input.result,
    deviationCount: input.deviationCount,
    cleanup: {
      state: input.cleanup.state,
      ...(input.cleanup.receipt
        ? { receipt: bounded(input.cleanup.receipt, 260, "Cleanup receipt") }
        : {}),
    },
    reviewedAt: new Date(reviewedAt).toISOString(),
  };
}

function payloadHash(payload: ReviewPayload): string {
  return digest(JSON.stringify(payload));
}

function validateReceipt(value: unknown): VisualReviewReceipt {
  if (!value || typeof value !== "object") {
    throw new Error("Visual review receipt is invalid.");
  }
  const receipt = value as VisualReviewReceipt;
  const normalized = normalizePayload(receipt);
  const expectedHash = payloadHash(normalized);
  const match = REVIEW_HANDLE.exec(receipt.handle);
  if (
    !match ||
    match[1] !== receipt.taskId ||
    match[2] !== expectedHash.slice(0, 16) ||
    receipt.hash !== expectedHash ||
    JSON.stringify(normalized) !==
      JSON.stringify(
        Object.fromEntries(
          Object.entries(receipt).filter(([key]) => !["handle", "hash"].includes(key)),
        ),
      )
  ) {
    throw new Error("Visual review receipt hash or identity is invalid.");
  }
  return receipt;
}

async function receiptDirectory(rootPath: string): Promise<string> {
  const identity = await resolveProjectIdentity(rootPath);
  return path.join(
    projectStorageDirectory(identity.logicalId),
    "task-state",
    "visual-review-receipts",
  );
}

function receiptFileName(handle: string): string {
  if (!REVIEW_HANDLE.test(handle)) throw new Error("Visual review handle is invalid.");
  return `${digest(handle)}.json`;
}

export async function persistVisualReviewReceipt(
  rootPathInput: string,
  input: PersistVisualReviewReceiptInput,
): Promise<VisualReviewReceipt> {
  const payload = normalizePayload(input);
  const hash = payloadHash(payload);
  const receipt = validateReceipt({
    ...payload,
    handle: `visual-review:${payload.taskId}:${hash.slice(0, 16)}`,
    hash,
  });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_ARTIFACT_BYTES) {
    throw new Error("Visual review receipt exceeds its 16 KB storage budget.");
  }
  const directory = await receiptDirectory(path.resolve(rootPathInput));
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, receiptFileName(receipt.handle));
  await writeImmutableArtifact(
    target,
    serialized,
    "Visual review receipts are immutable.",
  );
  return receipt;
}

export async function loadVisualReviewReceipt(
  rootPathInput: string,
  handle: string,
  expectedTaskId?: string,
): Promise<VisualReviewReceipt> {
  if (expectedTaskId !== undefined && !TASK_ID.test(expectedTaskId)) {
    throw new Error("Expected visual review task ID is invalid.");
  }
  const receipt = validateReceipt(
    JSON.parse(
      await readFile(
        path.join(
          await receiptDirectory(path.resolve(rootPathInput)),
          receiptFileName(handle),
        ),
        "utf8",
      ),
    ),
  );
  if (receipt.handle !== handle || (expectedTaskId && receipt.taskId !== expectedTaskId)) {
    throw new Error("Visual review receipt belongs to a different task.");
  }
  return receipt;
}

export async function expandVisualReviewReceipt(
  rootPath: string,
  handle: string,
  expectedTaskId?: string,
  budgetChars = 1_600,
) {
  const receipt = await loadVisualReviewReceipt(rootPath, handle, expectedTaskId);
  return fitBudgetedResponse(
    { receipt, nextAction: "Use this immutable review only with its bound visual contract and task." },
    {
      budgetChars,
      totalMatches: receipt.captures.length,
      expandableIds: receipt.captures.map((capture) => capture.handle),
      preserveKeys: ["receipt"],
    },
  );
}
