import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { fitBudgetedResponse } from "@component-atlas/memory";
import { projectStorageDirectory } from "@component-atlas/store";
import { canonicalJson } from "./change-surface-fingerprint.js";
import { resolveProjectIdentity } from "./identity.js";
import { writeImmutableArtifact } from "./immutable-artifact.js";
import { computeTaskObjectiveHash } from "./task-objective.js";
import {
  EXPANDABLE_HANDLE_PATTERN,
  RECEIPT_ID_PATTERN,
  TASK_ID_PATTERN,
} from "./task-state-contract.js";
import { taskStateFileName } from "./task-state-paths.js";

export const TASK_EVIDENCE_CONTRACT_SCHEMA_VERSION = 1 as const;
export const TASK_CONTINUATION_BUNDLE_SCHEMA_VERSION = 1 as const;
export const MAX_TASK_EVIDENCE_CONTRACT_BYTES = 24 * 1_024;
export const MAX_TASK_CONTINUATION_BUNDLE_BYTES = 12 * 1_024;

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_LEDGER_HASH_PATTERN = /^[a-f0-9]{16,64}$/u;
const MAX_TASK_ARTIFACT_FILES = 512;
export const TASK_EVIDENCE_CONTRACT_HANDLE_PATTERN =
  /^contract:([A-Za-z0-9_.:-]{1,160}):([a-f0-9]{16})$/u;
export const TASK_CONTINUATION_HANDLE_PATTERN =
  /^continuation:([A-Za-z0-9_.:-]{1,160}):([a-f0-9]{16})$/u;

export type TaskEvidenceDecisionStatus = "open" | "resolved" | "deferred";
export type TaskCriterionStatus =
  | "pending"
  | "satisfied"
  | "blocked"
  | "deferred";

export interface TaskEvidenceCriterion {
  id: string;
  statement: string;
  required: boolean;
  sourceRefs: string[];
}

export interface TaskEvidenceDecision {
  id: string;
  question: string;
  status: TaskEvidenceDecisionStatus;
  answer?: string;
  sourceRefs: string[];
}

export interface TaskEvidenceContract {
  schemaVersion: typeof TASK_EVIDENCE_CONTRACT_SCHEMA_VERSION;
  handle: string;
  hash: string;
  taskId: string;
  revision: number;
  objective: string;
  objectiveHash: string;
  sourceLedgerHash: string;
  criteria: TaskEvidenceCriterion[];
  decisions: TaskEvidenceDecision[];
  constraints: string[];
  exclusions: string[];
  sourceReceiptIds: string[];
  contextHandles: string[];
  previousHandle?: string;
  createdAt: string;
}

export interface PersistTaskEvidenceContractInput {
  taskId: string;
  objective: string;
  objectiveHash: string;
  sourceLedgerHash: string;
  criteria: TaskEvidenceCriterion[];
  decisions?: TaskEvidenceDecision[];
  constraints?: string[];
  exclusions?: string[];
  sourceReceiptIds?: string[];
  contextHandles?: string[];
  previousHandle?: string;
  createdAt?: string;
}

export interface TaskCriterionProgress {
  criterionId: string;
  status: TaskCriterionStatus;
  evidenceRefs: string[];
  validationRefs: string[];
  note?: string;
}

export interface TaskContinuationBundle {
  schemaVersion: typeof TASK_CONTINUATION_BUNDLE_SCHEMA_VERSION;
  handle: string;
  hash: string;
  taskId: string;
  revision: number;
  contract: {
    handle: string;
    hash: string;
    revision: number;
  };
  criteria: TaskCriterionProgress[];
  covered: string[];
  remaining: string[];
  nextSafeAction: string;
  validationRefs: string[];
  visualHandles: string[];
  changeSurfaceLockId?: string;
  previousHandle?: string;
  createdAt: string;
}

export interface PersistTaskContinuationBundleInput {
  taskId: string;
  contractHandle: string;
  criteria: TaskCriterionProgress[];
  covered?: string[];
  remaining?: string[];
  nextSafeAction: string;
  validationRefs?: string[];
  visualHandles?: string[];
  changeSurfaceLockId?: string;
  previousHandle?: string;
  createdAt?: string;
}

export interface TaskAcceptanceState {
  ready: boolean;
  required: number;
  satisfied: number;
  pending: string[];
  blocked: string[];
  deferred: string[];
}

interface LatestArtifactPointer {
  schemaVersion: 1;
  taskId: string;
  handle: string;
  hash: string;
  revision: number;
  updatedAt: string;
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function normalizedText(value: string, maximum: number, label: string): string {
  const normalized = value.trim().replace(/[\u0000-\u001f]+/gu, " ");
  if (!normalized || normalized.length > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function normalizedList(
  values: string[],
  maximumItems: number,
  maximumChars: number,
  label: string,
): string[] {
  if (!Array.isArray(values) || values.length > maximumItems) {
    throw new Error(`${label} is invalid.`);
  }
  return [
    ...new Set(values.map((value) => normalizedText(value, maximumChars, label))),
  ];
}

function normalizedReferences(
  values: string[],
  maximumItems: number,
  label: string,
): string[] {
  return normalizedList(values, maximumItems, 320, label);
}

function checkedTimestamp(value: string, label: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid.`);
  return value;
}

function checkedRevision(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 10_000) {
    throw new Error("Task artifact revision is invalid.");
  }
  return value;
}

function contractIntegrityPayload(
  contract: Omit<TaskEvidenceContract, "handle" | "hash" | "createdAt">,
): Omit<TaskEvidenceContract, "handle" | "hash" | "createdAt"> {
  return contract;
}

function continuationIntegrityPayload(
  bundle: Omit<TaskContinuationBundle, "handle" | "hash" | "createdAt">,
): Omit<TaskContinuationBundle, "handle" | "hash" | "createdAt"> {
  return bundle;
}

function parseContractHandle(handle: string): { taskId: string; prefix: string } {
  const match = TASK_EVIDENCE_CONTRACT_HANDLE_PATTERN.exec(handle);
  if (!match) throw new Error("Task evidence contract handle is invalid.");
  return { taskId: match[1]!, prefix: match[2]! };
}

function parseContinuationHandle(handle: string): {
  taskId: string;
  prefix: string;
} {
  const match = TASK_CONTINUATION_HANDLE_PATTERN.exec(handle);
  if (!match) throw new Error("Task continuation handle is invalid.");
  return { taskId: match[1]!, prefix: match[2]! };
}

function normalizeCriteria(criteria: TaskEvidenceCriterion[]): TaskEvidenceCriterion[] {
  if (!Array.isArray(criteria) || criteria.length === 0 || criteria.length > 64) {
    throw new Error("A task evidence contract requires 1 to 64 criteria.");
  }
  const normalized = criteria.map((criterion) => ({
    id: normalizedText(criterion.id, 120, "Criterion ID"),
    statement: normalizedText(criterion.statement, 1_000, "Criterion statement"),
    required: criterion.required === true,
    sourceRefs: normalizedReferences(
      criterion.sourceRefs ?? [],
      16,
      "Criterion source reference",
    ),
  }));
  if (new Set(normalized.map((criterion) => criterion.id)).size !== normalized.length) {
    throw new Error("Task evidence criterion IDs must be unique.");
  }
  return normalized;
}

function normalizeDecisions(
  decisions: TaskEvidenceDecision[],
): TaskEvidenceDecision[] {
  if (!Array.isArray(decisions) || decisions.length > 64) {
    throw new Error("A task evidence contract supports at most 64 decisions.");
  }
  const normalized = decisions.map((decision) => {
    if (!(["open", "resolved", "deferred"] as const).includes(decision.status)) {
      throw new Error("Task evidence decision status is invalid.");
    }
    if (decision.status === "resolved" && !decision.answer?.trim()) {
      throw new Error("A resolved task decision requires an answer.");
    }
    if (decision.status === "open" && decision.answer !== undefined) {
      throw new Error("An open task decision cannot contain an answer.");
    }
    return {
      id: normalizedText(decision.id, 120, "Decision ID"),
      question: normalizedText(decision.question, 1_000, "Decision question"),
      status: decision.status,
      ...(decision.answer !== undefined
        ? { answer: normalizedText(decision.answer, 2_000, "Decision answer") }
        : {}),
      sourceRefs: normalizedReferences(
        decision.sourceRefs ?? [],
        16,
        "Decision source reference",
      ),
    };
  });
  if (new Set(normalized.map((decision) => decision.id)).size !== normalized.length) {
    throw new Error("Task evidence decision IDs must be unique.");
  }
  return normalized;
}

function normalizeCriterionProgress(
  progress: TaskCriterionProgress[],
): TaskCriterionProgress[] {
  if (!Array.isArray(progress) || progress.length === 0 || progress.length > 64) {
    throw new Error("Task continuation criterion progress is invalid.");
  }
  const normalized = progress.map((criterion) => {
    if (
      !(["pending", "satisfied", "blocked", "deferred"] as const).includes(
        criterion.status,
      )
    ) {
      throw new Error("Task continuation criterion status is invalid.");
    }
    const evidenceRefs = normalizedReferences(
      criterion.evidenceRefs ?? [],
      24,
      "Criterion evidence reference",
    );
    const validationRefs = normalizedReferences(
      criterion.validationRefs ?? [],
      16,
      "Criterion validation reference",
    );
    if (criterion.status === "satisfied" && evidenceRefs.length === 0 && validationRefs.length === 0) {
      throw new Error("A satisfied criterion requires evidence or validation.");
    }
    return {
      criterionId: normalizedText(criterion.criterionId, 120, "Criterion progress ID"),
      status: criterion.status,
      evidenceRefs,
      validationRefs,
      ...(criterion.note !== undefined
        ? { note: normalizedText(criterion.note, 1_000, "Criterion progress note") }
        : {}),
    };
  });
  if (
    new Set(normalized.map((criterion) => criterion.criterionId)).size !==
    normalized.length
  ) {
    throw new Error("Task continuation criterion IDs must be unique.");
  }
  return normalized;
}

function assertArtifactBudget(value: unknown, maximum: number, label: string): void {
  const bytes = Buffer.byteLength(canonicalJson(value), "utf8");
  if (bytes > maximum) {
    throw new Error(`${label} exceeds its ${maximum}-byte storage budget.`);
  }
}

function validateContract(value: unknown): TaskEvidenceContract {
  if (!value || typeof value !== "object") {
    throw new Error("Task evidence contract is invalid.");
  }
  const raw = value as TaskEvidenceContract;
  const parsed = typeof raw.handle === "string" ? parseContractHandle(raw.handle) : undefined;
  if (
    raw.schemaVersion !== TASK_EVIDENCE_CONTRACT_SCHEMA_VERSION ||
    !TASK_ID_PATTERN.test(raw.taskId) ||
    !parsed ||
    parsed.taskId !== raw.taskId ||
    !DIGEST_PATTERN.test(raw.hash) ||
    !raw.hash.startsWith(parsed.prefix) ||
    !DIGEST_PATTERN.test(raw.objectiveHash) ||
    !SOURCE_LEDGER_HASH_PATTERN.test(raw.sourceLedgerHash) ||
    !Array.isArray(raw.decisions) ||
    !Array.isArray(raw.constraints) ||
    !Array.isArray(raw.exclusions) ||
    !Array.isArray(raw.sourceReceiptIds) ||
    !Array.isArray(raw.contextHandles)
  ) {
    throw new Error("Task evidence contract is invalid.");
  }
  const normalized: TaskEvidenceContract = {
    schemaVersion: TASK_EVIDENCE_CONTRACT_SCHEMA_VERSION,
    handle: raw.handle,
    hash: raw.hash,
    taskId: raw.taskId,
    revision: checkedRevision(raw.revision),
    objective: normalizedText(raw.objective, 6_000, "Task objective"),
    objectiveHash: raw.objectiveHash,
    sourceLedgerHash: raw.sourceLedgerHash,
    criteria: normalizeCriteria(raw.criteria),
    decisions: normalizeDecisions(raw.decisions),
    constraints: normalizedList(raw.constraints, 64, 1_000, "Task constraint"),
    exclusions: normalizedList(raw.exclusions, 64, 1_000, "Task exclusion"),
    sourceReceiptIds: normalizedList(
      raw.sourceReceiptIds,
      128,
      80,
      "Source receipt ID",
    ),
    contextHandles: normalizedList(raw.contextHandles, 32, 320, "Context handle"),
    ...(raw.previousHandle !== undefined
      ? { previousHandle: raw.previousHandle }
      : {}),
    createdAt: checkedTimestamp(raw.createdAt, "Task evidence contract timestamp"),
  };
  if (normalized.sourceReceiptIds.some((id) => !RECEIPT_ID_PATTERN.test(id))) {
    throw new Error("Task evidence contract source receipt is invalid.");
  }
  if (normalized.contextHandles.some((handle) => !EXPANDABLE_HANDLE_PATTERN.test(handle))) {
    throw new Error("Task evidence contract context handle is invalid.");
  }
  if (normalized.previousHandle) {
    const previous = parseContractHandle(normalized.previousHandle);
    if (previous.taskId !== normalized.taskId || normalized.revision === 1) {
      throw new Error("Task evidence contract predecessor is invalid.");
    }
  } else if (normalized.revision !== 1) {
    throw new Error("A revised task evidence contract requires its predecessor.");
  }
  const { handle: _handle, hash: _hash, createdAt: _createdAt, ...payload } = normalized;
  const expectedHash = digest(contractIntegrityPayload(payload));
  if (expectedHash !== normalized.hash) {
    throw new Error("Task evidence contract content hash is invalid.");
  }
  assertArtifactBudget(normalized, MAX_TASK_EVIDENCE_CONTRACT_BYTES, "Task evidence contract");
  return normalized;
}

function validateContinuation(value: unknown): TaskContinuationBundle {
  if (!value || typeof value !== "object") {
    throw new Error("Task continuation bundle is invalid.");
  }
  const raw = value as TaskContinuationBundle;
  const parsed =
    typeof raw.handle === "string" ? parseContinuationHandle(raw.handle) : undefined;
  if (
    raw.schemaVersion !== TASK_CONTINUATION_BUNDLE_SCHEMA_VERSION ||
    !TASK_ID_PATTERN.test(raw.taskId) ||
    !parsed ||
    parsed.taskId !== raw.taskId ||
    !DIGEST_PATTERN.test(raw.hash) ||
    !raw.hash.startsWith(parsed.prefix) ||
    !raw.contract ||
    !DIGEST_PATTERN.test(raw.contract.hash) ||
    !Array.isArray(raw.covered) ||
    !Array.isArray(raw.remaining) ||
    !Array.isArray(raw.validationRefs) ||
    !Array.isArray(raw.visualHandles)
  ) {
    throw new Error("Task continuation bundle is invalid.");
  }
  const contractHandle = parseContractHandle(raw.contract.handle);
  if (contractHandle.taskId !== raw.taskId || !raw.contract.hash.startsWith(contractHandle.prefix)) {
    throw new Error("Task continuation contract reference is invalid.");
  }
  const normalized: TaskContinuationBundle = {
    schemaVersion: TASK_CONTINUATION_BUNDLE_SCHEMA_VERSION,
    handle: raw.handle,
    hash: raw.hash,
    taskId: raw.taskId,
    revision: checkedRevision(raw.revision),
    contract: {
      handle: raw.contract.handle,
      hash: raw.contract.hash,
      revision: checkedRevision(raw.contract.revision),
    },
    criteria: normalizeCriterionProgress(raw.criteria),
    covered: normalizedList(raw.covered, 64, 1_000, "Covered task item"),
    remaining: normalizedList(raw.remaining, 64, 1_000, "Remaining task item"),
    nextSafeAction: normalizedText(raw.nextSafeAction, 2_000, "Next safe action"),
    validationRefs: normalizedReferences(
      raw.validationRefs,
      32,
      "Task validation reference",
    ),
    visualHandles: normalizedList(raw.visualHandles, 24, 320, "Visual handle"),
    ...(raw.changeSurfaceLockId !== undefined
      ? {
          changeSurfaceLockId: normalizedText(
            raw.changeSurfaceLockId,
            24,
            "ChangeSurface lock ID",
          ),
        }
      : {}),
    ...(raw.previousHandle !== undefined
      ? { previousHandle: raw.previousHandle }
      : {}),
    createdAt: checkedTimestamp(raw.createdAt, "Task continuation timestamp"),
  };
  if (
    normalized.visualHandles.some(
      (handle) =>
        !handle.startsWith("visual:") &&
        !handle.startsWith("visual-review:") &&
        !handle.startsWith("figma-snapshot:") &&
        !handle.startsWith("figma-asset:"),
    )
  ) {
    throw new Error("Task continuation visual handle is invalid.");
  }
  if (
    normalized.changeSurfaceLockId !== undefined &&
    !/^[a-f0-9]{24}$/u.test(normalized.changeSurfaceLockId)
  ) {
    throw new Error("Task continuation ChangeSurface lock ID is invalid.");
  }
  if (normalized.previousHandle) {
    const previous = parseContinuationHandle(normalized.previousHandle);
    if (previous.taskId !== normalized.taskId || normalized.revision === 1) {
      throw new Error("Task continuation predecessor is invalid.");
    }
  } else if (normalized.revision !== 1) {
    throw new Error("A revised task continuation requires its predecessor.");
  }
  const { handle: _handle, hash: _hash, createdAt: _createdAt, ...payload } = normalized;
  const expectedHash = digest(continuationIntegrityPayload(payload));
  if (expectedHash !== normalized.hash) {
    throw new Error("Task continuation content hash is invalid.");
  }
  assertArtifactBudget(
    normalized,
    MAX_TASK_CONTINUATION_BUNDLE_BYTES,
    "Task continuation bundle",
  );
  return normalized;
}

async function taskArtifactRoot(rootPath: string): Promise<string> {
  const identity = await resolveProjectIdentity(rootPath);
  return path.join(projectStorageDirectory(identity.logicalId), "task-state");
}

async function withTaskArtifactWriteLock<T>(
  rootPath: string,
  taskId: string,
  action: () => Promise<T>,
): Promise<T> {
  const directory = path.join(await taskArtifactRoot(rootPath), "artifact-locks");
  await mkdir(directory, { recursive: true });
  const target = path.join(
    directory,
    taskStateFileName(rootPath, taskId, "json").replace(/\.json$/u, ".lock"),
  );
  const acquire = async () => {
    try {
      return await open(target, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      throw new Error(
        "Task evidence is locked by another writer. Do not remove the lock automatically; inspect ownership before explicit recovery.",
        { cause: error },
      );
    }
  };
  const lock = await acquire();
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

async function artifactNames(directory: string): Promise<string[]> {
  let names: string[];
  try {
    names = (await readdir(directory)).filter((candidate) => candidate.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (names.length > MAX_TASK_ARTIFACT_FILES) {
    throw new Error(
      `Task artifact lookup exceeds its ${MAX_TASK_ARTIFACT_FILES}-file safety limit.`,
    );
  }
  return names;
}

async function artifactPath(
  rootPath: string,
  kind: "evidence-contracts" | "continuations",
  taskId: string,
  hash: string,
): Promise<string> {
  return path.join(
    await taskArtifactRoot(rootPath),
    kind,
    "artifacts",
    taskStateFileName(rootPath, taskId, "json").replace(/\.json$/u, ""),
    `${hash}.json`,
  );
}

async function latestPointerPath(
  rootPath: string,
  kind: "evidence-contracts" | "continuations",
  taskId: string,
): Promise<string> {
  return path.join(
    await taskArtifactRoot(rootPath),
    kind,
    "latest",
    taskStateFileName(rootPath, taskId, "json"),
  );
}

async function writeLatestPointer(
  target: string,
  pointer: LatestArtifactPointer,
): Promise<void> {
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

async function readLatestPointer(
  rootPath: string,
  kind: "evidence-contracts" | "continuations",
  taskId: string,
): Promise<LatestArtifactPointer | undefined> {
  try {
    const pointer = JSON.parse(
      await readFile(await latestPointerPath(rootPath, kind, taskId), "utf8"),
    ) as LatestArtifactPointer;
    if (
      pointer.schemaVersion !== 1 ||
      pointer.taskId !== taskId ||
      !DIGEST_PATTERN.test(pointer.hash) ||
      !Number.isInteger(pointer.revision) ||
      pointer.revision < 1 ||
      !Number.isFinite(Date.parse(pointer.updatedAt))
    ) {
      throw new Error("Latest task artifact pointer is invalid.");
    }
    return pointer;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function normalizedContractSemanticInput(input: PersistTaskEvidenceContractInput) {
  return {
    objective: normalizedText(input.objective, 6_000, "Task objective"),
    objectiveHash: input.objectiveHash,
    sourceLedgerHash: input.sourceLedgerHash,
    criteria: normalizeCriteria(input.criteria),
    decisions: normalizeDecisions(input.decisions ?? []),
    constraints: normalizedList(input.constraints ?? [], 64, 1_000, "Task constraint"),
    exclusions: normalizedList(input.exclusions ?? [], 64, 1_000, "Task exclusion"),
    sourceReceiptIds: normalizedList(
      input.sourceReceiptIds ?? [],
      128,
      80,
      "Source receipt ID",
    ),
    contextHandles: normalizedList(
      input.contextHandles ?? [],
      32,
      320,
      "Context handle",
    ),
  };
}

function contractSemanticArtifact(contract: TaskEvidenceContract) {
  return {
    objective: contract.objective,
    objectiveHash: contract.objectiveHash,
    sourceLedgerHash: contract.sourceLedgerHash,
    criteria: contract.criteria,
    decisions: contract.decisions,
    constraints: contract.constraints,
    exclusions: contract.exclusions,
    sourceReceiptIds: contract.sourceReceiptIds,
    contextHandles: contract.contextHandles,
  };
}

async function persistTaskEvidenceContractUnlocked(
  rootPath: string,
  input: PersistTaskEvidenceContractInput,
): Promise<TaskEvidenceContract> {
  if (!TASK_ID_PATTERN.test(input.taskId)) throw new Error("Task ID is invalid.");
  const semantic = normalizedContractSemanticInput(input);
  if (
    !DIGEST_PATTERN.test(semantic.objectiveHash) ||
    computeTaskObjectiveHash(semantic.objective) !== semantic.objectiveHash
  ) {
    throw new Error("Task objective hash is invalid.");
  }
  const latest = await loadLatestTaskEvidenceContract(rootPath, input.taskId);
  if (
    latest &&
    canonicalJson(contractSemanticArtifact(latest)) === canonicalJson(semantic)
  ) {
    return latest;
  }
  if (latest && input.previousHandle !== latest.handle) {
    throw new Error("A changed task evidence contract must reference its latest revision.");
  }
  if (!latest && input.previousHandle !== undefined) {
    throw new Error("The initial task evidence contract cannot reference a predecessor.");
  }
  const revision = latest ? latest.revision + 1 : 1;
  const payload = contractIntegrityPayload({
    schemaVersion: TASK_EVIDENCE_CONTRACT_SCHEMA_VERSION,
    taskId: input.taskId,
    revision,
    ...semantic,
    ...(latest ? { previousHandle: latest.handle } : {}),
  });
  const hash = digest(payload);
  const contract = validateContract({
    ...payload,
    handle: `contract:${input.taskId}:${hash.slice(0, 16)}`,
    hash,
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
  const target = await artifactPath(
    rootPath,
    "evidence-contracts",
    input.taskId,
    hash,
  );
  await mkdir(path.dirname(target), { recursive: true });
  await writeImmutableArtifact(
    target,
    `${canonicalJson(contract)}\n`,
    "A task evidence contract is immutable; create a new revision for changed evidence.",
  );
  await writeLatestPointer(
    await latestPointerPath(rootPath, "evidence-contracts", input.taskId),
    {
      schemaVersion: 1,
      taskId: input.taskId,
      handle: contract.handle,
      hash: contract.hash,
      revision: contract.revision,
      updatedAt: contract.createdAt,
    },
  );
  return contract;
}

export async function persistTaskEvidenceContract(
  rootPath: string,
  input: PersistTaskEvidenceContractInput,
): Promise<TaskEvidenceContract> {
  if (!TASK_ID_PATTERN.test(input.taskId)) throw new Error("Task ID is invalid.");
  return withTaskArtifactWriteLock(rootPath, input.taskId, () =>
    persistTaskEvidenceContractUnlocked(rootPath, input),
  );
}

export async function loadTaskEvidenceContract(
  rootPath: string,
  handle: string,
): Promise<TaskEvidenceContract> {
  const parsed = parseContractHandle(handle);
  const pointer = await readLatestPointer(rootPath, "evidence-contracts", parsed.taskId);
  if (pointer?.handle === handle) {
    const contract = validateContract(
      JSON.parse(
        await readFile(
          await artifactPath(
            rootPath,
            "evidence-contracts",
            parsed.taskId,
            pointer.hash,
          ),
          "utf8",
        ),
      ),
    );
    if (contract.handle !== handle) throw new Error("Task evidence contract identity is invalid.");
    return contract;
  }
  const directory = path.dirname(
    await artifactPath(
      rootPath,
      "evidence-contracts",
      parsed.taskId,
      "0".repeat(64),
    ),
  );
  for (const name of await artifactNames(directory)) {
    const candidate = validateContract(JSON.parse(await readFile(path.join(directory, name), "utf8")));
    if (candidate.handle === handle) return candidate;
  }
  throw new Error("Task evidence contract was not found.");
}

export async function loadLatestTaskEvidenceContract(
  rootPath: string,
  taskId: string,
): Promise<TaskEvidenceContract | undefined> {
  if (!TASK_ID_PATTERN.test(taskId)) throw new Error("Task ID is invalid.");
  const pointer = await readLatestPointer(rootPath, "evidence-contracts", taskId);
  if (!pointer) return undefined;
  const contract = validateContract(
    JSON.parse(
      await readFile(
        await artifactPath(
          rootPath,
          "evidence-contracts",
          taskId,
          pointer.hash,
        ),
        "utf8",
      ),
    ),
  );
  if (
    contract.taskId !== taskId ||
    contract.handle !== pointer.handle ||
    contract.hash !== pointer.hash ||
    contract.revision !== pointer.revision
  ) {
    throw new Error("Latest task evidence contract pointer is stale or invalid.");
  }
  return contract;
}

function normalizedContinuationSemanticInput(
  input: PersistTaskContinuationBundleInput,
) {
  return {
    contractHandle: input.contractHandle,
    criteria: normalizeCriterionProgress(input.criteria),
    covered: normalizedList(input.covered ?? [], 64, 1_000, "Covered task item"),
    remaining: normalizedList(input.remaining ?? [], 64, 1_000, "Remaining task item"),
    nextSafeAction: normalizedText(input.nextSafeAction, 2_000, "Next safe action"),
    validationRefs: normalizedReferences(
      input.validationRefs ?? [],
      32,
      "Task validation reference",
    ),
    visualHandles: normalizedList(input.visualHandles ?? [], 24, 320, "Visual handle"),
    changeSurfaceLockId: input.changeSurfaceLockId,
  };
}

function continuationSemanticArtifact(bundle: TaskContinuationBundle) {
  return {
    contractHandle: bundle.contract.handle,
    criteria: bundle.criteria,
    covered: bundle.covered,
    remaining: bundle.remaining,
    nextSafeAction: bundle.nextSafeAction,
    validationRefs: bundle.validationRefs,
    visualHandles: bundle.visualHandles,
    changeSurfaceLockId: bundle.changeSurfaceLockId,
  };
}

async function persistTaskContinuationBundleUnlocked(
  rootPath: string,
  input: PersistTaskContinuationBundleInput,
): Promise<TaskContinuationBundle> {
  if (!TASK_ID_PATTERN.test(input.taskId)) throw new Error("Task ID is invalid.");
  const contract = await loadTaskEvidenceContract(rootPath, input.contractHandle);
  if (contract.taskId !== input.taskId) {
    throw new Error("Task continuation contract belongs to a different task.");
  }
  const semantic = normalizedContinuationSemanticInput(input);
  const latest = await loadLatestTaskContinuationBundle(rootPath, input.taskId);
  if (
    latest &&
    canonicalJson(continuationSemanticArtifact(latest)) ===
      canonicalJson(semantic)
  ) {
    return latest;
  }
  if (latest && input.previousHandle !== latest.handle) {
    throw new Error("A changed task continuation must reference its latest revision.");
  }
  if (!latest && input.previousHandle !== undefined) {
    throw new Error("The initial task continuation cannot reference a predecessor.");
  }
  const criteria = semantic.criteria;
  const expectedIds = new Set(contract.criteria.map((criterion) => criterion.id));
  const actualIds = new Set(criteria.map((criterion) => criterion.criterionId));
  if (
    expectedIds.size !== actualIds.size ||
    [...expectedIds].some((criterionId) => !actualIds.has(criterionId))
  ) {
    throw new Error("Task continuation must report every contract criterion exactly once.");
  }
  const revision = latest ? latest.revision + 1 : 1;
  const payload = continuationIntegrityPayload({
    schemaVersion: TASK_CONTINUATION_BUNDLE_SCHEMA_VERSION,
    taskId: input.taskId,
    revision,
    contract: {
      handle: contract.handle,
      hash: contract.hash,
      revision: contract.revision,
    },
    criteria,
    covered: semantic.covered,
    remaining: semantic.remaining,
    nextSafeAction: semantic.nextSafeAction,
    validationRefs: semantic.validationRefs,
    visualHandles: semantic.visualHandles,
    ...(semantic.changeSurfaceLockId
      ? { changeSurfaceLockId: semantic.changeSurfaceLockId }
      : {}),
    ...(latest ? { previousHandle: latest.handle } : {}),
  });
  const hash = digest(payload);
  const bundle = validateContinuation({
    ...payload,
    handle: `continuation:${input.taskId}:${hash.slice(0, 16)}`,
    hash,
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
  const target = await artifactPath(
    rootPath,
    "continuations",
    input.taskId,
    hash,
  );
  await mkdir(path.dirname(target), { recursive: true });
  await writeImmutableArtifact(
    target,
    `${canonicalJson(bundle)}\n`,
    "A task continuation bundle is immutable; create a new revision for changed progress.",
  );
  await writeLatestPointer(
    await latestPointerPath(rootPath, "continuations", input.taskId),
    {
      schemaVersion: 1,
      taskId: input.taskId,
      handle: bundle.handle,
      hash: bundle.hash,
      revision: bundle.revision,
      updatedAt: bundle.createdAt,
    },
  );
  return bundle;
}

export async function persistTaskContinuationBundle(
  rootPath: string,
  input: PersistTaskContinuationBundleInput,
): Promise<TaskContinuationBundle> {
  if (!TASK_ID_PATTERN.test(input.taskId)) throw new Error("Task ID is invalid.");
  return withTaskArtifactWriteLock(rootPath, input.taskId, () =>
    persistTaskContinuationBundleUnlocked(rootPath, input),
  );
}

export async function loadTaskContinuationBundle(
  rootPath: string,
  handle: string,
): Promise<TaskContinuationBundle> {
  const parsed = parseContinuationHandle(handle);
  const pointer = await readLatestPointer(rootPath, "continuations", parsed.taskId);
  if (pointer?.handle === handle) {
    const bundle = validateContinuation(
      JSON.parse(
        await readFile(
          await artifactPath(
            rootPath,
            "continuations",
            parsed.taskId,
            pointer.hash,
          ),
          "utf8",
        ),
      ),
    );
    if (bundle.handle !== handle) throw new Error("Task continuation identity is invalid.");
    await assertContinuationContract(rootPath, bundle);
    return bundle;
  }
  const directory = path.dirname(
    await artifactPath(
      rootPath,
      "continuations",
      parsed.taskId,
      "0".repeat(64),
    ),
  );
  for (const name of await artifactNames(directory)) {
    const candidate = validateContinuation(JSON.parse(await readFile(path.join(directory, name), "utf8")));
    if (candidate.handle === handle) {
      await assertContinuationContract(rootPath, candidate);
      return candidate;
    }
  }
  throw new Error("Task continuation bundle was not found.");
}

async function assertContinuationContract(
  rootPath: string,
  bundle: TaskContinuationBundle,
): Promise<TaskEvidenceContract> {
  const contract = await loadTaskEvidenceContract(rootPath, bundle.contract.handle);
  if (
    contract.hash !== bundle.contract.hash ||
    contract.revision !== bundle.contract.revision
  ) {
    throw new Error("Task continuation contract binding is invalid.");
  }
  const expectedIds = new Set(contract.criteria.map((criterion) => criterion.id));
  const actualIds = new Set(bundle.criteria.map((criterion) => criterion.criterionId));
  if (
    expectedIds.size !== actualIds.size ||
    [...expectedIds].some((criterionId) => !actualIds.has(criterionId))
  ) {
    throw new Error("Task continuation criteria differ from its evidence contract.");
  }
  return contract;
}

export async function loadLatestTaskContinuationBundle(
  rootPath: string,
  taskId: string,
): Promise<TaskContinuationBundle | undefined> {
  if (!TASK_ID_PATTERN.test(taskId)) throw new Error("Task ID is invalid.");
  const pointer = await readLatestPointer(rootPath, "continuations", taskId);
  if (!pointer) return undefined;
  const bundle = validateContinuation(
    JSON.parse(
      await readFile(
        await artifactPath(rootPath, "continuations", taskId, pointer.hash),
        "utf8",
      ),
    ),
  );
  if (
    bundle.taskId !== taskId ||
    bundle.handle !== pointer.handle ||
    bundle.hash !== pointer.hash ||
    bundle.revision !== pointer.revision
  ) {
    throw new Error("Latest task continuation pointer is stale or invalid.");
  }
  await assertContinuationContract(rootPath, bundle);
  return bundle;
}

export function taskAcceptanceState(
  contract: TaskEvidenceContract,
  bundle: TaskContinuationBundle,
): TaskAcceptanceState {
  if (contract.handle !== bundle.contract.handle || contract.hash !== bundle.contract.hash) {
    throw new Error("Task continuation is not bound to this evidence contract.");
  }
  const progress = new Map(bundle.criteria.map((criterion) => [criterion.criterionId, criterion]));
  const required = contract.criteria.filter((criterion) => criterion.required);
  const byStatus = (status: TaskCriterionStatus) =>
    required
      .filter((criterion) => progress.get(criterion.id)?.status === status)
      .map((criterion) => criterion.id);
  const pending = byStatus("pending");
  const blocked = byStatus("blocked");
  const deferred = byStatus("deferred");
  const satisfied = byStatus("satisfied").length;
  return {
    ready: satisfied === required.length,
    required: required.length,
    satisfied,
    pending,
    blocked,
    deferred,
  };
}

export async function expandTaskEvidenceContract(
  rootPath: string,
  handle: string,
  budgetChars = 3_200,
) {
  const contract = await loadTaskEvidenceContract(rootPath, handle);
  return fitBudgetedResponse(
    { schemaVersion: 1, contract },
    {
      budgetChars,
      totalMatches: 1,
      expandableIds: [
        ...contract.contextHandles,
        ...contract.sourceReceiptIds,
      ],
      preserveKeys: ["contract"],
    },
  );
}

export async function expandTaskContinuationBundle(
  rootPath: string,
  handle: string,
  budgetChars = 3_200,
) {
  const bundle = await loadTaskContinuationBundle(rootPath, handle);
  const contract = await assertContinuationContract(rootPath, bundle);
  return fitBudgetedResponse(
    {
      schemaVersion: 1,
      continuation: bundle,
      acceptance: taskAcceptanceState(contract, bundle),
    },
    {
      budgetChars,
      totalMatches: 1,
      expandableIds: [
        bundle.contract.handle,
        ...bundle.criteria.flatMap((criterion) => [
          ...criterion.evidenceRefs,
          ...criterion.validationRefs,
        ]),
        ...bundle.validationRefs,
        ...bundle.visualHandles,
      ].filter((reference) => EXPANDABLE_HANDLE_PATTERN.test(reference)),
      preserveKeys: ["continuation", "acceptance"],
    },
  );
}
