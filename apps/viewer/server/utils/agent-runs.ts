import { randomUUID } from "node:crypto";
import {
  CodexAgentAdapter,
  type AgentAdapter,
  type AgentAdapterStatus,
  type AgentRunEvent,
  type AgentRunMode,
  type AgentSandbox,
  type AgentSourceReference,
} from "@component-atlas/agent";
import type { AgentRunAuditRecord } from "@component-atlas/core";
import { assertMemoryContentSafe } from "@component-atlas/memory";
import { getTaskContext } from "@component-atlas/runtime";
import { AtlasStore } from "@component-atlas/store";
import { createError } from "h3";
import { loadProjectAtlasSnapshot, projectRootPath } from "./project";

const MAX_RUNS = 20;
const MAX_EVENTS_PER_RUN = 160;
const MAX_SOURCE_VALUE_CHARS = 1_000;

export type AgentRunState =
  | "queued"
  | "running"
  | "awaiting-input"
  | "completed"
  | "failed"
  | "cancelled";

export interface StartAgentRunInput {
  mode: AgentRunMode;
  task: string;
  sources: AgentSourceReference[];
  sandbox: AgentSandbox;
  budgetChars: number;
  topK: number;
  selectedHandles: string[];
  figmaFile?: string;
  expectedFingerprint: string;
  threadId?: string;
  answer?: string;
}

interface AgentRunRecord {
  id: string;
  state: AgentRunState;
  mode: AgentRunMode;
  task: string;
  sources: AgentSourceReference[];
  sandbox: AgentSandbox;
  budgetChars: number;
  topK: number;
  selectedHandles: string[];
  figmaFile?: string;
  rootPath: string;
  projectId: string;
  checkoutId?: string;
  startingFingerprint: string;
  createdAt: string;
  updatedAt: string;
  threadId?: string;
  events: Array<{ cursor: number; event: AgentRunEvent }>;
  nextCursor: number;
  contextChars: number;
  estimatedTokens: number;
  truncated: boolean;
  questionCount: number;
  resultStatus?: AgentRunAuditRecord["resultStatus"];
  cancel?: (reason?: string) => void;
}

let adapter: AgentAdapter = new CodexAgentAdapter();
const records = new Map<string, AgentRunRecord>();

function publicRun(record: AgentRunRecord, after = 0) {
  const currentSnapshot = loadProjectAtlasSnapshot();
  return {
    id: record.id,
    state: record.state,
    mode: record.mode,
    sandbox: record.sandbox,
    sources: record.sources.map((source) => ({
      kind: source.kind,
      value: source.value,
    })),
    projectId: record.projectId,
    checkoutId: record.checkoutId,
    startingFingerprint: record.startingFingerprint,
    currentFingerprint: currentSnapshot.fingerprint,
    stale:
      record.state !== "running" &&
      currentSnapshot.fingerprint !== record.startingFingerprint,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    threadId: record.threadId,
    events: record.events.filter((event) => event.cursor > after),
    nextCursor: record.nextCursor,
  };
}

function trimRuns(): void {
  const terminal = [...records.values()]
    .filter((record) =>
      ["completed", "failed", "cancelled"].includes(record.state),
    )
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  while (records.size > MAX_RUNS && terminal.length > 0) {
    records.delete(terminal.shift()!.id);
  }
}

function persistRunAudit(record: AgentRunRecord): void {
  let stale = false;
  try {
    stale = loadProjectAtlasSnapshot().fingerprint !== record.startingFingerprint;
  } catch {
    stale = true;
  }
  const audit: AgentRunAuditRecord = {
    schemaVersion: 1,
    id: record.id,
    projectId: record.projectId,
    ...(record.checkoutId ? { checkoutId: record.checkoutId } : {}),
    startedAt: record.createdAt,
    updatedAt: record.updatedAt,
    mode: record.mode,
    state: record.state,
    sourceKinds: [...new Set(record.sources.map((source) => source.kind))],
    selectedKinds: [
      ...new Set(
        record.selectedHandles.map(
          (handle) => handle.slice(0, handle.indexOf(":")) as "code" | "design" | "memory",
        ),
      ),
    ],
    sandbox: record.sandbox,
    budgetChars: record.budgetChars,
    contextChars: record.contextChars,
    estimatedTokens: record.estimatedTokens,
    truncated: record.truncated,
    eventCount: record.nextCursor,
    questionCount: record.questionCount,
    stale,
    ...(record.resultStatus ? { resultStatus: record.resultStatus } : {}),
  };
  const store = new AtlasStore(record.projectId);
  try {
    store.saveAgentRunAudit(audit);
  } finally {
    store.close();
  }
}

function validateSources(
  sources: AgentSourceReference[],
): AgentSourceReference[] {
  if (sources.length > 12) {
    throw createError({
      statusCode: 400,
      statusMessage: "At most 12 explicit source references are allowed.",
    });
  }
  return sources.map((source) => {
    if (
      !["jira", "confluence", "figma", "other"].includes(source.kind) ||
      !source.value.trim() ||
      source.value.length > MAX_SOURCE_VALUE_CHARS ||
      /[\u0000-\u001f]/.test(source.value) ||
      /^(?:file|javascript|data):/i.test(source.value) ||
      /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])/i.test(source.value)
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: "A source reference is invalid or transient.",
      });
    }
    return { kind: source.kind, value: source.value.trim() };
  });
}

function validateHandles(handles: string[]): string[] {
  return [...new Set(handles)]
    .filter((handle) =>
      /^(?:code|design|memory):[^\u0000-\u001f]{1,240}$/.test(handle),
    )
    .slice(0, 8);
}

function assertNoActiveCheckoutRun(checkoutId: string | undefined): void {
  const active = [...records.values()].find(
    (record) =>
      record.checkoutId === checkoutId &&
      ["queued", "running", "awaiting-input"].includes(record.state),
  );
  if (active) {
    throw createError({
      statusCode: 409,
      statusMessage:
        "This checkout already has an active Codex run. Continue or cancel it first.",
    });
  }
}

function pushEvent(record: AgentRunRecord, event: AgentRunEvent): void {
  record.nextCursor += 1;
  record.events.push({ cursor: record.nextCursor, event });
  if (record.events.length > MAX_EVENTS_PER_RUN) {
    record.events.splice(0, record.events.length - MAX_EVENTS_PER_RUN);
  }
  record.updatedAt = new Date().toISOString();
  if (event.type === "run-started" && event.threadId) {
    record.threadId = event.threadId;
  } else if (event.type === "completed") {
    record.threadId = event.threadId;
    record.state =
      event.result.status === "needs-input" ? "awaiting-input" : "completed";
    record.resultStatus = event.result.status;
  } else if (event.type === "failed") {
    record.state = "failed";
  } else if (event.type === "cancelled") {
    record.state = "cancelled";
  } else if (event.type === "question") {
    record.questionCount += 1;
  }
  if (
    event.type === "question" ||
    event.type === "completed" ||
    event.type === "failed" ||
    event.type === "cancelled"
  ) {
    persistRunAudit(record);
  }
}

async function execute(record: AgentRunRecord, answer?: string): Promise<void> {
  record.state = "running";
  record.updatedAt = new Date().toISOString();
  try {
    const context = await getTaskContext(record.rootPath, record.task, {
      budgetChars: record.budgetChars,
      topK: record.topK,
      selectedHandles: record.selectedHandles,
      ...(record.figmaFile ? { figmaFile: record.figmaFile } : {}),
    });
    const compactContext = JSON.stringify(context);
    record.contextChars = context.metrics.usedChars;
    record.estimatedTokens = context.metrics.estimatedTokens;
    record.truncated = context.metrics.truncated;
    const handle = adapter.run({
      mode: record.mode,
      task: record.task,
      rootPath: record.rootPath,
      compactContext,
      contextMetrics: {
        budgetChars: context.metrics.budgetChars,
        usedChars: context.metrics.usedChars,
        estimatedTokens: context.metrics.estimatedTokens,
        truncated: context.metrics.truncated,
      },
      sources: record.sources,
      sandbox: record.sandbox,
      ...(record.threadId ? { threadId: record.threadId } : {}),
      ...(answer ? { answer } : {}),
    });
    record.cancel = handle.cancel;
    for await (const event of handle.events) pushEvent(record, event);
  } catch (error) {
    pushEvent(record, {
      type: "failed",
      at: new Date().toISOString(),
      code: "runtime",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    record.cancel = undefined;
    persistRunAudit(record);
    trimRuns();
  }
}

export async function agentAdapterStatus(): Promise<AgentAdapterStatus> {
  return adapter.status();
}

export function hasActiveAgentRun(): boolean {
  return [...records.values()].some((record) =>
    ["queued", "running", "awaiting-input"].includes(record.state),
  );
}

export function replaceAgentAdapter(
  replacement: AgentAdapter,
): () => void {
  const previous = adapter;
  adapter = replacement;
  return () => {
    adapter = previous;
  };
}

export function startAgentRun(input: StartAgentRunInput) {
  const snapshot = loadProjectAtlasSnapshot();
  const rootPath = projectRootPath();
  if (input.expectedFingerprint !== snapshot.fingerprint) {
    throw createError({
      statusCode: 409,
      statusMessage:
        "The Atlas snapshot changed after review. Refresh the task context before starting Codex.",
    });
  }
  const task = input.task.trim();
  if (!task || task.length > 6_000) {
    throw createError({
      statusCode: 400,
      statusMessage: "Task intent must contain 1-6,000 characters.",
    });
  }
  const sources = validateSources(input.sources ?? []);
  assertMemoryContentSafe({ task, sources, answer: input.answer });
  const checkoutId = snapshot.graph.project.identity?.checkoutId;
  assertNoActiveCheckoutRun(checkoutId);
  const now = new Date().toISOString();
  const record: AgentRunRecord = {
    id: randomUUID(),
    state: "queued",
    mode: input.mode,
    task,
    sources,
    sandbox: input.sandbox,
    budgetChars: Math.min(12_000, Math.max(800, input.budgetChars)),
    topK: Math.min(10, Math.max(1, input.topK)),
    selectedHandles: validateHandles(input.selectedHandles ?? []),
    ...(input.figmaFile ? { figmaFile: input.figmaFile } : {}),
    rootPath,
    projectId: snapshot.graph.project.id,
    ...(checkoutId ? { checkoutId } : {}),
    startingFingerprint: snapshot.fingerprint,
    createdAt: now,
    updatedAt: now,
    ...(input.threadId ? { threadId: input.threadId } : {}),
    events: [],
    nextCursor: 0,
    contextChars: 0,
    estimatedTokens: 0,
    truncated: false,
    questionCount: 0,
  };
  records.set(record.id, record);
  persistRunAudit(record);
  void execute(record, input.answer);
  return publicRun(record);
}

export function getAgentRun(id: string, after = 0) {
  const record = records.get(id);
  if (!record) {
    throw createError({
      statusCode: 404,
      statusMessage: "Agent run was not found or has expired.",
    });
  }
  return publicRun(record, Math.max(0, after));
}

export function cancelAgentRun(id: string) {
  const record = records.get(id);
  if (!record) {
    throw createError({ statusCode: 404, statusMessage: "Agent run was not found." });
  }
  if (!["queued", "running", "awaiting-input"].includes(record.state)) {
    return publicRun(record);
  }
  if (record.cancel) {
    record.cancel("Cancelled from Project Atlas.");
  } else {
    pushEvent(record, {
      type: "cancelled",
      at: new Date().toISOString(),
      message: "Cancelled from Project Atlas.",
    });
  }
  return publicRun(record);
}

export function resumeAgentRun(
  id: string,
  input: { answer?: string; correction?: string; sandbox?: AgentSandbox },
) {
  const record = records.get(id);
  if (!record) {
    throw createError({ statusCode: 404, statusMessage: "Agent run was not found." });
  }
  if (!["awaiting-input", "completed", "failed", "cancelled"].includes(record.state)) {
    throw createError({
      statusCode: 409,
      statusMessage: "The agent run is still active.",
    });
  }
  const snapshot = loadProjectAtlasSnapshot();
  if (
    snapshot.graph.project.id !== record.projectId ||
    snapshot.graph.project.identity?.checkoutId !== record.checkoutId
  ) {
    throw createError({
      statusCode: 409,
      statusMessage:
        "Project or checkout identity changed. Start a new correction brief instead.",
    });
  }
  const answer = input.answer?.trim();
  const correction = input.correction?.trim();
  if (!answer && !correction) {
    throw createError({
      statusCode: 400,
      statusMessage: "Provide a material answer or correction.",
    });
  }
  assertMemoryContentSafe({ answer, correction });
  if (correction) record.task = correction;
  record.mode = correction ? "correct" : "continue";
  if (input.sandbox) record.sandbox = input.sandbox;
  record.startingFingerprint = snapshot.fingerprint;
  void execute(record, answer);
  return publicRun(record);
}

export function clearAgentRuns(): { cleared: number } {
  const active = [...records.values()].filter((record) =>
    ["queued", "running"].includes(record.state),
  );
  if (active.length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: "Cancel active agent runs before clearing local activity.",
    });
  }
  const cleared = records.size;
  records.clear();
  return { cleared };
}
