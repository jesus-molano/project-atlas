import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function projectAtlasRoot() {
  if (process.env.PROJECT_ATLAS_HOME?.trim()) {
    return path.resolve(process.env.PROJECT_ATLAS_HOME);
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA?.trim()) {
    return path.join(process.env.LOCALAPPDATA, "ProjectAtlas");
  }
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "ProjectAtlas",
    );
  }
  return path.join(
    process.env.XDG_DATA_HOME?.trim() ||
      path.join(os.homedir(), ".local", "share"),
    "ProjectAtlas",
  );
}

export const DEFAULT_ROOT = path.join(
  projectAtlasRoot(),
  "temp",
  "visual-direction",
);
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;

const OWNER = "component-atlas-visual-direction/v1";
const MANIFEST_NAME = ".visual-direction-session.json";
const CONTRACT_NAME = ".selected-design-contract.json";
const CLEANUP_PREFIX = ".cleanup-";
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_CONTRACT_BYTES = 8_192;
const WINDOWS_RENAME_RETRY_DELAYS_MS = [8, 24, 64];
const ARTIFACT_KINDS = new Set([
  "moodboard",
  "mockup",
  "contact-sheet",
  "sandbox",
  "selected-preview",
  "review-capture",
]);
const SELECTABLE_KINDS = new Set([
  "moodboard",
  "mockup",
  "sandbox",
  "selected-preview",
]);

function selectionReceipt(manifest, selection) {
  const proof = hashText(
    [
      OWNER,
      manifest.taskFingerprint,
      manifest.sessionId,
      selection.contractHandle,
      selection.directionHash,
      selection.expiresAt,
    ].join("\0"),
  ).slice(0, 16);
  return `selection-receipt:v1:${manifest.taskFingerprint.slice(0, 16)}:${
    manifest.sessionId
  }:${selection.directionHash.slice(0, 16)}:${Date.parse(
    selection.expiresAt,
  ).toString(36)}:${proof}`;
}

function captureReceipt(manifest, artifact) {
  const proof = hashText(
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
  return `capture-receipt:v1:${manifest.taskFingerprint.slice(0, 16)}:${
    manifest.sessionId
  }:${artifact.hash.slice(0, 16)}:${proof}`;
}

export class CleanupPendingError extends Error {
  constructor(message, receipt) {
    super(message);
    this.name = "CleanupPendingError";
    this.receipt = receipt;
  }
}

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}

export class CorruptManifestError extends Error {
  constructor({ sessionPath, manifestFile, cause }) {
    const sessionId = path.basename(sessionPath);
    super(
      `Session ${sessionId} has an invalid JSON manifest. Its files were preserved; restore a valid owned manifest or review and remove the session explicitly.`,
      { cause },
    );
    this.name = "CorruptManifestError";
    this.code = "MANIFEST_JSON_INVALID";
    this.diagnostic = Object.freeze({
      state: "manual-review-required",
      code: this.code,
      sessionId,
      manifestFile,
      preserved: true,
      recovery:
        "Restore a valid owned manifest or inspect and remove this session explicitly; TTL sweep will not delete it.",
    });
  }
}

function cleanReceipt({ taskFingerprint, sessionId, reason, cleanedAt }) {
  const proof = hashText(
    [OWNER, taskFingerprint, sessionId, reason, cleanedAt].join("\0"),
  ).slice(0, 16);
  return `cleanup:v1:${taskFingerprint.slice(0, 16)}:${sessionId}:${reason}:${Date.parse(
    cleanedAt,
  ).toString(36)}:${proof}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify(value[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function errorCode(error) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code.slice(0, 40);
  }
  return "UNKNOWN";
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function pathExists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function findGitAncestor(target) {
  let current = path.resolve(target);
  while (true) {
    if (await pathExists(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function assertSafeRoot(root, { create = true } = {}) {
  const resolved = path.resolve(root);
  if (resolved === path.parse(resolved).root) {
    throw new Error("Temporary artifact root cannot be a filesystem root.");
  }
  const gitAncestor = await findGitAncestor(resolved);
  if (gitAncestor) {
    throw new Error(
      `Temporary artifact root must be outside a Git worktree: ${gitAncestor}`,
    );
  }
  if (create) await mkdir(resolved, { recursive: true });
  if (!(await pathExists(resolved))) return resolved;
  const rootStat = await lstat(resolved);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Temporary artifact root must be a real directory.");
  }
  return realpath(resolved);
}

function manifestPath(sessionPath) {
  return path.join(sessionPath, MANIFEST_NAME);
}

function cleanupReceiptPath(rootPath, sessionId) {
  return path.join(rootPath, `${CLEANUP_PREFIX}${sessionId}.json`);
}

function isWindowsRenameContention(error) {
  return (
    process.platform === "win32" &&
    ["EACCES", "EBUSY", "EEXIST", "EPERM"].includes(errorCode(error))
  );
}

async function replaceFileAtomically(temporaryFile, target) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temporaryFile, target);
      return;
    } catch (error) {
      const delay = WINDOWS_RENAME_RETRY_DELAYS_MS[attempt];
      if (!isWindowsRenameContention(error) || delay === undefined) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export async function writeJsonAtomic(
  target,
  value,
  { faultInjector } = {},
) {
  const resolvedTarget = path.resolve(target);
  const temporaryFile = path.join(
    path.dirname(resolvedTarget),
    `.${path.basename(resolvedTarget)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporaryFile, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
      handle = undefined;
    }
    await faultInjector?.({
      stage: "after-sync-before-rename",
      target: resolvedTarget,
      temporaryFile,
    });
    await replaceFileAtomically(temporaryFile, resolvedTarget);
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await rm(temporaryFile, { force: true }).catch(() => undefined);
  }
}

async function readOwnedManifest(sessionPath, root = DEFAULT_ROOT) {
  const rootPath = await assertSafeRoot(root, { create: false });
  if (!(await pathExists(rootPath))) {
    throw new Error("Temporary artifact root does not exist.");
  }
  const resolvedSession = path.resolve(sessionPath);
  if (path.dirname(resolvedSession) !== path.resolve(rootPath)) {
    throw new Error("Session must be a direct child of the owned temp root.");
  }
  const sessionStat = await lstat(resolvedSession);
  if (!sessionStat.isDirectory() || sessionStat.isSymbolicLink()) {
    throw new Error("Session must be a real directory.");
  }
  const realSession = await realpath(resolvedSession);
  if (path.dirname(realSession) !== path.resolve(rootPath)) {
    throw new Error("Session resolves outside the owned temp root.");
  }
  const ownedManifestPath = manifestPath(realSession);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(ownedManifestPath, "utf8"));
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause;
    throw new CorruptManifestError({
      sessionPath: realSession,
      manifestFile: ownedManifestPath,
      cause,
    });
  }
  if (
    manifest?.owner !== OWNER ||
    manifest?.sessionId !== path.basename(realSession)
  ) {
    throw new Error("Session manifest ownership check failed.");
  }
  return { rootPath, sessionPath: realSession, manifest };
}

async function hashArtifact(target, relative = "") {
  const targetStat = await lstat(target);
  if (targetStat.isSymbolicLink()) {
    throw new Error("Artifact paths cannot contain symbolic links.");
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
    throw new Error("Artifacts must be regular files or directories.");
  }

  const entries = await readdir(target, { withFileTypes: true });
  const digest = createHash("sha256").update(`dir:${relative}\0`);
  let bytes = 0;
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (entry.isSymbolicLink()) {
      throw new Error("Artifact directories cannot contain symbolic links.");
    }
    const childRelative = relative
      ? `${relative}/${entry.name}`
      : entry.name;
    const child = await hashArtifact(path.join(target, entry.name), childRelative);
    digest.update(`${childRelative}\0${child.hash}\0${child.bytes}\0`);
    bytes += child.bytes;
  }
  return { hash: digest.digest("hex"), bytes };
}

function assertTopLevelArtifact(sessionPath, artifactPath) {
  const resolved = path.resolve(artifactPath);
  if (!isInside(sessionPath, resolved)) {
    throw new Error("Artifact must stay inside its temporary session.");
  }
  const relativePath = path.relative(sessionPath, resolved);
  if (
    relativePath === MANIFEST_NAME ||
    path.dirname(relativePath) !== "."
  ) {
    throw new Error(
      "Register each artifact as one top-level file or directory in the session.",
    );
  }
  return { resolved, relativePath };
}

export async function createSession({
  taskId,
  root = DEFAULT_ROOT,
  ttlMs = DEFAULT_TTL_MS,
  now = Date.now(),
}) {
  if (typeof taskId !== "string" || taskId.trim() === "") {
    throw new TypeError("taskId must be a non-empty task-local identifier.");
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) {
    throw new RangeError("ttlMs must be greater than zero and at most seven days.");
  }
  const rootPath = await assertSafeRoot(root);
  const sessionPath = await mkdtemp(path.join(rootPath, "vd-"));
  const sessionId = path.basename(sessionPath);
  const manifest = {
    schemaVersion: 1,
    owner: OWNER,
    sessionId,
    taskFingerprint: hashText(taskId),
    state: "open",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    ttlMs,
    selection: null,
    artifacts: [],
    cleanup: {
      attempts: 0,
      pendingPaths: [],
      lastErrorCode: null,
    },
  };
  await writeJsonAtomic(manifestPath(sessionPath), manifest);
  return {
    sessionPath,
    sessionId,
    taskFingerprint: manifest.taskFingerprint,
    expiresAt: manifest.expiresAt,
    lifecycle: "ephemeral-only",
  };
}

export async function recordArtifact({
  sessionPath,
  artifactPath,
  kind,
  root = DEFAULT_ROOT,
}) {
  if (!ARTIFACT_KINDS.has(kind)) {
    throw new RangeError(
      `kind must be one of: ${[...ARTIFACT_KINDS].join(", ")}.`,
    );
  }
  const owned = await readOwnedManifest(sessionPath, root);
  if (!["open", "selected"].includes(owned.manifest.state)) {
    throw new Error(`Cannot record an artifact in ${owned.manifest.state} state.`);
  }
  if (owned.manifest.state === "selected" && kind !== "review-capture") {
    throw new Error(
      "After selection, only implementation review captures may be registered.",
    );
  }
  const artifact = assertTopLevelArtifact(
    owned.sessionPath,
    artifactPath,
  );
  const content = await hashArtifact(artifact.resolved);
  const existing = owned.manifest.artifacts.find(
    (entry) => entry.relativePath === artifact.relativePath,
  );
  const recordedAt = new Date().toISOString();
  const entry = {
    handle:
      (existing?.hash === content.hash ? existing.handle : undefined) ??
      `artifact-${content.hash.slice(0, 12)}-${randomUUID().slice(0, 8)}`,
    kind,
    relativePath: artifact.relativePath,
    hash: content.hash,
    bytes: content.bytes,
    recordedAt,
  };
  if (kind === "review-capture") {
    entry.captureReceipt = captureReceipt(owned.manifest, entry);
  }
  owned.manifest.artifacts = [
    ...owned.manifest.artifacts.filter(
      (item) => item.relativePath !== artifact.relativePath,
    ),
    entry,
  ];
  if (owned.manifest.state === "selected") {
    owned.manifest.expiresAt = new Date(
      Date.now() + owned.manifest.ttlMs,
    ).toISOString();
  }
  await writeJsonAtomic(manifestPath(owned.sessionPath), owned.manifest);
  return {
    handle: entry.handle,
    kind: entry.kind,
    hash: entry.hash,
    bytes: entry.bytes,
    ...(entry.captureReceipt ? { receipt: entry.captureReceipt } : {}),
    lifecycle: "task-temporary",
  };
}

async function purgeForSelection(
  owned,
  keptRelativePaths,
  remove = rm,
) {
  const kept = new Set(keptRelativePaths.filter(Boolean));
  const entries = await readdir(owned.sessionPath, { withFileTypes: true });
  const failures = [];
  for (const entry of entries) {
    if (
      entry.name === MANIFEST_NAME ||
      kept.has(entry.name)
    ) {
      continue;
    }
    try {
      await remove(path.join(owned.sessionPath, entry.name), {
        recursive: true,
        force: true,
      });
    } catch (error) {
      failures.push({
        relativePath: entry.name,
        errorCode: errorCode(error),
      });
    }
  }
  return failures;
}

export async function selectDirection({
  sessionPath,
  direction,
  selectedArtifactHandle,
  root = DEFAULT_ROOT,
  remove = rm,
}) {
  if (!direction || typeof direction !== "object" || Array.isArray(direction)) {
    throw new TypeError("direction must be a compact DesignContract object.");
  }
  const owned = await readOwnedManifest(sessionPath, root);
  if (owned.manifest.state !== "open") {
    throw new Error("Direction selection requires an open session.");
  }

  const selectedArtifact = selectedArtifactHandle
    ? owned.manifest.artifacts.find(
        (artifact) => artifact.handle === selectedArtifactHandle,
      )
    : undefined;
  if (selectedArtifactHandle && !selectedArtifact) {
    throw new Error("Selected artifact handle is not registered in this session.");
  }
  if (selectedArtifact && !SELECTABLE_KINDS.has(selectedArtifact.kind)) {
    throw new Error(
      "Contact sheets and review captures cannot be retained as the selected direction.",
    );
  }

  const directionHash = hashText(stableStringify(direction));
  const expiresAt = new Date(Date.now() + owned.manifest.ttlMs).toISOString();
  const pendingSelection = {
    directionHash,
    contractHandle: `visual:${owned.manifest.sessionId}:${directionHash.slice(0, 16)}`,
    contractFile: CONTRACT_NAME,
    selectedArtifactHandle: selectedArtifact?.handle ?? null,
    selectedArtifactHash: selectedArtifact?.hash ?? null,
    selectedAt: new Date().toISOString(),
    expiresAt,
  };
  pendingSelection.selectionReceipt = selectionReceipt(
    owned.manifest,
    pendingSelection,
  );
  const contractBytes = Buffer.byteLength(JSON.stringify(direction), "utf8");
  if (contractBytes > MAX_CONTRACT_BYTES) {
    throw new Error("Selected DesignContract exceeds its 8 KB task budget.");
  }
  await writeJsonAtomic(path.join(owned.sessionPath, CONTRACT_NAME), direction);
  const failures = await purgeForSelection(
    owned,
    [selectedArtifact?.relativePath, CONTRACT_NAME],
    remove,
  );
  owned.manifest.cleanup.attempts += 1;
  if (failures.length > 0) {
    owned.manifest.state = "cleanup-pending";
    owned.manifest.cleanup.pendingPaths = failures.map(
      (failure) => failure.relativePath,
    );
    owned.manifest.cleanup.lastErrorCode = failures[0].errorCode;
    owned.manifest.cleanup.targetState = "selected";
    owned.manifest.pendingSelection = pendingSelection;
    await writeJsonAtomic(manifestPath(owned.sessionPath), owned.manifest);
    const receipt = {
      state: "cleanup-pending",
      sessionId: owned.manifest.sessionId,
      attempts: owned.manifest.cleanup.attempts,
      pendingPaths: owned.manifest.cleanup.pendingPaths,
      lastErrorCode: owned.manifest.cleanup.lastErrorCode,
    };
    throw new CleanupPendingError(
      "Unselected artifact cleanup is pending; retry before implementation.",
      receipt,
    );
  }

  owned.manifest.state = "selected";
  owned.manifest.selection = pendingSelection;
  owned.manifest.expiresAt = expiresAt;
  owned.manifest.artifacts = selectedArtifact ? [selectedArtifact] : [];
  owned.manifest.cleanup.pendingPaths = [];
  owned.manifest.cleanup.lastErrorCode = null;
  delete owned.manifest.cleanup.targetState;
  delete owned.manifest.pendingSelection;
  await writeJsonAtomic(manifestPath(owned.sessionPath), owned.manifest);

  return {
    state: "selected",
    directionHash,
    contractHandle: pendingSelection.contractHandle,
    selectionReceipt: pendingSelection.selectionReceipt,
    selectedHandle: selectedArtifact?.handle ?? null,
    selectedHash: selectedArtifact?.hash ?? null,
    expiresAt: owned.manifest.expiresAt,
    lifecycle: selectedArtifact
      ? "selected-until-review-close"
      : "receipt-only",
  };
}

async function readCleanupReceipt(rootPath, sessionId) {
  const receiptPath = cleanupReceiptPath(rootPath, sessionId);
  const receiptStat = await lstat(receiptPath);
  if (!receiptStat.isFile() || receiptStat.isSymbolicLink()) {
    throw new Error("Cleanup receipt must be a real file.");
  }
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  if (receipt.owner !== OWNER || receipt.sessionId !== sessionId) {
    throw new Error("Cleanup receipt ownership check failed.");
  }
  return { receiptPath, receipt };
}

export async function cleanupSession({
  sessionPath,
  root = DEFAULT_ROOT,
  reason = "close",
  remove = rm,
}) {
  if (!["close", "cancel", "expired"].includes(reason)) {
    throw new RangeError("reason must be close, cancel, or expired.");
  }
  const owned = await readOwnedManifest(sessionPath, root);
  const receiptPath = cleanupReceiptPath(
    owned.rootPath,
    owned.manifest.sessionId,
  );
  let receipt = {
    schemaVersion: 1,
    owner: OWNER,
    state: "cleanup-pending",
    sessionId: owned.manifest.sessionId,
    taskFingerprint: owned.manifest.taskFingerprint,
    reason,
    attempts: 1,
    lastErrorCode: null,
    expiresAt: owned.manifest.expiresAt,
  };
  await writeJsonAtomic(receiptPath, receipt);

  try {
    await remove(owned.sessionPath, { recursive: true, force: true });
    await rm(receiptPath, { force: true });
    const cleanedAt = new Date().toISOString();
    return {
      state: "clean",
      sessionId: owned.manifest.sessionId,
      reason,
      cleanedAt,
      receipt: cleanReceipt({
        taskFingerprint: owned.manifest.taskFingerprint,
        sessionId: owned.manifest.sessionId,
        reason,
        cleanedAt,
      }),
    };
  } catch (error) {
    receipt = {
      ...receipt,
      lastErrorCode: errorCode(error),
    };
    await writeJsonAtomic(receiptPath, receipt);
    throw new CleanupPendingError(
      "Temporary artifact cleanup is pending and can be retried safely.",
      {
        state: "cleanup-pending",
        sessionId: receipt.sessionId,
        reason,
        attempts: receipt.attempts,
        lastErrorCode: receipt.lastErrorCode,
      },
    );
  }
}

export async function retryCleanup({
  sessionId,
  root = DEFAULT_ROOT,
  remove = rm,
}) {
  if (
    typeof sessionId !== "string" ||
    !/^vd-[A-Za-z0-9_-]+$/.test(sessionId)
  ) {
    throw new Error("Invalid temporary session ID.");
  }
  const rootPath = await assertSafeRoot(root, { create: false });
  const owned = await readCleanupReceipt(rootPath, sessionId);
  const sessionPath = path.join(rootPath, sessionId);
  if (await pathExists(sessionPath)) {
    const sessionStat = await lstat(sessionPath);
    if (!sessionStat.isDirectory() || sessionStat.isSymbolicLink()) {
      throw new Error("Cleanup target must be a real session directory.");
    }
    const realSession = await realpath(sessionPath);
    if (path.dirname(realSession) !== path.resolve(rootPath)) {
      throw new Error("Cleanup target resolves outside the owned temp root.");
    }
  }
  const nextReceipt = {
    ...owned.receipt,
    attempts: owned.receipt.attempts + 1,
  };
  try {
    await remove(sessionPath, { recursive: true, force: true });
    await rm(owned.receiptPath, { force: true });
    const cleanedAt = new Date().toISOString();
    return {
      state: "clean",
      sessionId,
      reason: owned.receipt.reason,
      attempts: nextReceipt.attempts,
      cleanedAt,
      receipt: cleanReceipt({
        taskFingerprint: owned.receipt.taskFingerprint,
        sessionId,
        reason: owned.receipt.reason,
        cleanedAt,
      }),
    };
  } catch (error) {
    nextReceipt.lastErrorCode = errorCode(error);
    await writeJsonAtomic(owned.receiptPath, nextReceipt);
    throw new CleanupPendingError(
      "Temporary artifact cleanup retry is still pending.",
      {
        state: "cleanup-pending",
        sessionId,
        reason: nextReceipt.reason,
        attempts: nextReceipt.attempts,
        lastErrorCode: nextReceipt.lastErrorCode,
      },
    );
  }
}

export async function retrySelectionCleanup({
  sessionPath,
  root = DEFAULT_ROOT,
  remove = rm,
}) {
  const owned = await readOwnedManifest(sessionPath, root);
  if (
    owned.manifest.state !== "cleanup-pending" ||
    owned.manifest.cleanup.targetState !== "selected"
  ) {
    throw new Error("Session has no pending selection cleanup.");
  }
  const selectedArtifact = owned.manifest.selection?.selectedArtifactHandle
    ? owned.manifest.artifacts.find(
        (artifact) =>
          artifact.handle === owned.manifest.selection.selectedArtifactHandle,
      )
    : owned.manifest.pendingSelection?.selectedArtifactHandle
    ? owned.manifest.artifacts.find(
        (artifact) =>
          artifact.handle === owned.manifest.pendingSelection.selectedArtifactHandle,
      )
    : undefined;
  const failures = await purgeForSelection(
    owned,
    [selectedArtifact?.relativePath, CONTRACT_NAME],
    remove,
  );
  owned.manifest.cleanup.attempts += 1;
  if (failures.length > 0) {
    owned.manifest.cleanup.pendingPaths = failures.map(
      (failure) => failure.relativePath,
    );
    owned.manifest.cleanup.lastErrorCode = failures[0].errorCode;
    await writeJsonAtomic(manifestPath(owned.sessionPath), owned.manifest);
    throw new CleanupPendingError("Selection cleanup retry is still pending.", {
      state: "cleanup-pending",
      sessionId: owned.manifest.sessionId,
      attempts: owned.manifest.cleanup.attempts,
      pendingPaths: owned.manifest.cleanup.pendingPaths,
      lastErrorCode: owned.manifest.cleanup.lastErrorCode,
    });
  }
  const pendingSelection = owned.manifest.pendingSelection;
  if (!pendingSelection) {
    throw new Error("Pending selection receipt is missing.");
  }
  owned.manifest.state = "selected";
  owned.manifest.selection = pendingSelection;
  owned.manifest.expiresAt = pendingSelection.expiresAt;
  owned.manifest.artifacts = selectedArtifact ? [selectedArtifact] : [];
  owned.manifest.cleanup.pendingPaths = [];
  owned.manifest.cleanup.lastErrorCode = null;
  delete owned.manifest.cleanup.targetState;
  delete owned.manifest.pendingSelection;
  await writeJsonAtomic(manifestPath(owned.sessionPath), owned.manifest);
  return {
    state: "selected",
    directionHash: pendingSelection.directionHash,
    contractHandle: pendingSelection.contractHandle,
    selectionReceipt: pendingSelection.selectionReceipt,
    selectedHandle: selectedArtifact?.handle ?? null,
    selectedHash: selectedArtifact?.hash ?? null,
    expiresAt: owned.manifest.expiresAt,
    lifecycle: selectedArtifact
      ? "selected-until-review-close"
      : "receipt-only",
  };
}

export async function readSelectedContract({
  contractHandle,
  root = DEFAULT_ROOT,
}) {
  const match =
    /^visual:(vd-[A-Za-z0-9_-]+):([a-f0-9]{16})$/u.exec(contractHandle);
  if (!match) throw new Error("Invalid visual DesignContract handle.");
  const [, sessionId, hashPrefix] = match;
  const rootPath = await assertSafeRoot(root, { create: false });
  const owned = await readOwnedManifest(
    path.join(rootPath, sessionId),
    rootPath,
  );
  if (
    owned.manifest.state !== "selected" ||
    owned.manifest.selection?.contractHandle !== contractHandle ||
    !owned.manifest.selection.directionHash.startsWith(hashPrefix)
  ) {
    throw new Error("Visual DesignContract handle is stale or not selected.");
  }
  const contract = JSON.parse(
    await readFile(path.join(owned.sessionPath, CONTRACT_NAME), "utf8"),
  );
  const directionHash = hashText(stableStringify(contract));
  if (directionHash !== owned.manifest.selection.directionHash) {
    throw new Error("Visual DesignContract hash does not match its receipt.");
  }
  return {
    contractHandle,
    directionHash,
    selectionReceipt: owned.manifest.selection.selectionReceipt,
    expiresAt: owned.manifest.expiresAt,
    contract,
  };
}

export async function sweepExpired({
  root = DEFAULT_ROOT,
  now = Date.now(),
  remove = rm,
}) {
  const rootPath = await assertSafeRoot(root, { create: false });
  if (!(await pathExists(rootPath))) {
    return { cleaned: [], pending: [], ignored: [], diagnostics: [] };
  }
  const entries = await readdir(rootPath, { withFileTypes: true });
  const result = { cleaned: [], pending: [], ignored: [], diagnostics: [] };

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("vd-")) continue;
    const sessionPath = path.join(rootPath, entry.name);
    try {
      const owned = await readOwnedManifest(sessionPath, rootPath);
      if (Date.parse(owned.manifest.expiresAt) > now) continue;
      await cleanupSession({
        sessionPath,
        root: rootPath,
        reason: "expired",
        remove,
      });
      result.cleaned.push(entry.name);
    } catch (error) {
      if (error instanceof CleanupPendingError) {
        result.pending.push(error.receipt);
      } else {
        result.ignored.push(entry.name);
        if (error instanceof CorruptManifestError) {
          result.diagnostics.push(error.diagnostic);
        }
      }
    }
  }

  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.startsWith(CLEANUP_PREFIX) ||
      !entry.name.endsWith(".json")
    ) {
      continue;
    }
    const sessionId = entry.name.slice(
      CLEANUP_PREFIX.length,
      -".json".length,
    );
    if (!(await pathExists(path.join(rootPath, entry.name)))) continue;
    try {
      const cleaned = await retryCleanup({
        sessionId,
        root: rootPath,
        remove,
      });
      result.cleaned.push(cleaned.sessionId);
    } catch (error) {
      if (error instanceof CleanupPendingError) {
        result.pending.push(error.receipt);
      } else {
        result.ignored.push(entry.name);
      }
    }
  }

  result.cleaned = [...new Set(result.cleaned)];
  return result;
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${key} requires a value.`);
    }
    options[key.slice(2)] = value;
    index += 1;
  }
  return { command, options };
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  const root = options.root ? path.resolve(options.root) : DEFAULT_ROOT;
  let result;

  if (command === "init") {
    result = await createSession({
      taskId: options.task,
      root,
      ttlMs: options["ttl-hours"]
        ? Number(options["ttl-hours"]) * 60 * 60 * 1_000
        : DEFAULT_TTL_MS,
    });
  } else if (command === "record") {
    result = await recordArtifact({
      sessionPath: options.session,
      artifactPath: options.artifact,
      kind: options.kind,
      root,
    });
  } else if (command === "select") {
    if (!options["direction-file"]) {
      throw new Error("select requires --direction-file.");
    }
    const directionPath = path.resolve(options["direction-file"]);
    assertTopLevelArtifact(path.resolve(options.session), directionPath);
    const direction = JSON.parse(await readFile(directionPath, "utf8"));
    result = await selectDirection({
      sessionPath: options.session,
      direction,
      selectedArtifactHandle: options["artifact-handle"],
      root,
    });
  } else if (command === "close" || command === "cancel") {
    result = await cleanupSession({
      sessionPath: options.session,
      root,
      reason: command,
    });
  } else if (command === "retry") {
    result = options.session
      ? await retrySelectionCleanup({
          sessionPath: options.session,
          root,
        })
      : await retryCleanup({
          sessionId: options["session-id"],
          root,
        });
  } else if (command === "expand") {
    result = await readSelectedContract({
      contractHandle: options["contract-handle"],
      root,
    });
  } else if (command === "sweep") {
    result = await sweepExpired({ root });
  } else {
    throw new Error(
      "Command must be init, record, select, expand, close, cancel, retry, or sweep.",
    );
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error) => {
    const output =
      error instanceof CleanupPendingError
        ? error.receipt
        : error instanceof CorruptManifestError
          ? error.diagnostic
        : { state: "error", message: error instanceof Error ? error.message : String(error) };
    process.stderr.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exitCode = error instanceof CleanupPendingError ? 2 : 1;
  });
}
