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
  parseSourceReceipt,
  type SourceReceipt,
  type TaskSourceDecision,
} from "@component-atlas/core";
import { fitBudgetedResponse } from "@component-atlas/memory";
import { decode, encode } from "@toon-format/toon";

const execFileAsync = promisify(execFile);
const CAPSULE_SCHEMA_VERSION = 1 as const;
const MAX_CAPSULE_BYTES = 4_096;
const MAX_JOURNAL_EVENT_BYTES = 2_048;
const CLOSED_TTL_MS = 24 * 60 * 60 * 1_000;
const TASK_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;
const RECEIPT_ID = /^receipt-[a-f0-9]{16}$/u;
const EXPANDABLE_HANDLE =
  /^(?:(?:code|design|memory):[^\u0000-\u001f]{1,240}|visual:vd-[A-Za-z0-9_-]+:[a-f0-9]{16})$/u;

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
  schemaVersion: typeof CAPSULE_SCHEMA_VERSION;
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
  }>;
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
  nextSafeAction: string;
}

export interface TaskCheckpointInput {
  taskId: string;
  status?: TaskResumeCapsule["status"];
  milestone: TaskJournalMilestone;
  objective: string;
  objectiveApproved: boolean;
  decisions: TaskSourceDecision[];
  sourceReceiptIds: string[];
  handles: string[];
  covered: string[];
  remaining: string[];
  budgetChars: number;
  estimatedTokens?: number;
  nextSafeAction: string;
  head?: string;
  at?: string;
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

function taskStateRoot(rootPath: string): string {
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
    capsule.schemaVersion !== CAPSULE_SCHEMA_VERSION ||
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
  const directory = path.join(taskStateRoot(rootPath), "journals");
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
  const directory = path.join(taskStateRoot(rootPath), "capsules");
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${input.taskId}.json`);
  let createdAt = now;
  try {
    const existing = validateCapsule(JSON.parse(await readFile(filePath, "utf8")));
    createdAt = existing.createdAt;
  } catch {
    // A missing or invalid prior capsule is replaced by the validated checkpoint.
  }
  const status = input.status ?? "active";
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
    decisions: input.decisions.slice(0, 12).map((decision) => ({
      id: short(decision.id, 160),
      kind: decision.kind,
      state: decision.state,
      required: decision.required,
      reference: short(decision.reference, 120),
    })),
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
  try {
    return validateCapsule(
      JSON.parse(
        await readFile(
          path.join(taskStateRoot(rootPath), "capsules", `${taskId}.json`),
          "utf8",
        ),
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
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
  const directory = path.join(taskStateRoot(rootPath), "receipts");
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

export async function expandSourceReceipt(
  rootPath: string,
  receiptId: string,
  budgetChars = 1_600,
) {
  checkedId(receiptId, RECEIPT_ID, "Source receipt ID");
  const receipt = parseSourceReceipt(JSON.parse(
    await readFile(
      path.join(taskStateRoot(rootPath), "receipts", `${receiptId}.json`),
      "utf8",
    ),
  ));
  if (receipt.id !== receiptId) throw new Error("Source receipt identity is invalid.");
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
  const capsules = path.join(taskStateRoot(rootPath), "capsules");
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
      const finalDirectory = path.join(taskStateRoot(rootPath), "final");
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
        path.join(taskStateRoot(rootPath), "journals", `${capsule.taskId}.ndjson`),
        { force: true },
      );
      removed += 1;
    } catch {
      // Invalid state is left intact for manual inspection instead of deleted.
    }
  }
  return removed;
}
