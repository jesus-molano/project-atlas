import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { projectStorageDirectory } from "@component-atlas/store";
import { canonicalJson } from "./change-surface-fingerprint.js";
import { captureGitDelta, compareGitDelta, type GitBaselineReference, type GitDeltaCaptureLimits, type GitDeltaResult } from "./git-delta.js";
import { resolveProjectIdentity } from "./identity.js";

export type TaskGitReconciliationState = "same" | "advanced" | "diverged" | "unknown";

export interface TaskGitReconciliation {
  schemaVersion: 1;
  handle: string;
  hash: string;
  taskId: string;
  baseline?: GitBaselineReference;
  storedHead?: string;
  state: TaskGitReconciliationState;
  observedAt: string;
  delta?: Pick<GitDeltaResult, "deltaHash" | "head" | "headChanged" | "files" | "additions" | "deletions" | "renames" | "truncated" | "truncationReasons">;
  commitOids: string[];
  reason?: string;
}
const execFileAsync = promisify(execFile);

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function validTaskId(value: string): boolean {
  return /^[A-Za-z0-9_.:-]{1,160}$/u.test(value);
}

async function artifactPath(rootPath: string, taskId: string, hash: string): Promise<string> {
  const identity = await resolveProjectIdentity(rootPath);
  return path.join(projectStorageDirectory(identity.logicalId), "task-state", "git-reconciliations", "artifacts", taskId, `${hash}.json`);
}

async function findArtifact(rootPath: string, taskId: string, prefix: string): Promise<string> {
  const identity = await resolveProjectIdentity(rootPath);
  const directory = path.join(projectStorageDirectory(identity.logicalId), "task-state", "git-reconciliations", "artifacts", taskId);
  const name = (await readdir(directory)).find((candidate) => candidate.startsWith(prefix) && candidate.endsWith(".json"));
  if (!name) throw new Error("Git reconciliation artifact was not found.");
  return path.join(directory, name);
}

async function writeAtomic(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${canonicalJson(value)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function loadTaskGitReconciliation(rootPath: string, handle: string): Promise<TaskGitReconciliation> {
  const match = /^git-state:([A-Za-z0-9_.:-]{1,160}):([a-f0-9]{16})$/u.exec(handle);
  if (!match) throw new Error("Git reconciliation handle is invalid.");
  const result = JSON.parse(await readFile(await findArtifact(rootPath, match[1]!, match[2]!), "utf8")) as TaskGitReconciliation;
  if (result.handle !== handle || result.hash.slice(0, 16) !== match[2]!) throw new Error("Git reconciliation identity is invalid.");
  return result;
}

export async function expandTaskGitReconciliation(rootPath: string, handle: string) {
  return { schemaVersion: 1 as const, gitState: await loadTaskGitReconciliation(rootPath, handle) };
}

/** Classifies the current checkout without treating an unavailable baseline as a pass. */
export async function reconcileTaskGit(
  rootPath: string,
  input: { taskId: string; baseline?: GitBaselineReference; storedHead?: string; at?: string; limits?: GitDeltaCaptureLimits; persist?: boolean },
): Promise<TaskGitReconciliation> {
  if (!validTaskId(input.taskId)) throw new Error("Task ID is invalid.");
  const observedAt = input.at ?? new Date().toISOString();
  let state: TaskGitReconciliationState = "unknown";
  let delta: TaskGitReconciliation["delta"];
  let commitOids: string[] = [];
  let reason: string | undefined;
  const comparedHead = input.storedHead ?? input.baseline?.head;
  if (!comparedHead) {
    reason = "No stored Git HEAD is bound to this task.";
  } else {
    try {
      const current = input.baseline
        ? await compareGitDelta(rootPath, input.baseline, input.limits)
        : await captureGitDelta(rootPath, input.limits);
      delta = {
        deltaHash: current.deltaHash, head: current.head, headChanged: current.headChanged,
        files: current.files, additions: current.additions, deletions: current.deletions,
        renames: current.renames, truncated: current.truncated,
        truncationReasons: current.truncationReasons,
      };
      if (current.truncated) {
        reason = "The Git delta is incomplete.";
      } else if (current.head === comparedHead) {
        state = "same";
      } else {
        let isAncestor = false;
        try {
          await execFileAsync("git", ["merge-base", "--is-ancestor", comparedHead, current.head], { cwd: rootPath });
          isAncestor = true;
        } catch (error) {
          if (Number((error as NodeJS.ErrnoException).code) !== 1) throw error;
        }
        if (isAncestor) {
          state = "advanced";
          const commits = await execFileAsync("git", ["rev-list", "--max-count=20", `${comparedHead}..${current.head}`], { cwd: rootPath, encoding: "utf8" });
          commitOids = commits.stdout.trim().split("\n").filter(Boolean);
        } else {
          state = "diverged";
        }
      }
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
  }
  const payload = { schemaVersion: 1 as const, taskId: input.taskId, ...(input.baseline ? { baseline: input.baseline } : {}), ...(input.storedHead ? { storedHead: input.storedHead } : {}), state, observedAt, ...(delta ? { delta } : {}), commitOids, ...(reason ? { reason } : {}) };
  const hash = digest(payload);
  const reconciliation: TaskGitReconciliation = { ...payload, handle: `git-state:${input.taskId}:${hash.slice(0, 16)}`, hash };
  if (input.persist === false) return reconciliation;
  const target = await artifactPath(rootPath, input.taskId, hash);
  try {
    const existing = JSON.parse(await readFile(target, "utf8")) as TaskGitReconciliation;
    if (canonicalJson(existing) !== canonicalJson(reconciliation)) throw new Error("Git reconciliation artifact identity conflicts with its hash.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeAtomic(target, reconciliation);
  }
  return reconciliation;
}

/** Read-only live Git relation for resume and recommendation flows. */
export async function inspectTaskGit(
  rootPath: string,
  input: Omit<Parameters<typeof reconcileTaskGit>[1], "persist">,
): Promise<TaskGitReconciliation> {
  return reconcileTaskGit(rootPath, { ...input, persist: false });
}
