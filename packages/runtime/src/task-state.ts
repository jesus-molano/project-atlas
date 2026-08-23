import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFile,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  defaultTaskSourceAuthorityRole,
  defaultTaskSourceRoutePolicy,
  normalizeTaskSourceDecisions,
  normalizeTaskSourceRelations,
  parseSourceReceipt,
  type SourceReceipt,
  type TaskSourceDecision,
} from "@component-atlas/core";
import { fitBudgetedResponse } from "@component-atlas/memory";
import { projectStorageDirectory } from "@component-atlas/store";
import { decode, encode } from "@toon-format/toon";
import { resolveProjectIdentity } from "./identity.js";
import { assertDevelopmentAuthMockGuard } from "./auth-mocks.js";
import {
  assertLockedChangeSurfaceArtifact,
  createLockedChangeSurface,
  type LockedChangeSurface,
  type LockTaskChangeSurfaceInput,
} from "./change-surface-lock.js";
import {
  EXPANDABLE_HANDLE_PATTERN as EXPANDABLE_HANDLE,
  fitTaskResumeCapsuleStorageBudget as fitCapsuleStorageBudget,
  RECEIPT_ID_PATTERN as RECEIPT_ID,
  shortTaskText as short,
  TASK_CAPSULE_SCHEMA_VERSION as CAPSULE_SCHEMA_VERSION,
  TASK_ID_PATTERN as TASK_ID,
  validateTaskFinalReceipt,
  validateTaskResumeCapsule as validateCapsule,
  validateTaskSourceLedger as validateSourceLedger,
  validChangeInvalidation,
  validTaskCompletion,
  validTaskValidation,
  validTaskVisualReview,
  type ResumeCapsuleTransport,
  type TaskCheckpointInput,
  type TaskFinalReceipt,
  type TaskJournalMilestone,
  type TaskResumeCapsule,
  type TaskSourceLedger,
} from "./task-state-contract.js";
import { hydrateTaskResumeCapsule } from "./task-state-hydration.js";
import {
  legacyTaskFilePath,
  sameWorkspaceRoot,
  taskStateFileName,
} from "./task-state-paths.js";
import { lifecycleForPhase } from "./task-lifecycle.js";
import {
  loadTaskObjectiveArtifact,
  normalizeTaskObjective,
  persistTaskObjective,
  resolveTaskObjectiveProjection,
  taskObjectiveReference,
  type ResolvedTaskObjective,
  type TaskObjectiveProjection,
} from "./task-objective.js";
import { mergeTaskGovernance } from "./task-governance.js";
import { loadTaskCompletionReceipt } from "./task-completion-receipt.js";

export type {
  LockedConfirmedOperation,
  LockedChangeSurface,
  LockedReuseDecision,
  LockedSurfacePrimary,
  LockedSurfaceReference,
  LockTaskChangeSurfaceInput,
} from "./change-surface-lock.js";
export type {
  TaskChangeInvalidation,
  TaskChangeInvalidationInput,
  TaskLifecycle,
  TaskLifecyclePhase,
  TaskValidationReference,
} from "./task-lifecycle.js";
export {
  taskContextResumeHandles,
  validateTaskFinalReceipt,
  validateTaskResumeCapsule,
  validateTaskSourceLedger,
} from "./task-state-contract.js";
export type {
  ResumeCapsuleTransport,
  TaskCheckpointInput,
  TaskCompletionSummary,
  TaskContextHandleSource,
  TaskFinalReceipt,
  TaskJournalMilestone,
  TaskResumeCapsule,
  TaskSourceLedger,
  TaskVisualReview,
  LegacyTaskVisualReview,
  ReceiptTaskVisualReview,
} from "./task-state-contract.js";
export type {
  ResolvedTaskObjective,
  TaskObjectiveArtifact,
  TaskObjectiveProjection,
  TaskObjectiveReference,
} from "./task-objective.js";
export type { TaskGovernance } from "./task-governance.js";

const execFileAsync = promisify(execFile);
const MAX_JOURNAL_EVENT_BYTES = 4_096;
const CLOSED_TTL_MS = 24 * 60 * 60 * 1_000;
async function taskStateRoot(rootPath: string): Promise<string> {
  const identity = await resolveProjectIdentity(rootPath);
  return path.join(
    projectStorageDirectory(identity.logicalId),
    "task-state",
  );
}

function legacyTaskStateRoot(rootPath: string): string {
  return path.join(rootPath, ".component-atlas", "task-state");
}

function checkedId(value: string, pattern: RegExp, label: string): string {
  if (!pattern.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

async function atomicJson(filePath: string, value: unknown): Promise<void> {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

async function withTaskCheckpointWriteLock<T>(
  rootPath: string,
  taskId: string,
  action: () => Promise<T>,
): Promise<T> {
  const directory = path.join(await taskStateRoot(rootPath), "capsule-locks");
  await mkdir(directory, { recursive: true });
  const target = path.join(
    directory,
    taskStateFileName(rootPath, taskId, "json").replace(/\.json$/u, ".lock"),
  );
  let lock;
  try {
    lock = await open(target, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new Error(
      "Task resume capsule is locked by another writer. Do not remove the lock automatically; inspect ownership before explicit recovery.",
      { cause: error },
    );
  }
  try {
    await lock.writeFile(
      `${JSON.stringify({ schemaVersion: 1, taskId, pid: process.pid, lockedAt: new Date().toISOString() })}\n`,
      "utf8",
    );
    await lock.sync();
    return await action();
  } finally {
    await lock.close();
    await rm(target, { force: true });
  }
}

function assertCheckpointCompareAndSwap(
  expectedUpdatedAt: string | null | undefined,
  existingCapsule: TaskResumeCapsule | undefined,
): void {
  if (expectedUpdatedAt === undefined) return;
  if (expectedUpdatedAt === null) {
    if (existingCapsule) {
      throw new Error(
        "Task resume capsule changed since it was read: expected no existing capsule.",
      );
    }
    return;
  }
  if (!Number.isFinite(Date.parse(expectedUpdatedAt))) {
    throw new Error("Task checkpoint expectedUpdatedAt is invalid.");
  }
  if (!existingCapsule || existingCapsule.updatedAt !== expectedUpdatedAt) {
    throw new Error(
      "Task resume capsule changed since it was read: expected updatedAt does not match the current capsule.",
    );
  }
}

async function gitHead(rootPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", rootPath, "rev-parse", "HEAD"],
      { windowsHide: true },
    );
    return stdout.trim().slice(0, 64);
  } catch {
    return "unknown";
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeLedgerEntries<T extends { id: string }>(
  existing: T[],
  updates: T[],
): T[] {
  const merged = new Map(existing.map((entry) => [entry.id, entry]));
  for (const entry of updates) merged.set(entry.id, entry);
  if (merged.size > 128) {
    throw new Error("A task source ledger supports at most 128 entries per kind.");
  }
  return [...merged.values()];
}

async function checkpointObjectiveProjection(
  rootPath: string,
  input: Pick<
    TaskCheckpointInput,
    "taskId" | "objective" | "objectiveApproved" | "objectiveReference"
  >,
  existing: TaskResumeCapsule | undefined,
): Promise<TaskObjectiveProjection> {
  const objective = normalizeTaskObjective(input.objective);
  if (input.objectiveReference) {
    const artifact = await loadTaskObjectiveArtifact(
      rootPath,
      input.objectiveReference,
      input.taskId,
    );
    const isKnownProjection = Boolean(
      existing?.objective.authority === "authoritative" &&
        existing.objective.reference?.handle === artifact.handle &&
        existing.objective.text === objective,
    );
    if (artifact.text !== objective && !isKnownProjection) {
      throw new Error(
        "Task objective text does not match the explicit immutable objective reference.",
      );
    }
    return {
      text: short(artifact.text, 480),
      approved: input.objectiveApproved,
      authority: "authoritative",
      reference: taskObjectiveReference(artifact),
    };
  }

  if (existing?.objective.authority === "authoritative") {
    const resolved = await resolveTaskObjectiveProjection(
      rootPath,
      input.taskId,
      existing.objective,
    );
    // Older callers may echo only the bounded capsule text. That is a resume
    // projection, never authority to replace a longer persisted objective.
    if (objective === resolved.text || objective === existing.objective.text) {
      return {
        text: short(resolved.text, 480),
        approved: input.objectiveApproved,
        authority: "authoritative",
        reference: resolved.reference!,
      };
    }
  }

  if (
    existing?.objective.authority === "legacy-projection" &&
    objective === existing.objective.text
  ) {
    return {
      text: existing.objective.text,
      approved: input.objectiveApproved,
      authority: "legacy-projection",
    };
  }

  const artifact = await persistTaskObjective(rootPath, {
    taskId: input.taskId,
    objective,
  });
  return {
    text: short(artifact.text, 480),
    approved: input.objectiveApproved,
    authority: "authoritative",
    reference: taskObjectiveReference(artifact),
  };
}

export function encodeResumeCapsule(
  capsule: TaskResumeCapsule,
): ResumeCapsuleTransport {
  const validated = validateCapsule(capsule);
  const fallbackJson = JSON.stringify(validated);
  try {
    const toon = encode(validated);
    const roundTrip = decode(toon, { strict: true });
    if (
      sameJson(roundTrip, validated) &&
      Buffer.byteLength(toon, "utf8") < Buffer.byteLength(fallbackJson, "utf8")
    ) {
      return {
        format: "toon",
        mediaType: "text/toon",
        body: toon,
        bytes: Buffer.byteLength(toon, "utf8"),
        fallbackAvailable: true,
      };
    }
  } catch {
    // JSON is the canonical readable fallback while TOON remains a transport.
  }
  return {
    format: "json",
    mediaType: "application/json",
    body: fallbackJson,
    bytes: Buffer.byteLength(fallbackJson, "utf8"),
    fallbackAvailable: true,
  };
}

export async function appendTaskJournalMilestone(
  rootPath: string,
  taskId: string,
  milestone: TaskJournalMilestone,
  detail: Record<string, unknown>,
  at = new Date().toISOString(),
): Promise<void> {
  checkedId(taskId, TASK_ID, "Task ID");
  const directory = path.join(await taskStateRoot(rootPath), "journals");
  await mkdir(directory, { recursive: true });
  const event = {
    schemaVersion: 1,
    taskId,
    milestone,
    at,
    detail,
  };
  if (Buffer.byteLength(JSON.stringify(event), "utf8") > MAX_JOURNAL_EVENT_BYTES) {
    throw new Error("Task journal milestone exceeds its 4 KB budget.");
  }
  await appendFile(
    path.join(directory, taskStateFileName(rootPath, taskId, "ndjson")),
    `${JSON.stringify(event)}\n`,
    "utf8",
  );
}

export async function lockTaskChangeSurface(
  rootPath: string,
  input: LockTaskChangeSurfaceInput,
): Promise<LockedChangeSurface> {
  checkedId(input.taskId, TASK_ID, "Task ID");
  const existing = (await loadTaskResumeCapsule(rootPath, input.taskId))
    ?.changeSurface;
  return createLockedChangeSurface(rootPath, input, existing);
}

export async function writeTaskCheckpoint(
  rootPath: string,
  input: TaskCheckpointInput,
): Promise<TaskResumeCapsule> {
  checkedId(input.taskId, TASK_ID, "Task ID");
  return withTaskCheckpointWriteLock(rootPath, input.taskId, () =>
    writeTaskCheckpointLocked(rootPath, input),
  );
}

async function writeTaskCheckpointLocked(
  rootPath: string,
  input: TaskCheckpointInput,
): Promise<TaskResumeCapsule> {
  let now = input.at ?? new Date().toISOString();
  const directory = path.join(await taskStateRoot(rootPath), "capsules");
  await mkdir(directory, { recursive: true });
  const filePath = path.join(
    directory,
    taskStateFileName(rootPath, input.taskId, "json"),
  );
  let createdAt = now;
  let existingCapsule: TaskResumeCapsule | undefined;
  const legacyCentral = legacyTaskFilePath(directory, input.taskId, "json");
  const legacyRepository = legacyTaskFilePath(
    path.join(legacyTaskStateRoot(rootPath), "capsules"),
    input.taskId,
    "json",
  );
  for (const candidate of [filePath, legacyCentral, legacyRepository]) {
    if (!candidate || existingCapsule) continue;
    try {
      existingCapsule = await hydrateTaskResumeCapsule(
        rootPath,
        validateCapsule(JSON.parse(await readFile(candidate, "utf8"))),
      );
      if (!sameWorkspaceRoot(existingCapsule.workspace.rootPath, rootPath)) {
        throw new Error(
          "Task resume capsule belongs to a different repository checkout.",
        );
      }
      createdAt = existingCapsule.createdAt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  assertCheckpointCompareAndSwap(input.expectedUpdatedAt, existingCapsule);
  // `updatedAt` is the public CAS version. Keep it strictly monotonic even
  // when a deterministic caller retries with the same explicit timestamp.
  if (
    existingCapsule &&
    Date.parse(now) <= Date.parse(existingCapsule.updatedAt)
  ) {
    now = new Date(Date.parse(existingCapsule.updatedAt) + 1).toISOString();
  }
  const governance = mergeTaskGovernance(
    existingCapsule?.governance,
    input.governance,
  );
  const status = input.status ?? "active";
  const executionManifest =
    input.executionManifest ?? existingCapsule?.executionManifest;
  const activePolicy = input.activePolicy ?? existingCapsule?.activePolicy;
  const contextReferences =
    input.contextReferences ?? existingCapsule?.contextReferences;
  const changeSurface = input.changeSurface ?? existingCapsule?.changeSurface;
  if (changeSurface) {
    await assertLockedChangeSurfaceArtifact(
      rootPath,
      input.taskId,
      changeSurface,
    );
  }
  const lockChanged = Boolean(
    existingCapsule?.changeSurface &&
      input.changeSurface &&
      existingCapsule.changeSurface.lockId !== input.changeSurface.lockId,
  );
  if (lockChanged && !input.changeSurface?.invalidationReason) {
    throw new Error(
      "A replacement change-surface lock requires its persisted invalidation reason.",
    );
  }
  let changeInvalidation = lockChanged
    ? undefined
    : existingCapsule?.changeInvalidation;
  if (input.changeInvalidation) {
    if (!existingCapsule?.changeSurface || !input.changeInvalidation.reason.trim()) {
      throw new Error(
        "Invalidating a task change requires an existing lock and a reason.",
      );
    }
    const invalidatedAt = input.changeInvalidation.invalidatedAt ?? now;
    changeInvalidation = {
      reason: short(input.changeInvalidation.reason, 240),
      invalidatedAt,
      previousLockId: existingCapsule.changeSurface.lockId,
      relockRequired: true,
    };
    if (!validChangeInvalidation(changeInvalidation, existingCapsule.changeSurface)) {
      throw new Error("Task change invalidation is invalid.");
    }
  }
  // A completed capsule keeps the visual-review hash in completion.verification
  // and, when validated, the full binding in its immutable delivery receipt.
  // Retaining the pre-closeout capture matrix here would duplicate that
  // evidence and can push an otherwise valid resume capsule over 4 KB.
  const visualReview =
    status === "completed" && input.completion
      ? undefined
      : input.visualReview ??
        (lockChanged || changeInvalidation
          ? undefined
          : existingCapsule?.visualReview);
  if (!validTaskVisualReview(visualReview)) {
    throw new Error("Task visual review evidence is invalid.");
  }
  const validation =
    input.validation === null || changeInvalidation
      ? undefined
      : input.validation ?? (lockChanged ? undefined : existingCapsule?.validation);
  if (!validTaskValidation(validation, changeSurface)) {
    throw new Error(
      "Task validation must contain a valid delta hash bound to the active change-surface lock.",
    );
  }
  const completion = input.completion ?? existingCapsule?.completion;
  if (!validTaskCompletion(completion)) {
    throw new Error("Task completion summary is invalid.");
  }
  const requestedLifecyclePhase =
    changeInvalidation
      ? "scoped"
      : input.lifecyclePhase ??
        (status === "completed" || input.milestone === "completed"
      ? "completed"
      : input.milestone === "change-validated"
        ? "validated"
        : input.changeSurface
          ? "scoped"
          : existingCapsule?.lifecycle.phase ?? "prepared");
  const lifecycle = lifecycleForPhase(
    existingCapsule?.lifecycle,
    requestedLifecyclePhase,
    now,
    createdAt,
    (lockChanged && Boolean(input.changeSurface?.invalidationReason)) ||
      Boolean(input.changeInvalidation),
  );
  if (input.activePolicy?.authMode === "dev-mock-no-session") {
    if (!input.activePolicy.authMockGuard) {
      throw new Error(
        "A new development auth mock policy requires an explicit sessionless production guard.",
      );
    }
    assertDevelopmentAuthMockGuard(input.activePolicy.authMockGuard);
  }
  if (
    input.activePolicy?.authMode === "real" &&
    input.activePolicy.authMockGuard
  ) {
    throw new Error("Real authentication cannot carry a development mock guard.");
  }
  const existingLedger = await loadTaskSourceLedger(
    rootPath,
    input.taskId,
  );
  const capsuleDecisions =
    existingCapsule?.decisions.map((decision) => ({
      id: decision.id,
      kind: decision.kind,
      state: decision.state,
      required: decision.required,
      reference: decision.reference,
      origin: decision.origin ?? ("manual" as const),
      ...(decision.relationship ? { relationship: decision.relationship } : {}),
      authorityRole:
        decision.authorityRole ?? defaultTaskSourceAuthorityRole(decision.kind),
      routePolicy:
        decision.routePolicy ??
        defaultTaskSourceRoutePolicy(decision.kind, decision.reference),
      ...(decision.decidedAt ? { decidedAt: decision.decidedAt } : {}),
    })) ?? [];
  const incomingDecisions = normalizeTaskSourceDecisions(input.decisions);
  const effectiveDecisions = mergeLedgerEntries(
    existingLedger?.decisions ?? capsuleDecisions,
    incomingDecisions,
  );
  const priorRelations =
    existingLedger?.relations ?? existingCapsule?.sourceRelations ?? [];
  const effectiveRelations =
    input.sourceRelations !== undefined
      ? normalizeTaskSourceRelations(input.sourceRelations, effectiveDecisions)
      : normalizeTaskSourceRelations(
          priorRelations.filter((relation) => {
            const from = effectiveDecisions.find(
              (decision) => decision.id === relation.fromSourceId,
            );
            const to = effectiveDecisions.find(
              (decision) => decision.id === relation.toSourceId,
            );
            return from?.state === "confirmed" && to?.state === "confirmed";
          }),
          effectiveDecisions,
        );
  const effectiveReceiptIds = [
    ...new Set([
      ...(existingLedger?.receiptIds ?? existingCapsule?.sourceReceiptIds ?? []),
      ...input.sourceReceiptIds.filter((id) => RECEIPT_ID.test(id)),
    ]),
  ];
  if (effectiveReceiptIds.length > 128) {
    throw new Error("A task source ledger supports at most 128 receipt IDs.");
  }
  const capsuleReceiptIds = [
    ...new Set([
      ...input.sourceReceiptIds.filter((id) => RECEIPT_ID.test(id)),
      ...effectiveReceiptIds,
    ]),
  ].slice(0, 20);
  if (
    effectiveDecisions.length > 0 ||
    effectiveRelations.length > 0 ||
    effectiveReceiptIds.length > 0
  ) {
    const ledgerDirectory = path.join(await taskStateRoot(rootPath), "ledgers");
    const ledgerIdentity = await resolveProjectIdentity(rootPath);
    await mkdir(ledgerDirectory, { recursive: true });
    await atomicJson(path.join(ledgerDirectory, taskStateFileName(rootPath, input.taskId, "json")), {
      schemaVersion: 1,
      taskId: input.taskId,
      updatedAt: now,
      rootPath: path.resolve(rootPath),
      ...(ledgerIdentity.checkoutId
        ? { checkoutId: ledgerIdentity.checkoutId }
        : {}),
      decisions: effectiveDecisions,
      relations: effectiveRelations,
      receiptIds: effectiveReceiptIds,
    } satisfies TaskSourceLedger);
  }
  const objective = await checkpointObjectiveProjection(
    rootPath,
    input,
    existingCapsule,
  );
  const capsule = fitCapsuleStorageBudget({
    schemaVersion: CAPSULE_SCHEMA_VERSION,
    taskId: input.taskId,
    status,
    createdAt,
    updatedAt: now,
    ...(status === "completed"
      ? { expiresAt: new Date(Date.parse(now) + CLOSED_TTL_MS).toISOString() }
      : {}),
    objective,
    ...(governance ? { governance } : {}),
    decisions: effectiveDecisions.slice(0, 12).map((decision) => ({
      id: short(decision.id, 160),
      kind: decision.kind,
      state: decision.state,
      required: decision.required,
      reference: short(decision.reference, 120),
      origin: decision.origin,
      ...(decision.relationship ? { relationship: decision.relationship } : {}),
      ...(decision.decidedAt ? { decidedAt: decision.decidedAt } : {}),
      authorityRole:
        decision.authorityRole ??
        defaultTaskSourceAuthorityRole(decision.kind),
      routePolicy:
        decision.routePolicy ??
        defaultTaskSourceRoutePolicy(decision.kind, decision.reference),
    })),
    ...(effectiveRelations.length > 0
      ? { sourceRelations: effectiveRelations }
      : {}),
    sourceReceiptIds: capsuleReceiptIds,
    handles: [
      ...new Set(
        input.handles
          .filter((handle) => EXPANDABLE_HANDLE.test(handle))
          .slice(0, 8),
      ),
    ],
    scope: {
      covered: input.covered.map((item) => short(item, 120)).filter(Boolean).slice(0, 8),
      remaining: input.remaining
        .map((item) => short(item, 120))
        .filter(Boolean)
        .slice(0, 8),
    },
    workspace: {
      rootPath: path.resolve(rootPath),
      head: input.head ?? (await gitHead(rootPath)),
    },
    budget: {
      contextChars: Math.max(800, Math.min(12_000, input.budgetChars)),
      estimatedTokens:
        input.estimatedTokens ?? Math.ceil(input.budgetChars / 4),
    },
    ...(executionManifest ? { executionManifest } : {}),
    ...(activePolicy ? { activePolicy } : {}),
    ...(contextReferences ? { contextReferences } : {}),
    lifecycle,
    ...(changeSurface ? { changeSurface } : {}),
    ...(changeInvalidation ? { changeInvalidation } : {}),
    ...(visualReview ? { visualReview } : {}),
    ...(validation ? { validation } : {}),
    ...(completion ? { completion } : {}),
    nextSafeAction: short(input.nextSafeAction, 240),
  });
  validateCapsule(capsule);
  await atomicJson(filePath, capsule);
  await appendTaskJournalMilestone(
    rootPath,
    input.taskId,
    input.milestone,
    {
      status,
      sourceReceiptIds: capsule.sourceReceiptIds,
      handles: capsule.handles,
      covered: capsule.scope.covered,
      remaining: capsule.scope.remaining,
      nextSafeAction: capsule.nextSafeAction,
      head: capsule.workspace.head,
      lifecycle: capsule.lifecycle.phase,
      objective: {
        authority: capsule.objective.authority,
        ...(capsule.objective.reference
          ? {
              handle: capsule.objective.reference.handle,
              hash: capsule.objective.reference.hash,
            }
          : {}),
      },
      ...(capsule.governance
        ? {
            governance: {
              size: capsule.governance.size,
              risk: capsule.governance.risk,
              reviewTier: capsule.governance.reviewTier,
              reasonCount: capsule.governance.reasons.length,
            },
          }
        : {}),
      ...(capsule.changeSurface
        ? {
            changeSurface: {
              lockId: capsule.changeSurface.lockId,
              revision: capsule.changeSurface.revision,
              baseline: capsule.changeSurface.gitBaseline.handle,
            },
          }
        : {}),
      ...(capsule.validation ? { validation: capsule.validation } : {}),
      ...(capsule.changeInvalidation
        ? { changeInvalidation: capsule.changeInvalidation }
        : {}),
      ...(capsule.visualReview
        ? {
            visualReview: {
              ...(capsule.visualReview.schemaVersion === 2 ||
              capsule.visualReview.schemaVersion === 3
                ? {
                    receiptHandle: capsule.visualReview.receiptHandle,
                    receiptHash: capsule.visualReview.receiptHash,
                  }
                : {}),
              ...(capsule.visualReview.schemaVersion === 3
                ? {}
                : {
                    contractHandle: capsule.visualReview.contractHandle,
                    contractHash: capsule.visualReview.contractHash,
                    result: capsule.visualReview.result,
                    deviationCount: capsule.visualReview.deviationCount,
                    captures:
                      capsule.visualReview.schemaVersion === 2
                        ? capsule.visualReview.captureCount
                        : capsule.visualReview.captures.length,
                    cleanup: capsule.visualReview.cleanup,
                  }),
            },
          }
        : {}),
    },
    now,
  );
  return hydrateTaskResumeCapsule(rootPath, capsule);
}

export async function loadTaskResumeCapsule(
  rootPath: string,
  taskId: string,
): Promise<TaskResumeCapsule | undefined> {
  checkedId(taskId, TASK_ID, "Task ID");
  await pruneExpiredTaskState(rootPath);
  const stateRoot = await taskStateRoot(rootPath);
  const capsuleDirectory = path.join(stateRoot, "capsules");
  const candidates = [
    path.join(capsuleDirectory, taskStateFileName(rootPath, taskId, "json")),
    legacyTaskFilePath(capsuleDirectory, taskId, "json"),
    legacyTaskFilePath(
      path.join(legacyTaskStateRoot(rootPath), "capsules"),
      taskId,
      "json",
    ),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const capsule = await hydrateTaskResumeCapsule(
        rootPath,
        validateCapsule(JSON.parse(await readFile(candidate, "utf8"))),
      );
      if (capsule.taskId !== taskId) {
        throw new Error("Task resume capsule identity is invalid.");
      }
      if (!sameWorkspaceRoot(capsule.workspace.rootPath, rootPath)) {
        throw new Error(
          "Task resume capsule belongs to a different repository checkout.",
        );
      }
      if (capsule.changeSurface) {
        await assertLockedChangeSurfaceArtifact(
          rootPath,
          taskId,
          capsule.changeSurface,
        );
      }
      await resolveTaskObjectiveProjection(rootPath, taskId, capsule.objective);
      return capsule;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

export async function loadTaskSourceLedger(
  rootPath: string,
  taskId: string,
): Promise<TaskSourceLedger | undefined> {
  const stateRoot = await taskStateRoot(rootPath);
  const ledgerDirectory = path.join(stateRoot, "ledgers");
  const candidates = [
    path.join(ledgerDirectory, taskStateFileName(rootPath, taskId, "json")),
    legacyTaskFilePath(ledgerDirectory, taskId, "json"),
    legacyTaskFilePath(
      path.join(legacyTaskStateRoot(rootPath), "ledgers"),
      taskId,
      "json",
    ),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const ledger = validateSourceLedger(
        JSON.parse(await readFile(candidate, "utf8")),
      );
      if (ledger.taskId !== taskId) {
        throw new Error("Task source ledger identity is invalid.");
      }
      const identity = await resolveProjectIdentity(rootPath);
      if (
        ledger.rootPath &&
        !sameWorkspaceRoot(ledger.rootPath, rootPath)
      ) {
        throw new Error("Task source ledger belongs to a different checkout.");
      }
      if (
        ledger.checkoutId &&
        identity.checkoutId &&
        ledger.checkoutId !== identity.checkoutId
      ) {
        throw new Error("Task source ledger belongs to a different checkout.");
      }
      if (!ledger.rootPath) {
        const capsule = await loadTaskResumeCapsule(rootPath, taskId);
        if (!capsule) {
          throw new Error(
            "Legacy task source ledger cannot be bound to this repository checkout.",
          );
        }
      }
      return {
        ...ledger,
        rootPath: path.resolve(rootPath),
        ...(identity.checkoutId ? { checkoutId: identity.checkoutId } : {}),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

export async function loadTaskFinalReceipt(
  rootPath: string,
  taskId: string,
): Promise<TaskFinalReceipt | undefined> {
  checkedId(taskId, TASK_ID, "Task ID");
  try {
    const value = JSON.parse(
      await readFile(
        path.join(
          await taskStateRoot(rootPath),
          "final",
          taskStateFileName(rootPath, taskId, "json"),
        ),
        "utf8",
      ),
    );
    const receipt = validateTaskFinalReceipt(value, taskId);
    if (receipt.objectiveAuthority === "authoritative") {
      const artifact = await loadTaskObjectiveArtifact(
        rootPath,
        receipt.objectiveReference!,
        taskId,
      );
      if (artifact.text !== receipt.objective) {
        throw new Error(
          "Task final receipt objective does not match its immutable artifact.",
        );
      }
    }
    return receipt;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Resolves full objective authority from active or pruned task state. */
export async function resolveTaskObjective(
  rootPath: string,
  taskId: string,
): Promise<ResolvedTaskObjective | undefined> {
  const capsule = await loadTaskResumeCapsule(rootPath, taskId);
  if (capsule) {
    return resolveTaskObjectiveProjection(rootPath, taskId, capsule.objective);
  }
  const finalReceipt = await loadTaskFinalReceipt(rootPath, taskId);
  if (!finalReceipt) return undefined;
  return {
    taskId,
    text: finalReceipt.objective,
    approved: finalReceipt.objectiveApproved,
    authority: finalReceipt.objectiveAuthority,
    projectionText: short(finalReceipt.objective, 480),
    ...(finalReceipt.objectiveReference
      ? { reference: finalReceipt.objectiveReference }
      : {}),
  };
}

export async function loadConfirmedTaskSourceDecision(
  rootPath: string,
  taskId: string,
  sourceDecisionId: string,
): Promise<TaskSourceDecision | TaskResumeCapsule["decisions"][number]> {
  const ledger = await loadTaskSourceLedger(rootPath, taskId);
  const capsule = ledger
    ? undefined
    : await loadTaskResumeCapsule(rootPath, taskId);
  if (!ledger && !capsule) {
    throw new Error(
      "The task source ledger is unavailable. Checkpoint confirmed sources before authoritative retrieval.",
    );
  }
  const decision = (ledger?.decisions ?? capsule!.decisions).find(
    (candidate) => candidate.id === sourceDecisionId,
  );
  if (!decision || decision.state !== "confirmed") {
    throw new Error(
      "The source decision is not confirmed in the task source ledger.",
    );
  }
  return decision;
}

export async function loadTaskResumeTransport(
  rootPath: string,
  taskId: string,
): Promise<ResumeCapsuleTransport | undefined> {
  const capsule = await loadTaskResumeCapsule(rootPath, taskId);
  return capsule ? encodeResumeCapsule(capsule) : undefined;
}

export async function persistSourceReceipts(
  rootPath: string,
  receipts: SourceReceipt[],
): Promise<void> {
  if (receipts.length === 0) return;
  const directory = path.join(await taskStateRoot(rootPath), "receipts");
  await mkdir(directory, { recursive: true });
  for (const receipt of receipts) {
    const validated = parseSourceReceipt(receipt);
    checkedId(validated.id, RECEIPT_ID, "Source receipt ID");
    const target = path.join(directory, `${validated.id}.json`);
    const serialized = `${JSON.stringify(validated, null, 2)}\n`;
    const assertIdenticalExisting = async (): Promise<void> => {
      const existing = parseSourceReceipt(
        JSON.parse(await readFile(target, "utf8")),
      );
      if (JSON.stringify(existing) !== JSON.stringify(validated)) {
        throw new Error(
          `Source receipt ${validated.id} is immutable; create a new receipt for changed evidence.`,
        );
      }
    };
    try {
      await assertIdenticalExisting();
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporary = `${target}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await assertIdenticalExisting();
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

export async function loadPersistedSourceReceipt(
  rootPath: string,
  receiptId: string,
): Promise<SourceReceipt> {
  checkedId(receiptId, RECEIPT_ID, "Source receipt ID");
  const stateRoot = await taskStateRoot(rootPath);
  let source: string;
  try {
    source = await readFile(
      path.join(stateRoot, "receipts", `${receiptId}.json`),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    source = await readFile(
      path.join(
        legacyTaskStateRoot(rootPath),
        "receipts",
        `${receiptId}.json`,
      ),
      "utf8",
    );
  }
  const receipt = parseSourceReceipt(JSON.parse(source));
  if (receipt.id !== receiptId) throw new Error("Source receipt identity is invalid.");
  return receipt;
}

export async function expandSourceReceipt(
  rootPath: string,
  receiptId: string,
  budgetChars = 1_600,
) {
  const receipt = await loadPersistedSourceReceipt(rootPath, receiptId);
  return fitBudgetedResponse(
    { receipt },
    {
      budgetChars,
      totalMatches: 1,
      retrieval: {
        indexedBytesInjected: 0,
        hits: 1,
        misses: 0,
        retries: 0,
        connectorsQueried: [],
        receiptsExpanded: 1,
      },
      preserveKeys: ["receipt"],
    },
  );
}

export async function pruneExpiredTaskState(
  rootPath: string,
  now = new Date(),
): Promise<number> {
  const stateRoot = await taskStateRoot(rootPath);
  const capsules = path.join(stateRoot, "capsules");
  let names: string[];
  try {
    names = await readdir(capsules);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  let removed = 0;
  for (const name of names.filter((candidate) => candidate.endsWith(".json"))) {
    const capsulePath = path.join(capsules, name);
    try {
      const capsule = await hydrateTaskResumeCapsule(
        rootPath,
        validateCapsule(JSON.parse(await readFile(capsulePath, "utf8"))),
      );
      if (!sameWorkspaceRoot(capsule.workspace.rootPath, rootPath)) continue;
      if (capsule.changeSurface) {
        await assertLockedChangeSurfaceArtifact(
          rootPath,
          capsule.taskId,
          capsule.changeSurface,
        );
      }
      if (
        capsule.status !== "completed" ||
        !capsule.expiresAt ||
        Date.parse(capsule.expiresAt) > now.getTime()
      ) {
        continue;
      }
      const resolvedObjective = await resolveTaskObjectiveProjection(
        rootPath,
        capsule.taskId,
        capsule.objective,
      );
      const sourceLedger = await loadTaskSourceLedger(
        rootPath,
        capsule.taskId,
      );
      const boundDeliveryReceipt = capsule.completion?.deliveryReceipt;
      const deliveryReceipt =
        boundDeliveryReceipt ??
        capsule.handles.find((handle) => handle.startsWith("delivery:"));
      const delivery = boundDeliveryReceipt
        ? await loadTaskCompletionReceipt(
            rootPath,
            boundDeliveryReceipt,
            capsule.taskId,
          )
        : undefined;
      const finalValidation =
        capsule.validation ??
        (delivery
          ? {
              lockId: delivery.lockId,
              deltaHash: delivery.deltaHash,
              validatedAt: delivery.completedAt,
            }
          : undefined);
      const finalLock = capsule.changeSurface
        ? {
            id: capsule.changeSurface.lockId,
            revision: capsule.changeSurface.revision,
          }
        : capsule.completion?.lock;
      const finalDirectory = path.join(stateRoot, "final");
      await mkdir(finalDirectory, { recursive: true });
      await atomicJson(
        path.join(
          finalDirectory,
          taskStateFileName(rootPath, capsule.taskId, "json"),
        ),
        {
        schemaVersion: 1,
        taskId: capsule.taskId,
        objective: resolvedObjective.text,
        objectiveApproved: resolvedObjective.approved,
        objectiveAuthority: resolvedObjective.authority,
        ...(resolvedObjective.reference
          ? { objectiveReference: resolvedObjective.reference }
          : {}),
        ...(capsule.governance ? { governance: capsule.governance } : {}),
        completedAt: capsule.updatedAt,
        head: capsule.workspace.head,
        sourceReceiptIds: sourceLedger?.receiptIds ?? capsule.sourceReceiptIds,
        ...(deliveryReceipt
          ? {
              deliveryReceipt,
            }
          : {}),
        ...(finalLock ? { lock: finalLock } : {}),
        ...(finalValidation ? { validation: finalValidation } : {}),
        ...(capsule.visualReview ? { visualReview: capsule.visualReview } : {}),
        ...(capsule.completion ? { outcome: capsule.completion } : {}),
        },
      );
      await rm(capsulePath, { force: true });
      await rm(
        path.join(
          stateRoot,
          "journals",
          taskStateFileName(rootPath, capsule.taskId, "ndjson"),
        ),
        { force: true },
      );
      const legacyJournal = legacyTaskFilePath(
        path.join(stateRoot, "journals"),
        capsule.taskId,
        "ndjson",
      );
      if (legacyJournal) await rm(legacyJournal, { force: true });
      removed += 1;
    } catch {
      // Invalid state is left intact for manual inspection instead of deleted.
    }
  }
  return removed;
}
