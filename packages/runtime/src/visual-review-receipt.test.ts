import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectStorageDirectory } from "@component-atlas/store";
import { resolveProjectIdentity } from "./identity.js";
import {
  expandVisualReviewReceipt,
  loadVisualReviewReceipt,
  persistVisualReviewReceipt,
} from "./visual-review-receipt.js";

const run = promisify(execFile);
const roots: string[] = [];
const owner = "component-atlas-visual-direction/v1";
let previousDataHome: string | undefined;

beforeEach(async () => {
  previousDataHome = process.env.PROJECT_ATLAS_HOME;
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-review-home-"));
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
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-review-"));
  roots.push(root);
  await run("git", ["init"], { cwd: root, windowsHide: true });
  return root;
}

function cleanupReceipt(taskId: string, reason = "close") {
  const taskFingerprint = createHash("sha256").update(taskId).digest("hex");
  const cleanedAt = "2020-01-01T12:00:00.000Z";
  const sessionId = "vd-review-test";
  const proof = createHash("sha256")
    .update([owner, taskFingerprint, sessionId, reason, cleanedAt].join("\0"))
    .digest("hex")
    .slice(0, 16);
  return `cleanup:v1:${taskFingerprint.slice(0, 16)}:${sessionId}:${reason}:${Date.parse(
    cleanedAt,
  ).toString(36)}:${proof}`;
}

function captureReceipt(taskId: string, hash: string) {
  const taskFingerprint = createHash("sha256").update(taskId).digest("hex");
  return `capture-receipt:v1:${taskFingerprint.slice(
    0,
    16,
  )}:vd-review-test:${hash.slice(0, 16)}:${"f".repeat(16)}`;
}

function reviewInput(taskId = "task-review") {
  return {
    taskId,
    contractHandle: "visual:vd-review:0123456789abcdef",
    contractHash: "0123456789abcdef".repeat(4),
    stateMatrix: {
      surface: "Checkout dialog",
      cases: [
        {
          id: "checkout-default-desktop",
          route: "/checkout",
          viewport: "desktop",
          state: "default",
        },
        {
          id: "checkout-focus-narrow",
          route: "/checkout",
          viewport: "narrow",
          state: "focus-visible",
        },
      ],
    },
    captures: [
      {
        caseId: "checkout-default-desktop",
        handle: "artifact-aaaaaaaaaaaa-00000001",
        hash: "a".repeat(64),
        receipt: captureReceipt(taskId, "a".repeat(64)),
      },
      {
        caseId: "checkout-focus-narrow",
        handle: "artifact-bbbbbbbbbbbb-00000002",
        hash: "b".repeat(64),
        receipt: captureReceipt(taskId, "b".repeat(64)),
      },
    ],
    figmaComparisons: [
      {
        caseId: "checkout-default-desktop",
        status: "match" as const,
        nodeId: "39:2731",
      },
      {
        caseId: "checkout-focus-narrow",
        status: "match" as const,
        nodeId: "39:2750",
      },
    ],
    result: "pass" as const,
    deviationCount: 0,
    artifactSessionId: "vd-review-test",
    preliminaryReviewHandle: `visual-review:${taskId}:${"1".repeat(16)}`,
    cleanup: {
      state: "clean" as const,
      receipt: cleanupReceipt(taskId),
    },
    reviewedAt: "2026-07-31T12:00:01.000Z",
  };
}

describe("visual review receipts", () => {
  it("publishes one immutable task-bound receipt under concurrent identical calls", async () => {
    const root = await repository();
    const receipts = await Promise.all(
      Array.from({ length: 12 }, () =>
        persistVisualReviewReceipt(root, reviewInput()),
      ),
    );
    expect(new Set(receipts.map((receipt) => receipt.handle)).size).toBe(1);
    const receipt = receipts[0]!;
    expect(receipt).toMatchObject({
      schemaVersion: 2,
      taskId: "task-review",
      coverage: {
        complete: true,
        browser: { complete: true, coveredCaseIds: expect.any(Array) },
        figma: { complete: true, coveredCaseIds: expect.any(Array) },
      },
      result: "pass",
    });
    await expect(
      loadVisualReviewReceipt(root, receipt.handle, "task-review"),
    ).resolves.toEqual(receipt);
    await expect(
      expandVisualReviewReceipt(root, receipt.handle, "task-review", 1_600),
    ).resolves.toMatchObject({ receipt: { hash: receipt.hash } });
  });

  it("rejects invalid, duplicate and incomplete case evidence", async () => {
    const root = await repository();
    const input = reviewInput();
    await expect(
      persistVisualReviewReceipt(root, {
        ...input,
        stateMatrix: {
          ...input.stateMatrix,
          cases: [
            input.stateMatrix.cases[0]!,
            { ...input.stateMatrix.cases[1]!, id: input.stateMatrix.cases[0]!.id },
          ],
        },
      }),
    ).rejects.toThrow(/case IDs must be unique/i);
    await expect(
      persistVisualReviewReceipt(root, {
        ...input,
        stateMatrix: {
          ...input.stateMatrix,
          cases: [
            input.stateMatrix.cases[0]!,
            {
              ...input.stateMatrix.cases[0]!,
              id: input.stateMatrix.cases[1]!.id,
            },
          ],
        },
      }),
    ).rejects.toThrow(/route, viewport and state cases must be unique/i);
    await expect(
      persistVisualReviewReceipt(root, {
        ...input,
        captures: [{ ...input.captures[0]!, hash: "c".repeat(64) }],
      }),
    ).rejects.toThrow(/SHA256/i);
    await expect(
      persistVisualReviewReceipt(root, {
        ...input,
        captures: [
          input.captures[0]!,
          { ...input.captures[0]!, handle: "artifact-aaaaaaaaaaaa-00000009" },
        ],
      }),
    ).rejects.toThrow(/case IDs must be unique/i);
    await expect(
      persistVisualReviewReceipt(root, {
        ...input,
        captures: [{ ...input.captures[0]!, caseId: "undeclared" }],
      }),
    ).rejects.toThrow(/browser capture.*declared visual case/i);
    await expect(
      persistVisualReviewReceipt(root, {
        ...input,
        figmaComparisons: [
          { ...input.figmaComparisons[0]!, caseId: "undeclared" },
        ],
      }),
    ).rejects.toThrow(/Figma comparison.*declared visual case/i);
    await expect(
      persistVisualReviewReceipt(root, {
        ...input,
        captures: [input.captures[0]!],
      }),
    ).rejects.toThrow(/browser capture.*every declared case/i);
    await expect(
      persistVisualReviewReceipt(root, {
        ...input,
        figmaComparisons: [input.figmaComparisons[0]!],
      }),
    ).rejects.toThrow(/Figma comparison.*every declared case/i);
    await expect(
      persistVisualReviewReceipt(root, {
        ...input,
        figmaComparisons: input.figmaComparisons.map((comparison, index) =>
          index === 0 ? { ...comparison, status: "deviation" as const } : comparison,
        ),
      }),
    ).rejects.toThrow(/passing visual review.*Figma deviations/i);
    await expect(
      persistVisualReviewReceipt(root, {
        ...input,
        result: "fix-and-recapture",
        deviationCount: 0,
        figmaComparisons: input.figmaComparisons.map((comparison, index) =>
          index === 0 ? { ...comparison, status: "deviation" as const } : comparison,
        ),
        preliminaryReviewHandle: undefined,
        cleanup: { state: "selected-retained" },
      }),
    ).rejects.toThrow(/cannot be lower than its Figma deviations/i);
    await expect(
      persistVisualReviewReceipt(root, {
        ...input,
        cleanup: { state: "clean", receipt: cleanupReceipt("other-task") },
      }),
    ).rejects.toThrow(/bound to this task/i);
    await expect(
      persistVisualReviewReceipt(root, {
        ...input,
        cleanup: { state: "clean", receipt: cleanupReceipt("task-review", "cancel") },
      }),
    ).rejects.toThrow(/normal close/i);
    await expect(
      persistVisualReviewReceipt(root, {
        ...input,
        cleanup: { state: "not-applicable" },
      }),
    ).rejects.toThrow(/requires clean cleanup/i);
  });

  it("keeps legacy receipts readable without treating them as strict evidence", async () => {
    const root = await repository();
    const taskId = "task-legacy-review";
    const payload = {
      schemaVersion: 1 as const,
      taskId,
      contractHandle: "visual:vd-review:0123456789abcdef",
      contractHash: "0123456789abcdef".repeat(4),
      artifactSessionId: "vd-review-test",
      preliminaryReviewHandle: `visual-review:${taskId}:${"1".repeat(16)}`,
      stateMatrix: {
        surface: "Checkout dialog",
        viewports: ["desktop", "narrow"],
        requiredStates: ["default", "focus-visible"],
      },
      captures: [
        {
          handle: "artifact-aaaaaaaaaaaa-00000001",
          hash: "a".repeat(64),
          receipt: captureReceipt(taskId, "a".repeat(64)),
          viewport: "desktop",
          state: "default",
        },
        {
          handle: "artifact-bbbbbbbbbbbb-00000002",
          hash: "b".repeat(64),
          receipt: captureReceipt(taskId, "b".repeat(64)),
          viewport: "narrow",
          state: "focus-visible",
        },
      ],
      coverage: {
        complete: true,
        coveredViewports: ["desktop", "narrow"],
        coveredStates: ["default", "focus-visible"],
      },
      result: "pass" as const,
      deviationCount: 0,
      cleanup: { state: "clean" as const, receipt: cleanupReceipt(taskId) },
      reviewedAt: "2026-07-31T12:00:01.000Z",
    };
    const hash = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
    const handle = `visual-review:${taskId}:${hash.slice(0, 16)}`;
    const identity = await resolveProjectIdentity(root);
    const directory = path.join(
      projectStorageDirectory(identity.logicalId),
      "task-state",
      "visual-review-receipts",
    );
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(
        directory,
        `${createHash("sha256").update(handle).digest("hex")}.json`,
      ),
      `${JSON.stringify({ ...payload, handle, hash }, null, 2)}\n`,
      "utf8",
    );

    await expect(loadVisualReviewReceipt(root, handle, taskId)).resolves.toMatchObject({
      schemaVersion: 1,
      handle,
    });
  });
});
