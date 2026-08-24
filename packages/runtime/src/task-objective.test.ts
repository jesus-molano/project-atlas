import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertLockedChangeSurfaceArtifact,
  createLockedChangeSurface,
} from "./change-surface-lock.js";
import {
  claimTaskCompletionIntent,
  commitTaskCompletionIntent,
  loadTaskCompletionCommit,
} from "./task-completion-intent.js";
import {
  loadTaskCompletionReceipt,
  persistTaskCompletionReceipt,
} from "./task-completion-receipt.js";
import {
  loadTaskObjectiveArtifact,
  persistTaskObjective,
  taskObjectiveArtifactPath,
  taskObjectiveReference,
} from "./task-objective.js";
import { recoverTaskResumeState } from "./task-recovery.js";
import {
  loadTaskFinalReceipt,
  loadTaskResumeCapsule,
  pruneExpiredTaskState,
  resolveTaskObjective,
  writeTaskCheckpoint,
} from "./task-state.js";

let dataHome: string;
let previousDataHome: string | undefined;
let previousProjectKey: string | undefined;
const roots: string[] = [];
const run = promisify(execFile);

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function checkpoint(
  taskId: string,
  objective: string,
  overrides: Partial<Parameters<typeof writeTaskCheckpoint>[1]> = {},
): Parameters<typeof writeTaskCheckpoint>[1] {
  return {
    taskId,
    milestone: "objective-approved",
    objective,
    objectiveApproved: true,
    decisions: [],
    sourceReceiptIds: [],
    handles: [],
    covered: ["intake"],
    remaining: ["implementation"],
    budgetChars: 800,
    nextSafeAction: "Lock the implementation surface.",
    ...overrides,
  };
}

beforeEach(async () => {
  previousDataHome = process.env.PROJECT_ATLAS_HOME;
  previousProjectKey = process.env.PROJECT_ATLAS_PROJECT_KEY;
  dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-objective-home-"));
  process.env.PROJECT_ATLAS_HOME = dataHome;
  delete process.env.PROJECT_ATLAS_PROJECT_KEY;
});

afterEach(async () => {
  if (previousDataHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousDataHome;
  if (previousProjectKey === undefined) delete process.env.PROJECT_ATLAS_PROJECT_KEY;
  else process.env.PROJECT_ATLAS_PROJECT_KEY = previousProjectKey;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
  await rm(dataHome, { recursive: true, force: true });
});

describe("immutable task objective authority", () => {
  it("preserves a long objective tail through compact resume and idempotent retries", async () => {
    const root = await temporaryRoot("atlas-objective-long-");
    const sentinel = "TAIL-SENTINEL-DO-NOT-TRUNCATE";
    const objective = [
      "Implement the complete checkout accessibility contract.",
      "Acceptance details: ".repeat(90),
      sentinel,
    ].join("\n");
    expect(objective.length).toBeGreaterThan(1_000);

    const first = await persistTaskObjective(root, {
      taskId: "task-long-objective",
      objective,
    });
    const retry = await persistTaskObjective(root, {
      taskId: "task-long-objective",
      objective: `  ${objective}\n`,
    });
    expect(retry).toEqual(first);
    expect(
      await readdir(path.dirname(await taskObjectiveArtifactPath(root, first.handle))),
    ).toHaveLength(1);

    await writeTaskCheckpoint(
      root,
      checkpoint("task-long-objective", objective),
    );
    const capsule = await loadTaskResumeCapsule(root, "task-long-objective");
    expect(capsule?.objective).toMatchObject({
      authority: "authoritative",
      reference: {
        handle: first.handle,
        hash: first.objectiveHash,
      },
    });
    expect(capsule?.objective.text).not.toContain(sentinel);
    expect(Buffer.byteLength(JSON.stringify(capsule), "utf8")).toBeLessThanOrEqual(
      4_096,
    );
    await expect(
      resolveTaskObjective(root, "task-long-objective"),
    ).resolves.toMatchObject({
      authority: "authoritative",
      text: objective,
      reference: { handle: first.handle },
    });
    await expect(recoverTaskResumeState(root)).resolves.toMatchObject({
      status: "ready",
      candidates: [
        expect.objectContaining({
          title: "Implement the complete checkout accessibility contract.",
          objective,
        }),
      ],
    });

    // Simulates an older lifecycle caller that only echoes the bounded capsule.
    await writeTaskCheckpoint(
      root,
      checkpoint("task-long-objective", capsule!.objective.text, {
        milestone: "batch-completed",
        covered: ["intake", "implementation"],
        remaining: ["validation"],
      }),
    );
    await expect(
      resolveTaskObjective(root, "task-long-objective"),
    ).resolves.toMatchObject({ text: objective });
  });

  it("rejects tampering and references used by another task", async () => {
    const root = await temporaryRoot("atlas-objective-integrity-");
    const objective = "Preserve this exact objective through validation.";
    const artifact = await persistTaskObjective(root, {
      taskId: "task-objective-a",
      objective,
    });
    const reference = taskObjectiveReference(artifact);
    await expect(
      loadTaskObjectiveArtifact(root, reference, "task-objective-b"),
    ).rejects.toThrow(/different task/iu);
    await expect(
      writeTaskCheckpoint(
        root,
        checkpoint("task-objective-b", objective, {
          objectiveReference: reference,
        }),
      ),
    ).rejects.toThrow(/different task/iu);

    await writeTaskCheckpoint(
      root,
      checkpoint("task-objective-a", objective, {
        objectiveReference: reference,
      }),
    );
    const artifactPath = await taskObjectiveArtifactPath(root, reference);
    const tampered = JSON.parse(await readFile(artifactPath, "utf8")) as {
      text: string;
    };
    tampered.text += " Tampered.";
    await writeFile(artifactPath, JSON.stringify(tampered), "utf8");
    await expect(
      loadTaskObjectiveArtifact(root, reference, "task-objective-a"),
    ).rejects.toThrow(/content hash/iu);
    await expect(
      loadTaskResumeCapsule(root, "task-objective-a"),
    ).rejects.toThrow(/content hash/iu);
  });

  it("rejects an artifact from another checkout even with shared project storage", async () => {
    process.env.PROJECT_ATLAS_PROJECT_KEY = "objective-cross-checkout-fixture";
    const firstRoot = await temporaryRoot("atlas-objective-checkout-a-");
    const secondRoot = await temporaryRoot("atlas-objective-checkout-b-");
    const artifact = await persistTaskObjective(firstRoot, {
      taskId: "task-shared-id",
      objective: "Stay bound to the checkout that approved this objective.",
    });
    await expect(
      loadTaskObjectiveArtifact(
        secondRoot,
        taskObjectiveReference(artifact),
        "task-shared-id",
      ),
    ).rejects.toThrow(/different repository checkout/iu);
  });

  it("marks old capsule text non-authoritative until explicitly promoted", async () => {
    const root = await temporaryRoot("atlas-objective-legacy-");
    const taskId = "task-legacy-objective";
    const legacyDirectory = path.join(
      root,
      ".component-atlas",
      "task-state",
      "capsules",
    );
    await mkdir(legacyDirectory, { recursive: true });
    await writeFile(
      path.join(legacyDirectory, `${taskId}.json`),
      JSON.stringify({
        schemaVersion: 4,
        taskId,
        status: "active",
        createdAt: "2026-07-30T10:00:00.000Z",
        updatedAt: "2026-07-30T10:05:00.000Z",
        objective: { text: "Legacy bounded objective", approved: true },
        decisions: [],
        sourceReceiptIds: [],
        handles: [],
        scope: { covered: ["intake"], remaining: ["implementation"] },
        workspace: { rootPath: root, head: "abc123" },
        budget: { contextChars: 800, estimatedTokens: 200 },
        lifecycle: {
          schemaVersion: 1,
          phase: "prepared",
          revision: 1,
          preparedAt: "2026-07-30T10:00:00.000Z",
          updatedAt: "2026-07-30T10:05:00.000Z",
        },
        nextSafeAction: "Confirm the full objective before locking.",
      }),
      "utf8",
    );

    await expect(loadTaskResumeCapsule(root, taskId)).resolves.toMatchObject({
      objective: { authority: "legacy-projection" },
    });
    await writeTaskCheckpoint(
      root,
      checkpoint(taskId, "Legacy bounded objective"),
    );
    await expect(resolveTaskObjective(root, taskId)).resolves.toMatchObject({
      authority: "legacy-projection",
      text: "Legacy bounded objective",
    });

    const promoted = await persistTaskObjective(root, {
      taskId,
      objective: "Legacy bounded objective",
    });
    await writeTaskCheckpoint(
      root,
      checkpoint(taskId, promoted.text, {
        objectiveReference: taskObjectiveReference(promoted),
      }),
    );
    await expect(resolveTaskObjective(root, taskId)).resolves.toMatchObject({
      authority: "authoritative",
      reference: { handle: promoted.handle },
    });
  });

  it("keeps the full authoritative objective after capsule pruning", async () => {
    const root = await temporaryRoot("atlas-objective-prune-");
    const sentinel = "FINAL-TAIL-SENTINEL";
    const objective = `${"Full delivery objective. ".repeat(80)}${sentinel}`;
    await writeTaskCheckpoint(
      root,
      checkpoint("task-objective-final", objective, {
        status: "completed",
        milestone: "completed",
        covered: ["validation"],
        remaining: [],
        nextSafeAction: "No further technical action.",
        at: "2026-07-01T00:00:00.000Z",
      }),
    );
    expect(
      await pruneExpiredTaskState(root, new Date("2026-07-29T00:00:00.000Z")),
    ).toBe(1);
    await expect(
      loadTaskFinalReceipt(root, "task-objective-final"),
    ).resolves.toMatchObject({
      objective,
      objectiveAuthority: "authoritative",
      objectiveReference: { hash: expect.stringMatching(/^[a-f0-9]{64}$/u) },
    });
    await expect(
      resolveTaskObjective(root, "task-objective-final"),
    ).resolves.toMatchObject({
      text: expect.stringContaining(sentinel),
      authority: "authoritative",
    });
  });

  it("binds ChangeSurface and completion artifacts to the full objective", async () => {
    const root = await temporaryRoot("atlas-objective-bindings-");
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "objective-bindings", dependencies: { react: "^19" } }),
    );
    await writeFile(
      path.join(root, "src", "App.tsx"),
      "export const App = () => <main />;\n",
    );
    await run("git", ["init"], { cwd: root, windowsHide: true });
    await run("git", ["add", "."], { cwd: root, windowsHide: true });
    await run(
      "git",
      [
        "-c",
        "user.name=Atlas Test",
        "-c",
        "user.email=atlas@example.invalid",
        "commit",
        "-m",
        "fixture",
      ],
      { cwd: root, windowsHide: true },
    );
    const objectiveArtifact = await persistTaskObjective(root, {
      taskId: "task-bound-objective",
      objective: `${"Detailed acceptance contract. ".repeat(60)}BOUND-TAIL`,
    });
    const objective = taskObjectiveReference(objectiveArtifact);
    const lock = await createLockedChangeSurface(root, {
      taskId: "task-bound-objective",
      objective,
      intent: "Implement the bounded projection shown in the capsule.",
      primary: {
        kind: "component",
        id: "react:src/App.tsx:App",
        path: "src/App.tsx",
      },
      allowedFiles: ["src/App.tsx"],
      reuseDecision: {
        decision: "extend",
        rationale: "The existing App surface owns the requested behavior.",
      },
    });
    expect(lock.objective).toEqual(objective);
    await expect(
      assertLockedChangeSurfaceArtifact(root, lock.taskId, lock),
    ).resolves.toBeUndefined();

    const deltaHash = "d".repeat(64);
    const receipt = await persistTaskCompletionReceipt(root, {
      taskId: lock.taskId,
      objective,
      lockId: lock.lockId,
      result: "success",
      summary: "Implemented the complete objective.",
      verification: ["objective tail verified"],
      validatedDelta: {
        deltaHash,
        changedFiles: [{ path: "src/App.tsx" }],
      },
      head: "abc123",
      completedAt: "2026-07-31T18:00:00.000Z",
    });
    const intent = await claimTaskCompletionIntent(root, {
      taskId: lock.taskId,
      request: {
        result: "success",
        summary: receipt.summary,
        verification: receipt.verification,
        files: receipt.files,
      },
      bindings: {
        head: "abc123",
        objective,
        lockId: lock.lockId,
        deltaHash,
      },
      completedAt: receipt.completedAt,
    });
    await commitTaskCompletionIntent(root, intent, {
      taskId: lock.taskId,
      status: "completed",
      ready: true,
      result: "success",
      summary: receipt.summary,
      verification: receipt.verification,
      files: receipt.files,
      sourceReceiptIds: [],
      deliveryReceipt: receipt.handle,
      handles: [receipt.handle],
      memory: "not-written",
    });
    await expect(
      loadTaskCompletionReceipt(root, receipt.handle, lock.taskId),
    ).resolves.toMatchObject({ objective });
    await expect(
      loadTaskCompletionCommit(root, lock.taskId),
    ).resolves.toMatchObject({ requestHash: intent.requestHash });
  });
});
