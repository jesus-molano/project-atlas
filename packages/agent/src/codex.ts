import { realpath } from "node:fs/promises";
import path from "node:path";
import {
  Codex,
  type ThreadEvent,
  type ThreadOptions,
  type Usage,
} from "@openai/codex-sdk";
import type {
  AgentAdapter,
  AgentAdapterStatus,
  AgentCompactResult,
  AgentRunEvent,
  AgentRunHandle,
  AgentRunRequest,
} from "./types.js";

const MAX_TASK_CHARS = 6_000;
const MAX_CONTEXT_CHARS = 12_000;
const MAX_SOURCES = 12;
const MAX_EVENTS = 500;
const MAX_EVENT_TEXT_CHARS = 2_000;
const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const MIN_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60 * 60_000;

interface CodexThread {
  runStreamed(
    input: string,
    options: { outputSchema: unknown; signal: AbortSignal },
  ): Promise<{ events: AsyncGenerator<ThreadEvent> }>;
}

export interface CodexClient {
  startThread(options?: ThreadOptions): CodexThread;
  resumeThread(id: string, options?: ThreadOptions): CodexThread;
}

const resultSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["completed", "needs-input"] },
    summary: { type: "string", maxLength: 2_000 },
    brief: {
      type: "array",
      maxItems: 12,
      items: { type: "string", maxLength: 600 },
    },
    evidence: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          source: {
            type: "string",
            enum: [
              "repository",
              "atlas",
              "figma",
              "jira",
              "confluence",
              "github",
              "openapi",
              "agent",
            ],
          },
          label: { type: "string", maxLength: 500 },
          handle: { type: "string", maxLength: 500 },
        },
        required: ["source", "label"],
      },
    },
    decisions: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", maxLength: 600 },
          status: { type: "string", enum: ["confirmed", "pending"] },
          recommendation: { type: "string", maxLength: 1_000 },
        },
        required: ["title", "status"],
      },
    },
    risks: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          level: {
            type: "string",
            enum: ["decision-required", "warning", "resolved"],
          },
          title: { type: "string", maxLength: 600 },
          recommendation: { type: "string", maxLength: 1_000 },
        },
        required: ["level", "title", "recommendation"],
      },
    },
    memoryProposals: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", maxLength: 80 },
          title: { type: "string", maxLength: 300 },
          summary: { type: "string", maxLength: 1_000 },
        },
        required: ["type", "title", "summary"],
      },
    },
    outcome: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: {
          type: "string",
          enum: ["implemented", "prepared", "blocked", "failed"],
        },
        summary: { type: "string", maxLength: 1_500 },
        verification: {
          type: "array",
          maxItems: 12,
          items: { type: "string", maxLength: 500 },
        },
      },
      required: ["status", "summary", "verification"],
    },
    question: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: { type: "string", maxLength: 1_000 },
        evidence: {
          type: "array",
          maxItems: 6,
          items: { type: "string", maxLength: 600 },
        },
        recommendation: { type: "string", maxLength: 1_000 },
      },
      required: ["prompt", "evidence", "recommendation"],
    },
  },
  required: [
    "status",
    "summary",
    "brief",
    "evidence",
    "decisions",
    "risks",
    "memoryProposals",
  ],
} as const;

class AsyncEventQueue implements AsyncIterable<AgentRunEvent> {
  private events: AgentRunEvent[] = [];
  private waiters: Array<() => void> = [];
  private closed = false;

  push(event: AgentRunEvent): void {
    if (this.closed) return;
    this.events.push(event);
    for (const wake of this.waiters.splice(0)) wake();
  }

  close(): void {
    this.closed = true;
    for (const wake of this.waiters.splice(0)) wake();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AgentRunEvent> {
    while (!this.closed || this.events.length > 0) {
      const event = this.events.shift();
      if (event) {
        yield event;
        continue;
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
}

function clampText(value: string, limit = MAX_EVENT_TEXT_CHARS): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

function assertRequest(request: AgentRunRequest): void {
  if (!request.task.trim() || request.task.length > MAX_TASK_CHARS) {
    throw new Error(`Task must contain 1-${MAX_TASK_CHARS} characters.`);
  }
  if (request.compactContext.length > MAX_CONTEXT_CHARS) {
    throw new Error(
      `Compact context exceeds the ${MAX_CONTEXT_CHARS}-character adapter cap.`,
    );
  }
  if (request.sources.length > MAX_SOURCES) {
    throw new Error(`At most ${MAX_SOURCES} source references are allowed.`);
  }
  if (request.sourceDecisions.some((source) => source.state === "pending")) {
    throw new Error("Every detected source must be resolved before starting Codex.");
  }
  const confirmed = request.sourceDecisions.filter(
    (source) => source.state === "confirmed",
  );
  if (
    confirmed.length !== request.sources.length ||
    confirmed.some(
      (decision) =>
        !request.sources.some(
          (source) =>
            source.kind === decision.kind &&
            source.value === decision.reference,
        ),
    )
  ) {
    throw new Error("Agent sources do not match the confirmed task source ledger.");
  }
  if (
    request.mode === "prepare" &&
    request.sandbox !== "read-only"
  ) {
    throw new Error("Task preparation must run read-only.");
  }
  if (request.sandbox === "workspace-write" && !request.threadId) {
    throw new Error(
      "A write-capable turn must resume a reviewed Project Atlas thread.",
    );
  }
  if (request.contextMetrics.usedChars > request.contextMetrics.budgetChars) {
    throw new Error("Context metrics exceed the reviewed hard cap.");
  }
}

function buildPrompt(request: AgentRunRequest): string {
  const verb =
    request.mode === "continue"
      ? "Continue"
      : request.mode === "correct"
        ? "Correct"
        : request.mode === "implement"
          ? "Prepare and implement"
          : "Prepare";
  const sources =
    request.sources.length > 0
      ? request.sources
          .map((source) => `- ${source.kind}: ${source.value}`)
          .join("\n")
      : "- No external source was confirmed for this task.";
  const sourceLedger =
    request.sourceDecisions.length > 0
      ? request.sourceDecisions
          .map((source) =>
            source.state === "confirmed"
              ? `- ${source.kind}: confirmed`
              : `- ${source.kind}: ${source.state}; do not access`,
          )
          .join("\n")
      : "- Empty: no source connector is authorized for this task.";
  const confirmedFigmaSources = request.sourceDecisions
    .filter(
      (source) => source.kind === "figma" && source.state === "confirmed",
    )
    .map((source) => `  - ${source.reference}`);
  const figmaIngestion =
    confirmedFigmaSources.length > 0
      ? [
          "Confirmed Figma ingestion (required before repository investigation):",
          ...confirmedFigmaSources,
          "- Connect to and use Figma Desktop MCP, the local MCP server exposed by the Figma desktop application, when it is available and authorized.",
          "- For each confirmed reference, read sparse metadata with the appropriate Figma Desktop MCP operation (`get_metadata` for the supported file, page, or node scope), then immediately call Project Atlas `map_figma_file` with the exact project root, confirmed reference, and returned metadata.",
          "- `map_figma_file` is required even for a direct node reference: it persists the sparse nodes and relationships in Design Atlas before code components are created or the task finishes.",
          "- Codex/Figma skills are instructions or operation prerequisites only; they never replace or precede the Figma Desktop MCP route.",
          "- Use another connector, manual selection, or supplied evidence only when Figma Desktop MCP is not connected, not authorized, or does not cover the operation. Report that condition explicitly and never fabricate metadata from the URL.",
          "- After mapping, refresh Project Atlas task/design context before continuing.",
          "",
        ]
      : [];
  const answer = request.answer
    ? `\nMaterial answer supplied by the user:\n${request.answer}\n`
    : "";
  return [
    `$frontend-task ${verb} this frontend task.`,
    "",
    "Task intent:",
    request.task,
    answer,
    "Explicit source references:",
    sources,
    "",
    "Task-scoped source ledger:",
    sourceLedger,
    "",
    `Risk classification: ${request.risk.level} (${request.risk.reasons.join("; ")})`,
    "",
    "Reviewed compact Project Atlas context:",
    request.compactContext || '{"status":"no-local-context"}',
    "",
    ...figmaIngestion,
    "Execution rules:",
    `- Work only in ${request.rootPath}.`,
    `- This turn is ${request.sandbox}.`,
    "- Preserve existing user changes and inspect the current diff before editing.",
    "- Use a connector only for an explicitly confirmed source above. Relevance alone is not authorization.",
    "- Use only the bounded `api` context extracted from confirmed OpenAPI/Swagger sources; do not inject or reproduce a full specification.",
    "- Do not follow, infer, or add transitive source references without a new user confirmation.",
    "- Omitted, unavailable, replaced, and unlisted sources are optional and must not block progress.",
    "- Do not install or authorize connectors and never read or expose credentials.",
    "- Do not perform external writes, commits, pushes, ticket changes, or documentation publication.",
    "- Ask only when a material decision or contradiction remains. Include evidence and a recommendation.",
    "- Keep task intake, exact references, hypotheses, and run state task-scoped. Propose durable project memory separately; never promote it implicitly.",
    "- Return the requested compact structured result. Do not include raw source documents, code dumps, or transient localhost asset URLs.",
  ]
    .filter(Boolean)
    .join("\n");
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 20 &&
    value.every((item) => typeof item === "string")
  );
}

function parseCompactResult(value: string): AgentCompactResult {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Codex returned a non-object result.");
  }
  const result = parsed as Record<string, unknown>;
  if (
    !["completed", "needs-input"].includes(String(result.status)) ||
    typeof result.summary !== "string" ||
    !isStringArray(result.brief) ||
    !Array.isArray(result.evidence) ||
    !Array.isArray(result.decisions) ||
    !Array.isArray(result.risks) ||
    !Array.isArray(result.memoryProposals)
  ) {
    throw new Error("Codex returned an invalid compact result.");
  }
  return parsed as AgentCompactResult;
}

function eventActivity(event: ThreadEvent): AgentRunEvent | undefined {
  if (event.type === "turn.started") {
    return {
      type: "activity",
      at: new Date().toISOString(),
      phase: "orienting",
      message: "Codex is orienting in the selected checkout.",
    };
  }
  if (event.type !== "item.started" && event.type !== "item.completed") {
    return undefined;
  }
  const item = event.item;
  if (item.type === "todo_list") {
    return {
      type: "activity",
      at: new Date().toISOString(),
      phase: "planning",
      message: "Codex updated the task plan.",
    };
  }
  if (item.type === "mcp_tool_call") {
    return {
      type: "activity",
      at: new Date().toISOString(),
      phase: "reading",
      message: `Codex is consulting ${clampText(item.server, 80)}.`,
    };
  }
  if (item.type === "file_change") {
    return {
      type: "activity",
      at: new Date().toISOString(),
      phase: "editing",
      message: `${item.changes.length} local file change${item.changes.length === 1 ? "" : "s"} recorded.`,
    };
  }
  if (item.type === "command_execution") {
    const validation = /\b(test|typecheck|lint|build|check|vitest|jest|playwright)\b/i.test(
      item.command,
    );
    return {
      type: "activity",
      at: new Date().toISOString(),
      phase: validation ? "validating" : "editing",
      message: validation
        ? "Codex is validating the local change."
        : "Codex is running a bounded local command.",
    };
  }
  if (item.type === "web_search") {
    return {
      type: "activity",
      at: new Date().toISOString(),
      phase: "reading",
      message: "Codex is checking an external public source.",
    };
  }
  return undefined;
}

function classifyError(
  error: unknown,
): Extract<AgentRunEvent, { type: "failed" }> {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const code = /login|auth|unauthor|api key|access token/.test(lower)
    ? "unauthenticated"
    : /abort|timeout|timed out/.test(lower)
      ? "timeout"
      : /not found|enoent|cannot find/.test(lower)
        ? "unavailable"
        : /json|schema|structured|invalid compact/.test(lower)
          ? "invalid-output"
          : "runtime";
  return {
    type: "failed",
    at: new Date().toISOString(),
    code,
    message: clampText(message),
  };
}

function usageSummary(usage: Usage | undefined) {
  return usage
    ? {
        inputTokens: usage.input_tokens,
        cachedInputTokens: usage.cached_input_tokens,
        outputTokens: usage.output_tokens,
      }
    : undefined;
}

export class CodexAgentAdapter implements AgentAdapter {
  readonly id = "codex";
  private client: CodexClient | undefined;
  private initializationError: string | undefined;

  constructor(client?: CodexClient) {
    this.client = client;
  }

  async status(): Promise<AgentAdapterStatus> {
    try {
      this.ensureClient();
    } catch {
      return {
        adapterId: this.id,
        label: "Codex",
        state: "unavailable",
        authentication: "unknown",
        checkedAt: new Date().toISOString(),
        detail:
          this.initializationError ??
          "The Codex SDK transport is unavailable in this installation.",
        supportsResume: true,
        transport: "sdk",
      };
    }
    return {
      adapterId: this.id,
      label: "Codex",
      state: "detected",
      authentication: "unknown",
      checkedAt: new Date().toISOString(),
      detail:
        "Official Codex SDK is available. Authentication is verified only when a reviewed run starts.",
      supportsResume: true,
      transport: "sdk",
    };
  }

  private ensureClient(): CodexClient {
    if (this.client) return this.client;
    try {
      const codexPathOverride = process.env.ATLAS_CODEX_PATH?.trim();
      this.client = new Codex(
        codexPathOverride ? { codexPathOverride } : undefined,
      );
      return this.client;
    } catch (error) {
      this.initializationError =
        error instanceof Error ? clampText(error.message) : String(error);
      throw error;
    }
  }

  run(request: AgentRunRequest): AgentRunHandle {
    const queue = new AsyncEventQueue();
    const controller = new AbortController();
    let cancelled = false;
    void this.execute(request, controller, queue, () => cancelled);
    return {
      cancel(reason?: string) {
        if (cancelled) return;
        cancelled = true;
        controller.abort(new Error(reason || "Cancelled by the user."));
      },
      events: queue,
    };
  }

  private async execute(
    request: AgentRunRequest,
    controller: AbortController,
    queue: AsyncEventQueue,
    isCancelled: () => boolean,
  ): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      assertRequest(request);
      const rootPath = await realpath(path.resolve(request.rootPath));
      const timeoutMs = Math.min(
        MAX_TIMEOUT_MS,
        Math.max(MIN_TIMEOUT_MS, request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      );
      timeout = setTimeout(
        () => controller.abort(new Error("Codex run timed out.")),
        timeoutMs,
      );
      const threadOptions = {
        workingDirectory: rootPath,
        sandboxMode: request.sandbox,
        approvalPolicy: "never" as const,
      };
      const client = this.ensureClient();
      const thread = request.threadId
        ? client.resumeThread(request.threadId, threadOptions)
        : client.startThread(threadOptions);
      const streamed = await thread.runStreamed(buildPrompt(request), {
        outputSchema: resultSchema,
        signal: controller.signal,
      });
      let threadId = request.threadId;
      let finalResponse = "";
      let usage: Usage | undefined;
      let eventCount = 0;
      for await (const event of streamed.events) {
        eventCount += 1;
        if (eventCount > MAX_EVENTS) {
          throw new Error(`Codex exceeded the ${MAX_EVENTS}-event safety cap.`);
        }
        if (event.type === "thread.started") {
          threadId = event.thread_id;
          queue.push({
            type: "run-started",
            at: new Date().toISOString(),
            threadId,
            message: request.threadId
              ? "Codex resumed the reviewed task."
              : "Codex started the reviewed task.",
          });
        }
        const activity = eventActivity(event);
        if (activity) queue.push(activity);
        if (
          event.type === "item.completed" &&
          event.item.type === "agent_message"
        ) {
          finalResponse = event.item.text;
        }
        if (event.type === "turn.completed") usage = event.usage;
        if (event.type === "turn.failed") throw new Error(event.error.message);
        if (event.type === "error") throw new Error(event.message);
      }
      if (!threadId) throw new Error("Codex did not return a thread ID.");
      const result = parseCompactResult(finalResponse);
      if (result.status === "needs-input" && result.question) {
        queue.push({
          type: "question",
          at: new Date().toISOString(),
          prompt: result.question.prompt,
          evidence: result.question.evidence.slice(0, 6),
          recommendation: result.question.recommendation,
        });
      }
      queue.push({
        type: "completed",
        at: new Date().toISOString(),
        threadId,
        result,
        ...(usage ? { usage: usageSummary(usage)! } : {}),
      });
    } catch (error) {
      if (isCancelled()) {
        queue.push({
          type: "cancelled",
          at: new Date().toISOString(),
          message: "Codex run cancelled. Local changes were preserved.",
        });
      } else {
        queue.push(classifyError(error));
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      queue.close();
    }
  }
}
