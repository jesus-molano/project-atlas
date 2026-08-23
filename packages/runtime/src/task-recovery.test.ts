import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { projectStorageDirectory } from "@component-atlas/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  persistTaskContinuationBundle,
  persistTaskEvidenceContract,
} from "./task-evidence-contract.js";
import { resolveProjectIdentity } from "./identity.js";
import { computeTaskObjectiveHash } from "./task-objective.js";
import {
  listTaskResumeCandidates,
  recoverTaskResumeState,
} from "./task-recovery.js";
import { writeTaskCheckpoint } from "./task-state.js";

const run = promisify(execFile);
const roots: string[] = [];
let previousAtlasHome: string | undefined;

beforeEach(async () => {
  previousAtlasHome = process.env.PROJECT_ATLAS_HOME;
  const home = await mkdtemp(path.join(os.tmpdir(), "atlas-recovery-home-"));
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

async function repository(prefix = "atlas-recovery-project-"): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function checkpoint(
  root: string,
  taskId: string,
  objective: string,
  handles: string[] = [],
): Promise<void> {
  await writeTaskCheckpoint(root, {
    taskId,
    milestone: "objective-approved",
    objective,
    objectiveApproved: true,
    decisions: [],
    sourceReceiptIds: [],
    handles,
    covered: ["Source intake"],
    remaining: ["Implementation", "Validation"],
    budgetChars: 2_400,
    nextSafeAction: "Continue from the durable task state.",
  });
}

describe("task recovery", () => {
  it("recovers one exact task and requires selection when several are active", async () => {
    const root = await repository();
    await expect(recoverTaskResumeState(root)).resolves.toEqual({
      status: "not-found",
      candidateCount: 0,
      candidates: [],
    });

    const objective = "Implement the approved checkout experience.";
    const contract = await persistTaskEvidenceContract(root, {
      taskId: "task-recover-one",
      objective,
      objectiveHash: computeTaskObjectiveHash(objective),
      sourceLedgerHash: "a".repeat(64),
      criteria: [
        {
          id: "checkout-submit",
          statement: "The confirmed order can be submitted once.",
          required: true,
          sourceRefs: ["jira:SHOP-42"],
        },
      ],
    });
    const continuation = await persistTaskContinuationBundle(root, {
      taskId: contract.taskId,
      contractHandle: contract.handle,
      criteria: [
        {
          criterionId: "checkout-submit",
          status: "pending",
          evidenceRefs: [],
          validationRefs: [],
        },
      ],
      covered: ["Source intake"],
      remaining: ["Implementation", "Validation"],
      nextSafeAction: "Implement checkout submission from the locked contract.",
    });
    await checkpoint(root, contract.taskId, objective, [
      contract.handle,
      continuation.handle,
    ]);

    await expect(recoverTaskResumeState(root)).resolves.toMatchObject({
      status: "ready",
      candidateCount: 1,
      candidates: [
        {
          taskId: contract.taskId,
          status: "active",
          continuationHandle: continuation.handle,
          nextSafeAction:
            "Implement checkout submission from the locked contract.",
        },
      ],
      continuation: { handle: continuation.handle },
    });

    await checkpoint(
      root,
      "task-recover-two",
      "Implement the approved account summary.",
      ["code:account-summary"],
    );
    await expect(recoverTaskResumeState(root)).resolves.toMatchObject({
      status: "selection-required",
      candidateCount: 2,
      candidates: expect.arrayContaining([
        expect.objectContaining({ taskId: "task-recover-one" }),
        expect.objectContaining({ taskId: "task-recover-two" }),
      ]),
    });
    await expect(listTaskResumeCandidates(root, 1)).resolves.toHaveLength(1);
  });

  it("discovers an active legacy capsule in the checkout-local store", async () => {
    const root = await repository();
    const directory = path.join(
      root,
      ".component-atlas",
      "task-state",
      "capsules",
    );
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "task-v3.json"),
      JSON.stringify({
        schemaVersion: 3,
        taskId: "task-v3",
        status: "active",
        createdAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:05:00.000Z",
        objective: { text: "Continue a legacy task", approved: true },
        decisions: [],
        sourceReceiptIds: [],
        handles: ["code:legacy-component"],
        scope: { covered: ["intake"], remaining: ["implementation"] },
        workspace: { rootPath: root, head: "abc123" },
        budget: { contextChars: 2_400, estimatedTokens: 600 },
        nextSafeAction: "Continue the legacy task.",
      }),
      "utf8",
    );

    await expect(recoverTaskResumeState(root)).resolves.toMatchObject({
      status: "ready",
      candidateCount: 1,
      candidates: [expect.objectContaining({ taskId: "task-v3" })],
      capsule: { schemaVersion: 4, taskId: "task-v3" },
    });
  });

  it("returns the same newest capsule selected across central and legacy stores", async () => {
    const root = await repository();
    await checkpoint(
      root,
      "task-duplicate",
      "Older central objective.",
      ["code:central-component"],
    );
    const directory = path.join(
      root,
      ".component-atlas",
      "task-state",
      "capsules",
    );
    await mkdir(directory, { recursive: true });
    const later = new Date(Date.now() + 60_000).toISOString();
    await writeFile(
      path.join(directory, "task-duplicate.json"),
      JSON.stringify({
        schemaVersion: 3,
        taskId: "task-duplicate",
        status: "active",
        createdAt: later,
        updatedAt: later,
        objective: { text: "Newest legacy objective.", approved: true },
        decisions: [],
        sourceReceiptIds: [],
        handles: ["code:legacy-component"],
        scope: { covered: ["intake"], remaining: ["implementation"] },
        workspace: { rootPath: root, head: "legacy-head" },
        budget: { contextChars: 2_400, estimatedTokens: 600 },
        nextSafeAction: "Continue from the newest legacy capsule.",
      }),
      "utf8",
    );

    await expect(recoverTaskResumeState(root)).resolves.toMatchObject({
      status: "ready",
      candidates: [
        {
          taskId: "task-duplicate",
          objective: "Newest legacy objective.",
          nextSafeAction: "Continue from the newest legacy capsule.",
        },
      ],
      capsule: {
        taskId: "task-duplicate",
        objective: { text: "Newest legacy objective." },
        handles: ["code:legacy-component"],
        nextSafeAction: "Continue from the newest legacy capsule.",
      },
    });
  });

  it("fails closed instead of choosing another task when a capsule is corrupt", async () => {
    const root = await repository();
    await checkpoint(root, "task-valid", "Continue the valid task.", [
      "code:valid-component",
    ]);
    const identity = await resolveProjectIdentity(root);
    const directory = path.join(
      projectStorageDirectory(identity.logicalId),
      "task-state",
      "capsules",
    );
    await writeFile(
      path.join(directory, "truncated.json"),
      "{\"schemaVersion\":4",
      "utf8",
    );

    await expect(recoverTaskResumeState(root)).rejects.toThrow(
      /discovery stopped.*corrupt/iu,
    );
  });

  it("does not recover a task that belongs to another checkout", async () => {
    const first = await repository("atlas-recovery-checkout-a-");
    const second = await repository("atlas-recovery-checkout-b-");
    for (const root of [first, second]) {
      await run("git", ["init"], { cwd: root, windowsHide: true });
      await run(
        "git",
        ["remote", "add", "origin", "https://example.test/shared/atlas.git"],
        { cwd: root, windowsHide: true },
      );
    }
    await checkpoint(first, "task-other-checkout", "Change checkout A only.");

    await expect(recoverTaskResumeState(second)).resolves.toEqual({
      status: "not-found",
      candidateCount: 0,
      candidates: [],
    });
  });
});
