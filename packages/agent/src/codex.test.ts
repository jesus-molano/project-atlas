import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexAgentAdapter,
  type CodexClient,
} from "./codex.js";
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
    compactContext: '{"code":[{"id":"catalogue-filter"}]}',
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

function completedResult(status: "completed" | "needs-input" = "completed") {
  return JSON.stringify({
    status,
    summary: "Prepared the task.",
    brief: ["Reuse the existing filter control."],
    evidence: [
      {
        source: "atlas",
        label: "Existing filter component",
        handle: "catalogue-filter",
      },
    ],
    decisions: [],
    risks: [],
    memoryProposals: [],
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
  },
): CodexClient {
  const thread = {
    async runStreamed(
      prompt: string,
      options: { outputSchema: unknown; signal: AbortSignal },
    ) {
      observed.prompt = prompt;
      observed.signal = options.signal;
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

describe("Codex Agent Adapter", () => {
  it("maps SDK activity and returns only the compact structured result", async () => {
    const observed: { prompt?: string; signal?: AbortSignal } = {};
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
    const events = await collect(adapter.run(request(await root())).events);
    expect(observed.prompt).toContain("$frontend-task Prepare");
    expect(observed.prompt).toContain("Do not perform external writes");
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
