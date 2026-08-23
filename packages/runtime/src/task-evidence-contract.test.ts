import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectStorageDirectory } from "@component-atlas/store";
import { resolveProjectIdentity } from "./identity.js";
import { computeTaskObjectiveHash } from "./task-objective.js";
import {
  expandTaskContinuationBundle,
  expandTaskEvidenceContract,
  loadLatestTaskContinuationBundle,
  loadLatestTaskEvidenceContract,
  loadTaskContinuationBundle,
  loadTaskEvidenceContract,
  persistTaskContinuationBundle,
  persistTaskContinuationBundleWithCheckpoint,
  persistTaskEvidenceContract,
  persistTaskEvidenceContractWithCheckpoint,
  taskAcceptanceState,
} from "./task-evidence-contract.js";
import { recoverTaskResumeState } from "./task-recovery.js";
import {
  loadTaskResumeCapsule,
  writeTaskCheckpoint,
} from "./task-state.js";

const roots: string[] = [];
let previousAtlasHome: string | undefined;

beforeEach(async () => {
  previousAtlasHome = process.env.PROJECT_ATLAS_HOME;
  const home = await mkdtemp(path.join(os.tmpdir(), "atlas-evidence-home-"));
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
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-evidence-project-"));
  roots.push(root);
  return root;
}

function contractInput() {
  const objective = "Implement the approved checkout experience.";
  return {
    taskId: "task-checkout",
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
      {
        id: "responsive-layout",
        statement: "The checkout remains usable at the supported widths.",
        required: false,
        sourceRefs: ["design:FileKey::12:34"],
      },
    ],
    decisions: [
      {
        id: "retry-policy",
        question: "Should failed submissions retry automatically?",
        status: "open" as const,
        sourceRefs: ["jira:SHOP-42"],
      },
    ],
    constraints: ["Do not change the public checkout API."],
    exclusions: ["Payment-provider migration is out of scope."],
    contextHandles: ["code:checkout-form", "design:FileKey::12:34"],
    createdAt: "2026-08-23T10:00:00.000Z",
  };
}

async function checkpoint(
  root: string,
  taskId: string,
  objective: string,
  handles: string[],
  nextSafeAction: string,
) {
  return writeTaskCheckpoint(root, {
    taskId,
    milestone: "decision-confirmed",
    objective,
    objectiveApproved: true,
    decisions: [],
    sourceReceiptIds: [],
    handles,
    covered: ["Source intake"],
    remaining: ["Implementation", "Validation"],
    budgetChars: 2_400,
    nextSafeAction,
  });
}

describe("task evidence contract", () => {
  it("persists an immutable contract and creates explicit revisions", async () => {
    const root = await repository();
    const first = await persistTaskEvidenceContract(root, contractInput());

    expect(first).toMatchObject({
      handle: expect.stringMatching(/^contract:task-checkout:[a-f0-9]{16}$/u),
      revision: 1,
      objective: "Implement the approved checkout experience.",
    });
    await expect(loadTaskEvidenceContract(root, first.handle)).resolves.toEqual(first);
    await expect(loadLatestTaskEvidenceContract(root, first.taskId)).resolves.toEqual(
      first,
    );
    await expect(expandTaskEvidenceContract(root, first.handle)).resolves.toMatchObject({
      contract: { handle: first.handle, criteria: expect.any(Array) },
    });

    const identical = await persistTaskEvidenceContract(root, {
      ...contractInput(),
      objective: "  Implement the approved checkout experience.  ",
      createdAt: "2026-08-23T10:01:00.000Z",
    });
    expect(identical).toEqual(first);

    await expect(
      persistTaskEvidenceContract(root, {
        ...contractInput(),
        constraints: ["Use the existing checkout API."],
      }),
    ).rejects.toThrow(/latest revision/iu);

    const second = await persistTaskEvidenceContract(root, {
      ...contractInput(),
      previousHandle: first.handle,
      decisions: [
        {
          id: "retry-policy",
          question: "Should failed submissions retry automatically?",
          status: "resolved",
          answer: "No. Keep retry under explicit user control.",
          sourceRefs: ["jira:SHOP-42"],
        },
      ],
      createdAt: "2026-08-23T10:05:00.000Z",
    });
    expect(second).toMatchObject({ revision: 2, previousHandle: first.handle });
    expect(second.handle).not.toBe(first.handle);
    await expect(loadTaskEvidenceContract(root, first.handle)).resolves.toEqual(first);
    await expect(loadLatestTaskEvidenceContract(root, first.taskId)).resolves.toEqual(
      second,
    );
  });

  it("rejects forged objective hashes and oversized contracts instead of trimming them", async () => {
    const root = await repository();
    await expect(
      persistTaskEvidenceContract(root, {
        ...contractInput(),
        objectiveHash: "f".repeat(64),
      }),
    ).rejects.toThrow(/objective hash/iu);

    await expect(
      persistTaskEvidenceContract(root, {
        ...contractInput(),
        criteria: Array.from({ length: 40 }, (_, index) => ({
          id: `criterion-${index}`,
          statement: `${index}-${"x".repeat(900)}`,
          required: true,
          sourceRefs: [],
        })),
      }),
    ).rejects.toThrow(/storage budget/iu);
  });

  it("rejects one of two concurrent revisions instead of losing either silently", async () => {
    const root = await repository();
    const first = await persistTaskEvidenceContract(root, contractInput());
    const attempts = await Promise.allSettled([
      persistTaskEvidenceContract(root, {
        ...contractInput(),
        previousHandle: first.handle,
        constraints: ["Writer A keeps the existing checkout API."],
      }),
      persistTaskEvidenceContract(root, {
        ...contractInput(),
        previousHandle: first.handle,
        constraints: ["Writer B keeps the existing checkout API."],
      }),
    ]);
    const fulfilled = attempts.filter(
      (attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof persistTaskEvidenceContract>>> =>
        attempt.status === "fulfilled",
    );
    const rejected = attempts.filter((attempt) => attempt.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    await expect(loadLatestTaskEvidenceContract(root, first.taskId)).resolves.toEqual(
      fulfilled[0]!.value,
    );
  });

  it("keeps the evidence lock through the capsule checkpoint and publishes one coherent revision", async () => {
    const root = await repository();
    let releaseCheckpoint!: () => void;
    let checkpointStarted!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseCheckpoint = resolve;
    });
    const started = new Promise<void>((resolve) => {
      checkpointStarted = resolve;
    });

    const transaction = persistTaskEvidenceContractWithCheckpoint(
      root,
      contractInput(),
      async (contract) => {
        checkpointStarted();
        await release;
        return checkpoint(
          root,
          contract.taskId,
          contract.objective,
          [contract.handle],
          "Checkpoint criterion progress against the latest contract.",
        );
      },
    );
    await started;

    await expect(
      persistTaskEvidenceContractWithCheckpoint(
        root,
        {
          ...contractInput(),
          constraints: ["A concurrent writer must not replace the transaction."],
        },
        async () => "unexpected",
      ),
    ).rejects.toThrow(/locked by another writer/iu);

    releaseCheckpoint();
    const saved = await transaction;
    const capsule = await loadTaskResumeCapsule(root, saved.artifact.taskId);
    expect(saved.checkpoint.handles).toContain(saved.artifact.handle);
    expect(capsule?.handles).toContain(saved.artifact.handle);
    await expect(
      loadLatestTaskEvidenceContract(root, saved.artifact.taskId),
    ).resolves.toEqual(saved.artifact);
  });

  it("marks a semantically identical contract checkpoint as a non-publishing retry", async () => {
    const root = await repository();
    const first = await persistTaskEvidenceContract(root, contractInput());
    let receivedMetadata:
      | { readonly publish: boolean; readonly previousHandle?: string }
      | undefined;

    const retry = await persistTaskEvidenceContractWithCheckpoint(
      root,
      {
        ...contractInput(),
        createdAt: "2026-08-23T11:00:00.000Z",
      },
      async (contract, metadata) => {
        receivedMetadata = metadata;
        return contract.handle;
      },
    );

    expect(retry.artifact).toEqual(first);
    expect(retry.checkpoint).toBe(first.handle);
    expect(receivedMetadata).toEqual({ publish: false });
    expect(Object.isFrozen(receivedMetadata)).toBe(true);
  });
});

describe("task continuation bundle", () => {
  it("tracks every criterion and exposes completion readiness", async () => {
    const root = await repository();
    const contract = await persistTaskEvidenceContract(root, contractInput());

    await expect(
      persistTaskContinuationBundle(root, {
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
        nextSafeAction: "Implement checkout submission.",
      }),
    ).rejects.toThrow(/every contract criterion/iu);

    const first = await persistTaskContinuationBundle(root, {
      taskId: contract.taskId,
      contractHandle: contract.handle,
      criteria: [
        {
          criterionId: "checkout-submit",
          status: "pending",
          evidenceRefs: [],
          validationRefs: [],
        },
        {
          criterionId: "responsive-layout",
          status: "deferred",
          evidenceRefs: [],
          validationRefs: [],
          note: "Validate after the implementation pass.",
        },
      ],
      covered: ["Source intake"],
      remaining: ["Implementation", "Validation"],
      nextSafeAction: "Implement checkout submission.",
      createdAt: "2026-08-23T10:10:00.000Z",
    });
    expect(taskAcceptanceState(contract, first)).toEqual({
      ready: false,
      required: 1,
      satisfied: 0,
      pending: ["checkout-submit"],
      blocked: [],
      deferred: [],
    });

    const second = await persistTaskContinuationBundle(root, {
      taskId: contract.taskId,
      contractHandle: contract.handle,
      previousHandle: first.handle,
      criteria: [
        {
          criterionId: "checkout-submit",
          status: "satisfied",
          evidenceRefs: ["code:checkout-form"],
          validationRefs: ["test:checkout-submit"],
        },
        {
          criterionId: "responsive-layout",
          status: "deferred",
          evidenceRefs: [],
          validationRefs: [],
        },
      ],
      covered: ["Source intake", "Implementation"],
      remaining: ["Optional responsive review"],
      nextSafeAction: "Run final validation and close the task.",
      validationRefs: ["test:checkout-submit"],
      createdAt: "2026-08-23T10:20:00.000Z",
    });
    expect(second).toMatchObject({ revision: 2, previousHandle: first.handle });
    expect(taskAcceptanceState(contract, second)).toMatchObject({ ready: true });
    await expect(loadTaskContinuationBundle(root, first.handle)).resolves.toEqual(first);
    await expect(
      loadLatestTaskContinuationBundle(root, contract.taskId),
    ).resolves.toEqual(second);
    await expect(
      expandTaskContinuationBundle(root, second.handle),
    ).resolves.toMatchObject({
      continuation: { handle: second.handle },
      acceptance: { ready: true },
    });
  });

  it("requires evidence before a criterion can be marked satisfied", async () => {
    const root = await repository();
    const contract = await persistTaskEvidenceContract(root, contractInput());
    await expect(
      persistTaskContinuationBundle(root, {
        taskId: contract.taskId,
        contractHandle: contract.handle,
        criteria: contract.criteria.map((criterion) => ({
          criterionId: criterion.id,
          status: "satisfied" as const,
          evidenceRefs: [],
          validationRefs: [],
        })),
        nextSafeAction: "Close the task.",
      }),
    ).rejects.toThrow(/requires evidence/iu);
  });

  it("marks a semantically identical continuation checkpoint as a non-publishing retry", async () => {
    const root = await repository();
    const contract = await persistTaskEvidenceContract(root, contractInput());
    const input = {
      taskId: contract.taskId,
      contractHandle: contract.handle,
      criteria: contract.criteria.map((criterion) => ({
        criterionId: criterion.id,
        status: "pending" as const,
        evidenceRefs: [],
        validationRefs: [],
      })),
      nextSafeAction: "Implement the approved contract.",
    };
    const first = await persistTaskContinuationBundle(root, input);
    const retry = await persistTaskContinuationBundleWithCheckpoint(
      root,
      input,
      async (_continuation, metadata) => metadata,
    );

    expect(retry.artifact).toEqual(first);
    expect(retry.checkpoint).toEqual({ publish: false });
    expect(Object.isFrozen(retry.checkpoint)).toBe(true);
  });

  it("refuses to resume a continuation whose immutable contract is missing", async () => {
    const root = await repository();
    const contract = await persistTaskEvidenceContract(root, contractInput());
    await persistTaskContinuationBundle(root, {
      taskId: contract.taskId,
      contractHandle: contract.handle,
      criteria: contract.criteria.map((criterion) => ({
        criterionId: criterion.id,
        status: "pending" as const,
        evidenceRefs: [],
        validationRefs: [],
      })),
      nextSafeAction: "Continue only from verified evidence.",
    });
    const identity = await resolveProjectIdentity(root);
    const artifactRoot = path.join(
      projectStorageDirectory(identity.logicalId),
      "task-state",
      "evidence-contracts",
      "artifacts",
    );
    const taskDirectories = await readdir(artifactRoot);
    expect(taskDirectories).toHaveLength(1);
    const directory = path.join(artifactRoot, taskDirectories[0]!);
    const artifacts = (await readdir(directory)).filter((name) =>
      name.endsWith(".json"),
    );
    expect(artifacts).toHaveLength(1);
    await rm(path.join(directory, artifacts[0]!));

    await expect(
      loadLatestTaskContinuationBundle(root, contract.taskId),
    ).rejects.toThrow();
  });

  it("does not activate a continuation when its capsule checkpoint callback fails", async () => {
    const root = await repository();
    const contract = await persistTaskEvidenceContract(root, contractInput());
    await checkpoint(
      root,
      contract.taskId,
      contract.objective,
      [contract.handle],
      "Checkpoint criterion progress.",
    );
    let stagedHandle: string | undefined;

    await expect(
      persistTaskContinuationBundleWithCheckpoint(
        root,
        {
          taskId: contract.taskId,
          contractHandle: contract.handle,
          criteria: contract.criteria.map((criterion) => ({
            criterionId: criterion.id,
            status: "pending" as const,
            evidenceRefs: [],
            validationRefs: [],
          })),
          nextSafeAction: "Implement from staged progress.",
        },
        async (continuation) => {
          stagedHandle = continuation.handle;
          await checkpoint(
            root,
            contract.taskId,
            contract.objective,
            [continuation.handle, contract.handle],
            continuation.nextSafeAction,
          );
          throw new Error("simulated failure after capsule publication");
        },
      ),
    ).rejects.toThrow(/simulated failure/iu);

    expect(stagedHandle).toBeDefined();
    await expect(
      loadTaskContinuationBundle(root, stagedHandle!),
    ).resolves.toMatchObject({ handle: stagedHandle });
    await expect(
      loadLatestTaskContinuationBundle(root, contract.taskId),
    ).resolves.toBeUndefined();
    await expect(recoverTaskResumeState(root)).resolves.toMatchObject({
      status: "ready",
      candidates: [
        {
          taskId: contract.taskId,
          nextSafeAction:
            "Reconcile the task capsule with the latest durable evidence before resuming implementation.",
        },
      ],
      capsule: {
        handles: [contract.handle],
      },
    });
    const recovered = await recoverTaskResumeState(root);
    expect(recovered).not.toHaveProperty("continuation");
    if (recovered.status === "ready") {
      expect(recovered.capsule.handles).not.toContain(stagedHandle);
    }
  });

  it("retires latest continuation progress when the evidence contract changes", async () => {
    const root = await repository();
    const firstContract = await persistTaskEvidenceContract(root, contractInput());
    const firstContinuation = await persistTaskContinuationBundle(root, {
      taskId: firstContract.taskId,
      contractHandle: firstContract.handle,
      criteria: firstContract.criteria.map((criterion) => ({
        criterionId: criterion.id,
        status: "pending" as const,
        evidenceRefs: [],
        validationRefs: [],
      })),
      nextSafeAction: "Implement the first contract.",
    });
    const secondContract = await persistTaskEvidenceContract(root, {
      ...contractInput(),
      previousHandle: firstContract.handle,
      constraints: ["Use the existing checkout API and preserve idempotency."],
    });

    await expect(
      loadLatestTaskContinuationBundle(root, firstContract.taskId),
    ).resolves.toBeUndefined();
    await expect(
      persistTaskContinuationBundle(root, {
        taskId: firstContract.taskId,
        contractHandle: firstContract.handle,
        previousHandle: firstContinuation.handle,
        criteria: firstContinuation.criteria,
        nextSafeAction: "Continue obsolete progress.",
      }),
    ).rejects.toThrow(/latest evidence contract/iu);

    const replacement = await persistTaskContinuationBundle(root, {
      taskId: secondContract.taskId,
      contractHandle: secondContract.handle,
      criteria: secondContract.criteria.map((criterion) => ({
        criterionId: criterion.id,
        status: "pending" as const,
        evidenceRefs: [],
        validationRefs: [],
      })),
      nextSafeAction: "Implement the revised contract.",
    });
    expect(replacement).toMatchObject({
      revision: 1,
      contract: { handle: secondContract.handle },
    });
    expect(replacement.previousHandle).toBeUndefined();
  });
});
