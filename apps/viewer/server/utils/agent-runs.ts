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
import {
  assessTaskIntake,
  assessTaskRisk,
  confirmedTaskSources,
  normalizeTaskSourceDecisions,
  sourceIdentityFromReference,
  type AgentRunAuditRecord,
  type TaskSourceDecision,
} from "@component-atlas/core";
import { assertMemoryContentSafe } from "@component-atlas/memory";
import {
  persistSourceReceipts,
  writeTaskCheckpoint,
  type TaskJournalMilestone,
  type TaskResumeCapsule,
} from "@component-atlas/runtime";
import { prepareTaskContext } from "@component-atlas/runtime/task-preparation";
import { AtlasStore } from "@component-atlas/store";
import { createError } from "h3";
import { loadProjectAtlasSnapshot, projectRootPath } from "./project";

const MAX_RUNS = 20;
const MAX_EVENTS_PER_RUN = 160;

export type AgentRunState =
  | "queued"
  | "running"
  | "awaiting-input"
  | "completed"
  | "failed"
  | "cancelled";

export interface StartAgentRunInput {
  task: string;
  objectiveConfirmed: boolean;
  sourceDecisions: TaskSourceDecision[];
  budgetChars: number;
  topK: number;
  selectedHandles: string[];
  figmaFile?: string;
  expectedFingerprint: string;
}

export interface StartFigmaSyncRunInput {
  task: string;
  objectiveConfirmed: boolean;
  sourceDecisions: TaskSourceDecision[];
  expectedFingerprint: string;
}

export interface ResumeAgentRunInput {
  answer?: string;
  correction?: string;
  nextStep?: string;
  sandbox?: AgentSandbox;
  mode?: AgentRunMode;
  sourceDecisions?: TaskSourceDecision[];
  budgetChars?: number;
  topK?: number;
  selectedHandles?: string[];
  figmaFile?: string | null;
  expectedFingerprint?: string;
}

interface AgentRunRecord {
  id: string;
  state: AgentRunState;
  mode: AgentRunMode;
  purpose: "task" | "figma-sync";
  task: string;
  objectiveConfirmed: boolean;
  sources: AgentSourceReference[];
  sourceDecisions: TaskSourceDecision[];
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
  checkpoint?: TaskResumeCapsule;
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
    purpose: record.purpose,
    sandbox: record.sandbox,
    sources: record.sources.map((source) => ({
      kind: source.kind,
      value: source.value,
    })),
    sourceDecisions: record.sourceDecisions.map((source) => ({
      id: source.id,
      kind: source.kind,
      origin: source.origin,
      state: source.state,
      required: source.required,
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
    checkpoint: record.checkpoint,
    events: record.events.filter((event) => event.cursor > after),
    nextCursor: record.nextCursor,
  };
}

async function checkpointRun(
  record: AgentRunRecord,
  milestone: TaskJournalMilestone,
  input: {
    status?: TaskResumeCapsule["status"];
    sourceReceiptIds?: string[];
    covered?: string[];
    remaining?: string[];
    nextSafeAction: string;
  },
): Promise<void> {
  record.checkpoint = await writeTaskCheckpoint(record.rootPath, {
    taskId: record.id,
    ...(input.status ? { status: input.status } : {}),
    milestone,
    objective: record.task,
    objectiveApproved: record.objectiveConfirmed,
    decisions: record.sourceDecisions,
    sourceReceiptIds: [
      ...new Set([
        ...(record.checkpoint?.sourceReceiptIds ?? []),
        ...(input.sourceReceiptIds ?? []),
      ]),
    ],
    handles: record.selectedHandles,
    covered: input.covered ?? record.checkpoint?.scope.covered ?? [],
    remaining: input.remaining ?? record.checkpoint?.scope.remaining ?? [],
    budgetChars: record.budgetChars,
    estimatedTokens: record.estimatedTokens,
    nextSafeAction: input.nextSafeAction,
  });
}

function publicRunSummary(record: AgentRunRecord) {
  const currentSnapshot = loadProjectAtlasSnapshot();
  const stale = currentSnapshot.fingerprint !== record.startingFingerprint;
  return {
    id: record.id,
    state: record.state,
    mode: record.mode,
    purpose: record.purpose,
    sandbox: record.sandbox,
    sourceKinds: [...new Set(record.sources.map((source) => source.kind))],
    sourceDecisions: record.sourceDecisions.map((source) => ({ ...source })),
    startingFingerprint: record.startingFingerprint,
    currentFingerprint: currentSnapshot.fingerprint,
    stale,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    threadId: record.threadId,
    checkpoint: record.checkpoint,
    resumable:
      record.purpose === "task" &&
      Boolean(record.threadId) &&
      ["awaiting-input", "completed", "failed", "cancelled"].includes(record.state),
  };
}

export function listAgentRuns() {
  const rootPath = projectRootPath();
  return [...records.values()]
    .filter((record) => record.rootPath === rootPath)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(publicRunSummary);
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
    sourceDecisions: {
      confirmed: record.sourceDecisions.filter(
        (source) => source.state === "confirmed",
      ).length,
      omitted: record.sourceDecisions.filter(
        (source) => source.state === "omitted",
      ).length,
      unavailable: record.sourceDecisions.filter(
        (source) => source.state === "unavailable",
      ).length,
      replaced: record.sourceDecisions.filter(
        (source) => source.state === "replaced",
      ).length,
    },
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

function validateSourceDecisions(
  sources: TaskSourceDecision[],
): TaskSourceDecision[] {
  try {
    return normalizeTaskSourceDecisions(sources);
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage:
        error instanceof Error ? error.message : "The source ledger is invalid.",
    });
  }
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

function publicFailureMessage(
  record: AgentRunRecord,
  message: string,
): string {
  const compact = message.trim().replace(/\s+/gu, " ");
  if (
    /invalid_json_schema|codex_output_schema|response_format|invalid_request_error/iu.test(
      compact,
    )
  ) {
    return record.purpose === "figma-sync"
      ? "The exact Figma source bootstrap could not start because the local Codex integration rejected its structured response. Retry after restarting the updated Atlas runtime; no task context was generated."
      : "Codex could not start the structured Atlas handoff. Retry after restarting the updated local integration.";
  }
  if (
    compact.length > 500 ||
    compact.startsWith("{") ||
    compact.startsWith("[")
  ) {
    return record.purpose === "figma-sync"
      ? "The exact Figma source could not be synchronized. Verify Figma Desktop MCP access and retry this same target; no task context was generated."
      : "The local Codex run failed. Review the confirmed sources and retry from the last safe checkpoint.";
  }
  return compact || "The local Codex run failed.";
}

function pushEvent(record: AgentRunRecord, event: AgentRunEvent): void {
  if (event.type === "failed") {
    event = {
      ...event,
      message: publicFailureMessage(record, event.message),
    };
  }
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
    record.resultStatus = event.result.status;
    const nextState =
      event.result.status === "needs-input" ? "awaiting-input" : "completed";
    void persistSourceReceipts(record.rootPath, event.result.sourceReceipts)
      .then(() =>
        checkpointRun(record, "completed", {
          status:
            event.result.status === "needs-input" ? "blocked" : "completed",
          sourceReceiptIds: event.result.sourceReceipts.map(
            (receipt) => receipt.id,
          ),
          covered: event.result.brief,
          remaining:
            event.result.status === "needs-input" && event.result.question
              ? [event.result.question.prompt]
              : [],
          nextSafeAction:
            event.result.status === "needs-input" && event.result.question
              ? event.result.question.recommendation
              : "Task is complete; expand evidence receipts only for audit.",
        }),
      )
      .then(() => {
        record.state = nextState;
        record.updatedAt = new Date().toISOString();
        persistRunAudit(record);
      })
      .catch((error) => {
        record.state = "failed";
        record.updatedAt = new Date().toISOString();
        record.events.push({
          cursor: ++record.nextCursor,
          event: {
            type: "failed",
            at: record.updatedAt,
            code: "runtime",
            message: error instanceof Error ? error.message : String(error),
          },
        });
        persistRunAudit(record);
      });
  } else if (event.type === "failed") {
    record.state = "failed";
    void checkpointRun(record, "blocked", {
      status: "blocked",
      covered: record.checkpoint?.scope.covered,
      remaining: [event.message],
      nextSafeAction:
        "Review the failure and confirmed sources before resuming this task.",
    }).catch(() => {
      // Preserve the original terminal event even if local checkpoint storage fails.
    });
  } else if (event.type === "cancelled") {
    record.state = "cancelled";
    void checkpointRun(record, "blocked", {
      status: "blocked",
      covered: record.checkpoint?.scope.covered,
      remaining: [event.message],
      nextSafeAction:
        "Resume only after confirming the task scope and current workspace HEAD.",
    }).catch(() => {
      // Preserve cancellation semantics if local checkpoint storage fails.
    });
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
    const context = await prepareTaskContext(
      record.rootPath,
      {
        schemaVersion: 1,
        scope: "task",
        objective: record.task,
        objectiveConfirmed: record.objectiveConfirmed,
        risk: assessTaskRisk(record.task),
        sources: record.sourceDecisions,
      },
      {
      budgetChars: record.budgetChars,
      topK: record.topK,
      selectedHandles: record.selectedHandles,
      ...(record.figmaFile ? { figmaFile: record.figmaFile } : {}),
      },
    );
    const compactContext = JSON.stringify(context);
    record.contextChars = context.metrics.usedChars;
    record.estimatedTokens = context.metrics.estimatedTokens;
    record.truncated = context.metrics.truncated;
    await checkpointRun(
      record,
      context.sourceReceiptIds.length > 0
        ? "source-resolved"
        : "batch-completed",
      {
      sourceReceiptIds: context.sourceReceiptIds,
      covered: ["task intake", "bounded Atlas context"],
      remaining: ["Codex task execution", "validation"],
      nextSafeAction:
        record.mode === "implement"
          ? "Resume the reviewed Codex task in workspace-write mode."
          : "Run the reviewed Codex preparation with this compact context.",
      },
    );
    const handle = adapter.run({
      mode: record.mode,
      purpose: record.purpose,
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
      sourceDecisions: record.sourceDecisions,
      risk: assessTaskRisk(record.task),
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

async function executeFigmaSync(record: AgentRunRecord): Promise<void> {
  record.state = "running";
  record.updatedAt = new Date().toISOString();
  try {
    const handle = adapter.run({
      mode: "prepare",
      purpose: "figma-sync",
      task: record.task,
      rootPath: record.rootPath,
      compactContext: '{"status":"source-gate","contextGenerated":false}',
      contextMetrics: {
        budgetChars: 0,
        usedChars: 0,
        estimatedTokens: 0,
        truncated: false,
      },
      sources: record.sources,
      sourceDecisions: record.sourceDecisions,
      risk: assessTaskRisk(record.task),
      sandbox: "read-only",
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
  const sourceDecisions = validateSourceDecisions(input.sourceDecisions ?? []);
  const risk = assessTaskRisk(task);
  const intake = assessTaskIntake({
    schemaVersion: 1,
    scope: "task",
    objective: task,
    objectiveConfirmed: input.objectiveConfirmed,
    risk,
    sources: sourceDecisions,
  });
  if (intake.status !== "ready") {
    throw createError({
      statusCode: 409,
      statusMessage: intake.reasons.join(" "),
    });
  }
  const sources = confirmedTaskSources(sourceDecisions).map((source) => ({
    kind: source.kind,
    value: source.reference,
  }));
  assertMemoryContentSafe({ task, sources });
  const checkoutId = snapshot.graph.project.identity?.checkoutId;
  assertNoActiveCheckoutRun(checkoutId);
  const now = new Date().toISOString();
  const record: AgentRunRecord = {
    id: randomUUID(),
    state: "queued",
    mode: "prepare",
    purpose: "task",
    task,
    objectiveConfirmed: input.objectiveConfirmed,
    sources,
    sourceDecisions,
    sandbox: "read-only",
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
    events: [],
    nextCursor: 0,
    contextChars: 0,
    estimatedTokens: 0,
    truncated: false,
    questionCount: 0,
  };
  records.set(record.id, record);
  persistRunAudit(record);
  void checkpointRun(record, "risk-boundary", {
    covered: ["objective approval", "source intake"],
    remaining: ["bounded context", "Codex execution", "validation"],
    nextSafeAction: "Generate bounded context only after the runtime gate clears.",
  })
    .then(() => execute(record))
    .catch((error) =>
      pushEvent(record, {
        type: "failed",
        at: new Date().toISOString(),
        code: "runtime",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  return publicRun(record);
}

export function startFigmaSyncRun(input: StartFigmaSyncRunInput) {
  const snapshot = loadProjectAtlasSnapshot();
  const rootPath = projectRootPath();
  if (input.expectedFingerprint !== snapshot.fingerprint) {
    throw createError({
      statusCode: 409,
      statusMessage:
        "The Atlas snapshot changed after review. Refresh before synchronizing Figma.",
    });
  }
  const task = input.task.trim();
  if (!task || task.length > 6_000) {
    throw createError({
      statusCode: 400,
      statusMessage: "Task intent must contain 1-6,000 characters.",
    });
  }
  const sourceDecisions = validateSourceDecisions(input.sourceDecisions ?? []);
  const intake = assessTaskIntake({
    schemaVersion: 1,
    scope: "task",
    objective: task,
    objectiveConfirmed: input.objectiveConfirmed,
    risk: assessTaskRisk(task),
    sources: sourceDecisions,
  });
  if (intake.status !== "ready") {
    throw createError({
      statusCode: 409,
      statusMessage: intake.reasons.join(" "),
    });
  }
  const confirmedFigma = sourceDecisions.filter(
    (source) => source.kind === "figma" && source.state === "confirmed",
  );
  if (confirmedFigma.length !== 1) {
    throw createError({
      statusCode: 409,
      statusMessage:
        "Confirm exactly one authoritative Figma target before synchronization.",
    });
  }
  let identity;
  try {
    identity = sourceIdentityFromReference(
      "figma",
      confirmedFigma[0]!.reference.replace(/^figma:/u, ""),
    );
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage:
        error instanceof Error
          ? error.message
          : "The confirmed Figma identity is invalid.",
    });
  }
  if (!identity.fileKey || !identity.nodeId) {
    throw createError({
      statusCode: 409,
      statusMessage:
        "The confirmed Figma target must include an exact fileKey and nodeId.",
    });
  }
  const sources = [
    {
      kind: "figma" as const,
      value: confirmedFigma[0]!.reference,
    },
  ];
  assertMemoryContentSafe({ task, sources });
  const checkoutId = snapshot.graph.project.identity?.checkoutId;
  assertNoActiveCheckoutRun(checkoutId);
  const now = new Date().toISOString();
  const record: AgentRunRecord = {
    id: randomUUID(),
    state: "queued",
    mode: "prepare",
    purpose: "figma-sync",
    task,
    objectiveConfirmed: input.objectiveConfirmed,
    sources,
    sourceDecisions,
    sandbox: "read-only",
    budgetChars: 0,
    topK: 1,
    selectedHandles: [],
    figmaFile: identity.fileKey,
    rootPath,
    projectId: snapshot.graph.project.id,
    ...(checkoutId ? { checkoutId } : {}),
    startingFingerprint: snapshot.fingerprint,
    createdAt: now,
    updatedAt: now,
    events: [],
    nextCursor: 0,
    contextChars: 0,
    estimatedTokens: 0,
    truncated: false,
    questionCount: 0,
  };
  records.set(record.id, record);
  persistRunAudit(record);
  void checkpointRun(record, "risk-boundary", {
    covered: ["objective approval", "exact Figma source confirmation"],
    remaining: ["exact Figma source receipt", "bounded task context"],
    nextSafeAction:
      "Resolve only the exact confirmed Figma target before generating task context.",
  })
    .then(() => executeFigmaSync(record))
    .catch((error) =>
      pushEvent(record, {
        type: "failed",
        at: new Date().toISOString(),
        code: "runtime",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
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
  input: ResumeAgentRunInput,
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
    input.expectedFingerprint &&
    input.expectedFingerprint !== snapshot.fingerprint
  ) {
    throw createError({
      statusCode: 409,
      statusMessage:
        "The Atlas snapshot changed after review. Refresh the task context before resuming Codex.",
    });
  }
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
  const nextStep = input.nextStep?.trim();
  let sourceLedgerChanged = false;
  if (!answer && !correction && !nextStep) {
    throw createError({
      statusCode: 400,
      statusMessage: "Provide a material answer, next step, or correction.",
    });
  }
  assertMemoryContentSafe({ answer, correction, nextStep });
  if (input.sourceDecisions) {
    const nextDecisions = validateSourceDecisions(input.sourceDecisions);
    if (nextDecisions.some((source) => source.state === "pending")) {
      throw createError({
        statusCode: 409,
        statusMessage: "Resolve every newly detected source before continuing.",
      });
    }
    sourceLedgerChanged =
      JSON.stringify(nextDecisions) !== JSON.stringify(record.sourceDecisions);
    record.sourceDecisions = nextDecisions;
    record.sources = confirmedTaskSources(nextDecisions).map((source) => ({
      kind: source.kind,
      value: source.reference,
    }));
  }
  if (input.mode === "implement") {
    if (
      !record.threadId ||
      record.resultStatus !== "completed" ||
      record.state !== "completed" ||
      input.sandbox !== "workspace-write"
    ) {
      throw createError({
        statusCode: 409,
        statusMessage:
          "Implementation must resume a completed, reviewed read-only thread.",
      });
    }
  }
  if (correction) record.task = `${record.task}\n\nCorrection: ${correction}`;
  if (nextStep) record.task = `${record.task}\n\nNext step: ${nextStep}`;
  record.objectiveConfirmed = true;
  record.mode =
    input.mode === "implement"
      ? "implement"
      : correction
        ? "correct"
        : "continue";
  if (input.sandbox) record.sandbox = input.sandbox;
  if (sourceLedgerChanged) record.sandbox = "read-only";
  if (input.budgetChars !== undefined) {
    record.budgetChars = Math.min(12_000, Math.max(800, input.budgetChars));
  }
  if (input.topK !== undefined) {
    record.topK = Math.min(10, Math.max(1, input.topK));
  }
  if (input.selectedHandles) {
    record.selectedHandles = validateHandles(input.selectedHandles);
  }
  if ("figmaFile" in input) {
    if (input.figmaFile) record.figmaFile = input.figmaFile;
    else delete record.figmaFile;
  }
  record.startingFingerprint = snapshot.fingerprint;
  record.state = "queued";
  void checkpointRun(
    record,
    input.mode === "implement" ? "risk-boundary" : "decision-confirmed",
    {
      covered: record.checkpoint?.scope.covered,
      remaining: record.checkpoint?.scope.remaining,
      nextSafeAction:
        input.mode === "implement"
          ? "Resume the reviewed thread in workspace-write mode."
          : "Resume from this capsule without replaying prior context.",
    },
  )
    .then(() => execute(record, answer))
    .catch((error) =>
      pushEvent(record, {
        type: "failed",
        at: new Date().toISOString(),
        code: "runtime",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
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
