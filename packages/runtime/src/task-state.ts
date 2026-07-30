import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
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
  type TaskSourceRelation,
} from "@component-atlas/core";
import { fitBudgetedResponse } from "@component-atlas/memory";
import { projectStorageDirectory } from "@component-atlas/store";
import { decode, encode } from "@toon-format/toon";
import { resolveProjectIdentity } from "./identity.js";
import {
  assertDevelopmentAuthMockGuard,
  type DevelopmentAuthMockGuard,
} from "./auth-mocks.js";

const execFileAsync = promisify(execFile);
const CAPSULE_SCHEMA_VERSION = 3 as const;
const PREVIOUS_CAPSULE_SCHEMA_VERSION = 2 as const;
const LEGACY_CAPSULE_SCHEMA_VERSION = 1 as const;
const MAX_CAPSULE_BYTES = 4_096;
const MAX_JOURNAL_EVENT_BYTES = 2_048;
const CLOSED_TTL_MS = 24 * 60 * 60 * 1_000;
const TASK_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;
const RECEIPT_ID = /^receipt-[a-f0-9]{16}$/u;
const EXPANDABLE_HANDLE =
  /^(?:(?:code|design|memory):[^\u0000-\u001f]{1,240}|visual:vd-[A-Za-z0-9_-]+:[a-f0-9]{16}|figma-asset:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{24}|manifest:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{16}|retrieval:[A-Za-z0-9_.:-]{1,160}:[a-z-]{2,32}:[a-f0-9]{16})$/u;

export type TaskJournalMilestone =
  | "objective-approved"
  | "decision-confirmed"
  | "source-resolved"
  | "batch-completed"
  | "change-validated"
  | "blocked"
  | "risk-boundary"
  | "completed";

export interface TaskResumeCapsule {
  schemaVersion:
    | typeof LEGACY_CAPSULE_SCHEMA_VERSION
    | typeof PREVIOUS_CAPSULE_SCHEMA_VERSION
    | typeof CAPSULE_SCHEMA_VERSION;
  taskId: string;
  status: "active" | "blocked" | "completed";
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  objective: { text: string; approved: boolean };
  decisions: Array<{
    id: string;
    kind: TaskSourceDecision["kind"];
    state: TaskSourceDecision["state"];
    required: boolean;
    reference: string;
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
  nextSafeAction: string;
}

export interface TaskCheckpointInput {
  taskId: string;
  status?: TaskResumeCapsule["status"];
  milestone: TaskJournalMilestone;
  objective: string;
  objectiveApproved: boolean;
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
  nextSafeAction: string;
  head?: string;
  at?: string;
}

export interface TaskSourceLedger {
  schemaVersion: 1;
  taskId: string;
  updatedAt: string;
  decisions: TaskSourceDecision[];
  relations: TaskSourceRelation[];
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

function short(value: string, maximum: number): string {
  return value
    .trim()
    .replace(/[\u0000-\u001f]+/gu, " ")
    .slice(0, maximum);
}

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

function validateCapsule(value: unknown): TaskResumeCapsule {
  if (!value || typeof value !== "object") {
    throw new Error("Task resume capsule is invalid.");
  }
  const capsule = value as TaskResumeCapsule;
  if (
    ![
      LEGACY_CAPSULE_SCHEMA_VERSION,
      PREVIOUS_CAPSULE_SCHEMA_VERSION,
      CAPSULE_SCHEMA_VERSION,
    ].includes(capsule.schemaVersion) ||
    !TASK_ID.test(capsule.taskId) ||
    !["active", "blocked", "completed"].includes(capsule.status) ||
    !capsule.objective?.text ||
    typeof capsule.objective.approved !== "boolean" ||
    !Array.isArray(capsule.decisions) ||
    !Array.isArray(capsule.sourceReceiptIds) ||
    !Array.isArray(capsule.handles) ||
    !Array.isArray(capsule.scope?.covered) ||
    !Array.isArray(capsule.scope?.remaining) ||
    !capsule.workspace?.rootPath ||
    !capsule.workspace.head ||
    !Number.isFinite(capsule.budget?.contextChars) ||
    !capsule.nextSafeAction
  ) {
    throw new Error("Task resume capsule is invalid.");
  }
  if (Buffer.byteLength(JSON.stringify(capsule), "utf8") > MAX_CAPSULE_BYTES) {
    throw new Error("Task resume capsule exceeds its 4 KB storage budget.");
  }
  if (capsule.activePolicy?.authMockGuard) {
    assertDevelopmentAuthMockGuard(capsule.activePolicy.authMockGuard);
  }
  return capsule;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function taskContextResumeHandles(
  context: TaskContextHandleSource,
): string[] {
  return [
    ...(context.selections ?? []),
    ...(context.code ?? []).map((item) => `code:${item.id}`),
    ...(context.memory ?? []).map((item) => `memory:${item.id}`),
    ...(context.design?.candidates ?? []).map((item) => `design:${item.id}`),
  ]
    .filter((handle) => EXPANDABLE_HANDLE.test(handle))
    .filter((handle, index, collection) => collection.indexOf(handle) === index)
    .slice(0, 8);
}

function fitCapsuleStorageBudget(
  capsule: TaskResumeCapsule,
): TaskResumeCapsule {
  if (Buffer.byteLength(JSON.stringify(capsule), "utf8") <= MAX_CAPSULE_BYTES) {
    return capsule;
  }
  const compact: TaskResumeCapsule = {
    ...capsule,
    objective: {
      ...capsule.objective,
      text: short(capsule.objective.text, 320),
    },
    decisions: capsule.decisions.slice(0, 8).map((decision) => ({
      ...decision,
      id: short(decision.id, 120),
      reference: short(decision.reference, 80),
    })),
    ...(capsule.sourceRelations
      ? { sourceRelations: capsule.sourceRelations.slice(0, 8) }
      : {}),
    sourceReceiptIds: capsule.sourceReceiptIds.slice(0, 12),
    handles: capsule.handles.slice(0, 4),
    scope: {
      covered: capsule.scope.covered
        .slice(0, 4)
        .map((item) => short(item, 96)),
      remaining: capsule.scope.remaining
        .slice(0, 4)
        .map((item) => short(item, 96)),
    },
    ...(capsule.activePolicy
      ? {
          activePolicy: {
            ...capsule.activePolicy,
            ...(capsule.activePolicy.excludedSurfaces
              ? {
                  excludedSurfaces: capsule.activePolicy.excludedSurfaces
                    .slice(0, 6)
                    .map((item) => short(item, 80)),
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
    nextSafeAction: short(capsule.nextSafeAction, 180),
  };
  if (Buffer.byteLength(JSON.stringify(compact), "utf8") <= MAX_CAPSULE_BYTES) {
    return compact;
  }
  return {
    ...compact,
    handles: compact.handles.slice(0, 2),
    scope: {
      covered: compact.scope.covered.slice(0, 2),
      remaining: compact.scope.remaining.slice(0, 2),
    },
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
    throw new Error("Task journal milestone exceeds its 2 KB budget.");
  }
  await appendFile(
    path.join(directory, `${taskId}.ndjson`),
    `${JSON.stringify(event)}\n`,
    "utf8",
  );
}

export async function writeTaskCheckpoint(
  rootPath: string,
  input: TaskCheckpointInput,
): Promise<TaskResumeCapsule> {
  checkedId(input.taskId, TASK_ID, "Task ID");
  const now = input.at ?? new Date().toISOString();
  const directory = path.join(await taskStateRoot(rootPath), "capsules");
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${input.taskId}.json`);
  let createdAt = now;
  let existingCapsule: TaskResumeCapsule | undefined;
  try {
    existingCapsule = validateCapsule(
      JSON.parse(await readFile(filePath, "utf8")),
    );
    createdAt = existingCapsule.createdAt;
  } catch {
    try {
      existingCapsule = validateCapsule(
        JSON.parse(
          await readFile(
            path.join(
              legacyTaskStateRoot(rootPath),
              "capsules",
              `${input.taskId}.json`,
            ),
            "utf8",
          ),
        ),
      );
      createdAt = existingCapsule.createdAt;
    } catch {
      // Missing or invalid legacy state is left untouched.
    }
  }
  const status = input.status ?? "active";
  const executionManifest =
    input.executionManifest ?? existingCapsule?.executionManifest;
  const activePolicy = input.activePolicy ?? existingCapsule?.activePolicy;
  const contextReferences =
    input.contextReferences ?? existingCapsule?.contextReferences;
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
  const effectiveDecisions =
    input.decisions.length > 0
      ? normalizeTaskSourceDecisions(input.decisions)
      : existingLedger?.decisions ??
        (existingCapsule?.decisions.map((decision) => ({
            id: decision.id,
            kind: decision.kind,
            state: decision.state,
            required: decision.required,
            reference: decision.reference,
            origin: "manual" as const,
            relationship: "primary" as const,
            authorityRole:
              decision.authorityRole ??
              defaultTaskSourceAuthorityRole(decision.kind),
            routePolicy:
              decision.routePolicy ??
              defaultTaskSourceRoutePolicy(decision.kind, decision.reference),
          })) ?? []);
  const normalizedRelations = normalizeTaskSourceRelations(
    input.sourceRelations ??
      existingLedger?.relations ??
      existingCapsule?.sourceRelations ??
      [],
    effectiveDecisions,
  );
  if (effectiveDecisions.length > 0) {
    const ledgerDirectory = path.join(await taskStateRoot(rootPath), "ledgers");
    await mkdir(ledgerDirectory, { recursive: true });
    await atomicJson(path.join(ledgerDirectory, `${input.taskId}.json`), {
      schemaVersion: 1,
      taskId: input.taskId,
      updatedAt: now,
      decisions: effectiveDecisions,
      relations: normalizedRelations,
    } satisfies TaskSourceLedger);
  }
  const capsule = fitCapsuleStorageBudget({
    schemaVersion: CAPSULE_SCHEMA_VERSION,
    taskId: input.taskId,
    status,
    createdAt,
    updatedAt: now,
    ...(status === "completed"
      ? { expiresAt: new Date(Date.parse(now) + CLOSED_TTL_MS).toISOString() }
      : {}),
    objective: {
      text: short(input.objective, 480),
      approved: input.objectiveApproved,
    },
    decisions: effectiveDecisions.slice(0, 12).map((decision) => ({
      id: short(decision.id, 160),
      kind: decision.kind,
      state: decision.state,
      required: decision.required,
      reference: short(decision.reference, 120),
      authorityRole:
        decision.authorityRole ??
        defaultTaskSourceAuthorityRole(decision.kind),
      routePolicy:
        decision.routePolicy ??
        defaultTaskSourceRoutePolicy(decision.kind, decision.reference),
    })),
    ...(normalizedRelations.length > 0
      ? { sourceRelations: normalizedRelations }
      : {}),
    sourceReceiptIds: [
      ...new Set(
        input.sourceReceiptIds
          .filter((id) => RECEIPT_ID.test(id))
          .slice(0, 20),
      ),
    ],
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
    },
    now,
  );
  return capsule;
}

export async function loadTaskResumeCapsule(
  rootPath: string,
  taskId: string,
): Promise<TaskResumeCapsule | undefined> {
  checkedId(taskId, TASK_ID, "Task ID");
  await pruneExpiredTaskState(rootPath);
  const stateRoot = await taskStateRoot(rootPath);
  try {
    return validateCapsule(
      JSON.parse(
        await readFile(
          path.join(stateRoot, "capsules", `${taskId}.json`),
          "utf8",
        ),
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        return validateCapsule(
          JSON.parse(
            await readFile(
              path.join(
                legacyTaskStateRoot(rootPath),
                "capsules",
                `${taskId}.json`,
              ),
              "utf8",
            ),
          ),
        );
      } catch (legacyError) {
        if ((legacyError as NodeJS.ErrnoException).code === "ENOENT") {
          return undefined;
        }
        throw legacyError;
      }
    }
    throw error;
  }
}

function validateSourceLedger(value: unknown): TaskSourceLedger {
  if (!value || typeof value !== "object") {
    throw new Error("Task source ledger is invalid.");
  }
  const ledger = value as TaskSourceLedger;
  if (
    ledger.schemaVersion !== 1 ||
    !TASK_ID.test(ledger.taskId) ||
    !Number.isFinite(Date.parse(ledger.updatedAt))
  ) {
    throw new Error("Task source ledger is invalid.");
  }
  const decisions = normalizeTaskSourceDecisions(ledger.decisions);
  return {
    ...ledger,
    decisions,
    relations: normalizeTaskSourceRelations(ledger.relations, decisions),
  };
}

async function loadTaskSourceLedger(
  rootPath: string,
  taskId: string,
): Promise<TaskSourceLedger | undefined> {
  const stateRoot = await taskStateRoot(rootPath);
  try {
    const ledger = validateSourceLedger(
      JSON.parse(
        await readFile(
          path.join(stateRoot, "ledgers", `${taskId}.json`),
          "utf8",
        ),
      ),
    );
    if (ledger.taskId !== taskId) {
      throw new Error("Task source ledger identity is invalid.");
    }
    return ledger;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
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
    await atomicJson(
      path.join(directory, `${validated.id}.json`),
      validated,
    );
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
      const capsule = validateCapsule(
        JSON.parse(await readFile(capsulePath, "utf8")),
      );
      if (
        capsule.status !== "completed" ||
        !capsule.expiresAt ||
        Date.parse(capsule.expiresAt) > now.getTime()
      ) {
        continue;
      }
      const finalDirectory = path.join(stateRoot, "final");
      await mkdir(finalDirectory, { recursive: true });
      await atomicJson(path.join(finalDirectory, name), {
        schemaVersion: 1,
        taskId: capsule.taskId,
        completedAt: capsule.updatedAt,
        head: capsule.workspace.head,
        sourceReceiptIds: capsule.sourceReceiptIds,
      });
      await rm(capsulePath, { force: true });
      await rm(
        path.join(stateRoot, "journals", `${capsule.taskId}.ndjson`),
        { force: true },
      );
      removed += 1;
    } catch {
      // Invalid state is left intact for manual inspection instead of deleted.
    }
  }
  return removed;
}
