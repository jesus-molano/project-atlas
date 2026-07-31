import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { assertMemoryContentSafe } from "@component-atlas/memory";
import { projectStorageDirectory } from "@component-atlas/store";
import { resolveProjectIdentity } from "./identity.js";
import { taskStateFileName } from "./task-state-paths.js";

const TASK_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const MAX_COMMITTED_RESULT_BYTES = 4_096;
const ACTIONS = [
  "record-episodic",
  "propose-canonical",
  "apply-canonical",
  "reject-proposal",
] as const;

export type MemoryConsentAction = (typeof ACTIONS)[number];
export type MemoryConsentStatus =
  | "issued"
  | "executing"
  | "committed"
  | "consumed";

export interface MemoryConsentReceipt {
  schemaVersion: 1;
  id: string;
  taskId: string;
  action: MemoryConsentAction;
  payloadHash: string;
  status: MemoryConsentStatus;
  issuedAt: string;
  executingAt?: string;
  committedAt?: string;
  consumedAt?: string;
  resultHash?: string;
  result?: Record<string, unknown>;
}

export interface PersistedMemoryConsent {
  receipt: MemoryConsentReceipt;
  created: boolean;
}

export interface MemoryConsentState {
  issued?: MemoryConsentReceipt;
  executing?: MemoryConsentReceipt;
  committed?: MemoryConsentReceipt;
  consumed?: MemoryConsentReceipt;
}

function hashResult(result: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(result)).digest("hex");
}

function normalizeResult(
  result: Record<string, unknown>,
): Record<string, unknown> {
  const serialized = JSON.stringify(result);
  if (!serialized) {
    throw new Error("Memory consent mutation result is not JSON serializable.");
  }
  const normalized = JSON.parse(serialized) as unknown;
  if (
    !normalized ||
    typeof normalized !== "object" ||
    Array.isArray(normalized)
  ) {
    throw new Error("Memory consent mutation result must be a JSON object.");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_COMMITTED_RESULT_BYTES) {
    throw new Error(
      "Memory consent mutation result exceeds the 4 KB audit budget.",
    );
  }
  assertMemoryContentSafe(normalized);
  return normalized as Record<string, unknown>;
}

function validCommittedResult(receipt: MemoryConsentReceipt): boolean {
  if (
    !receipt.result ||
    typeof receipt.result !== "object" ||
    Array.isArray(receipt.result) ||
    typeof receipt.resultHash !== "string" ||
    !HASH.test(receipt.resultHash)
  ) {
    return false;
  }
  try {
    const normalized = normalizeResult(receipt.result);
    return hashResult(normalized) === receipt.resultHash;
  } catch {
    return false;
  }
}

function checkedIdentity(
  taskId: string,
  action: MemoryConsentAction,
  payloadHash: string,
): void {
  if (!TASK_ID.test(taskId)) throw new Error("Memory consent task ID is invalid.");
  if (!ACTIONS.includes(action)) throw new Error("Memory consent action is invalid.");
  if (!HASH.test(payloadHash)) {
    throw new Error("Memory consent payload hash is invalid.");
  }
}

function receiptId(taskId: string, payloadHash: string): string {
  return `consent:${taskId}:${payloadHash.slice(0, 16)}`;
}

function validateReceipt(value: unknown): MemoryConsentReceipt {
  if (!value || typeof value !== "object") {
    throw new Error("Memory consent receipt is invalid.");
  }
  const receipt = value as MemoryConsentReceipt;
  checkedIdentity(receipt.taskId, receipt.action, receipt.payloadHash);
  const issuedAt = Date.parse(receipt.issuedAt);
  const executingAt = receipt.executingAt
    ? Date.parse(receipt.executingAt)
    : Number.NaN;
  const committedAt = receipt.committedAt
    ? Date.parse(receipt.committedAt)
    : Number.NaN;
  const consumedAt = receipt.consumedAt
    ? Date.parse(receipt.consumedAt)
    : Number.NaN;
  const issuedShape =
    receipt.executingAt === undefined &&
    receipt.committedAt === undefined &&
    receipt.consumedAt === undefined &&
    receipt.resultHash === undefined &&
    receipt.result === undefined;
  const executingShape =
    Number.isFinite(executingAt) &&
    executingAt >= issuedAt &&
    receipt.committedAt === undefined &&
    receipt.consumedAt === undefined &&
    receipt.resultHash === undefined &&
    receipt.result === undefined;
  const committedShape =
    Number.isFinite(executingAt) &&
    executingAt >= issuedAt &&
    Number.isFinite(committedAt) &&
    committedAt >= executingAt &&
    receipt.consumedAt === undefined &&
    validCommittedResult(receipt);
  const consumedShape =
    Number.isFinite(executingAt) &&
    executingAt >= issuedAt &&
    Number.isFinite(committedAt) &&
    committedAt >= executingAt &&
    Number.isFinite(consumedAt) &&
    consumedAt >= committedAt &&
    typeof receipt.resultHash === "string" &&
    HASH.test(receipt.resultHash) &&
    receipt.result === undefined;
  if (
    receipt.schemaVersion !== 1 ||
    receipt.id !== receiptId(receipt.taskId, receipt.payloadHash) ||
    !Number.isFinite(issuedAt) ||
    !(
      (receipt.status === "issued" && issuedShape) ||
      (receipt.status === "executing" && executingShape) ||
      (receipt.status === "committed" && committedShape) ||
      (receipt.status === "consumed" && consumedShape)
    )
  ) {
    throw new Error("Memory consent receipt is invalid.");
  }
  return receipt;
}

async function consentRoot(rootPath: string): Promise<string> {
  const identity = await resolveProjectIdentity(rootPath);
  return path.join(
    projectStorageDirectory(identity.logicalId),
    "task-state",
    "memory-consents",
  );
}

async function receiptPath(
  rootPath: string,
  taskId: string,
  payloadHash: string,
  status: MemoryConsentStatus,
): Promise<string> {
  const workspaceTask = taskStateFileName(rootPath, taskId, "json").slice(0, -5);
  return path.join(
    await consentRoot(rootPath),
    `${workspaceTask}-${payloadHash}-${status}.json`,
  );
}

async function loadAt(target: string): Promise<MemoryConsentReceipt | undefined> {
  try {
    return validateReceipt(JSON.parse(await readFile(target, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function persistImmutable(
  target: string,
  receipt: MemoryConsentReceipt,
): Promise<PersistedMemoryConsent> {
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  const assertCompatible = async (): Promise<MemoryConsentReceipt> => {
    const existing = await loadAt(target);
    if (
      !existing ||
      existing.id !== receipt.id ||
      existing.taskId !== receipt.taskId ||
      existing.action !== receipt.action ||
      existing.payloadHash !== receipt.payloadHash ||
      existing.status !== receipt.status ||
      existing.resultHash !== receipt.resultHash
    ) {
      throw new Error(
        "Memory consent receipts are immutable; task, action and payload must remain unchanged.",
      );
    }
    return existing;
  };
  const existing = await loadAt(target);
  if (existing) return { receipt: await assertCompatible(), created: false };

  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  let created = false;
  let persisted = receipt;
  try {
    await link(temporary, target);
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    persisted = await assertCompatible();
  } finally {
    await rm(temporary, { force: true });
  }
  return { receipt: persisted, created };
}

export async function loadMemoryConsentState(
  rootPath: string,
  taskId: string,
  action: MemoryConsentAction,
  payloadHash: string,
): Promise<MemoryConsentState> {
  checkedIdentity(taskId, action, payloadHash);
  const [issued, executing, committed, consumed] = await Promise.all([
    loadAt(await receiptPath(rootPath, taskId, payloadHash, "issued")),
    loadAt(await receiptPath(rootPath, taskId, payloadHash, "executing")),
    loadAt(await receiptPath(rootPath, taskId, payloadHash, "committed")),
    loadAt(await receiptPath(rootPath, taskId, payloadHash, "consumed")),
  ]);
  for (const receipt of [issued, executing, committed, consumed]) {
    if (
      receipt &&
      (receipt.taskId !== taskId ||
        receipt.action !== action ||
        receipt.payloadHash !== payloadHash)
    ) {
      throw new Error("Memory consent receipt identity is invalid.");
    }
  }
  if (executing && !issued) {
    throw new Error("Executing memory consent has no issued receipt.");
  }
  if (committed && !executing) {
    throw new Error("Committed memory consent has no executing receipt.");
  }
  if (consumed && !committed) {
    throw new Error("Consumed memory consent has no committed receipt.");
  }
  if (
    (executing && executing.issuedAt !== issued?.issuedAt) ||
    (committed &&
      (committed.issuedAt !== issued?.issuedAt ||
        committed.executingAt !== executing?.executingAt)) ||
    (consumed &&
      (consumed.issuedAt !== issued?.issuedAt ||
        consumed.executingAt !== executing?.executingAt ||
        consumed.committedAt !== committed?.committedAt ||
        consumed.resultHash !== committed?.resultHash))
  ) {
    throw new Error("Memory consent receipt transition chain is invalid.");
  }
  return {
    ...(issued ? { issued } : {}),
    ...(executing ? { executing } : {}),
    ...(committed ? { committed } : {}),
    ...(consumed ? { consumed } : {}),
  };
}

export async function issueMemoryConsent(
  rootPath: string,
  input: {
    taskId: string;
    action: MemoryConsentAction;
    payloadHash: string;
    at?: string;
  },
): Promise<PersistedMemoryConsent> {
  checkedIdentity(input.taskId, input.action, input.payloadHash);
  const existing = await loadMemoryConsentState(
    rootPath,
    input.taskId,
    input.action,
    input.payloadHash,
  );
  if (existing.issued) return { receipt: existing.issued, created: false };
  const issuedAt = input.at ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(issuedAt))) {
    throw new Error("Memory consent issue time is invalid.");
  }
  const receipt = validateReceipt({
    schemaVersion: 1,
    id: receiptId(input.taskId, input.payloadHash),
    taskId: input.taskId,
    action: input.action,
    payloadHash: input.payloadHash,
    status: "issued",
    issuedAt,
  });
  return persistImmutable(
    await receiptPath(rootPath, input.taskId, input.payloadHash, "issued"),
    receipt,
  );
}

export async function beginMemoryConsentExecution(
  rootPath: string,
  input: {
    taskId: string;
    action: MemoryConsentAction;
    payloadHash: string;
    at?: string;
  },
): Promise<PersistedMemoryConsent> {
  const state = await loadMemoryConsentState(
    rootPath,
    input.taskId,
    input.action,
    input.payloadHash,
  );
  if (!state.issued) {
    throw new Error(
      "Memory consent was not issued by Atlas for this task, action and payload.",
    );
  }
  if (state.executing) {
    return { receipt: state.executing, created: false };
  }
  const executingAt = input.at ?? new Date().toISOString();
  const receipt = validateReceipt({
    ...state.issued,
    status: "executing",
    executingAt,
  });
  return persistImmutable(
    await receiptPath(rootPath, input.taskId, input.payloadHash, "executing"),
    receipt,
  );
}

export async function commitMemoryConsentExecution(
  rootPath: string,
  input: {
    taskId: string;
    action: MemoryConsentAction;
    payloadHash: string;
    result: Record<string, unknown>;
    at?: string;
  },
): Promise<PersistedMemoryConsent> {
  const state = await loadMemoryConsentState(
    rootPath,
    input.taskId,
    input.action,
    input.payloadHash,
  );
  if (!state.executing) {
    throw new Error(
      "Memory consent execution must begin durably before its result is committed.",
    );
  }
  const result = normalizeResult(input.result);
  const resultHash = hashResult(result);
  if (state.committed) {
    if (state.committed.resultHash !== resultHash) {
      throw new Error(
        "Memory consent execution was already committed with a different result.",
      );
    }
    return { receipt: state.committed, created: false };
  }
  const committedAt = input.at ?? new Date().toISOString();
  const receipt = validateReceipt({
    ...state.executing,
    status: "committed",
    committedAt,
    resultHash,
    result,
  });
  return persistImmutable(
    await receiptPath(rootPath, input.taskId, input.payloadHash, "committed"),
    receipt,
  );
}

export function committedMemoryConsentResult(
  receipt: MemoryConsentReceipt,
): Record<string, unknown> {
  const validated = validateReceipt(receipt);
  if (validated.status !== "committed" || !validated.result) {
    throw new Error("Memory consent has no committed mutation result.");
  }
  return validated.result;
}

export async function consumeMemoryConsent(
  rootPath: string,
  input: {
    taskId: string;
    action: MemoryConsentAction;
    payloadHash: string;
    at?: string;
  },
): Promise<PersistedMemoryConsent> {
  const state = await loadMemoryConsentState(
    rootPath,
    input.taskId,
    input.action,
    input.payloadHash,
  );
  if (!state.issued) {
    throw new Error(
      "Memory consent was not issued by Atlas for this task, action and payload.",
    );
  }
  if (state.consumed) return { receipt: state.consumed, created: false };
  if (!state.committed) {
    throw new Error(
      "Memory consent cannot be consumed before its mutation result is committed.",
    );
  }
  const consumedAt = input.at ?? new Date().toISOString();
  const { result: _committedResult, ...committed } = state.committed;
  const receipt = validateReceipt({
    ...committed,
    status: "consumed",
    consumedAt,
  });
  return persistImmutable(
    await receiptPath(rootPath, input.taskId, input.payloadHash, "consumed"),
    receipt,
  );
}
