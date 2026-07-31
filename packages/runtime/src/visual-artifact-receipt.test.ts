import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  verifyVisualCaptureReceipt,
  verifyVisualSelectionReceipt,
} from "./visual-artifact-receipt.js";

const owner = "component-atlas-visual-direction/v1";
const roots: string[] = [];
let previousAtlasHome: string | undefined;

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

beforeEach(async () => {
  previousAtlasHome = process.env.PROJECT_ATLAS_HOME;
  const home = await mkdtemp(path.join(os.tmpdir(), "atlas-artifact-home-"));
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

async function emittedFixture() {
  const taskId = "task-visual-proof";
  const taskFingerprint = digest(taskId);
  const sessionId = "vd-proof-test";
  const sessionPath = path.join(
    process.env.PROJECT_ATLAS_HOME!,
    "temp",
    "visual-direction",
    sessionId,
  );
  await mkdir(sessionPath, { recursive: true });
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const contractHash = "a".repeat(64);
  const contractHandle = `visual:${sessionId}:${contractHash.slice(0, 16)}`;
  const selectionProof = digest(
    [
      owner,
      taskFingerprint,
      sessionId,
      contractHandle,
      contractHash,
      expiresAt,
    ].join("\0"),
  ).slice(0, 16);
  const selectionReceipt = `selection-receipt:v1:${taskFingerprint.slice(
    0,
    16,
  )}:${sessionId}:${contractHash.slice(0, 16)}:${Date.parse(expiresAt).toString(
    36,
  )}:${selectionProof}`;
  const relativePath = "capture.png";
  const content = Buffer.from("pixel-evidence");
  await writeFile(path.join(sessionPath, relativePath), content);
  const captureHash = createHash("sha256")
    .update("file:\0")
    .update(content)
    .digest("hex");
  const captureHandle = `artifact-${captureHash.slice(0, 12)}-12345678`;
  const recordedAt = new Date().toISOString();
  const captureProof = digest(
    [
      owner,
      taskFingerprint,
      sessionId,
      captureHandle,
      captureHash,
      "review-capture",
      recordedAt,
    ].join("\0"),
  ).slice(0, 16);
  const captureReceipt = `capture-receipt:v1:${taskFingerprint.slice(
    0,
    16,
  )}:${sessionId}:${captureHash.slice(0, 16)}:${captureProof}`;
  const manifestPath = path.join(sessionPath, ".visual-direction-session.json");
  const manifest = {
    schemaVersion: 1,
    owner,
    sessionId,
    taskFingerprint,
    state: "selected",
    selection: {
      directionHash: contractHash,
      contractHandle,
      expiresAt,
      selectionReceipt,
    },
    artifacts: [
      {
        handle: captureHandle,
        kind: "review-capture",
        relativePath,
        hash: captureHash,
        bytes: content.byteLength,
        recordedAt,
        captureReceipt,
      },
    ],
  };
  await writeFile(manifestPath, JSON.stringify(manifest));
  return {
    taskId,
    sessionPath,
    manifestPath,
    manifest,
    contractHash,
    contractHandle,
    expiresAt,
    selectionReceipt,
    captureHash,
    captureHandle,
    captureReceipt,
  };
}

describe("visual artifact receipts", () => {
  it("verifies emitted proofs and the live capture bytes", async () => {
    const fixture = await emittedFixture();
    await expect(
      verifyVisualSelectionReceipt({
        taskId: fixture.taskId,
        receipt: fixture.selectionReceipt,
        contractHandle: fixture.contractHandle,
        contractHash: fixture.contractHash,
        expiresAt: fixture.expiresAt,
      }),
    ).resolves.toMatchObject({ sessionId: "vd-proof-test" });
    await expect(
      verifyVisualCaptureReceipt({
        taskId: fixture.taskId,
        receipt: fixture.captureReceipt,
        handle: fixture.captureHandle,
        hash: fixture.captureHash,
      }),
    ).resolves.toMatchObject({ sessionId: "vd-proof-test" });
    await writeFile(path.join(fixture.sessionPath, "capture.png"), "tampered");
    await expect(
      verifyVisualCaptureReceipt({
        taskId: fixture.taskId,
        receipt: fixture.captureReceipt,
        handle: fixture.captureHandle,
        hash: fixture.captureHash,
      }),
    ).rejects.toThrow(/content differs/i);
  });

  it("rejects receipt proofs copied into a corrupted manifest", async () => {
    const fixture = await emittedFixture();
    const corruptedSelection = fixture.selectionReceipt.replace(
      /:[a-f0-9]{16}$/u,
      ":0000000000000000",
    );
    const selectionManifest = structuredClone(fixture.manifest);
    selectionManifest.selection.selectionReceipt = corruptedSelection;
    await writeFile(fixture.manifestPath, JSON.stringify(selectionManifest));
    await expect(
      verifyVisualSelectionReceipt({
        taskId: fixture.taskId,
        receipt: corruptedSelection,
        contractHandle: fixture.contractHandle,
        contractHash: fixture.contractHash,
        expiresAt: fixture.expiresAt,
      }),
    ).rejects.toThrow(/active task session/i);

    const corruptedCapture = fixture.captureReceipt.replace(
      /:[a-f0-9]{16}$/u,
      ":0000000000000000",
    );
    const captureManifest = structuredClone(fixture.manifest);
    captureManifest.artifacts[0]!.captureReceipt = corruptedCapture;
    await writeFile(fixture.manifestPath, JSON.stringify(captureManifest));
    await expect(
      verifyVisualCaptureReceipt({
        taskId: fixture.taskId,
        receipt: corruptedCapture,
        handle: fixture.captureHandle,
        hash: fixture.captureHash,
      }),
    ).rejects.toThrow(/active task session/i);
    expect(JSON.parse(await readFile(fixture.manifestPath, "utf8"))).toBeTruthy();
  });
});
