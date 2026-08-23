import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  computeTaskObjectiveHash,
  loadTaskFinalReceipt,
  loadTaskResumeCapsule,
  persistTaskContinuationBundle,
  persistTaskEvidenceContract,
  pruneExpiredTaskState,
  writeTaskCheckpoint,
} from "@component-atlas/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTaskCompletionFaultInjectorForTests } from "./core-task-completion.js";
import { sourceLedgerFingerprint } from "./core-tool-helpers.js";
import { createMcpServer } from "./index.js";

const run = promisify(execFile);
const roots: string[] = [];
let previousAtlasHome: string | undefined;

beforeEach(async () => {
  previousAtlasHome = process.env.PROJECT_ATLAS_HOME;
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-close-home-"));
  roots.push(dataHome);
  process.env.PROJECT_ATLAS_HOME = dataHome;
});

afterEach(async () => {
  setTaskCompletionFaultInjectorForTests();
  if (previousAtlasHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousAtlasHome;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createGitRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-close-repo-"));
  roots.push(root);
  await run("git", ["init"], { cwd: root, windowsHide: true });
  await run(
    "git",
    [
      "-c",
      "user.name=Project Atlas Test",
      "-c",
      "user.email=atlas@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "fixture",
    ],
    { cwd: root, windowsHide: true },
  );
  return root;
}

async function withCoreClient<T>(runClient: (client: Client) => Promise<T>) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createMcpServer("core");
  const client = new Client({
    name: "component-atlas-completion-test",
    version: "0.2.0",
  });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  try {
    return await runClient(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("core task completion", () => {
  it("blocks successful closeout until required evidence criteria are satisfied", async () => {
    const root = await createGitRoot();
    const taskId = "task-pending-acceptance";
    const objective = "Implement and verify durable task acceptance.";
    await writeTaskCheckpoint(root, {
      taskId,
      milestone: "source-resolved",
      objective,
      objectiveApproved: true,
      decisions: [],
      sourceReceiptIds: [],
      handles: [],
      covered: ["objective"],
      remaining: ["implementation"],
      budgetChars: 2_400,
      nextSafeAction: "Record acceptance criteria.",
    });
    const contract = await persistTaskEvidenceContract(root, {
      taskId,
      objective,
      objectiveHash: computeTaskObjectiveHash(objective),
      sourceLedgerHash: sourceLedgerFingerprint([], [], []),
      criteria: [
        {
          id: "verified",
          statement: "The implementation is verified.",
          required: true,
          sourceRefs: [],
        },
      ],
    });
    const continuation = await persistTaskContinuationBundle(root, {
      taskId,
      contractHandle: contract.handle,
      criteria: [
        {
          criterionId: "verified",
          status: "pending",
          evidenceRefs: [],
          validationRefs: [],
        },
      ],
      nextSafeAction: "Implement and validate the criterion.",
    });
    await writeTaskCheckpoint(root, {
      taskId,
      milestone: "batch-completed",
      objective,
      objectiveApproved: true,
      decisions: [],
      sourceReceiptIds: [],
      handles: [continuation.handle, contract.handle],
      covered: ["acceptance contract"],
      remaining: ["implementation", "validation"],
      budgetChars: 2_400,
      nextSafeAction: continuation.nextSafeAction,
    });

    await withCoreClient(async (client) => {
      const success = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "complete",
          result: "success",
          summary: "Do not accept this incomplete task.",
          verification: ["No valid evidence exists."],
          files: [],
        },
      });
      expect(success.isError).toBe(true);
      expect(JSON.stringify(success.content)).toMatch(/acceptance is incomplete/iu);

      const partial = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "complete",
          result: "partial",
          summary: "Acceptance remains pending.",
          verification: ["Pending criterion recorded durably."],
          files: [],
        },
      });
      expect(partial.isError, JSON.stringify(partial.content)).not.toBe(true);
      expect(partial.structuredContent).toMatchObject({
        status: "completed",
        ready: false,
        result: "partial",
      });
    });
  });

  it("reconciles a post-checkpoint interruption and archives partial closeout idempotently", async () => {
    const root = await createGitRoot();
    const objectiveSentinel = "FULL_OBJECTIVE_TAIL_MUST_SURVIVE";
    const fullObjective = `${"Document the bounded frontend investigation and its acceptance evidence. ".repeat(
      20,
    )}${objectiveSentinel}`;
    const sourceReceiptIds = Array.from(
      { length: 24 },
      (_, index) => `receipt-${index.toString(16).padStart(16, "0")}`,
    );
    await writeTaskCheckpoint(root, {
      taskId: "task-partial-closeout",
      milestone: "objective-approved",
      objective: fullObjective,
      objectiveApproved: true,
      decisions: [],
      sourceReceiptIds,
      handles: [],
      covered: ["investigation"],
      remaining: ["implementation"],
      budgetChars: 1_600,
      nextSafeAction: "Close with explicit partial evidence.",
    });
    const compactCapsule = await loadTaskResumeCapsule(
      root,
      "task-partial-closeout",
    );
    expect(compactCapsule?.sourceReceiptIds.length).toBeLessThan(
      sourceReceiptIds.length,
    );
    const completionArguments = {
      root_path: root,
      task_id: "task-partial-closeout",
      action: "complete",
      result: "partial",
      summary: "Investigation complete; implementation remains pending.",
      verification: ["targeted investigation reproduced the issue"],
      files: ["src/components/PartialExample.vue"],
    };
    await withCoreClient(async (client) => {
      let injected = false;
      setTaskCompletionFaultInjectorForTests((stage) => {
        if (!injected && stage === "after-checkpoint") {
          injected = true;
          throw new Error("injected post-checkpoint interruption");
        }
      });
      const interrupted = await client.callTool({
        name: "atlas_task_state",
        arguments: completionArguments,
      });
      expect(interrupted.isError).toBe(true);
      setTaskCompletionFaultInjectorForTests();
      const completed = await client.callTool({
        name: "atlas_task_state",
        arguments: completionArguments,
      });
      expect(completed.isError).not.toBe(true);
      expect(completed.structuredContent).toMatchObject({
        status: "completed",
        ready: false,
        result: "partial",
        deliveryReceipt: null,
        sourceReceiptIds,
      });
      const identicalRetry = await client.callTool({
        name: "atlas_task_state",
        arguments: completionArguments,
      });
      expect(identicalRetry.structuredContent).toEqual(
        completed.structuredContent,
      );
      const conflictingRetry = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          ...completionArguments,
          summary: "A conflicting closeout must not replace the first claim.",
        },
      });
      expect(conflictingRetry.isError).toBe(true);
    });

    await pruneExpiredTaskState(
      root,
      new Date(Date.now() + 8 * 24 * 60 * 60 * 1_000),
    );
    await expect(
      loadTaskFinalReceipt(root, "task-partial-closeout"),
    ).resolves.toMatchObject({
      taskId: "task-partial-closeout",
      objective: fullObjective,
      objectiveAuthority: "authoritative",
      sourceReceiptIds,
      outcome: {
        result: "partial",
        summary: "Investigation complete; implementation remains pending.",
        verification: ["targeted investigation reproduced the issue"],
        files: ["src/components/PartialExample.vue"],
      },
    });
    await withCoreClient(async (client) => {
      const lateIdenticalRetry = await client.callTool({
        name: "atlas_task_state",
        arguments: completionArguments,
      });
      expect(lateIdenticalRetry.structuredContent).toMatchObject({
        status: "completed",
        result: "partial",
        deliveryReceipt: null,
      });
      const resumed = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: "task-partial-closeout",
          action: "resume",
        },
      });
      expect(resumed.structuredContent).toMatchObject({
        status: "completed",
        taskId: "task-partial-closeout",
        deliveryReceipt: null,
        handles: [],
        final: {
          result: "partial",
          summary: "Investigation complete; implementation remains pending.",
        },
      });
      const memoryPreview = await client.callTool({
        name: "atlas_memory",
        arguments: {
          root_path: root,
          task_id: "task-partial-closeout",
          action: "record-episodic",
          result: "partial",
          summary: "The durable partial closeout remains eligible after TTL.",
          evidence: ["final outcome receipt verified"],
        },
      });
      expect(memoryPreview.structuredContent).toMatchObject({
        status: "needs-consent",
        memoryWritten: false,
        scope: {
          result: "partial",
          evidence: ["final outcome receipt verified"],
        },
      });
    });
  });
});
