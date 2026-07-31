import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  expandVisualEvidenceContract,
  loadVisualEvidenceContract,
  persistVisualEvidenceContract,
} from "./visual-contract.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
let previousAtlasHome: string | undefined;

beforeEach(async () => {
  previousAtlasHome = process.env.PROJECT_ATLAS_HOME;
  const home = await mkdtemp(path.join(os.tmpdir(), "atlas-contract-home-"));
  roots.push(home);
  process.env.PROJECT_ATLAS_HOME = home;
});

afterEach(async () => {
  if (previousAtlasHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousAtlasHome;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function repository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-visual-contract-"));
  roots.push(root);
  await execFileAsync("git", ["init"], { cwd: root });
  return root;
}

function visualWindow() {
  const now = Date.now();
  return {
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 24 * 60 * 60 * 1_000).toISOString(),
  };
}

async function selectionFixture(
  taskId: string,
  sessionId: string,
  hash: string,
  expiresAt: string,
) {
  const owner = "component-atlas-visual-direction/v1";
  const taskFingerprint = createHash("sha256").update(taskId).digest("hex");
  const handle = `visual:${sessionId}:${hash.slice(0, 16)}`;
  const proof = createHash("sha256")
    .update(
      [owner, taskFingerprint, sessionId, handle, hash, expiresAt].join("\0"),
    )
    .digest("hex")
    .slice(0, 16);
  const selectionReceipt = `selection-receipt:v1:${taskFingerprint.slice(
    0,
    16,
  )}:${sessionId}:${hash.slice(0, 16)}:${Date.parse(expiresAt).toString(
    36,
  )}:${proof}`;
  const sessionPath = path.join(
    process.env.PROJECT_ATLAS_HOME!,
    "temp",
    "visual-direction",
    sessionId,
  );
  await mkdir(sessionPath, { recursive: true });
  await writeFile(
    path.join(sessionPath, ".visual-direction-session.json"),
    JSON.stringify({
      owner,
      sessionId,
      taskFingerprint,
      state: "selected",
      selection: {
        directionHash: hash,
        contractHandle: handle,
        expiresAt,
        selectionReceipt,
      },
      artifacts: [],
    }),
  );
  return { handle, selectionReceipt };
}

describe("visual evidence contract", () => {
  it("persists and expands one bounded, task-owned visual authority", async () => {
    const root = await repository();
    const hash = "0123456789abcdef".repeat(4);
    const window = visualWindow();
    const selection = await selectionFixture(
      "task-42",
      "vd-task-42",
      hash,
      window.expiresAt,
    );
    const contract = await persistVisualEvidenceContract(root, {
      handle: selection.handle,
      taskId: "task-42",
      hash,
      authority: "exact-figma",
      summary: "Use the confirmed login card node and its responsive variants.",
      figma: { fileKey: "FileKey", nodeId: "39:2731" },
      sourceReceiptIds: [`receipt-${"a".repeat(64)}`],
      selectionReceipt: selection.selectionReceipt,
      ...window,
    });
    expect(contract.handle).toBe("visual:vd-task-42:0123456789abcdef");
    await expect(loadVisualEvidenceContract(root, contract.handle)).resolves.toEqual(
      contract,
    );
    await expect(
      expandVisualEvidenceContract(root, contract.handle, 1_600),
    ).resolves.toMatchObject({
      status: "current",
      contract: { authority: "exact-figma" },
    });
  });

  it("rejects a handle whose suffix is not bound to the full contract hash", async () => {
    const root = await repository();
    const window = visualWindow();
    const hash = "0123456789abcdef".repeat(4);
    const selection = await selectionFixture(
      "task-42",
      "vd-task-42",
      hash,
      window.expiresAt,
    );
    await expect(
      persistVisualEvidenceContract(root, {
        handle: "visual:vd-task-42:ffffffffffffffff",
        taskId: "task-42",
        hash,
        authority: "selected-direction",
        summary: "Selected direction",
        selectedDirectionId: "direction-a",
        selectionReceipt: selection.selectionReceipt,
        ...window,
      }),
    ).rejects.toThrow(/invalid/i);
  });

  it("keeps a visual handle immutable while allowing an identical retry", async () => {
    const root = await repository();
    const window = visualWindow();
    const hash = "0123456789abcdef".repeat(4);
    const selection = await selectionFixture(
      "task-immutable",
      "vd-immutable",
      hash,
      window.expiresAt,
    );
    const input = {
      handle: selection.handle,
      taskId: "task-immutable",
      hash,
      authority: "selected-direction" as const,
      summary: "Selected compact account panel direction.",
      selectedDirectionId: "compact-account-panel",
      sourceReceiptIds: [],
      selectionReceipt: selection.selectionReceipt,
      ...window,
    };
    const identical = await Promise.all(
      Array.from({ length: 12 }, () => persistVisualEvidenceContract(root, input)),
    );
    expect(new Set(identical.map((contract) => contract.handle)).size).toBe(1);
    expect(identical[0]).toMatchObject(input);
    await expect(
      persistVisualEvidenceContract(root, {
        ...input,
        summary: "A different contract must use a new handle.",
      }),
    ).rejects.toThrow(/handle is immutable/i);
  });
});
