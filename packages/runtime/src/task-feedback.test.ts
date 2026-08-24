import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { projectStorageDirectory } from "@component-atlas/store";
import { captureGitBaseline } from "./git-delta.js";
import { resolveProjectIdentity } from "./identity.js";
import { inspectTaskGit, reconcileTaskGit } from "./task-git-reconciliation.js";
import {
  loadTaskFeedbackEvent,
  loadTaskFeedbackQueue,
  persistTaskFeedbackEvent,
} from "./task-feedback.js";

const run = promisify(execFile);
const roots: string[] = [];
let previousAtlasHome: string | undefined;

beforeEach(async () => {
  previousAtlasHome = process.env.PROJECT_ATLAS_HOME;
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-feedback-home-"));
  roots.push(dataHome);
  process.env.PROJECT_ATLAS_HOME = dataHome;
});

async function repository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-feedback-"));
  roots.push(root);
  await run("git", ["init"], { cwd: root });
  await run("git", ["config", "user.email", "fixture@example.test"], { cwd: root });
  await run("git", ["config", "user.name", "Fixture"], { cwd: root });
  await writeFile(path.join(root, "package.json"), "{\"name\":\"fixture\"}\n");
  await run("git", ["add", "."], { cwd: root });
  await run("git", ["-c", "commit.gpgSign=false", "commit", "-m", "fixture"], { cwd: root });
  return root;
}

afterEach(async () => {
  if (previousAtlasHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousAtlasHome;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("task feedback and Git reconciliation", () => {
  it("chains a resolved correction without replacing its original event", async () => {
    const root = await repository();
    const first = await persistTaskFeedbackEvent(root, {
      taskId: "task-feedback", feedbackId: "otp", kind: "correction", message: "Require OTP for revocation.",
      origin: "user", required: true, impact: "contract", affectedCriterionIds: ["consent-edit"],
    });
    const resolved = await persistTaskFeedbackEvent(root, {
      taskId: "task-feedback", feedbackId: "otp", kind: "correction", status: "resolved", message: "OTP requirement implemented.",
      origin: "review", required: true, impact: "criterion", previousHandle: first.handle, evidenceRefs: ["test:otp"], affectedCriterionIds: ["consent-edit"],
    });
    expect(resolved).toMatchObject({ revision: 2, previousHandle: first.handle, status: "resolved" });
    await expect(loadTaskFeedbackEvent(root, first.handle)).resolves.toEqual(first);
  });

  it("converges concurrent identical feedback and rejects a corrupted artifact", async () => {
    const root = await repository();
    const input = {
      taskId: "task-feedback-integrity",
      feedbackId: "review-finding",
      kind: "review-finding" as const,
      message: "Keep this finding pending until its evidence is reconciled.",
      createdAt: "2026-08-24T12:00:00.000Z",
    };
    const attempts = await Promise.allSettled([
      persistTaskFeedbackEvent(root, input),
      persistTaskFeedbackEvent(root, input),
    ]);
    expect(attempts.some((attempt) => attempt.status === "fulfilled")).toBe(true);
    const queue = await loadTaskFeedbackQueue(root, input.taskId);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ revision: 1, status: "pending" });

    const event = queue[0]!;
    const identity = await resolveProjectIdentity(root);
    const artifactPath = path.join(
      projectStorageDirectory(identity.logicalId),
      "task-state",
      "feedback",
      "artifacts",
      input.taskId,
      `${event.hash.slice(0, 16)}.json`,
    );
    await writeFile(
      artifactPath,
      `${JSON.stringify({ ...event, status: "resolved" })}\n`,
      "utf8",
    );
    await expect(loadTaskFeedbackQueue(root, input.taskId)).rejects.toThrow(
      /hash|invalid/iu,
    );
  });

  it("reports same, advanced, diverged and unknown Git state", async () => {
    const root = await repository();
    const baseline = await captureGitBaseline(root, { taskId: "task-git" });
    await expect(reconcileTaskGit(root, { taskId: "task-git", baseline })).resolves.toMatchObject({ state: "same", handle: expect.stringMatching(/^git-state:task-git:/u) });
    await run("git", ["-c", "commit.gpgSign=false", "commit", "--allow-empty", "-m", "advance"], { cwd: root });
    await expect(reconcileTaskGit(root, { taskId: "task-git", baseline })).resolves.toMatchObject({ state: "advanced" });
    const second = await repository();
    await run("git", ["-c", "commit.gpgSign=false", "commit", "--allow-empty", "-m", "baseline"], { cwd: second });
    const secondBaseline = await captureGitBaseline(second, { taskId: "task-dirty" });
    await writeFile(path.join(second, "notes.txt"), "dirty\n");
    await expect(reconcileTaskGit(second, { taskId: "task-dirty", baseline: secondBaseline })).resolves.toMatchObject({ state: "same" });
    await run("git", ["reset", "--hard", "HEAD~1"], { cwd: second });
    await run("git", ["-c", "commit.gpgSign=false", "commit", "--allow-empty", "-m", "other branch"], { cwd: second });
    await expect(reconcileTaskGit(second, { taskId: "task-dirty", baseline: secondBaseline })).resolves.toMatchObject({ state: "diverged" });
    await expect(reconcileTaskGit(root, { taskId: "task-unknown" })).resolves.toMatchObject({ state: "unknown" });
  });

  it("reconciles a stored capsule HEAD without a ChangeSurface baseline", async () => {
    const root = await repository();
    const storedHead = (await run("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    await expect(inspectTaskGit(root, { taskId: "task-capsule", storedHead })).resolves.toMatchObject({ state: "same" });
    await run("git", ["-c", "commit.gpgSign=false", "commit", "--allow-empty", "-m", "advance"], { cwd: root });
    await expect(inspectTaskGit(root, { taskId: "task-capsule", storedHead })).resolves.toMatchObject({ state: "advanced" });
    const replacedHead = (await run("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    await run("git", ["reset", "--hard", "HEAD~1"], { cwd: root });
    await run("git", ["-c", "commit.gpgSign=false", "commit", "--allow-empty", "-m", "other branch"], { cwd: root });
    await expect(inspectTaskGit(root, { taskId: "task-capsule", storedHead: replacedHead })).resolves.toMatchObject({ state: "diverged" });
  });
});
