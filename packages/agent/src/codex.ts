import { realpath } from "node:fs/promises";
import path from "node:path";
import {
  Codex,
  type ThreadEvent,
  type ThreadOptions,
  type Usage,
} from "@openai/codex-sdk";
import {
  MEMORY_CLOSEOUT_JSON_SCHEMA,
  MEMORY_CLOSEOUT_PROMPT_RULES,
  parseMemoryCloseout,
} from "./memory-closeout.js";
import {
  assertAgentSourceReceiptMatchesDecision,
  parseAgentSourceReceipt,
} from "./source-receipts.js";
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

const sourceIdentitySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    provider: {
      type: "string",
      enum: ["figma", "jira", "confluence", "openapi", "github", "other"],
    },
    canonicalId: { type: "string", maxLength: 1_000 },
    url: { type: ["string", "null"], maxLength: 1_000 },
    host: { type: ["string", "null"], maxLength: 300 },
    fileKey: { type: ["string", "null"], maxLength: 300 },
    nodeId: { type: ["string", "null"], maxLength: 300 },
    issueKey: { type: ["string", "null"], maxLength: 100 },
    pageId: { type: ["string", "null"], maxLength: 300 },
    operationId: { type: ["string", "null"], maxLength: 300 },
    method: { type: ["string", "null"], maxLength: 20 },
    path: { type: ["string", "null"], maxLength: 500 },
    version: { type: ["string", "null"], maxLength: 200 },
  },
  required: [
    "provider",
    "canonicalId",
    "url",
    "host",
    "fileKey",
    "nodeId",
    "issueKey",
    "pageId",
    "operationId",
    "method",
    "path",
    "version",
  ],
} as const;

const sourceReceiptSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "number", const: 1 },
    id: { type: "string", pattern: "^receipt-[a-f0-9]{16}$" },
    sourceDecisionId: { type: "string", maxLength: 160 },
    provider: {
      type: "string",
      enum: ["figma", "jira", "confluence", "openapi", "github", "other"],
    },
    requested: sourceIdentitySchema,
    resolved: sourceIdentitySchema,
    adapter: {
      type: "string",
      enum: [
        "figma-desktop-mcp-local",
        "figma-remote-connector",
        "atlassian-rovo",
        "openapi-local-file",
        "openapi-pasted",
        "openapi-public-http",
        "openapi-internal-connector",
        "github-connector",
        "atlas-cache",
        "manual-import",
        "other",
      ],
    },
    route: { type: "string", maxLength: 500 },
    operation: { type: "string", maxLength: 160 },
    scope: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: {
          type: "string",
          enum: [
            "file",
            "page",
            "node",
            "selection",
            "issue",
            "document",
            "operation",
            "repository",
            "unknown",
          ],
        },
        id: { type: "string", maxLength: 500 },
        parentId: { type: ["string", "null"], maxLength: 500 },
      },
      required: ["kind", "id", "parentId"],
    },
    contentHash: { type: ["string", "null"], maxLength: 200 },
    observedAt: { type: "string", maxLength: 100 },
    fallback: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        fromAdapter: { type: "string", maxLength: 100 },
        condition: { type: "string", maxLength: 1_000 },
        identityPreserved: { type: "boolean" },
      },
      required: ["fromAdapter", "condition", "identityPreserved"],
    },
    coverage: {
      type: "string",
      enum: ["exact", "partial", "candidate"],
    },
    freshness: {
      type: "string",
      enum: ["current", "stale", "unknown"],
    },
  },
  required: [
    "schemaVersion",
    "id",
    "sourceDecisionId",
    "provider",
    "requested",
    "resolved",
    "adapter",
    "route",
    "operation",
    "scope",
    "contentHash",
    "observedAt",
    "fallback",
    "coverage",
    "freshness",
  ],
} as const;

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
    sourceReceipts: {
      type: "array",
      maxItems: 20,
      items: sourceReceiptSchema,
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
          handle: { type: ["string", "null"], maxLength: 500 },
          receiptId: {
            type: ["string", "null"],
            pattern: "^receipt-[a-f0-9]{16}$",
          },
          classification: {
            type: ["string", "null"],
            enum: [
              "confirmed-source",
              "atlas-candidate",
              "local",
              null,
            ],
          },
        },
        required: [
          "source",
          "label",
          "handle",
          "receiptId",
          "classification",
        ],
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
          recommendation: {
            type: ["string", "null"],
            maxLength: 1_000,
          },
        },
        required: ["title", "status", "recommendation"],
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
    memoryCloseout: MEMORY_CLOSEOUT_JSON_SCHEMA,
    outcome: {
      type: ["object", "null"],
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
      type: ["object", "null"],
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
    "sourceReceipts",
    "evidence",
    "decisions",
    "risks",
    "memoryCloseout",
    "outcome",
    "question",
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
  const figmaSourceSync = request.purpose === "figma-sync";
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
              ? `- ${source.kind}: confirmed primary; decision=${source.id}; authority=${source.authorityRole ?? "kind-default"}; exact=${source.reference}; route=${source.routePolicy?.primaryAdapter ?? "kind-default"}; fallback=${source.routePolicy?.fallback ?? "ask"}`
              : `- ${source.kind}: ${source.state}; decision=${source.id}; do not access`,
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
          "- Call `map_figma_file` with the current `task_id` and matching `source_decision_id`; Atlas resolves the immutable confirmed reference from its source ledger. Include `source_receipt` with adapter `figma-desktop-mcp-local`, actual MCP route/operation, and observation time.",
          "- A selected child frame is an observed scope contained by the confirmed Figma source, not a replacement source identity. Pass the selected scope and its page scope so Atlas can validate that relationship.",
          "- `map_figma_file` is required even for a direct node reference: it persists the sparse nodes and relationships in Design Atlas before code components are created or the task finishes.",
          "- Audit Variables separately with Project Atlas `sync_figma_variables`. Use `global` only if the active Figma Desktop MCP explicitly exposes and successfully returns a file-global Variables operation; do not infer global coverage from node context, selection, or `get_variable_defs`.",
          "- The documented Desktop `get_variable_defs` operation is node/selection scoped and is not equivalent to the global catalog. Record `selection-only` only when that fallback is actually exposed; record `permission-required` for an authorization/plan denial and `unavailable` when no confirmed Variables read is exposed. None of those states means the file contains no variables.",
          "- Keep the Variables sync at catalog detail by default (collection IDs/names, modes, counts, and resolved types). Request and persist expanded names, aliases, or exact values only when the task needs them and the same authorized global source returned them.",
          "- Codex/Figma skills are instructions or operation prerequisites only; they never replace or precede the Figma Desktop MCP route.",
          "- Use another connector, manual selection, or supplied evidence only when the source ledger explicitly allows that adapter. A policy of `ask` is not authorization; stop before fallback. Report the condition and never fabricate metadata from the URL.",
          "- Code Connect is optional enrichment. If no mapping exists, continue fidelity work from the confirmed Figma graph and repository reuse graph; do not pause, ask for mapping, or turn Code Connect into a prerequisite.",
          "- After mapping, refresh Project Atlas task/design context before continuing.",
          "",
        ]
      : [];
  const answer = request.answer
    ? `\nMaterial answer supplied by the user:\n${request.answer}\n`
    : "";
  if (figmaSourceSync) {
    return [
      "$frontend-task Synchronize the exact confirmed Figma target for Project Atlas.",
      "",
      "Task intent:",
      request.task,
      "",
      "Task-scoped source ledger:",
      sourceLedger,
      "",
      "Exact Figma target:",
      ...confirmedFigmaSources,
      "",
      "Source-gate rules:",
      `- Work only in ${request.rootPath}.`,
      "- This is a source bootstrap, not task preparation or implementation. Do not inspect the repository, compose Atlas task context, edit files, or explore unrelated connectors.",
      "- Resolve only the exact confirmed Figma source above through the ledger-declared primary route. A child selection is allowed only as a proven contained scope.",
      "- Never replace the confirmed source with an Atlas candidate, search result, current selection, nearby node, or similarly named frame.",
      "- If source file identity differs, containment or freshness cannot be established, or the primary route is unavailable without an explicitly allowed fallback, stop and return a minimal needs-input result with the discrepancy and retry guidance.",
      "- Read sparse metadata for that identity, then call Project Atlas `map_figma_file` with `task_id`, the immutable `source_decision_id`, the observed scope, and returned metadata.",
      "- Return a SourceReceipt bound to the confirmed source decision. Keep evidence compact and reference the receipt by ID.",
      "- Missing Code Connect is advisory only and never blocks this fidelity bootstrap.",
      "- The successful next step is to return to Atlas and prepare bounded context; do not perform that step in this run.",
      ...MEMORY_CLOSEOUT_PROMPT_RULES,
      "- Return the requested compact structured result.",
    ]
      .filter(Boolean)
      .join("\n");
  }
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
    `- Checkout sandbox: ${request.sandbox}. This does not authorize any Project Memory write; only the exact shared memoryCloseout confirmation can do that.`,
    "- Preserve existing user changes and inspect the current diff before editing.",
    "- Use a connector only for an explicitly confirmed source above. Relevance alone is not authorization.",
    "- Follow each source ledger route exactly: Figma Desktop MCP local is primary for Figma and Atlassian Rovo is primary for Jira/Confluence. Browser, Chrome, web, or another connector is forbidden when fallback is `deny`, and requires a recorded allow-list decision when fallback is `ask`.",
    "- An exact Jira issue, Confluence page, Figma node, or OpenAPI contract confirmed by the user is authoritative. Search results are Atlas candidates, never silent substitutes.",
    "- Linked or discovered secondary sources return to pending intake and cannot provide authoritative evidence until explicitly promoted and confirmed.",
    "- For every external evidence item, return a SourceReceipt bound to its confirmed source decision and reference that receipt by ID. If requested/resolved identity or version differs, stop with a minimal discrepancy instead of falling back silently.",
    "- Keep receipts out of narrative briefs: use receipt IDs and expand a receipt only when evidence is requested.",
    "- Keep authority domains distinct: Jira/Confluence define requirements, Figma defines visual scope, OpenAPI defines the API contract, and repository evidence defines implementation/reuse. A source relation does not transfer identity or authority.",
    "- Use only the bounded `api` context extracted from confirmed OpenAPI/Swagger sources; do not inject or reproduce a full specification.",
    "- Do not follow, infer, or add transitive source references without a new user confirmation.",
    "- Omitted, unavailable, replaced, and unlisted sources are optional and must not block progress.",
    "- Do not install or authorize connectors and never read or expose credentials.",
    "- Do not perform external writes, commits, pushes, ticket changes, or documentation publication.",
    "- Ask only when a material decision or contradiction remains. Include evidence and a recommendation.",
    "- Keep task intake, exact references, hypotheses, and run state task-scoped. Propose durable project memory separately; never promote it implicitly.",
    "- Reuse the task capsule's execution-manifest hashes and retrieval handles after continuation or compaction. Do not reread unchanged skill/reference/script bodies, run stable scripts with --help, or recompute reuse context without a named invalidation.",
    ...MEMORY_CLOSEOUT_PROMPT_RULES,
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

function omitNullObjectFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitNullObjectFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== null)
      .map(([key, item]) => [key, omitNullObjectFields(item)]),
  );
}

function parseCompactResult(
  value: string,
  request: AgentRunRequest,
): AgentCompactResult {
  const parsed = omitNullObjectFields(JSON.parse(value));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Codex returned a non-object result.");
  }
  const result = parsed as Record<string, unknown>;
  if (
    !["completed", "needs-input"].includes(String(result.status)) ||
    typeof result.summary !== "string" ||
    !isStringArray(result.brief) ||
    !Array.isArray(result.sourceReceipts) ||
    !Array.isArray(result.evidence) ||
    !Array.isArray(result.decisions) ||
    !Array.isArray(result.risks) ||
    (result.status === "completed" && !result.outcome) ||
    (result.status === "needs-input" && !result.question)
  ) {
    throw new Error("Codex returned an invalid compact result.");
  }
  let memoryCloseout;
  try {
    memoryCloseout = parseMemoryCloseout(result.memoryCloseout);
  } catch {
    throw new Error("Codex returned an invalid compact result.");
  }
  const sourceReceipts = result.sourceReceipts.map((value) =>
    parseAgentSourceReceipt(value),
  );
  for (const receipt of sourceReceipts) {
    const decision = request.sourceDecisions.find(
      (candidate) => candidate.id === receipt.sourceDecisionId,
    );
    if (!decision) {
      throw new Error(
        "Codex returned a receipt without a matching source decision.",
      );
    }
    assertAgentSourceReceiptMatchesDecision(decision, receipt);
  }
  const receiptsById = new Map(
    sourceReceipts.map((receipt) => [receipt.id, receipt]),
  );
  for (const evidence of result.evidence as Array<Record<string, unknown>>) {
    const source = String(evidence.source);
    if (!["figma", "jira", "confluence", "github", "openapi"].includes(source)) {
      continue;
    }
    const receiptId =
      typeof evidence.receiptId === "string" ? evidence.receiptId : undefined;
    const receipt = receiptId ? receiptsById.get(receiptId) : undefined;
    if (!receipt || receipt.provider !== source) {
      throw new Error(
        "Codex external evidence is missing a matching SourceReceipt.",
      );
    }
  }
  return {
    ...(parsed as AgentCompactResult),
    memoryCloseout,
    sourceReceipts,
  };
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
        : /json|schema|structured|invalid compact|sourcereceipt/.test(lower)
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
      const result = parseCompactResult(finalResponse, request);
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
