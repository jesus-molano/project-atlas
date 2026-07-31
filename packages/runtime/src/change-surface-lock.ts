import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  SOURCE_RECEIPT_ID_PATTERN,
  type ComponentGraph,
  type DecisionKind,
} from "@component-atlas/core";
import { projectStorageDirectory } from "@component-atlas/store";
import {
  canonicalJson,
  computeScopedChangeSurfaceFingerprints,
  type ScopedChangeSurfaceFingerprints,
} from "./change-surface-fingerprint.js";
import {
  captureGitBaseline,
  type GitBaselineReference,
  type GitDeltaCaptureLimits,
} from "./git-delta.js";
import { resolveProjectIdentity } from "./identity.js";
import { writeImmutableArtifact } from "./immutable-artifact.js";
import { scanProject } from "./scan.js";
import {
  loadTaskObjectiveArtifact,
  taskObjectiveReference,
  validateTaskObjectiveReference,
  type TaskObjectiveReference,
} from "./task-objective.js";

const TASK_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;
const RECEIPT_ID = SOURCE_RECEIPT_ID_PATTERN;
const MAX_LOCKED_CHANGE_SURFACE_BYTES = 2_800;
const EXPANDABLE_HANDLE =
  /^(?:(?:code|design|memory|entity):[^\u0000-\u001f]{1,240}|visual:vd-[A-Za-z0-9_-]+:[a-f0-9]{16}|figma-asset:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{24}|manifest:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{16}|retrieval:[A-Za-z0-9_.:-]{1,160}:[a-z-]{2,32}:[a-f0-9]{16}|delivery:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{16})$/u;

export interface LockedConfirmedOperation {
  method: string;
  path: string;
  operationId?: string;
}

export type LockedSurfacePrimary =
  | {
      kind: "component";
      id: string;
      path: string;
    }
  | {
      kind: "non-component";
      surfaceKind: string;
      id: string;
      path?: string;
    };

export interface LockedSurfaceReference {
  kind: "component" | "non-component";
  id: string;
  path?: string;
}

export interface LockedReuseDecision {
  decision: DecisionKind | "not-applicable";
  rationale: string;
  selectedComponentIds: string[];
  rejectedComponentIds: string[];
}

export interface LockedChangeSurface {
  schemaVersion: 2;
  taskId: string;
  lockId: string;
  integrityHash: string;
  revision: number;
  lockedAt: string;
  /** Missing only on a legacy/unbound v2 lock. */
  objective?: TaskObjectiveReference;
  intent: string;
  primary: LockedSurfacePrimary;
  references: LockedSurfaceReference[];
  allowedFiles: string[];
  referenceFiles: string[];
  exclusions: string[];
  reuseDecision: LockedReuseDecision;
  gitBaseline: GitBaselineReference;
  evidence: {
    fingerprints: {
      graph: string;
      theme?: string;
      scopedTheme?: string;
    };
    sourceLedger: {
      hash?: string;
      receiptIds: string[];
      /** Counts are absent only on legacy v2 locks. */
      decisionCount?: number;
      relationCount?: number;
      receiptCount?: number;
      openApiAuthority: boolean;
      confirmedOperations: LockedConfirmedOperation[];
    };
    handles: string[];
  };
  supersedes?: string;
  invalidationReason?: string;
}

export interface LockTaskChangeSurfaceInput {
  taskId: string;
  objective?: TaskObjectiveReference;
  intent: string;
  primary: LockedSurfacePrimary;
  references?: LockedSurfaceReference[];
  allowedFiles: string[];
  referenceFiles?: string[];
  exclusions?: string[];
  reuseDecision: {
    decision: DecisionKind | "not-applicable";
    rationale: string;
    selectedComponentIds?: string[];
    rejectedComponentIds?: string[];
  };
  /** Optional fresh graph supplied by an orchestrator to avoid a duplicate scan. */
  graph?: ComponentGraph;
  sourceLedger?: {
    hash?: string;
    receiptIds?: string[];
    decisionCount?: number;
    relationCount?: number;
    receiptCount?: number;
    openApiAuthority?: boolean;
    confirmedOperations?: LockedConfirmedOperation[];
  };
  handles?: string[];
  gitBaseline?: GitBaselineReference;
  baselineLimits?: GitDeltaCaptureLimits;
  invalidationReason?: string;
  at?: string;
}

function short(value: string, maximum: number): string {
  return value
    .trim()
    .replace(/[\u0000-\u001f]+/gu, " ")
    .slice(0, maximum)
    .trimEnd();
}

function uniqueShort(values: string[], maximum: number, limit: number): string[] {
  return [...new Set(values.map((value) => short(value, maximum)).filter(Boolean))]
    .slice(0, limit);
}

export function normalizeLockedChangeIntent(value: string): string {
  return short(value, 320);
}

export function normalizeLockedEvidenceHandles(values: string[] = []): string[] {
  const priority = (handle: string): number =>
    handle.startsWith("visual:")
      ? 0
      : /^(?:figma-asset|manifest|retrieval|design):/u.test(handle)
        ? 1
        : handle.startsWith("code:")
          ? 2
          : 3;
  return uniqueShort(
    values.filter((handle) => EXPANDABLE_HANDLE.test(handle)),
    260,
    128,
  )
    .sort(
      (left, right) =>
        priority(left) - priority(right) || left.localeCompare(right),
    )
    .slice(0, 3)
    .sort();
}

function repositoryPath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
  if (
    !normalized ||
    path.isAbsolute(value) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("\0")
  ) {
    throw new Error(`Locked repository path "${value}" is invalid.`);
  }
  return short(normalized, 260);
}

function exclusion(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
  if (!normalized || normalized.includes("\0")) {
    throw new Error("Locked change-surface exclusion is invalid.");
  }
  return short(normalized, 260);
}

function validGitBaseline(value: GitBaselineReference | undefined): boolean {
  const nonNegativeInteger = (candidate: unknown): boolean =>
    Number.isInteger(candidate) && Number(candidate) >= 0;
  return Boolean(
    value?.schemaVersion === 1 &&
      /^git-baseline:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{16}$/u.test(value.handle) &&
      /^[a-f0-9]{64}$/u.test(value.snapshotHash) &&
      typeof value.head === "string" &&
      /^[a-f0-9]{64}$/u.test(value.indexFingerprint) &&
      /^[a-f0-9]{64}$/u.test(value.worktreeFingerprint) &&
      Number.isFinite(Date.parse(value.capturedAt)) &&
      (value.checkoutId === undefined || /^[a-f0-9]{20}$/u.test(value.checkoutId)) &&
      nonNegativeInteger(value.files) &&
      nonNegativeInteger(value.additions) &&
      nonNegativeInteger(value.deletions) &&
      nonNegativeInteger(value.renames) &&
      typeof value.truncated === "boolean" &&
      Array.isArray(value.truncationReasons) &&
      value.truncationReasons.every(
        (reason) => typeof reason === "string" && reason.length <= 160,
      ),
  );
}

function normalizedConfirmedOperations(
  operations: LockedConfirmedOperation[] = [],
): LockedConfirmedOperation[] {
  if (operations.length > 100) {
    throw new Error("A locked change surface supports at most 100 confirmed operations.");
  }
  return operations
    .map((operation) => {
      const method = operation.method.trim().toUpperCase();
      const operationPath = operation.path.trim().replace(/[?#].*$/u, "");
      if (
        !["GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE"].includes(
          method,
        ) ||
        !operationPath.startsWith("/") ||
        operationPath.length > 500 ||
        /[\u0000-\u001f]/u.test(operationPath)
      ) {
        throw new Error("A locked confirmed operation is invalid.");
      }
      const normalizedPath =
        operationPath.length > 1 ? operationPath.replace(/\/+$/u, "") : operationPath;
      const operationId = operation.operationId
        ? short(operation.operationId, 160)
        : undefined;
      return {
        method,
        path: normalizedPath,
        ...(operationId ? { operationId } : {}),
      };
    })
    .filter(
      (operation, index, collection) =>
        collection.findIndex(
          (candidate) =>
            candidate.method === operation.method && candidate.path === operation.path,
        ) === index,
    )
    .sort((left, right) => {
      const leftKey = `${left.method}\0${left.path}`;
      const rightKey = `${right.method}\0${right.path}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
}

type LockedChangeSurfaceIntegrityPayload = Omit<
  LockedChangeSurface,
  "lockId" | "integrityHash"
>;

function integrityPayload(
  value: LockedChangeSurface | LockedChangeSurfaceIntegrityPayload,
): LockedChangeSurfaceIntegrityPayload {
  const {
    lockId: _lockId,
    integrityHash: _integrityHash,
    ...payload
  } = value as LockedChangeSurface;
  return payload;
}

export function computeLockedChangeSurfaceIntegrity(
  value: LockedChangeSurface | LockedChangeSurfaceIntegrityPayload,
): string {
  return createHash("sha256")
    .update(canonicalJson(integrityPayload(value)))
    .digest("hex");
}

function normalizedStringArray(
  values: unknown,
  maximum: number,
  limit: number,
): values is string[] {
  if (!Array.isArray(values) || values.length > limit) return false;
  return values.every(
    (value) =>
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= maximum &&
      !/[\u0000-\u001f]/u.test(value),
  );
}

function validFingerprint(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isCanonicalSorted(values: string[]): boolean {
  return (
    new Set(values).size === values.length &&
    values.every((value, index) => index === 0 || values[index - 1]! <= value)
  );
}

export function isLockedChangeSurface(
  value: LockedChangeSurface | undefined,
): boolean {
  if (!value) return false;
  try {
    const primaryValid =
      value.primary?.kind === "component"
        ? Boolean(
            value.primary.id &&
              short(value.primary.id, 160) === value.primary.id &&
              repositoryPath(value.primary.path) === value.primary.path,
          )
        : value.primary?.kind === "non-component"
          ? Boolean(
              value.primary.id &&
                short(value.primary.id, 160) === value.primary.id &&
                value.primary.surfaceKind &&
                short(value.primary.surfaceKind, 80) ===
                  value.primary.surfaceKind &&
                (!value.primary.path ||
                  repositoryPath(value.primary.path) === value.primary.path),
            )
          : false;
    const theme = value.evidence?.fingerprints?.theme;
    const scopedTheme = value.evidence?.fingerprints?.scopedTheme;
    const expectedIntegrity = computeLockedChangeSurfaceIntegrity(value);
    return Boolean(
      value.schemaVersion === 2 &&
        TASK_ID.test(value.taskId) &&
        /^[a-f0-9]{24}$/u.test(value.lockId) &&
        /^[a-f0-9]{64}$/u.test(value.integrityHash) &&
        value.integrityHash === expectedIntegrity &&
        value.lockId === expectedIntegrity.slice(0, 24) &&
        Number.isInteger(value.revision) &&
        value.revision > 0 &&
        Number.isFinite(Date.parse(value.lockedAt)) &&
        (value.objective === undefined ||
          Boolean(validateTaskObjectiveReference(value.objective, value.taskId))) &&
        normalizeLockedChangeIntent(value.intent) === value.intent &&
        primaryValid &&
        Array.isArray(value.references) &&
        value.references.length <= 6 &&
        value.references.every(
          (reference) =>
            (reference.kind === "component" ||
              reference.kind === "non-component") &&
            Boolean(reference.id) &&
            short(reference.id, 160) === reference.id &&
            (!reference.path || repositoryPath(reference.path) === reference.path),
        ) &&
        value.references.every(
          (reference, index) =>
            index === 0 ||
            `${value.references[index - 1]!.kind}\0${value.references[index - 1]!.id}\0${value.references[index - 1]!.path ?? ""}` <=
              `${reference.kind}\0${reference.id}\0${reference.path ?? ""}`,
        ) &&
        normalizedStringArray(value.allowedFiles, 260, 32) &&
        value.allowedFiles.every((file) => repositoryPath(file) === file) &&
        isCanonicalSorted(value.allowedFiles) &&
        normalizedStringArray(value.referenceFiles, 260, 24) &&
        value.referenceFiles.every((file) => repositoryPath(file) === file) &&
        isCanonicalSorted(value.referenceFiles) &&
        normalizedStringArray(value.exclusions, 260, 16) &&
        isCanonicalSorted(value.exclusions) &&
        value.reuseDecision?.rationale &&
        short(value.reuseDecision.rationale, 240) ===
          value.reuseDecision.rationale &&
        [
          "reuse",
          "extend",
          "compose",
          "extract-and-reuse",
          "create",
          "not-applicable",
        ].includes(value.reuseDecision?.decision) &&
        normalizedStringArray(
          value.reuseDecision?.selectedComponentIds,
          160,
          8,
        ) &&
        isCanonicalSorted(value.reuseDecision.selectedComponentIds) &&
        normalizedStringArray(
          value.reuseDecision?.rejectedComponentIds,
          160,
          8,
        ) &&
        isCanonicalSorted(value.reuseDecision.rejectedComponentIds) &&
        validGitBaseline(value.gitBaseline) &&
        value.gitBaseline.handle.startsWith(`git-baseline:${value.taskId}:`) &&
        validFingerprint(value.evidence?.fingerprints?.graph) &&
        ((theme === undefined && scopedTheme === undefined) ||
          (validFingerprint(theme) && validFingerprint(scopedTheme))) &&
        Array.isArray(value.evidence?.sourceLedger?.receiptIds) &&
        value.evidence.sourceLedger.receiptIds.length <= 4 &&
        value.evidence.sourceLedger.receiptIds.every((id) => RECEIPT_ID.test(id)) &&
        isCanonicalSorted(value.evidence.sourceLedger.receiptIds) &&
        [
          value.evidence.sourceLedger.decisionCount,
          value.evidence.sourceLedger.relationCount,
          value.evidence.sourceLedger.receiptCount,
        ].every(
          (count) =>
            count === undefined ||
            (Number.isInteger(count) && count >= 0 && count <= 128),
        ) &&
        (value.evidence.sourceLedger.receiptCount === undefined ||
          value.evidence.sourceLedger.receiptCount >=
            value.evidence.sourceLedger.receiptIds.length) &&
        (value.evidence.sourceLedger.hash === undefined ||
          validFingerprint(value.evidence.sourceLedger.hash)) &&
        typeof value.evidence?.sourceLedger?.openApiAuthority === "boolean" &&
        Array.isArray(value.evidence?.sourceLedger?.confirmedOperations) &&
        value.evidence.sourceLedger.confirmedOperations.length <= 100 &&
        value.evidence.sourceLedger.confirmedOperations.every((operation) =>
          canonicalJson(normalizedConfirmedOperations([operation])[0]) ===
          canonicalJson(operation),
        ) &&
        canonicalJson(
          normalizedConfirmedOperations(
            value.evidence.sourceLedger.confirmedOperations,
          ),
        ) ===
          canonicalJson(value.evidence.sourceLedger.confirmedOperations) &&
        Array.isArray(value.evidence?.handles) &&
        canonicalJson(normalizeLockedEvidenceHandles(value.evidence.handles)) ===
          canonicalJson(value.evidence.handles) &&
        (value.supersedes === undefined || /^[a-f0-9]{24}$/u.test(value.supersedes)) &&
        (value.invalidationReason === undefined ||
          short(value.invalidationReason, 240) === value.invalidationReason) &&
        ((value.supersedes === undefined && value.invalidationReason === undefined) ||
          (value.revision > 1 &&
            value.supersedes !== undefined &&
            value.invalidationReason !== undefined)) &&
        Buffer.byteLength(JSON.stringify(value), "utf8") <=
          MAX_LOCKED_CHANGE_SURFACE_BYTES,
    );
  } catch {
    return false;
  }
}

interface LockedChangeSurfaceArtifact {
  schemaVersion: 1;
  taskId: string;
  checkoutId: string;
  integrityHash: string;
  lock: LockedChangeSurface;
}

async function changeSurfaceArtifactLocation(
  rootPath: string,
  lock: LockedChangeSurface,
): Promise<{ directory: string; filePath: string; checkoutId: string }> {
  const identity = await resolveProjectIdentity(rootPath);
  const directory = path.join(
    projectStorageDirectory(identity.logicalId),
    "task-state",
    "change-surfaces",
  );
  const fileName = `${createHash("sha256")
    .update(`${identity.checkoutId}\0${lock.taskId}\0${lock.integrityHash}`)
    .digest("hex")}.json`;
  return {
    directory,
    filePath: path.join(directory, fileName),
    checkoutId: identity.checkoutId,
  };
}

export async function lockedChangeSurfaceArtifactPath(
  rootPath: string,
  lock: LockedChangeSurface,
): Promise<string> {
  return (await changeSurfaceArtifactLocation(rootPath, lock)).filePath;
}

async function persistLockedChangeSurfaceArtifact(
  rootPath: string,
  lock: LockedChangeSurface,
): Promise<void> {
  const location = await changeSurfaceArtifactLocation(rootPath, lock);
  await mkdir(location.directory, { recursive: true });
  const artifact: LockedChangeSurfaceArtifact = {
    schemaVersion: 1,
    taskId: lock.taskId,
    checkoutId: location.checkoutId,
    integrityHash: lock.integrityHash,
    lock,
  };
  await writeImmutableArtifact(
    location.filePath,
    `${canonicalJson(artifact)}\n`,
    "A different immutable ChangeSurface artifact already exists at this path.",
  );
}

export async function assertLockedChangeSurfaceArtifact(
  rootPath: string,
  taskId: string,
  lock: LockedChangeSurface,
): Promise<void> {
  if (!isLockedChangeSurface(lock) || lock.taskId !== taskId) {
    throw new Error("The ChangeSurface capsule failed its v2 integrity check.");
  }
  const location = await changeSurfaceArtifactLocation(rootPath, lock);
  let artifact: LockedChangeSurfaceArtifact;
  try {
    artifact = JSON.parse(
      await readFile(location.filePath, "utf8"),
    ) as LockedChangeSurfaceArtifact;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        "The immutable ChangeSurface artifact is missing; explicitly relock the task before continuing.",
        { cause: error },
      );
    }
    throw new Error("The immutable ChangeSurface artifact is unreadable.", {
      cause: error,
    });
  }
  if (
    artifact.schemaVersion !== 1 ||
    artifact.taskId !== taskId ||
    artifact.checkoutId !== location.checkoutId ||
    artifact.integrityHash !== lock.integrityHash ||
    !isLockedChangeSurface(artifact.lock) ||
    canonicalJson(artifact.lock) !== canonicalJson(lock)
  ) {
    throw new Error(
      "The ChangeSurface capsule does not match its immutable artifact.",
    );
  }
  if (lock.objective) {
    await loadTaskObjectiveArtifact(rootPath, lock.objective, taskId);
  }
}

function normalizedPrimary(primary: LockedSurfacePrimary): LockedSurfacePrimary {
  if (primary.kind === "component") {
    if (!primary.id.trim()) throw new Error("Locked primary component ID is required.");
    return {
      kind: "component",
      id: short(primary.id, 160),
      path: repositoryPath(primary.path),
    };
  }
  if (!primary.id.trim() || !primary.surfaceKind.trim()) {
    throw new Error("Locked non-component kind and ID are required.");
  }
  return {
    kind: "non-component",
    surfaceKind: short(primary.surfaceKind, 80),
    id: short(primary.id, 160),
    ...(primary.path ? { path: repositoryPath(primary.path) } : {}),
  };
}

function normalizedReferences(
  references: LockedSurfaceReference[] = [],
): LockedSurfaceReference[] {
  if (references.length > 6) {
    throw new Error("A locked change surface supports at most six references.");
  }
  return references
    .map((reference) => {
      if (!reference.id.trim()) {
        throw new Error("Locked change-surface reference ID is required.");
      }
      return {
        kind: reference.kind,
        id: short(reference.id, 160),
        ...(reference.path ? { path: repositoryPath(reference.path) } : {}),
      };
    })
    .sort((left, right) => {
      const leftKey = `${left.kind}\0${left.id}\0${left.path ?? ""}`;
      const rightKey = `${right.kind}\0${right.id}\0${right.path ?? ""}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
}

function lockDefinition(
  value: Pick<
    LockedChangeSurface,
    | "intent"
    | "objective"
    | "primary"
    | "references"
    | "allowedFiles"
    | "referenceFiles"
    | "exclusions"
    | "reuseDecision"
    | "evidence"
  >,
): string {
  return canonicalJson({
    ...(value.objective ? { objective: value.objective } : {}),
    intent: value.intent,
    primary: value.primary,
    references: value.references,
    allowedFiles: value.allowedFiles,
    referenceFiles: value.referenceFiles,
    exclusions: value.exclusions,
    reuseDecision: value.reuseDecision,
    evidence: {
      sourceLedger: value.evidence.sourceLedger,
      handles: value.evidence.handles,
    },
  });
}

export async function createLockedChangeSurface(
  rootPath: string,
  input: LockTaskChangeSurfaceInput,
  existing?: LockedChangeSurface,
): Promise<LockedChangeSurface> {
  if (!TASK_ID.test(input.taskId)) throw new Error("Task ID is invalid.");
  if (existing && (existing as { schemaVersion: number }).schemaVersion !== 2) {
    throw new Error(
      "Legacy ChangeSurface v1 capsules are not trusted. Explicitly relock the task to create a v2 artifact.",
    );
  }
  if (existing) {
    await assertLockedChangeSurfaceArtifact(rootPath, input.taskId, existing);
  }
  if (!input.intent.trim()) throw new Error("Locked change-surface intent is required.");
  if (!input.reuseDecision.rationale.trim()) {
    throw new Error("A locked change surface requires a reuse rationale.");
  }
  if (input.sourceLedger?.hash && !validFingerprint(input.sourceLedger.hash)) {
    throw new Error("A source-ledger hash must be a lowercase SHA-256 digest.");
  }
  for (const count of [
    input.sourceLedger?.decisionCount,
    input.sourceLedger?.relationCount,
    input.sourceLedger?.receiptCount,
  ]) {
    if (
      count !== undefined &&
      (!Number.isInteger(count) || count < 0 || count > 128)
    ) {
      throw new Error("Source-ledger counts must be integers from zero to 128.");
    }
  }
  if (input.allowedFiles.length > 32) {
    throw new Error("A locked change surface supports at most 32 allowed files.");
  }
  if ((input.referenceFiles?.length ?? 0) > 24) {
    throw new Error("A locked change surface supports at most 24 reference files.");
  }
  if ((input.exclusions?.length ?? 0) > 16) {
    throw new Error("A locked change surface supports at most 16 exclusions.");
  }
  const objective = input.objective
    ? taskObjectiveReference(
        await loadTaskObjectiveArtifact(
          rootPath,
          input.objective,
          input.taskId,
        ),
      )
    : undefined;
  const sourceReceiptIds = uniqueShort(
    (input.sourceLedger?.receiptIds ?? []).filter((id) => RECEIPT_ID.test(id)),
    80,
    128,
  ).sort();
  const normalizedDefinition = {
    ...(objective ? { objective } : {}),
    intent: normalizeLockedChangeIntent(input.intent),
    primary: normalizedPrimary(input.primary),
    references: normalizedReferences(input.references),
    allowedFiles: [...new Set(input.allowedFiles.map(repositoryPath))].sort(),
    referenceFiles: [
      ...new Set((input.referenceFiles ?? []).map(repositoryPath)),
    ].sort(),
    exclusions: [...new Set((input.exclusions ?? []).map(exclusion))].sort(),
    reuseDecision: {
      decision: input.reuseDecision.decision,
      rationale: short(input.reuseDecision.rationale, 240),
      selectedComponentIds: uniqueShort(
        input.reuseDecision.selectedComponentIds ?? [],
        160,
        8,
      ).sort(),
      rejectedComponentIds: uniqueShort(
        input.reuseDecision.rejectedComponentIds ?? [],
        160,
        8,
      ).sort(),
    },
    evidence: {
      fingerprints: { graph: "" },
      sourceLedger: {
        ...(input.sourceLedger?.hash
          ? { hash: short(input.sourceLedger.hash, 128) }
          : {}),
        ...((input.sourceLedger?.decisionCount ?? 0) > 0
          ? { decisionCount: input.sourceLedger!.decisionCount }
          : {}),
        ...((input.sourceLedger?.relationCount ?? 0) > 0
          ? { relationCount: input.sourceLedger!.relationCount }
          : {}),
        ...((input.sourceLedger?.receiptCount ?? sourceReceiptIds.length) > 0
          ? {
              receiptCount:
                input.sourceLedger?.receiptCount ?? sourceReceiptIds.length,
            }
          : {}),
        receiptIds: sourceReceiptIds.slice(0, 4),
        openApiAuthority: input.sourceLedger?.openApiAuthority ?? false,
        confirmedOperations: normalizedConfirmedOperations(
          input.sourceLedger?.confirmedOperations,
        ),
      },
      handles: normalizeLockedEvidenceHandles(input.handles),
    },
  } satisfies Pick<
    LockedChangeSurface,
    | "intent"
    | "objective"
    | "primary"
    | "references"
    | "allowedFiles"
    | "referenceFiles"
    | "exclusions"
    | "reuseDecision"
    | "evidence"
  >;
  if (existing && !input.invalidationReason) {
    if (
      lockDefinition(existing) === lockDefinition(normalizedDefinition)
    ) {
      return existing;
    }
    throw new Error(
      "The task already has a different locked change surface. Supply an explicit invalidation reason before relocking.",
    );
  }
  if (existing && !input.invalidationReason?.trim()) {
    throw new Error("A change-surface invalidation reason cannot be empty.");
  }
  if (!existing && input.invalidationReason !== undefined) {
    throw new Error(
      "A first ChangeSurface lock cannot declare an invalidation reason.",
    );
  }
  const lockedAt = input.at ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(lockedAt))) {
    throw new Error("Locked change-surface timestamp is invalid.");
  }
  if (
    existing &&
    input.gitBaseline &&
    input.gitBaseline.handle !== existing.gitBaseline.handle
  ) {
    throw new Error(
      "Relocking a task must preserve its original Git baseline so already implemented changes remain attributable to the task.",
    );
  }
  const gitBaseline = existing
    ? existing.gitBaseline
    : input.gitBaseline ??
      (await captureGitBaseline(rootPath, {
        taskId: input.taskId,
        at: lockedAt,
        ...(input.baselineLimits ? { limits: input.baselineLimits } : {}),
      }));
  if (gitBaseline.truncated) {
    throw new Error(
      `ChangeSurface cannot lock an incomplete Git baseline (${gitBaseline.truncationReasons.join(
        ", ",
      ) || "unknown limit"}). Reduce the dirty baseline or start a narrower task before editing.`,
    );
  }
  if (
    !validGitBaseline(gitBaseline) ||
    !gitBaseline.handle.startsWith(`git-baseline:${input.taskId}:`)
  ) {
    throw new Error("The Git baseline does not belong to the locked task.");
  }
  const graph = input.graph ??
    (await scanProject(rootPath, { writeArtifacts: false }));
  const expectedGraphRoot = path.resolve(rootPath);
  const suppliedGraphRoot = path.resolve(graph.project.rootPath);
  if (
    (process.platform === "win32"
      ? expectedGraphRoot.toLowerCase() !== suppliedGraphRoot.toLowerCase()
      : expectedGraphRoot !== suppliedGraphRoot)
  ) {
    throw new Error("The supplied graph belongs to a different repository root.");
  }
  const fingerprints: ScopedChangeSurfaceFingerprints =
    computeScopedChangeSurfaceFingerprints(
      graph,
      normalizedDefinition.allowedFiles,
    );
  const normalized = {
    ...normalizedDefinition,
    evidence: {
      ...normalizedDefinition.evidence,
      fingerprints,
    },
  } satisfies Pick<
    LockedChangeSurface,
    | "intent"
    | "objective"
    | "primary"
    | "references"
    | "allowedFiles"
    | "referenceFiles"
    | "exclusions"
    | "reuseDecision"
    | "evidence"
  >;
  const revision = (existing?.revision ?? 0) + 1;
  const payload: LockedChangeSurfaceIntegrityPayload = {
    schemaVersion: 2,
    taskId: input.taskId,
    revision,
    lockedAt,
    ...normalized,
    gitBaseline,
    ...(existing ? { supersedes: existing.lockId } : {}),
    ...(input.invalidationReason
      ? { invalidationReason: short(input.invalidationReason, 240) }
      : {}),
  };
  const integrityHash = computeLockedChangeSurfaceIntegrity(payload);
  const locked: LockedChangeSurface = {
    ...payload,
    lockId: integrityHash.slice(0, 24),
    integrityHash,
  };
  const lockedBytes = Buffer.byteLength(JSON.stringify(locked), "utf8");
  if (lockedBytes > MAX_LOCKED_CHANGE_SURFACE_BYTES) {
    throw new Error(
      `Locked change surface uses ${lockedBytes} bytes and exceeds its 2.8 KB capsule budget; narrow the allowed files or evidence set.`,
    );
  }
  if (!isLockedChangeSurface(locked)) {
    throw new Error("Locked change surface is invalid.");
  }
  await persistLockedChangeSurfaceArtifact(rootPath, locked);
  return locked;
}
