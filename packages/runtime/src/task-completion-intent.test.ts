import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimTaskCompletionIntent,
  commitTaskCompletionIntent,
  loadTaskCompletionCommit,
  loadTaskCompletionIntent,
} from "./task-completion-intent.js";

const run = promisify(execFile);
const roots: string[] = [];
let previousAtlasHome: string | undefined;

beforeEach(async () => {
  previousAtlasHome = process.env.PROJECT_ATLAS_HOME;
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-intent-home-"));
  roots.push(dataHome);
  process.env.PROJECT_ATLAS_HOME = dataHome;
});

afterEach(async () => {
  if (previousAtlasHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousAtlasHome;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function repository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-intent-repo-"));
  roots.push(root);
  await run("git", ["init"], { cwd: root, windowsHide: true });
  return root;
}

function claimInput() {
  return {
    taskId: "task-completion-race",
    request: {
      result: "partial" as const,
      summary: "Delivered the stable portion; one external dependency remains.",
      verification: ["pnpm test -- completion"],
      files: ["src/result.ts"],
    },
    bindings: {
      head: "a".repeat(40),
      lockId: "b".repeat(24),
      deltaHash: "c".repeat(64),
      sourceReceiptIds: [`receipt-${"d".repeat(64)}`],
      handles: ["code:completion-result"],
    },
  };
}

describe("task completion intent", () => {
  it("converges identical concurrent claims on one timestamp and commit", async () => {
    const root = await repository();
    const intents = await Promise.all(
      Array.from({ length: 24 }, () =>
        claimTaskCompletionIntent(root, claimInput()),
      ),
    );
    expect(new Set(intents.map((intent) => intent.requestHash)).size).toBe(1);
    expect(new Set(intents.map((intent) => intent.completedAt)).size).toBe(1);
    const intent = intents[0]!;
    const projection = {
      taskId: intent.taskId,
      status: "completed" as const,
      ready: false,
      result: intent.request.result,
      summary: intent.request.summary,
      verification: intent.request.verification,
      files: intent.request.files,
      sourceReceiptIds: intent.bindings.sourceReceiptIds!,
      deliveryReceipt: null,
      handles: intent.bindings.handles!,
      memory: "not-written" as const,
    };
    const commits = await Promise.all(
      Array.from({ length: 16 }, () =>
        commitTaskCompletionIntent(root, intent, projection),
      ),
    );
    expect(new Set(commits.map((commit) => commit.completedAt))).toEqual(
      new Set([intent.completedAt]),
    );
    await expect(
      loadTaskCompletionCommit(root, intent.taskId),
    ).resolves.toEqual(commits[0]);
    await expect(
      loadTaskCompletionIntent(root, intent.taskId),
    ).resolves.toEqual(intent);
    await expect(
      commitTaskCompletionIntent(root, intent, {
        ...projection,
        summary: "A tampered projection summary.",
      }),
    ).rejects.toThrow(/diverges from its claimed/i);
    await expect(
      commitTaskCompletionIntent(root, intent, {
        ...projection,
        result: "failure",
      }),
    ).rejects.toThrow(/diverges from its claimed/i);
    await expect(
      commitTaskCompletionIntent(root, intent, {
        ...projection,
        verification: [...projection.verification, "unclaimed extra"],
      }),
    ).rejects.toThrow(/diverges from its claimed/i);
    await expect(
      commitTaskCompletionIntent(root, intent, {
        ...projection,
        files: ["src/tampered.ts"],
      }),
    ).rejects.toThrow(/files diverge/i);
    await expect(
      commitTaskCompletionIntent(root, intent, {
        ...projection,
        sourceReceiptIds: [],
      }),
    ).rejects.toThrow(/source receipts diverge/i);
    await expect(
      commitTaskCompletionIntent(root, intent, {
        ...projection,
        handles: ["code:late-context"],
      }),
    ).rejects.toThrow(/context handles diverge/i);
  });

  it("blocks a different payload or workspace binding after first-writer wins", async () => {
    const root = await repository();
    const intent = await claimTaskCompletionIntent(root, claimInput());
    await expect(
      claimTaskCompletionIntent(root, {
        ...claimInput(),
        request: {
          ...claimInput().request,
          summary: "A different completion claim.",
        },
      }),
    ).rejects.toThrow(/different payload|different result/i);
    await expect(
      claimTaskCompletionIntent(root, {
        ...claimInput(),
        bindings: { ...claimInput().bindings, deltaHash: "d".repeat(64) },
      }),
    ).rejects.toThrow(/different payload|workspace bindings/i);
    expect((await loadTaskCompletionIntent(root, intent.taskId))?.requestHash).toBe(
      intent.requestHash,
    );
  });

  it("freezes the exact visual review hash and result in completion evidence", async () => {
    const root = await repository();
    const reviewHash = "e".repeat(64);
    const taskId = "task-visual-completion";
    const intent = await claimTaskCompletionIntent(root, {
      taskId,
      request: {
        result: "success",
        summary: "Visual evidence is complete.",
        verification: ["visual comparison passed"],
        files: [],
      },
      bindings: {
        head: "a".repeat(40),
        visualReview: {
          handle: `visual-review:${taskId}:${reviewHash.slice(0, 16)}`,
          contractHandle: `visual:vd-completion:${"f".repeat(16)}`,
          hash: reviewHash,
          result: "pass",
        },
      },
    });
    const projection = {
      taskId,
      status: "completed" as const,
      ready: true,
      result: "success" as const,
      summary: intent.request.summary,
      verification: [
        ...intent.request.verification,
        `visual-review:${reviewHash}`,
      ],
      files: [],
      sourceReceiptIds: [],
      deliveryReceipt: null,
      handles: [],
      memory: "not-written" as const,
    };
    await expect(
      commitTaskCompletionIntent(root, intent, {
        ...projection,
        verification: [
          ...intent.request.verification,
          `visual-review:${"f".repeat(64)}`,
        ],
      }),
    ).rejects.toThrow(/verification evidence/i);
    await expect(
      commitTaskCompletionIntent(root, intent, projection),
    ).resolves.toMatchObject({ projection });

    const blockedHash = "d".repeat(64);
    const blockedTaskId = "task-visual-partial";
    const blockedIntent = await claimTaskCompletionIntent(root, {
      taskId: blockedTaskId,
      request: {
        result: "partial",
        summary: "Visual review remains blocked.",
        verification: ["review blocker documented"],
        files: [],
      },
      bindings: {
        head: "a".repeat(40),
        visualReview: {
          handle: `visual-review:${blockedTaskId}:${blockedHash.slice(0, 16)}`,
          contractHandle: `visual:vd-blocked:${"c".repeat(16)}`,
          hash: blockedHash,
          result: "blocked",
        },
      },
    });
    await expect(
      commitTaskCompletionIntent(root, blockedIntent, {
        taskId: blockedTaskId,
        status: "completed",
        ready: false,
        result: "partial",
        summary: blockedIntent.request.summary,
        verification: [
          ...blockedIntent.request.verification,
          `visual-review-outcome:${blockedIntent.bindings.visualReview!.handle}:pass`,
        ],
        files: [],
        sourceReceiptIds: [],
        deliveryReceipt: null,
        handles: [],
        memory: "not-written",
      }),
    ).rejects.toThrow(/verification evidence/i);
  });
});
