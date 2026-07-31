import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { projectAtlasTempRoot } from "@component-atlas/store";

const OWNER = "component-atlas-visual-direction/v1";
const TASK_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;
const SESSION_ID = /^vd-[A-Za-z0-9_-]+$/u;
const ARTIFACT_HANDLE = /^artifact-([a-f0-9]{12})-[a-f0-9]{8}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const VISUAL_HANDLE = /^visual:vd-[A-Za-z0-9_-]+:[a-f0-9]{16}$/u;
const SELECTION_RECEIPT =
  /^selection-receipt:v1:([a-f0-9]{16}):(vd-[A-Za-z0-9_-]+):([a-f0-9]{16}):([a-z0-9]+):([a-f0-9]{16})$/u;
const CAPTURE_RECEIPT =
  /^capture-receipt:v1:([a-f0-9]{16}):(vd-[A-Za-z0-9_-]+):([a-f0-9]{16}):([a-f0-9]{16})$/u;
const MANIFEST_NAME = ".visual-direction-session.json";

interface ArtifactEntry {
  handle: string;
  kind: string;
  relativePath: string;
  hash: string;
  bytes: number;
  recordedAt: string;
  captureReceipt?: string;
}

interface SelectionEntry {
  directionHash: string;
  contractHandle: string;
  expiresAt: string;
  selectionReceipt: string;
}

interface VisualSessionManifest {
  owner: string;
  sessionId: string;
  taskFingerprint: string;
  state: string;
  selection?: SelectionEntry | null;
  artifacts?: ArtifactEntry[];
}

export interface VerifiedVisualSelectionReceipt {
  sessionId: string;
  taskFingerprint: string;
  receipt: string;
}

export interface VerifiedVisualCaptureReceipt {
  sessionId: string;
  taskFingerprint: string;
  receipt: string;
  recordedAt: string;
}

export interface VisualCaptureReceiptBinding {
  sessionId: string;
  taskFingerprint: string;
  hashPrefix: string;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function taskFingerprint(taskId: string): string {
  if (!TASK_ID.test(taskId)) throw new Error("Visual artifact task ID is invalid.");
  return digest(taskId);
}

function selectionProof(
  manifest: VisualSessionManifest,
  selection: SelectionEntry,
): string {
  return digest(
    [
      OWNER,
      manifest.taskFingerprint,
      manifest.sessionId,
      selection.contractHandle,
      selection.directionHash,
      selection.expiresAt,
    ].join("\0"),
  ).slice(0, 16);
}

function captureProof(
  manifest: VisualSessionManifest,
  artifact: ArtifactEntry,
): string {
  return digest(
    [
      OWNER,
      manifest.taskFingerprint,
      manifest.sessionId,
      artifact.handle,
      artifact.hash,
      artifact.kind,
      artifact.recordedAt,
    ].join("\0"),
  ).slice(0, 16);
}

function visualRoot(): string {
  return path.join(projectAtlasTempRoot(), "visual-direction");
}

async function readSession(
  sessionId: string,
): Promise<{ manifest: VisualSessionManifest; sessionPath: string }> {
  if (!SESSION_ID.test(sessionId)) throw new Error("Visual session ID is invalid.");
  const root = visualRoot();
  const sessionPath = path.join(root, sessionId);
  const [rootPath, sessionStat] = await Promise.all([
    realpath(root),
    lstat(sessionPath),
  ]);
  if (!sessionStat.isDirectory() || sessionStat.isSymbolicLink()) {
    throw new Error("Visual artifact session must be a real directory.");
  }
  const resolvedSession = await realpath(sessionPath);
  if (path.dirname(resolvedSession) !== rootPath) {
    throw new Error("Visual artifact session resolves outside the owned temp root.");
  }
  const manifestStat = await lstat(path.join(resolvedSession, MANIFEST_NAME));
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error("Visual artifact manifest must be a regular file.");
  }
  const manifest = JSON.parse(
    await readFile(path.join(resolvedSession, MANIFEST_NAME), "utf8"),
  ) as VisualSessionManifest;
  if (
    manifest.owner !== OWNER ||
    manifest.sessionId !== sessionId ||
    !HASH.test(manifest.taskFingerprint)
  ) {
    throw new Error("Visual artifact manifest ownership is invalid.");
  }
  return { manifest, sessionPath: resolvedSession };
}

async function hashArtifact(
  target: string,
  relative = "",
): Promise<{ hash: string; bytes: number }> {
  const targetStat = await lstat(target);
  if (targetStat.isSymbolicLink()) {
    throw new Error("Visual capture paths cannot contain symbolic links.");
  }
  if (targetStat.isFile()) {
    const content = await readFile(target);
    return {
      hash: createHash("sha256")
        .update(`file:${relative}\0`)
        .update(content)
        .digest("hex"),
      bytes: content.byteLength,
    };
  }
  if (!targetStat.isDirectory()) {
    throw new Error("Visual captures must be regular files or directories.");
  }
  const entries = await readdir(target, { withFileTypes: true });
  const artifactDigest = createHash("sha256").update(`dir:${relative}\0`);
  let bytes = 0;
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (entry.isSymbolicLink()) {
      throw new Error("Visual capture directories cannot contain symbolic links.");
    }
    const childRelative = relative
      ? `${relative}/${entry.name}`
      : entry.name;
    const child = await hashArtifact(
      path.join(target, entry.name),
      childRelative,
    );
    artifactDigest.update(
      `${childRelative}\0${child.hash}\0${child.bytes}\0`,
    );
    bytes += child.bytes;
  }
  return { hash: artifactDigest.digest("hex"), bytes };
}

export function visualSelectionReceiptSession(receipt: string): string {
  const match = SELECTION_RECEIPT.exec(receipt);
  if (!match) throw new Error("Visual selection receipt is invalid.");
  return match[2]!;
}

export function visualCaptureReceiptSession(receipt: string): string {
  const match = CAPTURE_RECEIPT.exec(receipt);
  if (!match) throw new Error("Visual capture receipt is invalid.");
  return match[2]!;
}

export function parseVisualCaptureReceiptBinding(input: {
  taskId: string;
  receipt: string;
  hash: string;
}): VisualCaptureReceiptBinding {
  const match = CAPTURE_RECEIPT.exec(input.receipt);
  const fingerprint = taskFingerprint(input.taskId);
  if (
    !match ||
    match[1] !== fingerprint.slice(0, 16) ||
    !HASH.test(input.hash) ||
    match[3] !== input.hash.slice(0, 16)
  ) {
    throw new Error("Visual capture receipt binding is invalid.");
  }
  return {
    sessionId: match[2]!,
    taskFingerprint: fingerprint,
    hashPrefix: match[3]!,
  };
}

export async function verifyVisualSelectionReceipt(
  input: {
    taskId: string;
    receipt: string;
    contractHandle: string;
    contractHash: string;
    expiresAt: string;
  },
): Promise<VerifiedVisualSelectionReceipt> {
  const match = SELECTION_RECEIPT.exec(input.receipt);
  const fingerprint = taskFingerprint(input.taskId);
  if (
    !match ||
    match[1] !== fingerprint.slice(0, 16) ||
    !VISUAL_HANDLE.test(input.contractHandle) ||
    !HASH.test(input.contractHash) ||
    match[3] !== input.contractHash.slice(0, 16) ||
    !Number.isFinite(Date.parse(input.expiresAt)) ||
    Number.parseInt(match[4]!, 36) !== Date.parse(input.expiresAt)
  ) {
    throw new Error("Visual selection receipt binding is invalid.");
  }
  const { manifest } = await readSession(match[2]!);
  const selection = manifest.selection;
  if (
    manifest.state !== "selected" ||
    manifest.taskFingerprint !== fingerprint ||
    !selection ||
    selection.selectionReceipt !== input.receipt ||
    selection.contractHandle !== input.contractHandle ||
    selection.directionHash !== input.contractHash ||
    selection.expiresAt !== input.expiresAt ||
    match[5] !== selectionProof(manifest, selection)
  ) {
    throw new Error(
      "Visual selection receipt was not emitted by the active task session.",
    );
  }
  return {
    sessionId: manifest.sessionId,
    taskFingerprint: fingerprint,
    receipt: input.receipt,
  };
}

export async function verifyVisualCaptureReceipt(input: {
  taskId: string;
  receipt: string;
  handle: string;
  hash: string;
}): Promise<VerifiedVisualCaptureReceipt> {
  const match = CAPTURE_RECEIPT.exec(input.receipt);
  const binding = parseVisualCaptureReceiptBinding(input);
  const fingerprint = binding.taskFingerprint;
  const handle = ARTIFACT_HANDLE.exec(input.handle);
  if (
    !match ||
    !handle ||
    handle[1] !== input.hash.slice(0, 12)
  ) {
    throw new Error("Visual capture receipt binding is invalid.");
  }
  const { manifest, sessionPath } = await readSession(match[2]!);
  const artifact = manifest.artifacts?.find(
    (candidate) => candidate.handle === input.handle,
  );
  if (
    manifest.state !== "selected" ||
    manifest.taskFingerprint !== fingerprint ||
    !artifact ||
    artifact.kind !== "review-capture" ||
    !artifact.relativePath ||
    path.dirname(artifact.relativePath) !== "." ||
    artifact.hash !== input.hash ||
    !Number.isSafeInteger(artifact.bytes) ||
    artifact.bytes < 0 ||
    artifact.captureReceipt !== input.receipt ||
    !Number.isFinite(Date.parse(artifact.recordedAt)) ||
    match[4] !== captureProof(manifest, artifact)
  ) {
    throw new Error(
      "Visual capture receipt was not emitted by the active task session.",
    );
  }
  const content = await hashArtifact(
    path.join(sessionPath, artifact.relativePath),
  );
  if (content.hash !== artifact.hash || content.bytes !== artifact.bytes) {
    throw new Error(
      "Visual capture content differs from its emitted receipt.",
    );
  }
  return {
    sessionId: manifest.sessionId,
    taskFingerprint: fingerprint,
    receipt: input.receipt,
    recordedAt: artifact.recordedAt,
  };
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function assertVisualArtifactSessionClean(
  sessionId: string,
): Promise<void> {
  if (!SESSION_ID.test(sessionId)) throw new Error("Visual session ID is invalid.");
  const root = visualRoot();
  if (
    (await exists(path.join(root, sessionId))) ||
    (await exists(path.join(root, `.cleanup-${sessionId}.json`)))
  ) {
    throw new Error(
      "Visual artifact session or its pending cleanup receipt still exists.",
    );
  }
}
