import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  beginMemoryConsentExecution,
  commitMemoryConsentExecution,
  committedMemoryConsentResult,
  consumeMemoryConsent,
  issueMemoryConsent,
  loadMemoryConsentState,
} from "./memory-consent-receipt.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-consent-"));
  roots.push(root);
  await execFileAsync("git", ["init"], { cwd: root });
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("memory consent receipts", () => {
  it("requires an issued artifact and persists write-once idempotent transitions", async () => {
    const root = await createRoot();
    const input = {
      taskId: "task-consent-artifact",
      action: "record-episodic" as const,
      payloadHash: "a".repeat(64),
    };
    await expect(consumeMemoryConsent(root, input)).rejects.toThrow(
      /was not issued/u,
    );

    const issued = await issueMemoryConsent(root, {
      ...input,
      at: "2026-07-31T10:00:00.000Z",
    });
    expect(issued).toMatchObject({
      created: true,
      receipt: { status: "issued", issuedAt: "2026-07-31T10:00:00.000Z" },
    });
    await expect(
      issueMemoryConsent(root, {
        ...input,
        at: "2026-07-31T11:00:00.000Z",
      }),
    ).resolves.toEqual({ receipt: issued.receipt, created: false });

    await expect(consumeMemoryConsent(root, input)).rejects.toThrow(
      /before its mutation result is committed/u,
    );
    const executing = await beginMemoryConsentExecution(root, {
      ...input,
      at: "2026-07-31T11:00:00.000Z",
    });
    expect(executing).toMatchObject({
      created: true,
      receipt: { status: "executing" },
    });
    await expect(
      beginMemoryConsentExecution(root, {
        ...input,
        at: "2026-07-31T11:30:00.000Z",
      }),
    ).resolves.toEqual({ receipt: executing.receipt, created: false });
    const result = { outcome: { id: "outcome:test", result: "success" } };
    const committed = await commitMemoryConsentExecution(root, {
      ...input,
      result,
      at: "2026-07-31T12:00:00.000Z",
    });
    expect(committed).toMatchObject({
      created: true,
      receipt: {
        status: "committed",
        result,
        resultHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    expect(committedMemoryConsentResult(committed.receipt)).toEqual(result);
    await expect(
      commitMemoryConsentExecution(root, {
        ...input,
        result: { outcome: { id: "outcome:different" } },
      }),
    ).rejects.toThrow(/different result/u);
    const consumed = await consumeMemoryConsent(root, {
      ...input,
      at: "2026-07-31T13:00:00.000Z",
    });
    expect(consumed).toMatchObject({
      created: true,
      receipt: {
        status: "consumed",
        issuedAt: "2026-07-31T10:00:00.000Z",
        executingAt: "2026-07-31T11:00:00.000Z",
        committedAt: "2026-07-31T12:00:00.000Z",
        consumedAt: "2026-07-31T13:00:00.000Z",
        resultHash: committed.receipt.resultHash,
      },
    });
    await expect(
      consumeMemoryConsent(root, {
        ...input,
        at: "2026-07-31T14:00:00.000Z",
      }),
    ).resolves.toEqual({ receipt: consumed.receipt, created: false });
    await expect(
      loadMemoryConsentState(root, input.taskId, input.action, input.payloadHash),
    ).resolves.toEqual({
      issued: issued.receipt,
      executing: executing.receipt,
      committed: committed.receipt,
      consumed: consumed.receipt,
    });
  });

  it("isolates the same task and payload across workspaces", async () => {
    const left = await createRoot();
    const right = await createRoot();
    const input = {
      taskId: "shared-task",
      action: "propose-canonical" as const,
      payloadHash: "b".repeat(64),
    };
    await issueMemoryConsent(left, input);
    await expect(
      loadMemoryConsentState(right, input.taskId, input.action, input.payloadHash),
    ).resolves.toEqual({});
    await expect(consumeMemoryConsent(right, input)).rejects.toThrow(
      /was not issued/u,
    );
  });

  it("keeps committed audit results bounded and free of secret-like content", async () => {
    const root = await createRoot();
    const input = {
      taskId: "task-consent-result-guard",
      action: "record-episodic" as const,
      payloadHash: "c".repeat(64),
    };
    await issueMemoryConsent(root, input);
    await beginMemoryConsentExecution(root, input);

    await expect(
      commitMemoryConsentExecution(root, {
        ...input,
        result: { detail: `api_key=${"x".repeat(32)}` },
      }),
    ).rejects.toThrow(/secret-like content/u);
    await expect(
      commitMemoryConsentExecution(root, {
        ...input,
        result: { detail: "x".repeat(4_097) },
      }),
    ).rejects.toThrow(/4 KB audit budget/u);
    await expect(
      loadMemoryConsentState(root, input.taskId, input.action, input.payloadHash),
    ).resolves.not.toHaveProperty("committed");
  });
});
