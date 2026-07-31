import {
  mkdtemp,
  readdir,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  changeSurfaceRetrievalKey,
  claimTaskRetrieval,
  completeTaskRetrieval,
  loadTaskExecutionManifest,
  loadTaskRetrievalResult,
  writeTaskExecutionManifest,
} from "./task-execution.js";

let rootPath: string;
let dataHome: string;
let previousDataHome: string | undefined;

beforeEach(async () => {
  previousDataHome = process.env.PROJECT_ATLAS_HOME;
  rootPath = await mkdtemp(path.join(os.tmpdir(), "project-atlas-project-"));
  dataHome = await mkdtemp(path.join(os.tmpdir(), "project-atlas-state-"));
  process.env.PROJECT_ATLAS_HOME = dataHome;
});

afterEach(async () => {
  if (previousDataHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousDataHome;
  await Promise.all([
    rm(rootPath, { recursive: true, force: true }),
    rm(dataHome, { recursive: true, force: true }),
  ]);
});

describe("task execution manifest and retrieval budget", () => {
  it("stores only manifest hashes outside the checkout", async () => {
    const before = await readdir(rootPath);
    const projection = await writeTaskExecutionManifest(rootPath, {
      taskId: "task-42",
      objectiveHash: "0123456789abcdef0123456789abcdef",
      sourceLedgerHash: "fedcba9876543210fedcba9876543210",
      skills: [
        {
          id: "frontend-task",
          digest: "11111111111111111111111111111111",
          phase: "intake",
        },
      ],
      references: [
        {
          id: "continuation-mode",
          digest: "22222222222222222222222222222222",
          phase: "implementation",
        },
      ],
      scripts: [
        {
          id: "resolve-authority",
          interfaceVersion: "1",
          digest: "33333333333333333333333333333333",
        },
      ],
      retrievalKeys: ["reuse:checkout"],
      invalidatesOn: [
        "checkout-change",
        "head-change",
        "objective-change",
        "source-ledger-change",
      ],
    });
    expect(projection.handle).toMatch(/^manifest:task-42:/);
    expect(await loadTaskExecutionManifest(rootPath, projection.handle)).toMatchObject({
      taskId: "task-42",
      skills: [{ id: "frontend-task" }],
    });
    await expect(
      loadTaskExecutionManifest(rootPath, projection.handle, "task-43"),
    ).rejects.toThrow(/different task/i);
    expect(await readdir(rootPath)).toEqual(before);
  });

  it("returns a handle without reinjecting a repeated reuse result", async () => {
    const first = await claimTaskRetrieval(rootPath, {
      taskId: "task-42",
      kind: "reuse",
      key: "same checked-out graph and intent",
    });
    expect(first.status).toBe("granted");
    await completeTaskRetrieval(rootPath, first.handle, {
      candidates: [{ id: "login-form" }],
    });
    const second = await claimTaskRetrieval(rootPath, {
      taskId: "task-42",
      kind: "reuse",
      key: "same checked-out graph and intent",
    });
    expect(second).toMatchObject({
      status: "cached",
      handle: first.handle,
      priorResultAvailable: true,
    });
    expect(await loadTaskRetrievalResult(rootPath, second.handle)).toEqual({
      candidates: [{ id: "login-form" }],
    });
    await expect(
      loadTaskRetrievalResult(rootPath, second.handle, "task-43"),
    ).rejects.toThrow(/different task/i);
  });

  it("requires an explicit invalidation before a second reuse computation", async () => {
    const first = await claimTaskRetrieval(rootPath, {
      taskId: "task-42",
      kind: "reuse",
      key: "first graph",
    });
    await completeTaskRetrieval(rootPath, first.handle, { candidates: [] });
    await expect(
      claimTaskRetrieval(rootPath, {
        taskId: "task-42",
        kind: "reuse",
        key: "second graph",
      }),
    ).rejects.toThrow(/budget.*exhausted/i);
    const invalidated = await claimTaskRetrieval(rootPath, {
      taskId: "task-42",
      kind: "reuse",
      key: "second graph",
      invalidationReason: "graph-changed",
    });
    expect(invalidated.status).toBe("granted");
  });

  it("allows one compact ChangeSurface per stable task scope", async () => {
    const key = changeSurfaceRetrievalKey({
      projectId: "auth",
      checkoutId: "checkout-a",
      graphFingerprint: "graph-a",
      intent: "login OTP challenge",
      primaryComponent: "LoginChallenge",
      secondaryComponents: ["BackofficeLogin"],
      outOfScope: ["ProfileFingerprintModal"],
    });
    const first = await claimTaskRetrieval(rootPath, {
      taskId: "task-42",
      kind: "change-surface",
      key,
    });
    await completeTaskRetrieval(rootPath, first.handle, {
      primary: "LoginChallenge",
      secondary: ["BackofficeLogin"],
    });
    const repeated = await claimTaskRetrieval(rootPath, {
      taskId: "task-42",
      kind: "change-surface",
      key,
    });

    expect(repeated).toMatchObject({
      status: "cached",
      handle: first.handle,
      priorResultAvailable: true,
    });
    await expect(
      claimTaskRetrieval(rootPath, {
        taskId: "task-42",
        kind: "change-surface",
        key: `${key}:expanded`,
      }),
    ).rejects.toThrow(/budget.*exhausted/i);
  });

  it("caps Figma asset retrieval at eight body-free handle results", async () => {
    for (let index = 0; index < 8; index += 1) {
      const claim = await claimTaskRetrieval(rootPath, {
        taskId: "task-assets",
        kind: "figma-asset",
        key: `receipt:scope:asset-${index}`,
      });
      await completeTaskRetrieval(rootPath, claim.handle, {
        handle: `figma-asset:task-assets:${index.toString(16).padStart(24, "0")}`,
        bytes: 128,
        contentHash: `sha256:${index.toString(16).padStart(64, "0")}`,
      });
    }
    await expect(
      claimTaskRetrieval(rootPath, {
        taskId: "task-assets",
        kind: "figma-asset",
        key: "receipt:scope:asset-8",
      }),
    ).rejects.toThrow(/budget.*exhausted/i);
    const entries = await readdir(rootPath);
    expect(entries).toEqual([]);
  });
});
