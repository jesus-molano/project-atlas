import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexAgentAdapter,
  type CodexClient,
} from "./codex.js";
import { planAgentDelegation } from "./delegation.js";
import type {
  AgentRunEvent,
  AgentRunRequest,
} from "./types.js";
import type { ThreadEvent } from "@openai/codex-sdk";

const temporary: string[] = [];

async function root(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "atlas-agent-"));
  temporary.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function request(rootPath: string): AgentRunRequest {
  return {
    mode: "prepare",
    task: "Add a filter to the local catalogue.",
    rootPath,
    compactContext: "{\"code\":[{\"id\":\"catalogue-filter\"}]}",
    contextMetrics: {
      budgetChars: 3_600,
      usedChars: 43,
      estimatedTokens: 11,
      truncated: false,
    },
    sources: [],
    sourceDecisions: [],
    risk: {
      level: "low",
      reasons: ["No elevated-risk signal detected"],
      requiresObjectiveConfirmation: false,
    },
    sandbox: "read-only",
  };
}

async function collect(
  events: AsyncIterable<AgentRunEvent>,
): Promise<AgentRunEvent[]> {
  const result: AgentRunEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

function noMemoryCandidate() {
  return {
    status: "none" as const,
    summary: "No durable project knowledge was detected.",
    candidates: [],
    confirmationRequired: false,
    confirmationPrompt: "",
  };
}

function completedResult(
  status: "completed" | "needs-input" = "completed",
  memoryCloseout: Record<string, unknown> = noMemoryCandidate(),
) {
  return JSON.stringify({
    status,
    summary: "Prepared the task.",
    brief: ["Reuse the existing filter control."],
    sourceReceipts: [],
    evidence: [
      {
        source: "atlas",
        label: "Existing filter component",
        handle: "catalogue-filter",
      },
    ],
    decisions: [],
    risks: [],
    memoryCloseout,
    ...(status === "needs-input"
      ? {
          question: {
            prompt: "Should the filter persist in the URL?",
            evidence: ["The current route already reads query state."],
            recommendation: "Persist it in the URL.",
          },
        }
      : {
          outcome: {
            status: "prepared",
            summary: "Ready for implementation.",
            verification: [],
          },
        }),
  });
}

function fakeClient(
  events: ThreadEvent[],
  observed: {
    prompt?: string;
    resumed?: string;
    signal?: AbortSignal;
    outputSchema?: unknown;
  },
): CodexClient {
  const thread = {
    async runStreamed(
      prompt: string,
      options: { outputSchema: unknown; signal: AbortSignal },
    ) {
      observed.prompt = prompt;
      observed.signal = options.signal;
      observed.outputSchema = options.outputSchema;
      return {
        events: (async function* () {
          for (const event of events) yield event;
        })(),
      };
    },
  };
  return {
    startThread: () => thread,
    resumeThread: (id) => {
      observed.resumed = id;
      return thread;
    },
  };
}

function strictObjectSchemaErrors(
  value: unknown,
  path = "$",
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      strictObjectSchemaErrors(item, `${path}[${index}]`),
    );
  }
  if (!value || typeof value !== "object") return [];
  const schema = value as Record<string, unknown>;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const properties =
    schema.properties && typeof schema.properties === "object"
      ? (schema.properties as Record<string, unknown>)
      : undefined;
  const required = Array.isArray(schema.required)
    ? schema.required.map(String)
    : [];
  const ownErrors =
    types.includes("object") &&
    schema.additionalProperties === false &&
    properties
      ? Object.keys(properties)
          .filter((key) => !required.includes(key))
          .map((key) => `${path}.${key}`)
      : [];
  return [
    ...ownErrors,
    ...Object.entries(schema).flatMap(([key, item]) =>
      strictObjectSchemaErrors(item, `${path}.${key}`),
    ),
  ];
}

describe("Codex Agent Adapter", () => {
  it("maps SDK activity and returns only the compact structured result", async () => {
    const observed: {
      prompt?: string;
      signal?: AbortSignal;
      outputSchema?: unknown;
    } = {};
    const client = fakeClient(
      [
        { type: "thread.started", thread_id: "thread-1" },
        { type: "turn.started" },
        {
          type: "item.completed",
          item: {
            id: "todo-1",
            type: "todo_list",
            items: [{ text: "Inspect", completed: false }],
          },
        },
        {
          type: "item.completed",
          item: {
            id: "message-1",
            type: "agent_message",
            text: completedResult(),
          },
        },
        {
          type: "turn.completed",
          usage: {
            input_tokens: 120,
            cached_input_tokens: 80,
            cache_write_input_tokens: 0,
            output_tokens: 40,
            reasoning_output_tokens: 0,
          },
        },
      ],
      observed,
    );
    const adapter = new CodexAgentAdapter(client);
    const reviewed = request(await root());
    reviewed.sources = [{ kind: "openapi", value: "openapi.yaml" }];
    reviewed.sourceDecisions = [
      {
        id: "source-openapi-fixture",
        kind: "openapi",
        reference: "openapi.yaml",
        origin: "manual",
        state: "confirmed",
        required: false,
      },
    ];
    const events = await collect(adapter.run(reviewed).events);
    expect(observed.prompt).toContain("$frontend-task Prepare");
    expect(observed.prompt).toContain("- openapi: confirmed");
    expect(observed.prompt).toContain("bounded `api` context");
    expect(observed.prompt).toContain("Do not perform external writes");
    expect(observed.prompt).toContain("shared structured `memoryCloseout` result");
    expect(observed.prompt).toContain("exact shared memoryCloseout confirmation");
    expect(strictObjectSchemaErrors(observed.outputSchema)).toEqual([]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "run-started", threadId: "thread-1" }),
        expect.objectContaining({ type: "activity", phase: "planning" }),
        expect.objectContaining({
          type: "completed",
          threadId: "thread-1",
          usage: { inputTokens: 120, cachedInputTokens: 80, outputTokens: 40 },
        }),
      ]),
    );
    expect(JSON.stringify(events)).not.toContain("command");
  });

  it("injects only validated compact delegated evidence into the coordinator", async () => {
    const observed: { prompt?: string; signal?: AbortSignal } = {};
    const client = fakeClient(
      [
        { type: "thread.started", thread_id: "thread-delegated" },
        {
          type: "item.completed",
          item: {
            id: "message-delegated",
            type: "agent_message",
            text: completedResult(),
          },
        },
        {
          type: "turn.completed",
          usage: {
            input_tokens: 40,
            cached_input_tokens: 20,
            cache_write_input_tokens: 0,
            output_tokens: 20,
            reasoning_output_tokens: 0,
          },
        },
      ],
      observed,
    );
    const reviewed = request(await root());
    const plan = planAgentDelegation({
      taskId: "task-delegated",
      explicitlyAllowed: true,
      coordinatorContextRemainingChars: 8_000,
      workItems: [
        {
          domain: "code",
          sourceDecisionIds: [],
          confirmed: true,
          authorityConfirmed: true,
          primaryAdapter: "project-atlas",
          fallbackPolicy: "deny",
          estimatedRawChars: 30_000,
          compactBudgetChars: 4_000,
        },
      ],
    });
    const draft = {
      schemaVersion: 1 as const,
      jobId: plan.jobs[0]!.id,
      taskId: plan.taskId,
      domain: "code" as const,
      status: "blocked" as const,
      sourceDecisionIds: [],
      receiptIds: [],
      warnings: [],
      blocker: "ChangeSurface needs one explicit primary component.",
      metrics: { outputChars: 0, rawBodiesIncluded: false as const },
    };
    reviewed.delegation = {
      plan,
      results: [
        {
          ...draft,
          metrics: {
            ...draft.metrics,
            outputChars: JSON.stringify(draft).length,
          },
        },
      ],
    };

    await collect(new CodexAgentAdapter(client).run(reviewed).events);
    expect(observed.prompt).toContain("Delegated compact evidence");
    expect(observed.prompt).toContain(
      "ChangeSurface needs one explicit primary component.",
    );
    expect(observed.prompt).toContain(
      "Delegates do not confirm sources",
    );
    expect(observed.prompt).not.toMatch(/<svg|localhost:3845|metadataXml/iu);
  });

  it("ingests a confirmed Figma source through Figma Desktop MCP before repository investigation", async () => {
    const observed: { prompt?: string; signal?: AbortSignal } = {};
    const client = fakeClient(
      [
        { type: "thread.started", thread_id: "thread-figma" },
        {
          type: "item.completed",
          item: {
            id: "message-figma",
            type: "agent_message",
            text: completedResult(),
          },
        },
      ],
      observed,
    );
    const adapter = new CodexAgentAdapter(client);
    const input = request(await root());
    const reference =
      "https://www.figma.com/design/atlas-file/Problem-Tags?node-id=10-20";
    input.sources = [{ kind: "figma", value: reference }];
    input.sourceDecisions = [
      {
        id: "source-figma-confirmed",
        kind: "figma",
        reference,
        origin: "manual",
        state: "confirmed",
        required: false,
      },
    ];

    await collect(adapter.run(input).events);

    expect(observed.prompt).toContain("Confirmed Figma ingestion");
    expect(observed.prompt).toContain("Figma Desktop MCP");
    expect(observed.prompt).toContain("local MCP server exposed by the Figma desktop application");
    expect(observed.prompt).toContain("`get_metadata`");
    expect(observed.prompt).toContain("`map_figma_file`");
    expect(observed.prompt).toContain("`sync_figma_variables`");
    expect(observed.prompt).toContain("`selection-only`");
    expect(observed.prompt).toContain("not equivalent to the global catalog");
    expect(observed.prompt).toContain("persists the sparse nodes and relationships");
    expect(observed.prompt?.indexOf("Confirmed Figma ingestion")).toBeLessThan(
      observed.prompt?.indexOf("Preserve existing user changes") ?? -1,
    );
  });

  it("keeps exact Figma source bootstrap separate from context and repository work", async () => {
    const observed: { prompt?: string; signal?: AbortSignal } = {};
    const client = fakeClient(
      [
        { type: "thread.started", thread_id: "thread-figma-sync" },
        {
          type: "item.completed",
          item: {
            id: "message-figma-sync",
            type: "agent_message",
            text: completedResult(),
          },
        },
      ],
      observed,
    );
    const adapter = new CodexAgentAdapter(client);
    const input = request(await root());
    const reference =
      "https://www.figma.com/design/atlas-file/Problem-Tags?node-id=10-20";
    input.purpose = "figma-sync";
    input.compactContext = "{\"status\":\"source-gate\",\"contextGenerated\":false}";
    input.contextMetrics = {
      budgetChars: 0,
      usedChars: 0,
      estimatedTokens: 0,
      truncated: false,
    };
    input.sources = [{ kind: "figma", value: reference }];
    input.sourceDecisions = [
      {
        id: "source-figma-confirmed",
        kind: "figma",
        reference,
        origin: "explicit",
        state: "confirmed",
        required: true,
      },
    ];

    await collect(adapter.run(input).events);

    expect(observed.prompt).toContain("Synchronize the exact confirmed Figma target");
    expect(observed.prompt).toContain("Do not inspect the repository");
    expect(observed.prompt).toContain("compose Atlas task context");
    expect(observed.prompt).toContain("ledger-declared primary route");
    expect(observed.prompt).toContain("proven contained scope");
    expect(observed.prompt).toContain("Never replace the confirmed source");
    expect(observed.prompt).toContain("immutable `source_decision_id`");
    expect(observed.prompt).toContain("Code Connect is advisory only");
    expect(observed.prompt).toContain("`map_figma_file`");
    expect(observed.prompt).not.toContain("Reviewed compact Project Atlas context");
    expect(observed.prompt).not.toContain("`sync_figma_variables`");
  });

  it("does not probe Figma when no Figma source was confirmed", async () => {
    const observed: { prompt?: string; signal?: AbortSignal } = {};
    const client = fakeClient(
      [
        { type: "thread.started", thread_id: "thread-local" },
        {
          type: "item.completed",
          item: {
            id: "message-local",
            type: "agent_message",
            text: completedResult(),
          },
        },
      ],
      observed,
    );
    const adapter = new CodexAgentAdapter(client);

    await collect(adapter.run(request(await root())).events);

    expect(observed.prompt).not.toContain("Confirmed Figma ingestion");
    expect(observed.prompt).not.toContain("`get_metadata`");
    expect(observed.prompt).not.toContain("`map_figma_file`");
  });

  it.each([
    {
      label: "no durable candidate",
      closeout: noMemoryCandidate(),
      expectedStatus: "none",
      confirmationRequired: false,
    },
    {
      label: "canonical candidate awaiting confirmation",
      closeout: {
        status: "canonical-candidate",
        summary: "A reusable route-state convention was detected.",
        candidates: [
          {
            type: "convention",
            title: "Persist catalogue filters in the URL",
            summary: "Catalogue filters use query parameters for shareable state.",
            evidence: ["The existing catalogue route reads and writes query state."],
            scope: "canonical",
            confidence: 0.9,
          },
        ],
        confirmationRequired: true,
        confirmationPrompt:
          "Save this convention as canonical Project Memory?",
      },
      expectedStatus: "canonical-candidate",
      confirmationRequired: true,
    },
    {
      label: "local-only outcome",
      closeout: {
        status: "local-only",
        summary: "The validation result is useful only for this checkout.",
        candidates: [],
        localOutcome: {
          summary: "The catalogue filter tests passed in this checkout.",
          evidence: ["pnpm test -- catalogue-filter"],
        },
        confirmationRequired: false,
        confirmationPrompt: "",
      },
      expectedStatus: "local-only",
      confirmationRequired: false,
    },
    {
      label: "declined candidate",
      closeout: {
        status: "declined",
        summary: "The user declined the memory candidate; nothing was stored.",
        candidates: [],
        confirmationRequired: false,
        confirmationPrompt: "",
      },
      expectedStatus: "declined",
      confirmationRequired: false,
    },
  ])(
    "returns an explicit memory closeout for $label",
    async ({ closeout, expectedStatus, confirmationRequired }) => {
      const client = fakeClient(
        [
          { type: "thread.started", thread_id: "thread-memory-closeout" },
          {
            type: "item.completed",
            item: {
              id: "message-memory-closeout",
              type: "agent_message",
              text: completedResult("completed", closeout),
            },
          },
        ],
        {},
      );
      const adapter = new CodexAgentAdapter(client);
      const events = await collect(adapter.run(request(await root())).events);
      const completed = events.find((event) => event.type === "completed");
      expect(completed?.type).toBe("completed");
      if (completed?.type !== "completed") return;
      expect(completed.result.memoryCloseout).toMatchObject({
        status: expectedStatus,
        confirmationRequired,
      });
    },
  );

  it("rejects a canonical candidate that does not request explicit confirmation", async () => {
    const client = fakeClient(
      [
        { type: "thread.started", thread_id: "thread-invalid-memory-closeout" },
        {
          type: "item.completed",
          item: {
            id: "message-invalid-memory-closeout",
            type: "agent_message",
            text: completedResult("completed", {
              status: "canonical-candidate",
              summary: "Candidate",
              candidates: [
                {
                  type: "decision",
                  title: "Use one filter route",
                  summary: "The project uses one route.",
                  evidence: ["Observed in the repository."],
                  scope: "canonical",
                  confidence: 0.8,
                },
              ],
              confirmationRequired: false,
              confirmationPrompt: "",
            }),
          },
        },
      ],
      {},
    );
    const adapter = new CodexAgentAdapter(client);
    const events = await collect(adapter.run(request(await root())).events);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "failed",
          message: expect.stringMatching(/invalid compact result/i),
        }),
      ]),
    );
  });

  it("rejects external Jira or Confluence evidence without a matching receipt", async () => {
    const invalid = JSON.parse(completedResult()) as Record<string, unknown>;
    invalid.evidence = [
      {
        source: "jira",
        label: "APP-42",
      },
    ];
    const client = fakeClient(
      [
        { type: "thread.started", thread_id: "thread-missing-receipt" },
        {
          type: "item.completed",
          item: {
            id: "message-missing-receipt",
            type: "agent_message",
            text: JSON.stringify(invalid),
          },
        },
      ],
      {},
    );
    const adapter = new CodexAgentAdapter(client);
    const input = request(await root());
    input.sources = [{ kind: "jira", value: "APP-42" }];
    input.sourceDecisions = [
      {
        id: "source-jira-fixture",
        kind: "jira",
        reference: "APP-42",
        origin: "manual",
        state: "confirmed",
        required: false,
      },
    ];
    const events = await collect(adapter.run(input).events);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "failed",
          code: "invalid-output",
          message: expect.stringMatching(/SourceReceipt/i),
        }),
      ]),
    );
  });

  it("surfaces a material question and resumes the confirmed thread", async () => {
    const observed: { prompt?: string; resumed?: string; signal?: AbortSignal } =
      {};
    const client = fakeClient(
      [
        {
          type: "item.completed",
          item: {
            id: "message-1",
            type: "agent_message",
            text: completedResult("needs-input"),
          },
        },
        { type: "turn.completed", usage: {
          input_tokens: 1,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 1,
          reasoning_output_tokens: 0,
        } },
      ],
      observed,
    );
    const adapter = new CodexAgentAdapter(client);
    const input = request(await root());
    input.mode = "continue";
    input.threadId = "thread-existing";
    input.answer = "Yes, keep it in the URL.";
    const events = await collect(adapter.run(input).events);
    expect(observed.resumed).toBe("thread-existing");
    expect(observed.prompt).toContain("Material answer supplied by the user");
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "question",
          prompt: "Should the filter persist in the URL?",
        }),
        expect.objectContaining({
          type: "completed",
          threadId: "thread-existing",
        }),
      ]),
    );
  });

  it("cancels an active SDK turn without leaking a runtime error", async () => {
    const client: CodexClient = {
      startThread: () => ({
        async runStreamed(
          _prompt: string,
          options: { outputSchema: unknown; signal: AbortSignal },
        ) {
          return {
            events: (async function* () {
              yield { type: "thread.started", thread_id: "thread-cancel" } as const;
              await new Promise<void>((_resolve, reject) => {
                options.signal.addEventListener(
                  "abort",
                  () => reject(options.signal.reason),
                  { once: true },
                );
              });
            })(),
          };
        },
      }),
      resumeThread: () => {
        throw new Error("not used");
      },
    };
    const adapter = new CodexAgentAdapter(client);
    const handle = adapter.run(request(await root()));
    setTimeout(() => handle.cancel(), 10);
    const events = await collect(handle.events);
    expect(events.at(-1)).toMatchObject({ type: "cancelled" });
  });

  it("rejects context that exceeds the reviewed adapter cap", async () => {
    const observed: { prompt?: string; signal?: AbortSignal } = {};
    const adapter = new CodexAgentAdapter(fakeClient([], observed));
    const input = request(await root());
    input.compactContext = "x".repeat(12_001);
    const events = await collect(adapter.run(input).events);
    expect(events).toEqual([
      expect.objectContaining({ type: "failed", code: "runtime" }),
    ]);
    expect(observed.prompt).toBeUndefined();
  });
});
