import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { captureGitBaseline } from "./git-delta.js";
import {
  expandTaskGitReconciliation,
  inspectTaskGit,
  loadTaskGitReconciliation,
  reconcileTaskGit,
} from "./task-git-reconciliation.js";

const run = promisify(execFile);
const roots: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-git-state-"));
  roots.push(root);
  await run("git", ["init"], { cwd: root });
  await run("git", ["config", "user.email", "fixture@example.test"], { cwd: root });
  await run("git", ["config", "user.name", "Fixture"], { cwd: root });
  await writeFile(path.join(root, "tracked.txt"), "initial\n");
  await run("git", ["add", "."], { cwd: root });
  await run("git", ["-c", "commit.gpgSign=false", "commit", "-m", "initial"], { cwd: root });
  return root;
}

async function commit(root: string, message: string): Promise<string> {
  await run("git", ["-c", "commit.gpgSign=false", "commit", "--allow-empty", "-m", message], { cwd: root });
  return (await run("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("task Git reconciliation", () => {
  it("persists and expands a same-HEAD reconciliation", async () => {
    const root = await repository();
    const baseline = await captureGitBaseline(root, { taskId: "git-state-same" });
    const at = "2026-08-24T12:00:00.000Z";

    const persisted = await reconcileTaskGit(root, { taskId: "git-state-same", baseline, at });
    expect(persisted).toMatchObject({
      state: "same",
      commitOids: [],
      handle: expect.stringMatching(/^git-state:git-state-same:[a-f0-9]{16}$/u),
    });
    await expect(loadTaskGitReconciliation(root, persisted.handle)).resolves.toEqual(persisted);
    await expect(expandTaskGitReconciliation(root, persisted.handle)).resolves.toEqual({
      schemaVersion: 1,
      gitState: persisted,
    });

    const inspected = await inspectTaskGit(root, { taskId: "git-state-same", baseline, at });
    expect(inspected).toMatchObject({ state: "same", handle: persisted.handle });
  });

  it("reports an advanced HEAD and includes the new commit OID", async () => {
    const root = await repository();
    const baseline = await captureGitBaseline(root, { taskId: "git-state-advanced" });
    const advancedHead = await commit(root, "advance");

    const result = await inspectTaskGit(root, { taskId: "git-state-advanced", baseline });
    expect(result).toMatchObject({ state: "advanced", commitOids: [advancedHead] });
    expect(result.delta).toMatchObject({ head: advancedHead, headChanged: true });
  });

  it("reports a diverged checkout when the stored HEAD is not an ancestor", async () => {
    const root = await repository();
    await commit(root, "baseline branch");
    const storedHead = (await run("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    await run("git", ["reset", "--hard", "HEAD~1"], { cwd: root });
    const replacementHead = await commit(root, "replacement branch");

    const result = await inspectTaskGit(root, { taskId: "git-state-diverged", storedHead });
    expect(result).toMatchObject({ state: "diverged", commitOids: [] });
    expect(result.delta).toMatchObject({ head: replacementHead });
  });

  it("does not treat a worktree-only delta as an advanced commit", async () => {
    const root = await repository();
    const baseline = await captureGitBaseline(root, { taskId: "git-state-dirty" });
    await writeFile(path.join(root, "tracked.txt"), "changed without commit\n");

    const result = await inspectTaskGit(root, { taskId: "git-state-dirty", baseline });
    expect(result).toMatchObject({ state: "same", commitOids: [] });
    expect(result.delta).toMatchObject({ headChanged: false, files: 1 });
  });

  it("returns unknown when the task has no stored HEAD or baseline", async () => {
    const root = await repository();

    await expect(inspectTaskGit(root, { taskId: "git-state-unknown" })).resolves.toMatchObject({
      state: "unknown",
      commitOids: [],
      reason: "No stored Git HEAD is bound to this task.",
    });
  });
});
