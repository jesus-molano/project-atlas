import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { projectStorageDirectory } from "@component-atlas/store";
import { resolveProjectIdentity } from "./identity.js";
import { writeImmutableArtifact } from "./immutable-artifact.js";
import { sameWorkspaceRoot } from "./task-state-paths.js";

export const TASK_OBJECTIVE_ARTIFACT_SCHEMA_VERSION = 1 as const;
export const MAX_TASK_OBJECTIVE_CHARS = 6_000;
export const TASK_OBJECTIVE_HANDLE_PATTERN =
  /^objective:([A-Za-z0-9_.:-]{1,160}):([a-f0-9]{64})$/u;

const TASK_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const PROJECT_ID_PATTERN = /^[a-f0-9]{20}$/u;
const REPOSITORY_FINGERPRINT_PATTERN = /^[a-f0-9]{16}$/u;
const CHECKOUT_ID_PATTERN = /^[a-f0-9]{20}$/u;

export interface TaskObjectiveReference {
  schemaVersion: typeof TASK_OBJECTIVE_ARTIFACT_SCHEMA_VERSION;
  handle: string;
  hash: string;
}

export interface TaskObjectiveProjection {
  text: string;
  approved: boolean;
  authority: "authoritative" | "legacy-projection";
  reference?: TaskObjectiveReference;
}

export interface TaskObjectiveArtifact {
  schemaVersion: typeof TASK_OBJECTIVE_ARTIFACT_SCHEMA_VERSION;
  handle: string;
  taskId: string;
  projectId: string;
  repositoryFingerprint: string;
  checkoutId: string;
  workspaceRoot: string;
  objectiveHash: string;
  text: string;
}

export interface PersistTaskObjectiveInput {
  taskId: string;
  objective: string;
}

export interface ResolvedTaskObjective {
  taskId: string;
  text: string;
  approved: boolean;
  authority: TaskObjectiveProjection["authority"];
  projectionText: string;
  reference?: TaskObjectiveReference;
}

interface TaskObjectiveIntegrityPayload {
  schemaVersion: typeof TASK_OBJECTIVE_ARTIFACT_SCHEMA_VERSION;
  taskId: string;
  projectId: string;
  repositoryFingerprint: string;
  checkoutId: string;
  workspaceRoot: string;
  objectiveHash: string;
  text: string;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Keeps all meaningful objective bytes while discarding transport padding. */
export function normalizeTaskObjective(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("Task objective must not be empty.");
  if (normalized.length > MAX_TASK_OBJECTIVE_CHARS) {
    throw new Error(
      `Task objective exceeds the ${MAX_TASK_OBJECTIVE_CHARS}-character contract.`,
    );
  }
  return normalized;
}

export function computeTaskObjectiveHash(value: string): string {
  return digest(normalizeTaskObjective(value));
}

function compactObjectiveText(value: string, maximum: number): string {
  return value
    .trim()
    .replace(/[\u0000-\u001f]+/gu, " ")
    .slice(0, maximum);
}

function integrityPayload(
  artifact: TaskObjectiveArtifact | TaskObjectiveIntegrityPayload,
): TaskObjectiveIntegrityPayload {
  return {
    schemaVersion: TASK_OBJECTIVE_ARTIFACT_SCHEMA_VERSION,
    taskId: artifact.taskId,
    projectId: artifact.projectId,
    repositoryFingerprint: artifact.repositoryFingerprint,
    checkoutId: artifact.checkoutId,
    workspaceRoot: artifact.workspaceRoot,
    objectiveHash: artifact.objectiveHash,
    text: artifact.text,
  };
}

export function computeTaskObjectiveIntegrity(
  artifact: TaskObjectiveArtifact | TaskObjectiveIntegrityPayload,
): string {
  return digest(JSON.stringify(integrityPayload(artifact)));
}

function parseTaskObjectiveHandle(handle: string): {
  taskId: string;
  integrityHash: string;
} {
  const match = TASK_OBJECTIVE_HANDLE_PATTERN.exec(handle);
  if (!match || !TASK_ID_PATTERN.test(match[1]!)) {
    throw new Error("Task objective handle is invalid.");
  }
  return { taskId: match[1]!, integrityHash: match[2]! };
}

export function validateTaskObjectiveReference(
  value: unknown,
  expectedTaskId?: string,
): TaskObjectiveReference {
  const reference = value as TaskObjectiveReference;
  if (
    !reference ||
    typeof reference !== "object" ||
    reference.schemaVersion !== TASK_OBJECTIVE_ARTIFACT_SCHEMA_VERSION ||
    typeof reference.handle !== "string" ||
    !DIGEST_PATTERN.test(reference.hash)
  ) {
    throw new Error("Task objective reference is invalid.");
  }
  const parsed = parseTaskObjectiveHandle(reference.handle);
  if (expectedTaskId !== undefined && parsed.taskId !== expectedTaskId) {
    throw new Error("Task objective reference belongs to a different task.");
  }
  return {
    schemaVersion: TASK_OBJECTIVE_ARTIFACT_SCHEMA_VERSION,
    handle: reference.handle,
    hash: reference.hash,
  };
}

export function isTaskObjectiveProjection(
  value: unknown,
  expectedTaskId?: string,
): value is TaskObjectiveProjection {
  const projection = value as TaskObjectiveProjection;
  if (
    !projection ||
    typeof projection !== "object" ||
    typeof projection.text !== "string" ||
    !projection.text.trim() ||
    typeof projection.approved !== "boolean" ||
    !["authoritative", "legacy-projection"].includes(projection.authority)
  ) {
    return false;
  }
  if (projection.authority === "legacy-projection") {
    return projection.reference === undefined;
  }
  try {
    return Boolean(
      projection.reference &&
        validateTaskObjectiveReference(projection.reference, expectedTaskId),
    );
  } catch {
    return false;
  }
}

async function objectiveDirectory(rootPath: string): Promise<string> {
  const identity = await resolveProjectIdentity(rootPath);
  return path.join(
    projectStorageDirectory(identity.logicalId),
    "task-state",
    "objectives",
  );
}

export async function taskObjectiveArtifactPath(
  rootPath: string,
  referenceOrHandle: TaskObjectiveReference | string,
): Promise<string> {
  const handle =
    typeof referenceOrHandle === "string"
      ? referenceOrHandle
      : validateTaskObjectiveReference(referenceOrHandle).handle;
  const { integrityHash } = parseTaskObjectiveHandle(handle);
  return path.join(await objectiveDirectory(rootPath), `${integrityHash}.json`);
}

function assertArtifactShape(value: unknown): TaskObjectiveArtifact {
  const artifact = value as TaskObjectiveArtifact;
  if (
    !artifact ||
    typeof artifact !== "object" ||
    artifact.schemaVersion !== TASK_OBJECTIVE_ARTIFACT_SCHEMA_VERSION ||
    typeof artifact.handle !== "string" ||
    !TASK_ID_PATTERN.test(artifact.taskId) ||
    !PROJECT_ID_PATTERN.test(artifact.projectId) ||
    !REPOSITORY_FINGERPRINT_PATTERN.test(artifact.repositoryFingerprint) ||
    !CHECKOUT_ID_PATTERN.test(artifact.checkoutId) ||
    typeof artifact.workspaceRoot !== "string" ||
    !path.isAbsolute(artifact.workspaceRoot) ||
    !DIGEST_PATTERN.test(artifact.objectiveHash) ||
    typeof artifact.text !== "string"
  ) {
    throw new Error("Task objective artifact is invalid.");
  }
  const text = normalizeTaskObjective(artifact.text);
  if (text !== artifact.text || computeTaskObjectiveHash(text) !== artifact.objectiveHash) {
    throw new Error("Task objective artifact content hash is invalid.");
  }
  const parsed = parseTaskObjectiveHandle(artifact.handle);
  if (
    parsed.taskId !== artifact.taskId ||
    parsed.integrityHash !== computeTaskObjectiveIntegrity(artifact)
  ) {
    throw new Error("Task objective artifact integrity is invalid.");
  }
  return artifact;
}

async function assertArtifactCheckout(
  rootPath: string,
  artifact: TaskObjectiveArtifact,
  expectedTaskId?: string,
): Promise<void> {
  const identity = await resolveProjectIdentity(rootPath);
  if (expectedTaskId !== undefined && artifact.taskId !== expectedTaskId) {
    throw new Error("Task objective artifact belongs to a different task.");
  }
  if (
    artifact.projectId !== identity.logicalId ||
    artifact.repositoryFingerprint !== identity.repositoryFingerprint ||
    artifact.checkoutId !== identity.checkoutId ||
    !sameWorkspaceRoot(artifact.workspaceRoot, identity.worktreePath)
  ) {
    throw new Error(
      "Task objective artifact belongs to a different repository checkout.",
    );
  }
}

export async function persistTaskObjective(
  rootPath: string,
  input: PersistTaskObjectiveInput,
): Promise<TaskObjectiveArtifact> {
  if (!TASK_ID_PATTERN.test(input.taskId)) {
    throw new Error("Task objective task ID is invalid.");
  }
  const text = normalizeTaskObjective(input.objective);
  const identity = await resolveProjectIdentity(rootPath);
  if (!identity.checkoutId) {
    throw new Error("Task objective requires a resolved checkout identity.");
  }
  const payload: TaskObjectiveIntegrityPayload = {
    schemaVersion: TASK_OBJECTIVE_ARTIFACT_SCHEMA_VERSION,
    taskId: input.taskId,
    projectId: identity.logicalId,
    repositoryFingerprint: identity.repositoryFingerprint,
    checkoutId: identity.checkoutId,
    workspaceRoot: identity.worktreePath,
    objectiveHash: computeTaskObjectiveHash(text),
    text,
  };
  const integrityHash = computeTaskObjectiveIntegrity(payload);
  const artifact: TaskObjectiveArtifact = {
    ...payload,
    handle: `objective:${input.taskId}:${integrityHash}`,
  };
  const directory = await objectiveDirectory(rootPath);
  await mkdir(directory, { recursive: true });
  await writeImmutableArtifact(
    path.join(directory, `${integrityHash}.json`),
    `${JSON.stringify(artifact, null, 2)}\n`,
    "Task objective artifact hash collision detected.",
  );
  return artifact;
}

export function taskObjectiveReference(
  artifact: TaskObjectiveArtifact,
): TaskObjectiveReference {
  const validated = assertArtifactShape(artifact);
  return {
    schemaVersion: TASK_OBJECTIVE_ARTIFACT_SCHEMA_VERSION,
    handle: validated.handle,
    hash: validated.objectiveHash,
  };
}

export async function loadTaskObjectiveArtifact(
  rootPath: string,
  referenceOrHandle: TaskObjectiveReference | string,
  expectedTaskId?: string,
): Promise<TaskObjectiveArtifact> {
  const reference =
    typeof referenceOrHandle === "string"
      ? undefined
      : validateTaskObjectiveReference(referenceOrHandle, expectedTaskId);
  const handle =
    typeof referenceOrHandle === "string"
      ? referenceOrHandle
      : referenceOrHandle.handle;
  const parsed = parseTaskObjectiveHandle(handle);
  if (expectedTaskId !== undefined && parsed.taskId !== expectedTaskId) {
    throw new Error("Task objective handle belongs to a different task.");
  }
  let serialized: string;
  try {
    serialized = await readFile(
      await taskObjectiveArtifactPath(rootPath, handle),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Task objective artifact is missing.", { cause: error });
    }
    throw error;
  }
  const artifact = assertArtifactShape(JSON.parse(serialized));
  if (
    artifact.handle !== handle ||
    parsed.integrityHash !== computeTaskObjectiveIntegrity(artifact) ||
    (reference && artifact.objectiveHash !== reference.hash)
  ) {
    throw new Error("Task objective artifact does not match its reference.");
  }
  await assertArtifactCheckout(rootPath, artifact, expectedTaskId);
  return artifact;
}

export async function resolveTaskObjectiveProjection(
  rootPath: string,
  taskId: string,
  projection: TaskObjectiveProjection,
): Promise<ResolvedTaskObjective> {
  if (!isTaskObjectiveProjection(projection, taskId)) {
    throw new Error("Task objective projection is invalid.");
  }
  if (projection.authority === "legacy-projection") {
    return {
      taskId,
      text: projection.text,
      approved: projection.approved,
      authority: "legacy-projection",
      projectionText: projection.text,
    };
  }
  const artifact = await loadTaskObjectiveArtifact(
    rootPath,
    projection.reference!,
    taskId,
  );
  const validProjection = [480, 320, 240, 200, 160, 120, 80, 32].some(
    (maximum) => compactObjectiveText(artifact.text, maximum) === projection.text,
  );
  if (!validProjection) {
    throw new Error(
      "Task objective capsule projection does not match its authoritative artifact.",
    );
  }
  return {
    taskId,
    text: artifact.text,
    approved: projection.approved,
    authority: "authoritative",
    projectionText: projection.text,
    reference: taskObjectiveReference(artifact),
  };
}
