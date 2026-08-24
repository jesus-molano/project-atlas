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
const MAX_VISUAL_REVIEW_CASES = 14;

export interface LegacyVisualReviewCapture {
  handle: string;
  hash: string;
  receipt: string;
  viewport: string;
  state: string;
}

export interface LegacyVisualReviewReceipt {
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
  captures: LegacyVisualReviewCapture[];
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

export interface VisualReviewCase {
  id: string;
  route: string;
  viewport: string;
  state: string;
}

export interface VisualReviewCapture {
  caseId: string;
  handle: string;
  hash: string;
  receipt: string;
}

export type VisualReviewFigmaComparisonStatus =
  | "match"
  | "deviation"
  | "not-applicable";

export interface VisualReviewFigmaComparison {
  caseId: string;
  status: VisualReviewFigmaComparisonStatus;
  nodeId?: string;
}

export interface StrictVisualReviewReceipt {
  schemaVersion: 2;
  handle: string;
  hash: string;
  taskId: string;
  contractHandle: string;
  contractHash: string;
  artifactSessionId?: string;
  preliminaryReviewHandle?: string;
  stateMatrix: {
    surface: string;
    cases: VisualReviewCase[];
  };
  captures: VisualReviewCapture[];
  figmaComparisons: VisualReviewFigmaComparison[];
  coverage: {
    complete: boolean;
    browser: {
      complete: boolean;
      coveredCaseIds: string[];
    };
    figma: {
      complete: boolean;
      coveredCaseIds: string[];
      notApplicableCaseIds: string[];
    };
  };
  result: "pass" | "fix-and-recapture" | "blocked";
  deviationCount: number;
  cleanup: {
    state: "clean" | "selected-retained" | "not-applicable" | "cleanup-pending";
    receipt?: string;
  };
  reviewedAt: string;
}

export type VisualReviewReceipt =
  | LegacyVisualReviewReceipt
  | StrictVisualReviewReceipt;

export interface PersistVisualReviewReceiptInput {
  taskId: string;
  contractHandle: string;
  contractHash: string;
  artifactSessionId?: string;
  preliminaryReviewHandle?: string;
  stateMatrix: StrictVisualReviewReceipt["stateMatrix"];
  captures: VisualReviewCapture[];
  figmaComparisons: VisualReviewFigmaComparison[];
  result: StrictVisualReviewReceipt["result"];
  deviationCount: number;
  cleanup: StrictVisualReviewReceipt["cleanup"];
  reviewedAt?: string;
}

export interface VisualCleanupReceiptMetadata {
  sessionId: string;
  reason: "close" | "cancel" | "expired";
  cleanedAt: string;
}

type LegacyReviewPayload = Omit<LegacyVisualReviewReceipt, "handle" | "hash">;
type StrictReviewPayload = Omit<StrictVisualReviewReceipt, "handle" | "hash">;
type LegacyVisualReviewReceiptInput = Omit<
  LegacyVisualReviewReceipt,
  "handle" | "hash" | "coverage"
>;

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

function normalizeLegacyPayload(
  input: LegacyVisualReviewReceiptInput,
): LegacyReviewPayload {
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

function normalizeStrictPayload(
  input: PersistVisualReviewReceiptInput,
): StrictReviewPayload {
  if (!TASK_ID.test(input.taskId)) throw new Error("Visual review task ID is invalid.");
  if (!VISUAL_HANDLE.test(input.contractHandle) || !CONTRACT_HASH.test(input.contractHash)) {
    throw new Error("Visual review contract binding is invalid.");
  }
  if (
    !Array.isArray(input.stateMatrix.cases) ||
    input.stateMatrix.cases.length === 0 ||
    input.stateMatrix.cases.length > MAX_VISUAL_REVIEW_CASES
  ) {
    throw new Error("Visual review cases are invalid.");
  }
  const cases = input.stateMatrix.cases.map((entry) => ({
    id: bounded(entry.id, 64, "Visual review case ID"),
    route: bounded(entry.route, 160, "Visual review case route"),
    viewport: bounded(entry.viewport, 48, "Visual review case viewport"),
    state: bounded(entry.state, 48, "Visual review case state"),
  }));
  const caseIds = cases.map((entry) => entry.id);
  if (new Set(caseIds).size !== caseIds.length) {
    throw new Error("Visual review case IDs must be unique.");
  }
  const matrixKeys = cases.map((entry) =>
    JSON.stringify([entry.route, entry.viewport, entry.state]),
  );
  if (new Set(matrixKeys).size !== matrixKeys.length) {
    throw new Error("Visual review route, viewport and state cases must be unique.");
  }
  const sortedCases = [...cases].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  if (
    !Array.isArray(input.captures) ||
    input.captures.length > MAX_VISUAL_REVIEW_CASES
  ) {
    throw new Error("Visual review browser captures are invalid.");
  }
  if (
    (input.captures.length > 0 &&
      (!input.artifactSessionId || !ARTIFACT_SESSION.test(input.artifactSessionId))) ||
    (input.artifactSessionId !== undefined &&
      !ARTIFACT_SESSION.test(input.artifactSessionId)) ||
    (input.captures.length === 0 &&
      input.artifactSessionId !== undefined &&
      !["selected-retained", "clean"].includes(input.cleanup.state))
  ) {
    throw new Error(
      "Visual review browser captures and their artifact session ID must be declared together.",
    );
  }
  const captures = input.captures.map((capture) => {
    const caseId = bounded(capture.caseId, 64, "Browser capture case ID");
    if (!caseIds.includes(caseId)) {
      throw new Error("Every browser capture must belong to a declared visual case.");
    }
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
    return { caseId, handle, hash, receipt };
  });
  const capturedCaseIds = captures.map((capture) => capture.caseId);
  if (new Set(capturedCaseIds).size !== capturedCaseIds.length) {
    throw new Error("Browser capture case IDs must be unique.");
  }
  if (
    !Array.isArray(input.figmaComparisons) ||
    input.figmaComparisons.length > MAX_VISUAL_REVIEW_CASES
  ) {
    throw new Error("Visual review Figma comparisons are invalid.");
  }
  const figmaComparisons = input.figmaComparisons.map((comparison) => {
    const caseId = bounded(comparison.caseId, 64, "Figma comparison case ID");
    if (!caseIds.includes(caseId)) {
      throw new Error("Every Figma comparison must belong to a declared visual case.");
    }
    if (!["match", "deviation", "not-applicable"].includes(comparison.status)) {
      throw new Error("Figma comparison status is invalid.");
    }
    const nodeId = comparison.nodeId
      ? bounded(comparison.nodeId, 240, "Figma comparison node ID")
      : undefined;
    if (comparison.status === "not-applicable" ? nodeId : !nodeId) {
      throw new Error(
        "Figma comparisons require a node ID unless explicitly not applicable.",
      );
    }
    return {
      caseId,
      status: comparison.status,
      ...(nodeId ? { nodeId } : {}),
    };
  });
  const comparedCaseIds = figmaComparisons.map((comparison) => comparison.caseId);
  if (new Set(comparedCaseIds).size !== comparedCaseIds.length) {
    throw new Error("Figma comparison case IDs must be unique.");
  }
  const browserComplete =
    capturedCaseIds.length === caseIds.length &&
    caseIds.every((caseId) => capturedCaseIds.includes(caseId));
  const figmaComplete =
    comparedCaseIds.length === caseIds.length &&
    caseIds.every((caseId) => comparedCaseIds.includes(caseId));
  const complete = browserComplete && figmaComplete;
  if (input.result === "pass" && !browserComplete) {
    throw new Error(
      "A passing visual review requires one browser capture for every declared case.",
    );
  }
  if (input.result === "pass" && !figmaComplete) {
    throw new Error(
      "A passing visual review requires one Figma comparison for every declared case.",
    );
  }
  if (
    input.result === "pass" &&
    input.figmaComparisons.some((comparison) => comparison.status === "deviation")
  ) {
    throw new Error("A passing visual review cannot contain Figma deviations.");
  }
  if (input.result === "pass" && input.cleanup.state === "not-applicable") {
    throw new Error(
      "A passing review with registered browser captures requires clean cleanup evidence.",
    );
  }
  if (!["pass", "fix-and-recapture", "blocked"].includes(input.result)) {
    throw new Error("Visual review result is invalid.");
  }
  if (
    !Number.isInteger(input.deviationCount) ||
    input.deviationCount < 0 ||
    input.deviationCount > 99 ||
    (input.result === "pass" && input.deviationCount !== 0)
  ) {
    throw new Error("Visual review deviation count is invalid.");
  }
  const figmaDeviationCount = figmaComparisons.filter(
    (comparison) => comparison.status === "deviation",
  ).length;
  if (input.deviationCount < figmaDeviationCount) {
    throw new Error(
      "Visual review deviation count cannot be lower than its Figma deviations.",
    );
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
  if (input.cleanup.state !== "clean" && input.preliminaryReviewHandle) {
    throw new Error(
      "Only a final clean review may reference a preliminary review.",
    );
  }
  return {
    schemaVersion: 2,
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
      cases: sortedCases,
    },
    captures: captures.sort((left, right) => left.caseId.localeCompare(right.caseId)),
    figmaComparisons: figmaComparisons.sort((left, right) =>
      left.caseId.localeCompare(right.caseId),
    ),
    coverage: {
      complete,
      browser: {
        complete: browserComplete,
        coveredCaseIds: [...capturedCaseIds].sort(),
      },
      figma: {
        complete: figmaComplete,
        coveredCaseIds: [...comparedCaseIds].sort(),
        notApplicableCaseIds: figmaComparisons
          .filter((comparison) => comparison.status === "not-applicable")
          .map((comparison) => comparison.caseId)
          .sort(),
      },
    },
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

function payloadHash(payload: LegacyReviewPayload | StrictReviewPayload): string {
  return digest(JSON.stringify(payload));
}

function validateReceipt(value: unknown): VisualReviewReceipt {
  if (!value || typeof value !== "object") {
    throw new Error("Visual review receipt is invalid.");
  }
  const receipt = value as VisualReviewReceipt;
  const normalized =
    receipt.schemaVersion === 1
      ? normalizeLegacyPayload(receipt)
      : receipt.schemaVersion === 2
        ? normalizeStrictPayload(receipt)
        : undefined;
  if (!normalized) throw new Error("Visual review receipt version is invalid.");
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
  const payload = normalizeStrictPayload(input);
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
