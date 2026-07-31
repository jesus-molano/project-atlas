import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { projectStorageDirectory } from "@component-atlas/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveProjectIdentity } from "./identity.js";
import {
  expandTaskCompletionReceipt,
  loadTaskCompletionReceipt,
  persistTaskCompletionReceipt,
} from "./task-completion-receipt.js";

const run = promisify(execFile);
const roots: string[] = [];
let previousDataHome: string | undefined;

beforeEach(async () => {
  previousDataHome = process.env.PROJECT_ATLAS_HOME;
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-delivery-home-"));
  roots.push(dataHome);
  process.env.PROJECT_ATLAS_HOME = dataHome;
});

afterEach(async () => {
  if (previousDataHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousDataHome;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function repository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-delivery-"));
  roots.push(root);
  await run("git", ["init"], { cwd: root, windowsHide: true });
  return root;
}

async function artifactPath(root: string): Promise<string> {
  const identity = await resolveProjectIdentity(root);
  const directory = path.join(
    projectStorageDirectory(identity.logicalId),
    "task-state",
    "delivery-receipts",
  );
  const [name] = await readdir(directory);
  return path.join(directory, name!);
}

describe("task completion receipts", () => {
  it("publishes identical delivery bytes once under concurrent writers", async () => {
    const root = await repository();
    const input = {
      taskId: "task-concurrent",
      lockId: "f".repeat(24),
      result: "success" as const,
      summary: "Concurrent immutable delivery.",
      verification: ["tests passed"],
      validatedDelta: {
        deltaHash: "e".repeat(64),
        changedFiles: [{ path: "src/App.tsx" }],
      },
      sourceHandles: [
        `visual-review:task-concurrent:${"1".repeat(16)}`,
        `visual:vd-concurrent:${"2".repeat(16)}`,
        `receipt-${"a".repeat(64)}`,
      ],
      visualReview: {
        receiptHandle: `visual-review:task-concurrent:${"1".repeat(16)}`,
        contractHandle: `visual:vd-concurrent:${"2".repeat(16)}`,
        contractHash: "2".repeat(64),
        reviewHash: "1".repeat(64),
        result: "pass" as const,
        captureCount: 12,
        cleanupState: "clean" as const,
      },
      completedAt: "2026-07-31T15:00:00.000Z",
    };
    const receipts = await Promise.all(
      Array.from({ length: 12 }, () =>
        persistTaskCompletionReceipt(root, input),
      ),
    );
    expect(new Set(receipts.map((receipt) => receipt.handle)).size).toBe(1);
    expect(receipts[0]!.visualReview?.captureCount).toBe(12);
    await expect(
      loadTaskCompletionReceipt(root, receipts[0]!.handle, input.taskId),
    ).resolves.toEqual(receipts[0]);
  });

  it("persists, loads and expands an immutable task-bound delivery record", async () => {
    const root = await repository();
    const receipt = await persistTaskCompletionReceipt(root, {
      taskId: "task:42",
      lockId: "1".repeat(24),
      result: "success",
      summary: "Implemented and verified the locked checkout surface.",
      verification: ["pnpm test passed", "Typecheck passed"],
      validatedDelta: {
        deltaHash: "a".repeat(64),
        changedFiles: [
          { path: "src/Checkout.test.tsx" },
          { path: "src/Checkout.tsx" },
        ],
      },
      head: "b".repeat(40),
      sourceHandles: ["code:checkout-form"],
      completedAt: "2026-07-31T15:00:00.000Z",
    });

    expect(receipt.handle).toMatch(/^delivery:task:42:[a-f0-9]{16}$/u);
    expect(receipt.hash).toMatch(/^[a-f0-9]{64}$/u);
    await expect(
      loadTaskCompletionReceipt(root, receipt.handle, "task:42"),
    ).resolves.toEqual(receipt);
    await expect(
      expandTaskCompletionReceipt(root, receipt.handle, {
        taskId: "task:42",
        budgetChars: 1_600,
      }),
    ).resolves.toMatchObject({
      status: "complete",
      receipt: {
        taskId: "task:42",
        lockId: "1".repeat(24),
        deltaHash: "a".repeat(64),
        result: "success",
      },
    });
  });

  it("rejects content tampering and cross-task expansion", async () => {
    const root = await repository();
    const receipt = await persistTaskCompletionReceipt(root, {
      taskId: "task-42",
      lockId: "2".repeat(24),
      result: "partial",
      summary: "The scoped implementation is ready but one external check is pending.",
      verification: ["Local tests passed"],
      validatedDelta: {
        deltaHash: "b".repeat(64),
        changedFiles: [{ path: "src/Checkout.tsx" }],
      },
    });
    await expect(
      expandTaskCompletionReceipt(root, receipt.handle, { taskId: "task-43" }),
    ).rejects.toThrow(/identity/i);

    const target = await artifactPath(root);
    const stored = JSON.parse(await readFile(target, "utf8")) as {
      summary: string;
    };
    stored.summary = "Tampered after persistence";
    await writeFile(target, JSON.stringify(stored), "utf8");
    await expect(
      loadTaskCompletionReceipt(root, receipt.handle, "task-42"),
    ).rejects.toThrow(/hash/i);
  });

  it("fits expansion to the minimum budget without mutating the artifact", async () => {
    const root = await repository();
    const receipt = await persistTaskCompletionReceipt(root, {
      taskId: "task-budget",
      lockId: "3".repeat(24),
      result: "success",
      summary: "A complete technical delivery with deliberately dense evidence.",
      verification: Array.from(
        { length: 20 },
        (_, index) => `Verification ${index}: ${"evidence ".repeat(24)}`,
      ),
      validatedDelta: {
        deltaHash: "c".repeat(64),
        changedFiles: Array.from({ length: 30 }, (_, index) => ({
          path: `src/features/checkout/generated/File${index}.tsx`,
        })),
      },
    });
    const expanded = await expandTaskCompletionReceipt(root, receipt.handle, {
      taskId: "task-budget",
      budgetChars: 800,
    });

    expect(expanded.metrics).toMatchObject({
      budgetChars: 800,
      truncated: true,
    });
    expect(expanded.metrics.usedChars).toBeLessThanOrEqual(800);
    await expect(loadTaskCompletionReceipt(root, receipt.handle)).resolves.toEqual(
      receipt,
    );
  });
});
