import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  taskSourceId,
  taskSourceRelationId,
  type TaskSourceDecision,
} from "@component-atlas/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLockedChangeSurface } from "./change-surface-lock.js";
import {
  MAX_TASK_GOVERNANCE_REASONS,
  normalizeTaskGovernance,
  type TaskGovernance,
} from "./task-governance.js";
import {
  loadTaskFinalReceipt,
  loadTaskResumeCapsule,
  loadTaskSourceLedger,
  pruneExpiredTaskState,
  resolveTaskObjective,
  writeTaskCheckpoint,
} from "./task-state.js";
import {
  persistTaskObjective,
  taskObjectiveReference,
} from "./task-objective.js";

const run = promisify(execFile);
let dataHome: string;
let previousDataHome: string | undefined;
const roots: string[] = [];

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function checkpoint(
  taskId: string,
  governance?: TaskGovernance,
  overrides: Partial<Parameters<typeof writeTaskCheckpoint>[1]> = {},
): Parameters<typeof writeTaskCheckpoint>[1] {
  return {
    taskId,
    milestone: "objective-approved",
    objective: `Implement ${taskId} safely.`,
    objectiveApproved: true,
    ...(governance ? { governance } : {}),
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
  dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-governance-home-"));
  process.env.PROJECT_ATLAS_HOME = dataHome;
});

afterEach(async () => {
  if (previousDataHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousDataHome;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
  await rm(dataHome, { recursive: true, force: true });
});

describe("persisted task governance", () => {
  it("persists real small, medium and large classifications independently", async () => {
    const root = await temporaryRoot("atlas-governance-sizes-");
    const cases: Array<[string, TaskGovernance]> = [
      [
        "task-small",
        {
          size: "small",
          risk: "low",
          reviewTier: "none",
          reasons: ["Localized established presentation change"],
        },
      ],
      [
        "task-medium",
        {
          size: "medium",
          risk: "medium",
          reviewTier: "correctness",
          reasons: ["Shared stateful component surface"],
        },
      ],
      [
        "task-large",
        {
          size: "large",
          risk: "high",
          reviewTier: "specialist",
          reasons: ["Cross-flow accessibility-critical change"],
        },
      ],
    ];
    for (const [taskId, governance] of cases) {
      await writeTaskCheckpoint(root, checkpoint(taskId, governance));
      await expect(loadTaskResumeCapsule(root, taskId)).resolves.toMatchObject({
        governance,
      });
    }
  });

  it("allows escalation, merges reasons and rejects every downgrade axis", async () => {
    const root = await temporaryRoot("atlas-governance-monotonic-");
    const taskId = "task-governance-escalation";
    await writeTaskCheckpoint(
      root,
      checkpoint(taskId, {
        size: "small",
        risk: "low",
        reviewTier: "none",
        reasons: ["Initially localized"],
      }),
    );
    await writeTaskCheckpoint(
      root,
      checkpoint(
        taskId,
        {
          size: "medium",
          risk: "medium",
          reviewTier: "correctness",
          reasons: ["Shared consumer discovered"],
        },
        { milestone: "risk-boundary" },
      ),
    );
    await writeTaskCheckpoint(
      root,
      checkpoint(
        taskId,
        {
          size: "large",
          risk: "high",
          reviewTier: "specialist",
          reasons: ["Accessibility-critical flow impact"],
        },
        { milestone: "risk-boundary" },
      ),
    );
    await expect(loadTaskResumeCapsule(root, taskId)).resolves.toMatchObject({
      governance: {
        size: "large",
        risk: "high",
        reviewTier: "specialist",
        reasons: [
          "Initially localized",
          "Shared consumer discovered",
          "Accessibility-critical flow impact",
        ],
      },
    });

    const downgradeCases: TaskGovernance[] = [
      {
        size: "medium",
        risk: "high",
        reviewTier: "specialist",
        reasons: [],
      },
      {
        size: "large",
        risk: "medium",
        reviewTier: "specialist",
        reasons: [],
      },
      {
        size: "large",
        risk: "high",
        reviewTier: "correctness",
        reasons: [],
      },
    ];
    for (const governance of downgradeCases) {
      await expect(
        writeTaskCheckpoint(root, checkpoint(taskId, governance)),
      ).rejects.toThrow(/cannot lower/iu);
    }
    await expect(loadTaskResumeCapsule(root, taskId)).resolves.toMatchObject({
      governance: {
        size: "large",
        risk: "high",
        reviewTier: "specialist",
      },
    });
  });

  it("canonicalizes, deduplicates and bounds governance reasons", () => {
    expect(
      normalizeTaskGovernance({
        size: "medium",
        risk: "medium",
        reviewTier: "correctness",
        reasons: [
          "  Shared\nstate  ",
          "Shared state",
          "API contract",
          "Multiple consumers",
          "Visual states",
          "This reason is outside the compact reason budget",
        ],
      }),
    ).toEqual({
      size: "medium",
      risk: "medium",
      reviewTier: "correctness",
      reasons: [
        "Shared state",
        "API contract",
        "Multiple consumers",
        "Visual states",
      ],
    });
    expect(MAX_TASK_GOVERNANCE_REASONS).toBe(4);
  });

  it("accepts a first classification for legacy state and retains it in final prune", async () => {
    const root = await temporaryRoot("atlas-governance-legacy-");
    const taskId = "task-governance-legacy";
    await writeTaskCheckpoint(
      root,
      checkpoint(taskId, undefined, { at: "2026-06-30T00:00:00.000Z" }),
    );
    expect((await loadTaskResumeCapsule(root, taskId))?.governance).toBeUndefined();
    const governance: TaskGovernance = {
      size: "medium",
      risk: "high",
      reviewTier: "specialist",
      reasons: ["Legacy task classified before continuation"],
    };
    await writeTaskCheckpoint(
      root,
      checkpoint(taskId, governance, {
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
    await expect(loadTaskFinalReceipt(root, taskId)).resolves.toMatchObject({
      governance,
    });
  });

  it("fits objective, lock, visual review and governance under the 4 KB capsule cap", async () => {
    const root = await temporaryRoot("atlas-governance-dense-");
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "dense-governance", dependencies: { react: "^19" } }),
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
    const taskId = "task-dense";
    const contractHandle = `contract:${taskId}:1111111111111111`;
    const continuationHandle = `continuation:${taskId}:2222222222222222`;
    const figmaSnapshotHandle = `figma-snapshot:${taskId}:3333333333333333`;
    const sentinel = "DENSE-OBJECTIVE-TAIL";
    const objectiveText = `${"Detailed visual acceptance criterion. ".repeat(70)}${sentinel}`;
    const objectiveArtifact = await persistTaskObjective(root, {
      taskId,
      objective: objectiveText,
    });
    const receiptIds = Array.from(
      { length: 10 },
      (_, index) => `receipt-${index.toString(16).padStart(64, "0")}`,
    );
    const decisions: TaskSourceDecision[] = Array.from(
      { length: 10 },
      (_, index) => {
        const reference = `https://example.test/requirements/${index}/with-a-long-reference`;
        return {
          id: taskSourceId("jira", reference),
          kind: "jira" as const,
          reference,
          origin: "explicit" as const,
          state: "confirmed" as const,
          required: true,
          authorityRole: "requirement" as const,
        };
      },
    );
    const relations = decisions.slice(1, 7).map((decision) => ({
      id: taskSourceRelationId(
        decisions[0]!.id,
        decision.id,
        "secondary-implementation-reference",
      ),
      fromSourceId: decisions[0]!.id,
      toSourceId: decision.id,
      kind: "secondary-implementation-reference" as const,
    }));
    const lock = await createLockedChangeSurface(root, {
      taskId,
      objective: taskObjectiveReference(objectiveArtifact),
      intent: objectiveText,
      primary: {
        kind: "component",
        id: "react:src/App.tsx:App",
        path: "src/App.tsx",
      },
      allowedFiles: ["src/App.tsx"],
      reuseDecision: {
        decision: "extend",
        rationale: "The existing App owns the visual flow and shared state.",
      },
      handles: [contractHandle, figmaSnapshotHandle],
    });
    const governance: TaskGovernance = {
      size: "large",
      risk: "high",
      reviewTier: "specialist",
      reasons: Array.from(
        { length: 4 },
        (_, index) => `Specialist review reason ${index} ${"x".repeat(40)}`,
      ),
    };
    await writeTaskCheckpoint(root, {
      ...checkpoint(taskId, governance),
      objective: objectiveText,
      objectiveReference: taskObjectiveReference(objectiveArtifact),
      milestone: "batch-completed",
      decisions,
      sourceRelations: relations,
      sourceReceiptIds: receiptIds,
      handles: [
        continuationHandle,
        contractHandle,
        figmaSnapshotHandle,
      ],
      covered: Array.from({ length: 8 }, (_, index) => `covered-${index}`),
      remaining: Array.from({ length: 8 }, (_, index) => `remaining-${index}`),
      changeSurface: lock,
      visualReview: {
        schemaVersion: 2,
        receiptHandle: `visual-review:${taskId}:aaaaaaaaaaaaaaaa`,
        receiptHash: "a".repeat(64),
        contractHandle: `visual:vd-${taskId}:bbbbbbbbbbbbbbbb`,
        contractHash: "b".repeat(64),
        result: "pass",
        captureCount: 4,
        deviationCount: 0,
        cleanup: { state: "clean" },
        reviewedAt: "2026-07-31T18:00:00.000Z",
      },
      activePolicy: {
        visualMode: "fidelity",
        inventionBudget: 0,
        excludedSurfaces: Array.from(
          { length: 6 },
          (_, index) => `ExcludedSurface${index}`,
        ),
      },
      contextReferences: {
        themeFingerprintHash: "c".repeat(64),
        designCoverageLedger: {
          id: "dense-design-coverage",
          hash: "d".repeat(64),
          selectedNodeIds: Array.from(
            { length: 6 },
            (_, index) => `node:${index}`,
          ),
        },
      },
    });

    const capsule = await loadTaskResumeCapsule(root, taskId);
    expect(Buffer.byteLength(JSON.stringify(capsule), "utf8")).toBeLessThanOrEqual(
      3_800,
    );
    expect(capsule?.governance).toEqual(governance);
    expect(capsule?.changeSurface?.lockId).toBe(lock.lockId);
    expect(capsule?.handles).toEqual(
      expect.arrayContaining([
        continuationHandle,
        contractHandle,
        figmaSnapshotHandle,
      ]),
    );
    expect(capsule?.visualReview).toMatchObject({
      schemaVersion: 3,
      receiptHandle: `visual-review:${taskId}:${"a".repeat(16)}`,
      receiptHash: "a".repeat(64),
    });
    await expect(resolveTaskObjective(root, taskId)).resolves.toMatchObject({
      text: expect.stringContaining(sentinel),
    });
    const ledger = await loadTaskSourceLedger(root, taskId);
    expect(ledger?.decisions.map((decision) => decision.id)).toEqual(
      decisions.map((decision) => decision.id),
    );
    expect(ledger?.relations.map((relation) => relation.id)).toEqual(
      relations.map((relation) => relation.id),
    );
    expect(ledger?.receiptIds).toEqual(receiptIds);
  });
});
