import path from "node:path";
import {
  normalizeTaskSourceDecisions,
  normalizeTaskSourceRelations,
  SOURCE_RECEIPT_ID_PATTERN,
  type TaskSourceDecision,
  type TaskSourceRelation,
} from "@component-atlas/core";
import {
  assertDevelopmentAuthMockGuard,
  type DevelopmentAuthMockGuard,
} from "./auth-mocks.js";
import {
  isLockedChangeSurface,
  isLockedChangeSurfaceArtifactReference,
  lockedChangeSurfaceArtifactReference,
  type LockedChangeSurface,
  type LockedChangeSurfaceArtifactReference,
} from "./change-surface-lock.js";
import { EXPANDABLE_HANDLE_PATTERN } from "./expandable-handle.js";
import {
  lifecycleForPhase,
  lifecyclePhaseFromLegacy,
  validLifecycle,
  type TaskChangeInvalidation,
  type TaskChangeInvalidationInput,
  type TaskLifecycle,
  type TaskLifecyclePhase,
  type TaskValidationReference,
} from "./task-lifecycle.js";
import {
  computeTaskObjectiveHash,
  isTaskObjectiveProjection,
  validateTaskObjectiveReference,
  type TaskObjectiveProjection,
  type TaskObjectiveReference,
} from "./task-objective.js";
import {
  isTaskGovernance,
  type TaskGovernance,
} from "./task-governance.js";

export { EXPANDABLE_HANDLE_PATTERN };

export const TASK_CAPSULE_SCHEMA_VERSION = 5 as const;
const PREVIOUS_CAPSULE_SCHEMA_VERSION = 4 as const;
const LEGACY_CAPSULE_SCHEMA_VERSIONS = [1, 2, 3] as const;
export const MAX_TASK_CAPSULE_BYTES = 4_096;
const TARGET_TASK_CAPSULE_BYTES = 3_800;
export const TASK_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/u;
export const RECEIPT_ID_PATTERN = SOURCE_RECEIPT_ID_PATTERN;
const DELTA_HASH = /^[a-f0-9]{64}$/u;
const VISUAL_HANDLE = /^visual:vd-[A-Za-z0-9_-]+:[a-f0-9]{16}$/u;
const VISUAL_HASH = /^[a-f0-9]{16,64}$/u;
const VISUAL_REVIEW_HANDLE =
  /^visual-review:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{16}$/u;

export type TaskJournalMilestone =
  | "objective-approved"
  | "decision-confirmed"
  | "source-resolved"
  | "batch-completed"
  | "change-validated"
  | "blocked"
  | "risk-boundary"
  | "completed";

export interface LegacyTaskVisualReview {
  schemaVersion: 1;
  contractHandle: string;
  contractHash: string;
  stateMatrix: {
    surface: string;
    viewports: string[];
    requiredStates: string[];
  };
  captures: Array<{
    handle: string;
    viewport: string;
    state: string;
  }>;
  result: "pass" | "fix-and-recapture" | "blocked";
  deviationCount: number;
  cleanup: {
    state: "clean" | "selected-retained" | "not-applicable" | "cleanup-pending";
    receipt?: string;
  };
  reviewedAt: string;
}

export interface ReceiptTaskVisualReview {
  schemaVersion: 2;
  receiptHandle: string;
  receiptHash: string;
  contractHandle: string;
  contractHash: string;
  result: "pass" | "fix-and-recapture" | "blocked";
  captureCount: number;
  deviationCount: number;
  cleanup: {
    state: "clean" | "selected-retained" | "not-applicable" | "cleanup-pending";
    receipt?: string;
  };
  reviewedAt?: string;
}

export interface CompactReceiptTaskVisualReview {
  schemaVersion: 3;
  receiptHandle: string;
  receiptHash: string;
}

export type TaskVisualReview =
  | LegacyTaskVisualReview
  | ReceiptTaskVisualReview
  | CompactReceiptTaskVisualReview;

export interface TaskCompletionSummary {
  result: "success" | "failure" | "partial";
  summary: string;
  verification: string[];
  files: string[];
  deliveryReceipt?: string;
  /** Minimal lock identity retained only when the full completed surface is compacted. */
  lock?: { id: string; revision: number };
}

/** Stable, compact identity for UI and recovery. The full objective is immutable. */
export interface TaskLineage {
  rootTaskId?: string;
  parentTaskId?: string;
  relation?: "correction";
  sourceFeedbackHandle?: string;
  supersedesTaskId?: string;
  supersededByTaskId?: string;
}

/** A bounded projection of iterative user feedback attached to the active task. */
export interface TaskFeedbackSummary {
  total: number;
  pending: number;
  latestHandle: string;
  latestAt?: string;
}

export interface TaskResumeCapsule {
  schemaVersion: typeof TASK_CAPSULE_SCHEMA_VERSION;
  taskId: string;
  status: "active" | "blocked" | "completed";
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  title: string;
  objective: TaskObjectiveProjection;
  lineage?: TaskLineage;
  feedbackSummary?: TaskFeedbackSummary;
  governance?: TaskGovernance;
  decisions: Array<{
    id: string;
    kind: TaskSourceDecision["kind"];
    state: TaskSourceDecision["state"];
    required: boolean;
    reference: string;
    origin?: TaskSourceDecision["origin"];
    relationship?: TaskSourceDecision["relationship"];
    decidedAt?: string;
    authorityRole?: TaskSourceDecision["authorityRole"];
    routePolicy?: TaskSourceDecision["routePolicy"];
  }>;
  sourceRelations?: TaskSourceRelation[];
  sourceReceiptIds: string[];
  handles: string[];
  scope: {
    covered: string[];
    remaining: string[];
  };
  workspace: {
    rootPath: string;
    head: string;
    checkoutId?: string;
    branch?: string;
  };
  budget: {
    contextChars: number;
    estimatedTokens: number;
  };
  executionManifest?: {
    handle: string;
    hash: string;
    sourceLedgerHash: string;
    retrievalBudgetId: string;
  };
  activePolicy?: {
    visualMode?: "fidelity" | "inherit" | "explore";
    inventionBudget?: 0 | 1 | 2 | 3;
    excludedSurfaces?: string[];
    authMode?: "real" | "dev-mock-no-session";
    authMockGuard?: DevelopmentAuthMockGuard;
  };
  contextReferences?: {
    themeFingerprintHash?: string;
    designCoverageLedger?: {
      id: string;
      hash: string;
      selectedNodeIds: string[];
    };
  };
  lifecycle: TaskLifecycle;
  changeSurface?: LockedChangeSurface;
  /** Compact pointer used only while a relock invalidation is pending. */
  changeSurfaceArtifact?: LockedChangeSurfaceArtifactReference;
  changeInvalidation?: TaskChangeInvalidation;
  visualReview?: TaskVisualReview;
  validation?: TaskValidationReference;
  completion?: TaskCompletionSummary;
  nextSafeAction: string;
}

export interface TaskCheckpointInput {
  taskId: string;
  /** Stable task label. Omit on later checkpoints to retain the initial title. */
  title?: string;
  /**
   * Optional optimistic-concurrency precondition for a capsule update.
   *
   * `null` requires that no capsule exists yet. A timestamp requires the
   * current capsule to have exactly that `updatedAt` value. Omit it for
   * compatibility with callers that only need serialized writes.
   */
  expectedUpdatedAt?: string | null;
  status?: TaskResumeCapsule["status"];
  milestone: TaskJournalMilestone;
  objective: string;
  objectiveApproved: boolean;
  /**
   * Explicitly promotes a legacy projection or selects a previously persisted
   * immutable objective. Omit for new tasks and ordinary idempotent retries.
   */
  objectiveReference?: TaskObjectiveReference;
  lineage?: TaskLineage;
  feedbackSummary?: TaskFeedbackSummary;
  governance?: TaskGovernance;
  decisions: TaskSourceDecision[];
  sourceRelations?: TaskSourceRelation[];
  sourceReceiptIds: string[];
  handles: string[];
  covered: string[];
  remaining: string[];
  budgetChars: number;
  estimatedTokens?: number;
  executionManifest?: TaskResumeCapsule["executionManifest"];
  activePolicy?: TaskResumeCapsule["activePolicy"];
  contextReferences?: TaskResumeCapsule["contextReferences"];
  lifecyclePhase?: TaskLifecyclePhase;
  changeSurface?: LockedChangeSurface;
  changeInvalidation?: TaskChangeInvalidationInput;
  visualReview?: TaskVisualReview;
  validation?: TaskValidationReference | null;
  completion?: TaskCompletionSummary;
  nextSafeAction: string;
  head?: string;
  at?: string;
}

export interface TaskSourceLedger {
  schemaVersion: 1;
  taskId: string;
  updatedAt: string;
  rootPath?: string;
  checkoutId?: string;
  decisions: TaskSourceDecision[];
  relations: TaskSourceRelation[];
  receiptIds: string[];
}

export interface TaskFinalReceipt {
  schemaVersion: 1;
  taskId: string;
  objective: string;
  objectiveApproved: boolean;
  objectiveAuthority: TaskObjectiveProjection["authority"];
  objectiveReference?: TaskObjectiveReference;
  governance?: TaskGovernance;
  completedAt: string;
  head: string;
  sourceReceiptIds: string[];
  deliveryReceipt?: string;
  lock?: { id: string; revision: number };
  validation?: TaskValidationReference;
  visualReview?: TaskVisualReview;
  outcome?: TaskCompletionSummary;
}

export interface ResumeCapsuleTransport {
  format: "toon" | "json";
  mediaType: "text/toon" | "application/json";
  body: string;
  bytes: number;
  fallbackAvailable: true;
}

export interface TaskContextHandleSource {
  selections?: string[];
  code?: Array<{ id: string }>;
  memory?: Array<{ id: string }>;
  design?: { candidates?: Array<{ id: string }> };
}

export function shortTaskText(value: string, maximum: number): string {
  return value
    .trim()
    .replace(/[\u0000-\u001f]+/gu, " ")
    .slice(0, maximum);
}

/**
 * Keeps a human-readable task identity independent from the budgeted objective
 * projection. The immutable objective artifact remains the complete contract.
 */
export function taskTitleFromObjective(value: string): string {
  const trimmed = value.trim();
  const firstLine = trimmed.split(/\r?\n/u, 1)[0] ?? trimmed;
  const normalized = firstLine.replace(/[\u0000-\u001f]+/gu, " ");
  return shortTaskText(normalized, 160) || "Untitled task";
}

function validTaskLineage(value: TaskLineage | undefined, taskId: string): boolean {
  if (!value) return true;
  const ids = [
    value.rootTaskId,
    value.parentTaskId,
    value.supersedesTaskId,
    value.supersededByTaskId,
  ].filter((id): id is string => id !== undefined);
  return Boolean(
    ids.length > 0 &&
      ids.every((id) => TASK_ID_PATTERN.test(id) && id !== taskId) &&
      (value.relation === undefined || value.relation === "correction") &&
      (value.sourceFeedbackHandle === undefined ||
        /^feedback:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{16}$/u.test(
          value.sourceFeedbackHandle,
        )),
  );
}

function validTaskFeedbackSummary(value: TaskFeedbackSummary | undefined): boolean {
  return Boolean(
    !value ||
      (Number.isInteger(value.total) &&
        value.total > 0 &&
        value.total <= 999 &&
        Number.isInteger(value.pending) &&
        value.pending >= 0 &&
        value.pending <= value.total &&
        typeof value.latestHandle === "string" &&
        /^feedback:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{16}$/u.test(
          value.latestHandle,
        ) &&
        (value.latestAt === undefined || Number.isFinite(Date.parse(value.latestAt)))),
  );
}

function migrateTaskObjectiveProjection(raw: Record<string, unknown>): TaskObjectiveProjection {
  const candidate = raw.objective as
    | (Partial<TaskObjectiveProjection> & { text?: unknown; approved?: unknown })
    | undefined;
  const text = typeof candidate?.text === "string" ? candidate.text : "";
  const approved =
    typeof candidate?.approved === "boolean" ? candidate.approved : false;
  if (
    candidate?.authority === "authoritative" ||
    candidate?.authority === "legacy-projection"
  ) {
    return {
      text,
      approved,
      authority: candidate.authority,
      ...(candidate.reference !== undefined
        ? { reference: candidate.reference }
        : {}),
    } as TaskObjectiveProjection;
  }
  return { text, approved, authority: "legacy-projection" };
}

export function migrateTaskResumeCapsule(value: unknown): TaskResumeCapsule {
  const raw = value as Record<string, unknown> & {
    schemaVersion?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
    lifecycle?: TaskLifecycle;
  };
  const supported = [
    ...LEGACY_CAPSULE_SCHEMA_VERSIONS,
    PREVIOUS_CAPSULE_SCHEMA_VERSION,
    TASK_CAPSULE_SCHEMA_VERSION,
  ] as unknown[];
  if (!supported.includes(raw.schemaVersion)) {
    throw new Error("Task resume capsule is invalid.");
  }
  const createdAt =
    typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString();
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : createdAt;
  const objective = migrateTaskObjectiveProjection(raw);
  const title =
    typeof raw.title === "string" && raw.title.trim()
      ? taskTitleFromObjective(raw.title)
      : taskTitleFromObjective(objective.text);
  const hasUntrustedV1ChangeSurface =
    (raw as { changeSurface?: { schemaVersion?: unknown } }).changeSurface
      ?.schemaVersion === 1;
  if (hasUntrustedV1ChangeSurface) {
    const {
      changeSurface: _changeSurface,
      changeInvalidation: _changeInvalidation,
      validation: _validation,
      visualReview: _visualReview,
      completion: _completion,
      expiresAt: _expiresAt,
      ...preserved
    } = raw;
    const priorScope = raw.scope as
      | { covered?: unknown; remaining?: unknown }
      | undefined;
    const remaining = Array.isArray(priorScope?.remaining)
      ? priorScope.remaining.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    const relockAction =
      "Relock ChangeSurface as v2 before implementation or validation.";
    const lifecycle = lifecycleForPhase(
      undefined,
      "prepared",
      createdAt,
      createdAt,
    );
    return {
      ...(preserved as unknown as Omit<
        TaskResumeCapsule,
        | "schemaVersion"
        | "status"
        | "expiresAt"
        | "lifecycle"
        | "scope"
        | "changeSurface"
        | "changeInvalidation"
        | "validation"
        | "visualReview"
        | "completion"
        | "nextSafeAction"
      >),
      schemaVersion: TASK_CAPSULE_SCHEMA_VERSION,
      title,
      objective,
      status: "active",
      lifecycle,
      scope: {
        covered: Array.isArray(priorScope?.covered)
          ? priorScope.covered.filter(
              (item): item is string => typeof item === "string",
            )
          : [],
        remaining: [relockAction, ...remaining.filter((item) => item !== relockAction)],
      },
      nextSafeAction: relockAction,
    };
  }
  if (raw.schemaVersion === TASK_CAPSULE_SCHEMA_VERSION) {
    return { ...raw, objective, title } as unknown as TaskResumeCapsule;
  }
  const phase = lifecyclePhaseFromLegacy(
    raw as unknown as {
      status?: unknown;
      scope?: { covered?: unknown };
      changeSurface?: unknown;
    },
  );
  let lifecycle = lifecycleForPhase(undefined, "prepared", createdAt, createdAt);
  if (phase !== "prepared") lifecycle = lifecycleForPhase(lifecycle, phase, updatedAt);
  return {
    ...(raw as unknown as Omit<TaskResumeCapsule, "schemaVersion" | "lifecycle">),
    schemaVersion: TASK_CAPSULE_SCHEMA_VERSION,
    title,
    objective,
    lifecycle,
  };
}

export function validTaskValidation(
  value: TaskValidationReference | undefined,
  changeSurface: Pick<LockedChangeSurface, "lockId"> | undefined,
): boolean {
  if (!value) return true;
  return Boolean(
    changeSurface &&
      value.lockId === changeSurface.lockId &&
      /^[a-f0-9]{24}$/u.test(value.lockId) &&
      DELTA_HASH.test(value.deltaHash) &&
      Number.isFinite(Date.parse(value.validatedAt)),
  );
}

export function validChangeInvalidation(
  value: TaskChangeInvalidation | undefined,
  changeSurface: Pick<LockedChangeSurface, "lockId"> | undefined,
): boolean {
  if (!value) return true;
  return Boolean(
    changeSurface &&
      value.relockRequired === true &&
      value.previousLockId === changeSurface.lockId &&
      /^[a-f0-9]{24}$/u.test(value.previousLockId) &&
      value.reason.trim() &&
      value.reason.length <= 240 &&
      Number.isFinite(Date.parse(value.invalidatedAt)),
  );
}

export function validTaskVisualReview(
  value: TaskVisualReview | undefined,
): boolean {
  if (!value) return true;
  const bounded = (candidate: unknown, maximum: number) =>
    typeof candidate === "string" &&
    candidate.trim().length > 0 &&
    candidate.length <= maximum &&
    !/[\u0000-\u001f]/u.test(candidate);
  if (value.schemaVersion === 3) {
    return Boolean(
      VISUAL_REVIEW_HANDLE.test(value.receiptHandle) &&
        /^[a-f0-9]{64}$/u.test(value.receiptHash),
    );
  }
  if (value.schemaVersion === 2) {
    return Boolean(
      VISUAL_REVIEW_HANDLE.test(value.receiptHandle) &&
        /^[a-f0-9]{64}$/u.test(value.receiptHash) &&
        VISUAL_HANDLE.test(value.contractHandle) &&
        VISUAL_HASH.test(value.contractHash) &&
        ["pass", "fix-and-recapture", "blocked"].includes(value.result) &&
        Number.isInteger(value.captureCount) &&
        value.captureCount >= 0 &&
        value.captureCount <= 24 &&
        Number.isInteger(value.deviationCount) &&
        value.deviationCount >= 0 &&
        value.deviationCount <= 99 &&
        [
          "clean",
          "selected-retained",
          "not-applicable",
          "cleanup-pending",
        ].includes(value.cleanup?.state) &&
        (value.cleanup?.receipt === undefined ||
          bounded(value.cleanup.receipt, 260)) &&
        (value.reviewedAt === undefined ||
          Number.isFinite(Date.parse(value.reviewedAt))) &&
        (value.result !== "pass" || value.captureCount > 0),
    );
  }
  return Boolean(
    value.schemaVersion === 1 &&
      VISUAL_HANDLE.test(value.contractHandle) &&
      VISUAL_HASH.test(value.contractHash) &&
      bounded(value.stateMatrix?.surface, 120) &&
      Array.isArray(value.stateMatrix?.viewports) &&
      value.stateMatrix.viewports.length > 0 &&
      value.stateMatrix.viewports.length <= 6 &&
      value.stateMatrix.viewports.every((item) => bounded(item, 48)) &&
      Array.isArray(value.stateMatrix?.requiredStates) &&
      value.stateMatrix.requiredStates.length > 0 &&
      value.stateMatrix.requiredStates.length <= 14 &&
      value.stateMatrix.requiredStates.every((item) => bounded(item, 48)) &&
      Array.isArray(value.captures) &&
      value.captures.length <= 8 &&
      value.captures.every(
        (capture) =>
          bounded(capture?.handle, 260) &&
          bounded(capture?.viewport, 48) &&
          bounded(capture?.state, 48),
      ) &&
      ["pass", "fix-and-recapture", "blocked"].includes(value.result) &&
      Number.isInteger(value.deviationCount) &&
      value.deviationCount >= 0 &&
      value.deviationCount <= 99 &&
      [
        "clean",
        "selected-retained",
        "not-applicable",
        "cleanup-pending",
      ].includes(value.cleanup?.state) &&
      (value.cleanup?.receipt === undefined ||
        bounded(value.cleanup.receipt, 260)) &&
      Number.isFinite(Date.parse(value.reviewedAt)) &&
      (value.result !== "pass" || value.captures.length > 0),
  );
}

export function validTaskCompletion(
  value: TaskCompletionSummary | undefined,
): boolean {
  return Boolean(
    !value ||
      (["success", "failure", "partial"].includes(value.result) &&
        typeof value.summary === "string" &&
        value.summary.trim().length > 0 &&
        value.summary.length <= 1_000 &&
        Array.isArray(value.verification) &&
        value.verification.length > 0 &&
        value.verification.length <= 12 &&
        value.verification.every(
          (item) => typeof item === "string" && item.length <= 500,
        ) &&
        Array.isArray(value.files) &&
        value.files.length <= 100 &&
        value.files.every(
          (item) => typeof item === "string" && item.length <= 500,
        ) &&
        (value.deliveryReceipt === undefined ||
          /^delivery:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{16}$/u.test(
            value.deliveryReceipt,
          )) &&
        (value.lock === undefined ||
          (/^[a-f0-9]{24}$/u.test(value.lock.id) &&
            Number.isInteger(value.lock.revision) &&
            value.lock.revision > 0))),
  );
}

export function taskContextResumeHandles(
  context: TaskContextHandleSource,
): string[] {
  return [
    ...(context.selections ?? []),
    ...(context.code ?? []).map((item) => `code:${item.id}`),
    ...(context.memory ?? []).map((item) =>
      item.id.startsWith("memory:") ? item.id : `memory:${item.id}`,
    ),
    ...(context.design?.candidates ?? []).map((item) => `design:${item.id}`),
  ]
    .filter((handle) => EXPANDABLE_HANDLE_PATTERN.test(handle))
    .filter((handle, index, collection) => collection.indexOf(handle) === index)
    .slice(0, 8);
}

function prioritizedResumeHandles(handles: string[]): string[] {
  const priority = (handle: string): number =>
    handle.startsWith("continuation:")
      ? 0
      : handle.startsWith("contract:")
        ? 1
        : handle.startsWith("figma-snapshot:")
          ? 2
          : handle.startsWith("delivery:")
            ? 3
            : 4;
  return handles
    .map((handle, index) => ({ handle, index, priority: priority(handle) }))
    .toSorted(
      (left, right) => left.priority - right.priority || left.index - right.index,
    )
    .map(({ handle }) => handle);
}

function requiredActiveResumeHandles(capsule: TaskResumeCapsule): string[] {
  if (capsule.status === "completed") return [];
  const first = (prefix: string): string | undefined =>
    capsule.handles.find((handle) => handle.startsWith(prefix));
  return [
    first("continuation:"),
    first("contract:"),
    first("figma-snapshot:"),
  ].filter((handle): handle is string => handle !== undefined);
}

function compactResumeHandles(
  capsule: TaskResumeCapsule,
  maximum: number,
): string[] {
  const required = requiredActiveResumeHandles(capsule);
  return [
    ...required,
    ...prioritizedResumeHandles(capsule.handles).filter(
      (handle) => !required.includes(handle),
    ),
  ].slice(0, maximum);
}

export function fitTaskResumeCapsuleStorageBudget(
  inputCapsule: TaskResumeCapsule,
): TaskResumeCapsule {
  const fullChangeSurface = inputCapsule.changeSurface;
  const capsule =
    inputCapsule.status !== "completed" && fullChangeSurface
      ? (() => {
          const {
            changeSurface: _immutableChangeSurface,
            ...withoutImmutableChangeSurface
          } = inputCapsule;
          return {
            ...withoutImmutableChangeSurface,
            changeSurfaceArtifact:
              lockedChangeSurfaceArtifactReference(fullChangeSurface),
          };
        })()
      : inputCapsule;
  const fitsTargetAfterHydration = (candidate: TaskResumeCapsule): boolean => {
    if (!fullChangeSurface || !candidate.changeSurfaceArtifact) {
      return (
        Buffer.byteLength(JSON.stringify(candidate), "utf8") <=
        TARGET_TASK_CAPSULE_BYTES
      );
    }
    const {
      changeSurfaceArtifact: _changeSurfaceArtifact,
      ...withoutArtifactReference
    } = candidate;
    return (
      Buffer.byteLength(
        JSON.stringify({
          ...withoutArtifactReference,
          changeSurface: fullChangeSurface,
        }),
        "utf8",
      ) <= TARGET_TASK_CAPSULE_BYTES
    );
  };
  if (fitsTargetAfterHydration(capsule)) {
    return capsule;
  }
  const { sourceRelations: _sourceRelations, ...capsuleWithoutRelations } =
    capsule;
  const compact: TaskResumeCapsule = {
    ...capsuleWithoutRelations,
    objective: {
      ...capsule.objective,
      text: shortTaskText(capsule.objective.text, 320),
    },
    decisions:
      capsule.status === "completed"
        ? []
        : capsule.decisions.slice(0, 8).map((decision) => ({
            ...decision,
            id: shortTaskText(decision.id, 120),
            reference: shortTaskText(decision.reference, 80),
          })),
    ...(capsule.status !== "completed" && capsule.sourceRelations
      ? { sourceRelations: capsule.sourceRelations.slice(0, 8) }
      : {}),
    sourceReceiptIds: capsule.sourceReceiptIds.slice(0, 12),
    handles: compactResumeHandles(capsule, 4),
    ...(capsule.completion
      ? {
          completion: {
            ...capsule.completion,
            summary: shortTaskText(capsule.completion.summary, 400),
            verification: capsule.completion.verification
              .slice(0, 4)
              .map((item) => shortTaskText(item, 200)),
            files: capsule.completion.files
              .slice(0, 20)
              .map((item) => shortTaskText(item, 260)),
          },
        }
      : {}),
    scope:
      capsule.status === "completed"
        ? { covered: ["delivery completed"], remaining: [] }
        : {
            covered: capsule.scope.covered
              .slice(0, 4)
              .map((item) => shortTaskText(item, 96)),
            remaining: capsule.scope.remaining
              .slice(0, 4)
              .map((item) => shortTaskText(item, 96)),
          },
    ...(capsule.activePolicy
      ? {
          activePolicy: {
            ...capsule.activePolicy,
            ...(capsule.activePolicy.excludedSurfaces
              ? {
                  excludedSurfaces: capsule.activePolicy.excludedSurfaces
                    .slice(0, 6)
                    .map((item) => shortTaskText(item, 80)),
                }
              : {}),
          },
        }
      : {}),
    ...(capsule.contextReferences
      ? {
          contextReferences: {
            ...capsule.contextReferences,
            ...(capsule.contextReferences.designCoverageLedger
              ? {
                  designCoverageLedger: {
                    ...capsule.contextReferences.designCoverageLedger,
                    selectedNodeIds:
                      capsule.contextReferences.designCoverageLedger.selectedNodeIds.slice(
                        0,
                        6,
                      ),
                  },
                }
              : {}),
          },
        }
      : {}),
    nextSafeAction:
      capsule.status === "completed"
        ? "Task complete."
        : shortTaskText(capsule.nextSafeAction, 180),
  };
  if (fitsTargetAfterHydration(compact)) {
    return compact;
  }
  const tight: TaskResumeCapsule = {
    ...compact,
    objective: {
      ...compact.objective,
      text: shortTaskText(compact.objective.text, 240),
    },
    decisions: compact.decisions.slice(0, 4).map((decision) => ({
      ...decision,
      id: shortTaskText(decision.id, 80),
      reference: shortTaskText(decision.reference, 64),
    })),
    ...(compact.sourceRelations
      ? { sourceRelations: compact.sourceRelations.slice(0, 4) }
      : {}),
    sourceReceiptIds: compact.sourceReceiptIds.slice(0, 8),
    handles: compactResumeHandles(compact, 3),
    scope: {
      covered: compact.scope.covered.slice(0, 1),
      remaining: compact.scope.remaining.slice(0, 1),
    },
    nextSafeAction: shortTaskText(compact.nextSafeAction, 140),
  };
  if (fitsTargetAfterHydration(tight)) {
    return tight;
  }

  // Decisions, relations and receipt history remain authoritative in the
  // task ledger; ChangeSurface and visual evidence remain in immutable
  // artifacts. Active ChangeSurfaces were projected to integrity-bound artifact
  // references before the first budget check. This last projection removes
  // other rehydratable summaries only when needed. Receipt-backed
  // visual reviews become a lossless v3 pointer to their immutable receipt.
  // Governance is authoritative task state and remains byte-for-byte intact.
  const {
    sourceRelations: _tightSourceRelations,
    contextReferences: _contextReferences,
    executionManifest: _executionManifest,
    validation: _validation,
    ...withoutRehydratableContext
  } = tight;
  const compactBase =
    tight.status === "completed"
      ? (() => {
          const {
            changeSurface: _completedChangeSurface,
            changeInvalidation: _completedChangeInvalidation,
            ...completedWithoutImmutableDuplicates
          } = withoutRehydratableContext;
          return completedWithoutImmutableDuplicates;
        })()
      : withoutRehydratableContext;
  const compactPolicy = tight.activePolicy
    ? (() => {
        const {
          excludedSurfaces: _excludedSurfaces,
          ...essentialPolicy
        } = tight.activePolicy;
        return essentialPolicy;
    })()
    : undefined;
  const {
    checkoutId: _checkoutId,
    ...compactWorkspace
  } = tight.workspace;
  const essentialHandle =
    tight.status === "completed"
      ? undefined
      : capsule.handles.find((handle) => handle.startsWith("continuation:")) ??
        capsule.handles.find((handle) => handle.startsWith("contract:")) ??
        capsule.handles.find((handle) => handle.startsWith("delivery:")) ??
        (!(tight.changeSurface || tight.changeSurfaceArtifact)
          ? (capsule.handles.find((handle) => handle.startsWith("visual:")) ??
            tight.handles[0])
          : undefined);
  const compactVisualReview =
    tight.visualReview?.schemaVersion === 2
      ? {
          schemaVersion: 3 as const,
          receiptHandle: tight.visualReview.receiptHandle,
          receiptHash: tight.visualReview.receiptHash,
        }
      : tight.visualReview;
  const pendingRelockEvidenceHandle =
    capsule.changeInvalidation?.relockRequired && fullChangeSurface
      ? capsule.handles.find(
          (handle) =>
            !fullChangeSurface.evidence.handles.includes(handle),
        )
      : undefined;
  const requiredHandles = requiredActiveResumeHandles(capsule);
  const finalHandles = pendingRelockEvidenceHandle
    ? [
        pendingRelockEvidenceHandle,
        ...requiredHandles.filter(
          (handle) => handle !== pendingRelockEvidenceHandle,
        ),
      ]
    : requiredHandles.length > 0
      ? requiredHandles
      : essentialHandle
        ? [essentialHandle]
        : [];
  return {
    ...compactBase,
    title: shortTaskText(tight.title, 96),
    objective: {
      ...tight.objective,
      // The immutable objective artifact remains authoritative. A shorter
      // prefix is safe only when that checkout-bound reference is present;
      // legacy projections keep the previous self-contained budget.
      text: shortTaskText(
        tight.objective.text,
        tight.objective.reference ? 8 : 32,
      ),
    },
    lifecycle: {
      schemaVersion: 1,
      phase: tight.lifecycle.phase,
      revision: tight.lifecycle.revision,
      preparedAt: tight.lifecycle.preparedAt,
      updatedAt: tight.lifecycle.updatedAt,
    },
    decisions: [],
    workspace: compactWorkspace,
    sourceReceiptIds:
      tight.status === "completed" ? tight.sourceReceiptIds.slice(0, 2) : [],
    handles: finalHandles,
    ...(tight.status !== "completed" && tight.validation
      ? { validation: tight.validation }
      : {}),
    scope: { covered: [], remaining: [] },
    ...(tight.completion
      ? {
          completion: {
            ...tight.completion,
            summary: shortTaskText(tight.completion.summary, 240),
            verification: tight.completion.verification
              .slice(0, 2)
              .map((item) => shortTaskText(item, 160)),
            files: tight.completion.files
              .slice(0, 8)
              .map((item) => shortTaskText(item, 180)),
            ...(tight.changeSurface
              ? {
                  lock: {
                    id: tight.changeSurface.lockId,
                    revision: tight.changeSurface.revision,
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(compactPolicy ? { activePolicy: compactPolicy } : {}),
    ...(compactVisualReview ? { visualReview: compactVisualReview } : {}),
    nextSafeAction: shortTaskText(tight.nextSafeAction, 140),
  };
}

export function validateTaskResumeCapsule(value: unknown): TaskResumeCapsule {
  if (!value || typeof value !== "object") {
    throw new Error("Task resume capsule is invalid.");
  }
  const migratedCapsule = migrateTaskResumeCapsule(value);
  // Validate an embedded legacy/full lock before projecting it to its compact
  // reference. Otherwise a malformed full lock could hide behind valid-looking
  // lockId and integrityHash fields during compaction.
  if (
    (migratedCapsule.changeSurface !== undefined &&
      !isLockedChangeSurface(migratedCapsule.changeSurface)) ||
    (migratedCapsule.changeSurface !== undefined &&
      migratedCapsule.changeSurfaceArtifact !== undefined)
  ) {
    throw new Error("Task resume capsule is invalid.");
  }
  const capsule = fitTaskResumeCapsuleStorageBudget(migratedCapsule);
  if (
    capsule.schemaVersion !== TASK_CAPSULE_SCHEMA_VERSION ||
    !TASK_ID_PATTERN.test(capsule.taskId) ||
    !["active", "blocked", "completed"].includes(capsule.status) ||
    typeof capsule.title !== "string" ||
    !capsule.title.trim() ||
    capsule.title.length > 160 ||
    !isTaskObjectiveProjection(capsule.objective, capsule.taskId) ||
    !validTaskLineage(capsule.lineage, capsule.taskId) ||
    !validTaskFeedbackSummary(capsule.feedbackSummary) ||
    (capsule.governance !== undefined &&
      !isTaskGovernance(capsule.governance)) ||
    !Array.isArray(capsule.decisions) ||
    !Array.isArray(capsule.sourceReceiptIds) ||
    !Array.isArray(capsule.handles) ||
    !Array.isArray(capsule.scope?.covered) ||
    !Array.isArray(capsule.scope?.remaining) ||
    !capsule.workspace?.rootPath ||
    !capsule.workspace.head ||
    (capsule.workspace.checkoutId !== undefined &&
      !/^[a-f0-9]{20}$/u.test(capsule.workspace.checkoutId)) ||
    (capsule.workspace.branch !== undefined &&
      (!capsule.workspace.branch.trim() || capsule.workspace.branch.length > 240)) ||
    !Number.isFinite(capsule.budget?.contextChars) ||
    !validLifecycle(capsule.lifecycle) ||
    ((capsule.status === "completed") !==
      (capsule.lifecycle.phase === "completed")) ||
    (capsule.changeSurface !== undefined &&
      !isLockedChangeSurface(capsule.changeSurface)) ||
    (capsule.changeSurfaceArtifact !== undefined &&
      !isLockedChangeSurfaceArtifactReference(capsule.changeSurfaceArtifact)) ||
    (capsule.changeSurface !== undefined &&
      capsule.changeSurfaceArtifact !== undefined) ||
    !validChangeInvalidation(
      capsule.changeInvalidation,
      capsule.changeSurface ?? capsule.changeSurfaceArtifact,
    ) ||
    !validTaskVisualReview(capsule.visualReview) ||
    !validTaskCompletion(capsule.completion) ||
    (capsule.completion !== undefined && capsule.status !== "completed") ||
    (capsule.status === "completed" && capsule.changeInvalidation !== undefined) ||
    !validTaskValidation(
      capsule.validation,
      capsule.changeSurface ?? capsule.changeSurfaceArtifact,
    ) ||
    !capsule.nextSafeAction
  ) {
    throw new Error("Task resume capsule is invalid.");
  }
  const capsuleBytes = Buffer.byteLength(JSON.stringify(capsule), "utf8");
  if (capsuleBytes > MAX_TASK_CAPSULE_BYTES) {
    const largestFields = Object.entries(capsule)
      .map(([key, field]) => [
        key,
        Buffer.byteLength(JSON.stringify(field), "utf8"),
      ] as const)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([key, bytes]) => `${key}=${bytes}`)
      .join(", ");
    throw new Error(
      `Task resume capsule exceeds its 4 KB storage budget (${capsuleBytes} bytes after compaction; largest fields: ${largestFields}).`,
    );
  }
  if (capsule.activePolicy?.authMockGuard) {
    assertDevelopmentAuthMockGuard(capsule.activePolicy.authMockGuard);
  }
  return capsule;
}

function normalizeLedgerDecisions(value: unknown): TaskSourceDecision[] {
  if (!Array.isArray(value) || value.length > 128) {
    throw new Error("A task source ledger supports at most 128 decisions.");
  }
  const decisions = value.flatMap((_, index, source) =>
    index % 12 === 0
      ? normalizeTaskSourceDecisions(source.slice(index, index + 12))
      : [],
  );
  if (new Set(decisions.map((decision) => decision.id)).size !== decisions.length) {
    throw new Error("A task source ledger decision appears more than once.");
  }
  return decisions;
}

function normalizeLedgerRelations(
  value: unknown,
  decisions: TaskSourceDecision[],
): TaskSourceRelation[] {
  if (!Array.isArray(value) || value.length > 128) {
    throw new Error("A task source ledger supports at most 128 relations.");
  }
  const relations = value.flatMap((_, index, source) =>
    index % 12 === 0
      ? normalizeTaskSourceRelations(source.slice(index, index + 12), decisions)
      : [],
  );
  if (new Set(relations.map((relation) => relation.id)).size !== relations.length) {
    throw new Error("A task source ledger relation appears more than once.");
  }
  return relations;
}

export function validateTaskSourceLedger(value: unknown): TaskSourceLedger {
  if (!value || typeof value !== "object") {
    throw new Error("Task source ledger is invalid.");
  }
  const ledger = value as TaskSourceLedger;
  if (
    ledger.schemaVersion !== 1 ||
    !TASK_ID_PATTERN.test(ledger.taskId) ||
    !Number.isFinite(Date.parse(ledger.updatedAt)) ||
    (ledger.rootPath !== undefined &&
      (typeof ledger.rootPath !== "string" || !path.isAbsolute(ledger.rootPath))) ||
    (ledger.checkoutId !== undefined && typeof ledger.checkoutId !== "string")
  ) {
    throw new Error("Task source ledger is invalid.");
  }
  const decisions = normalizeLedgerDecisions(ledger.decisions);
  const receiptIds = ledger.receiptIds ?? [];
  if (
    !Array.isArray(receiptIds) ||
    receiptIds.length > 128 ||
    receiptIds.some(
      (id) => typeof id !== "string" || !RECEIPT_ID_PATTERN.test(id),
    )
  ) {
    throw new Error("Task source ledger receipt IDs are invalid.");
  }
  return {
    ...ledger,
    decisions,
    relations: normalizeLedgerRelations(ledger.relations, decisions),
    receiptIds: [...new Set(receiptIds)],
  };
}

export function validateTaskFinalReceipt(
  value: unknown,
  taskId: string,
): TaskFinalReceipt {
  const candidate = value as TaskFinalReceipt;
  const objectiveAuthority =
    candidate?.objectiveAuthority ?? "legacy-projection";
  const objectiveApproved = candidate?.objectiveApproved ?? true;
  const receipt = {
    ...candidate,
    objectiveApproved,
    objectiveAuthority,
  } as TaskFinalReceipt;
  let objectiveReferenceValid: boolean;
  try {
    objectiveReferenceValid = Boolean(
      objectiveAuthority === "authoritative" &&
        receipt.objectiveReference &&
        validateTaskObjectiveReference(receipt.objectiveReference, taskId) &&
        computeTaskObjectiveHash(receipt.objective) ===
          receipt.objectiveReference.hash,
    );
  } catch {
    objectiveReferenceValid = false;
  }
  if (
    !receipt ||
    typeof receipt !== "object" ||
    receipt.schemaVersion !== 1 ||
    receipt.taskId !== taskId ||
    !receipt.objective?.trim() ||
    typeof receipt.objectiveApproved !== "boolean" ||
    !["authoritative", "legacy-projection"].includes(objectiveAuthority) ||
    (objectiveAuthority === "authoritative" && !objectiveReferenceValid) ||
    (objectiveAuthority === "legacy-projection" &&
      receipt.objectiveReference !== undefined) ||
    (receipt.governance !== undefined &&
      !isTaskGovernance(receipt.governance)) ||
    !Number.isFinite(Date.parse(receipt.completedAt)) ||
    typeof receipt.head !== "string" ||
    !Array.isArray(receipt.sourceReceiptIds) ||
    (receipt.deliveryReceipt !== undefined &&
      !/^delivery:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{16}$/u.test(
        receipt.deliveryReceipt,
      )) ||
    !validTaskVisualReview(receipt.visualReview) ||
    !validTaskCompletion(receipt.outcome) ||
    (receipt.validation !== undefined &&
      (!receipt.lock ||
        receipt.validation.lockId !== receipt.lock.id ||
        !/^[a-f0-9]{24}$/u.test(receipt.validation.lockId) ||
        !DELTA_HASH.test(receipt.validation.deltaHash) ||
        !Number.isFinite(Date.parse(receipt.validation.validatedAt))))
  ) {
    throw new Error("Task final receipt is invalid.");
  }
  return receipt;
}
