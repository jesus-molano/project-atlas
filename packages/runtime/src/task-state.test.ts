import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { taskSourceRelationId, taskSourceId, type TaskSourceDecision } from "@component-atlas/core";
import { projectStorageDirectory } from "@component-atlas/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveProjectIdentity } from "./identity.js";
import { taskStateFileName } from "./task-state-paths.js";
import {
  isLockedChangeSurface,
  lockedChangeSurfaceArtifactPath,
} from "./change-surface-lock.js";
import { compareGitDelta } from "./git-delta.js";
import {
  loadConfirmedTaskSourceDecision,
  loadTaskFinalReceipt,
  loadTaskSourceLedger,
  loadTaskResumeCapsule,
  loadTaskResumeTransport,
  lockTaskChangeSurface,
  pruneExpiredTaskState,
  writeTaskCheckpoint,
} from "./task-state.js";

const run = promisify(execFile);
const sources: TaskSourceDecision[] = [
  {
    id: taskSourceId("jira", "ATLAS-42"),
    kind: "jira",
    reference: "ATLAS-42",
    origin: "explicit",
    state: "confirmed",
    required: true,
  },
];

let dataHome: string;
let previousDataHome: string | undefined;

beforeEach(async () => {
  previousDataHome = process.env.PROJECT_ATLAS_HOME;
  dataHome = await mkdtemp(path.join(os.tmpdir(), "project-atlas-state-"));
  process.env.PROJECT_ATLAS_HOME = dataHome;
});

afterEach(async () => {
  vi.useRealTimers();
  if (previousDataHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousDataHome;
  await rm(dataHome, { recursive: true, force: true });
});

describe("task checkpoint and resume", () => {
  it("rehydrates only the bounded capsule and never expands handles implicitly", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-capsule-"));
    await writeTaskCheckpoint(root, {
      taskId: "task-42",
      milestone: "decision-confirmed",
      objective: "Implement the approved checkout contract",
      objectiveApproved: true,
      decisions: sources,
      sourceReceiptIds: [],
      handles: [
        "code:checkout-form",
        "visual:vd-task-42:0123456789abcdef",
        "figma-asset:task-42:0123456789abcdef01234567",
        "delivery:task-42:0123456789abcdef",
        "feedback:task-42:0123456789abcdef",
        "git-state:task-42:fedcba9876543210",
        "entity:component:checkout-form",
        "memory:contract-rule",
        "visual:not-expandable",
      ],
      covered: ["intake"],
      remaining: ["implementation", "validation"],
      budgetChars: 2_400,
      lineage: {
        rootTaskId: "task-parent", parentTaskId: "task-parent", relation: "correction",
        sourceFeedbackHandle: "feedback:task-parent:0123456789abcdef",
      },
      feedbackSummary: {
        total: 1, pending: 1, latestHandle: "feedback:task-42:0123456789abcdef",
      },
      nextSafeAction: "Expand code:checkout-form only.",
      executionManifest: {
        handle: "manifest:task-42:0123456789abcdef",
        hash: "0123456789abcdef0123456789abcdef",
        sourceLedgerHash: "fedcba9876543210fedcba9876543210",
        retrievalBudgetId: "retrieval-budget:task-42",
      },
      activePolicy: {
        visualMode: "fidelity",
        inventionBudget: 0,
        excludedSurfaces: ["ProfileFingerprintModal"],
        authMode: "dev-mock-no-session",
        authMockGuard: {
          schemaVersion: 1,
          mode: "dev-mock-no-session",
          adapterId: "login-challenge-dev",
          environment: "development",
          challengeOnly: true,
          profileFlowUntouched: true,
          acceptsRealCredentials: false,
          readsExistingSession: false,
          createsSession: false,
          issuesTokens: false,
          writesAuthCookies: false,
          productionEnabled: false,
        },
      },
      head: "abc123",
      at: "2026-07-29T12:00:00.000Z",
    });
    const expand = vi.fn();
    const capsule = await loadTaskResumeCapsule(root, "task-42");
    expect(capsule?.handles).toEqual([
      "code:checkout-form",
      "visual:vd-task-42:0123456789abcdef",
      "figma-asset:task-42:0123456789abcdef01234567",
      "delivery:task-42:0123456789abcdef",
      "feedback:task-42:0123456789abcdef",
      "git-state:task-42:fedcba9876543210",
      "entity:component:checkout-form",
      "memory:contract-rule",
    ]);
    expect(capsule?.schemaVersion).toBe(5);
    expect(capsule?.title).toBe("Implement the approved checkout contract");
    expect(capsule?.workspace.checkoutId).toMatch(/^[a-f0-9]{20}$/u);
    expect(capsule?.lineage).toMatchObject({ rootTaskId: "task-parent", parentTaskId: "task-parent", relation: "correction" });
    expect(capsule?.feedbackSummary).toMatchObject({ total: 1, pending: 1 });
    expect(capsule?.lifecycle.phase).toBe("prepared");
    expect(capsule?.activePolicy).toMatchObject({
      visualMode: "fidelity",
      inventionBudget: 0,
      authMode: "dev-mock-no-session",
      authMockGuard: expect.objectContaining({
        adapterId: "login-challenge-dev",
        profileFlowUntouched: true,
        createsSession: false,
        productionEnabled: false,
      }),
    });
    expect(expand).not.toHaveBeenCalled();
    const transport = await loadTaskResumeTransport(root, "task-42");
    expect(transport?.bytes).toBeLessThanOrEqual(4_096);
    expect(["toon", "json"]).toContain(transport?.format);
    expect(transport?.body).toContain("nextSafeAction");
    expect(transport?.fallbackAvailable).toBe(true);
    expect(transport).not.toHaveProperty("fallbackJson");
  });

  it("serializes concurrent checkpoints and rejects a stale compare-and-swap", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-capsule-cas-"));
    const initial = await writeTaskCheckpoint(root, {
      taskId: "task-cas",
      expectedUpdatedAt: null,
      milestone: "objective-approved",
      objective: "Keep the task capsule current",
      objectiveApproved: true,
      decisions: [],
      sourceReceiptIds: [],
      handles: ["code:checkout-form"],
      covered: ["intake"],
      remaining: ["implementation"],
      budgetChars: 800,
      nextSafeAction: "Implement the approved task.",
      at: "2026-08-23T10:00:00.000Z",
    });
    const observedUpdatedAt = initial.updatedAt;
    const input = {
      taskId: "task-cas",
      expectedUpdatedAt: observedUpdatedAt,
      milestone: "batch-completed" as const,
      objective: "Keep the task capsule current",
      objectiveApproved: true,
      decisions: [],
      sourceReceiptIds: [],
      budgetChars: 800,
    };
    const [first, second] = await Promise.allSettled([
      writeTaskCheckpoint(root, {
        ...input,
        handles: ["code:checkout-form", "memory:first-writer"],
        covered: ["intake", "first writer"],
        remaining: ["validation"],
        nextSafeAction: "Validate the first writer result.",
        at: "2026-08-23T10:01:00.000Z",
      }),
      writeTaskCheckpoint(root, {
        ...input,
        handles: ["code:checkout-form", "memory:second-writer"],
        covered: ["intake", "second writer"],
        remaining: ["delivery"],
        nextSafeAction: "Deliver the second writer result.",
        at: "2026-08-23T10:02:00.000Z",
      }),
    ]);
    const fulfilled = [first, second].filter(
      (result): result is PromiseFulfilledResult<Awaited<typeof initial>> =>
        result.status === "fulfilled",
    );
    const rejected = [first, second].filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0]!.reason)).toMatch(/locked by another writer/i);

    const stored = await loadTaskResumeCapsule(root, "task-cas");
    expect(stored).toMatchObject({ updatedAt: fulfilled[0]!.value.updatedAt });
    expect(stored?.handles).toEqual(fulfilled[0]!.value.handles);
    expect(stored?.scope).toEqual(fulfilled[0]!.value.scope);

    await expect(
      writeTaskCheckpoint(root, {
        ...input,
        handles: ["code:checkout-form", "memory:stale-writer"],
        covered: ["intake", "stale writer"],
        remaining: ["delivery"],
        nextSafeAction: "This stale write must not replace the winner.",
        at: "2026-08-23T10:03:00.000Z",
      }),
    ).rejects.toThrow(/changed since it was read/i);
    await expect(
      writeTaskCheckpoint(root, {
        ...input,
        expectedUpdatedAt: stored!.updatedAt,
        handles: ["code:checkout-form", "memory:retry"],
        covered: ["intake", "retry"],
        remaining: ["validation"],
        nextSafeAction: "Validate the retried checkpoint.",
        at: "2026-08-23T10:04:00.000Z",
      }),
    ).resolves.toMatchObject({
      updatedAt: "2026-08-23T10:04:00.000Z",
      handles: ["code:checkout-form", "memory:retry"],
    });
    await rm(root, { recursive: true, force: true });
  });

  it("leaves a pre-existing checkpoint lock for explicit recovery", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-capsule-lock-"));
    const identity = await resolveProjectIdentity(root);
    const lockPath = path.join(
      projectStorageDirectory(identity.logicalId),
      "task-state",
      "capsule-locks",
      taskStateFileName(root, "task-locked", "json").replace(/\.json$/u, ".lock"),
    );
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, "manual recovery required\n", "utf8");

    await expect(
      writeTaskCheckpoint(root, {
        taskId: "task-locked",
        expectedUpdatedAt: null,
        milestone: "objective-approved",
        objective: "Do not remove an unknown lock",
        objectiveApproved: true,
        decisions: [],
        sourceReceiptIds: [],
        handles: [],
        covered: ["intake"],
        remaining: ["implementation"],
        budgetChars: 800,
        nextSafeAction: "Recover the lock explicitly.",
      }),
    ).rejects.toThrow(/locked by another writer/i);
    await expect(readFile(lockPath, "utf8")).resolves.toBe(
      "manual recovery required\n",
    );
    await rm(root, { recursive: true, force: true });
  });

  it("never uses a colon-bearing task ID as a filesystem name", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-safe-task-file-"));
    await writeTaskCheckpoint(root, {
      taskId: "jira:ATLAS-42",
      milestone: "objective-approved",
      objective: "Use an opaque safe state filename",
      objectiveApproved: true,
      decisions: [],
      sourceReceiptIds: [],
      handles: [],
      covered: ["intake"],
      remaining: ["implementation"],
      budgetChars: 800,
      nextSafeAction: "Continue safely.",
    });
    const identity = await resolveProjectIdentity(root);
    const names = await readdir(
      path.join(
        projectStorageDirectory(identity.logicalId),
        "task-state",
        "capsules",
      ),
    );
    expect(names).toEqual([expect.stringMatching(/^[a-f0-9]{64}\.json$/u)]);
    await expect(loadTaskResumeCapsule(root, "jira:ATLAS-42")).resolves.toMatchObject({
      taskId: "jira:ATLAS-42",
    });
    await rm(root, { recursive: true, force: true });
  });

  it("isolates the same task ID across worktrees that share project storage", async () => {
    const container = await mkdtemp(path.join(os.tmpdir(), "atlas-worktrees-"));
    const root = path.join(container, "main");
    const sibling = path.join(container, "sibling");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "shared" }));
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
    await run(
      "git",
      ["worktree", "add", "-b", `state-${Date.now()}`, sibling],
      { cwd: root, windowsHide: true },
    );
    const checkpoint = {
      taskId: "task-shared",
      milestone: "objective-approved" as const,
      objectiveApproved: true,
      decisions: [],
      sourceReceiptIds: [],
      handles: [],
      covered: ["intake"],
      remaining: ["implementation"],
      budgetChars: 800,
      nextSafeAction: "Continue in this checkout.",
    };
    await writeTaskCheckpoint(root, { ...checkpoint, objective: "Main checkout" });
    await writeTaskCheckpoint(sibling, {
      ...checkpoint,
      objective: "Sibling checkout",
    });

    expect((await resolveProjectIdentity(root)).logicalId).toBe(
      (await resolveProjectIdentity(sibling)).logicalId,
    );
    await expect(loadTaskResumeCapsule(root, "task-shared")).resolves.toMatchObject({
      objective: { text: "Main checkout" },
    });
    await expect(
      loadTaskResumeCapsule(sibling, "task-shared"),
    ).resolves.toMatchObject({ objective: { text: "Sibling checkout" } });
    await run("git", ["worktree", "remove", "--force", sibling], {
      cwd: root,
      windowsHide: true,
    });
    await rm(container, { recursive: true, force: true });
  });

  it("retains confirmed source authority and route policy across later checkpoints", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-ledger-"));
    const exactReference =
      "https://example.atlassian.net/wiki/spaces/HH/pages/470516116/Two-factor-authentication?source=confirmed-short-link-resolution-and-version";
    const decisions: TaskSourceDecision[] = [
      {
        id: taskSourceId("confluence", exactReference),
        kind: "confluence",
        reference: exactReference,
        origin: "explicit",
        state: "confirmed",
        required: true,
        authorityRole: "requirement",
        routePolicy: {
          primaryAdapter: "atlassian-rovo",
          fallback: "deny",
        },
      },
    ];
    await writeTaskCheckpoint(root, {
      taskId: "task-ledger",
      milestone: "decision-confirmed",
      objective: "Implement the confirmed requirement",
      objectiveApproved: true,
      decisions,
      sourceReceiptIds: [],
      handles: [],
      covered: ["intake"],
      remaining: ["implementation"],
      budgetChars: 2_400,
      nextSafeAction: "Resolve the confirmed issue.",
    });
    await writeTaskCheckpoint(root, {
      taskId: "task-ledger",
      milestone: "batch-completed",
      objective: "Implement the confirmed requirement",
      objectiveApproved: true,
      decisions: [],
      sourceReceiptIds: [],
      handles: [],
      covered: ["intake", "requirements"],
      remaining: ["implementation"],
      budgetChars: 2_400,
      nextSafeAction: "Implement without asking for the source again.",
    });

    await expect(
      loadConfirmedTaskSourceDecision(
        root,
        "task-ledger",
        decisions[0]!.id,
      ),
    ).resolves.toMatchObject({
      reference: exactReference,
      authorityRole: "requirement",
      routePolicy: {
        primaryAdapter: "atlassian-rovo",
        fallback: "deny",
      },
    });
    await rm(root, { recursive: true, force: true });
  });

  it("requires the full production-disabled guard for a new auth mock policy", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-auth-guard-"));
    await expect(
      writeTaskCheckpoint(root, {
        taskId: "task-auth-guard",
        milestone: "risk-boundary",
        objective: "Mock only the login OTP challenge",
        objectiveApproved: true,
        decisions: [],
        sourceReceiptIds: [],
        handles: [],
        covered: ["scope"],
        remaining: ["implementation"],
        budgetChars: 2_400,
        nextSafeAction: "Create a dev-only sessionless adapter.",
        activePolicy: {
          authMode: "dev-mock-no-session",
          excludedSurfaces: ["ProfileFingerprintModal"],
        },
      }),
    ).rejects.toThrow(/sessionless production guard/i);
    await rm(root, { recursive: true, force: true });
  });

  it("keeps a minimal final receipt and removes expired capsule/journal state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-capsule-"));
    await writeTaskCheckpoint(root, {
      taskId: "task-closed",
      status: "completed",
      milestone: "completed",
      objective: "Done",
      objectiveApproved: true,
      decisions: [],
      sourceReceiptIds: [],
      handles: ["delivery:task-closed:0123456789abcdef"],
      covered: ["validation"],
      remaining: [],
      budgetChars: 800,
      nextSafeAction: "No further action.",
      head: "def456",
      at: "2026-07-01T00:00:00.000Z",
    });
    expect(
      await pruneExpiredTaskState(root, new Date("2026-07-29T00:00:00.000Z")),
    ).toBe(1);
    expect(await loadTaskResumeCapsule(root, "task-closed")).toBeUndefined();
    const identity = await resolveProjectIdentity(root);
    const finalDirectory = path.join(
      projectStorageDirectory(identity.logicalId),
      "task-state",
      "final",
    );
    const [finalName] = await readdir(finalDirectory);
    expect(finalName).toMatch(/^[a-f0-9]{64}\.json$/u);
    const finalReceipt = await readFile(path.join(finalDirectory, finalName!), "utf8");
    expect(finalReceipt).toContain("\"head\": \"def456\"");
    await expect(loadTaskFinalReceipt(root, "task-closed")).resolves.toMatchObject({
      objective: "Done",
      deliveryReceipt: "delivery:task-closed:0123456789abcdef",
    });
  });

  it("treats an explicitly empty source relation list as an active tombstone", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-relations-"));
    const requirement = {
      id: taskSourceId("jira", "APP-42"),
      kind: "jira" as const,
      reference: "APP-42",
      origin: "explicit" as const,
      state: "confirmed" as const,
      required: true,
      authorityRole: "requirement" as const,
    };
    const visualReference =
      "https://www.figma.com/design/FileKey/Product?node-id=10-20";
    const visual = {
      id: taskSourceId("figma", visualReference),
      kind: "figma" as const,
      reference: visualReference,
      origin: "explicit" as const,
      state: "confirmed" as const,
      required: false,
      authorityRole: "visual" as const,
    };
    const relation = {
      id: taskSourceRelationId(
        requirement.id,
        visual.id,
        "references-design",
      ),
      fromSourceId: requirement.id,
      toSourceId: visual.id,
      kind: "references-design" as const,
    };
    const checkpoint = {
      taskId: "task-relation-tombstone",
      objective: "Implement the linked visual requirement",
      objectiveApproved: true,
      decisions: [requirement, visual],
      sourceReceiptIds: [] as string[],
      handles: [] as string[],
      covered: ["sources"],
      remaining: ["implementation"],
      budgetChars: 2_400,
      nextSafeAction: "Continue.",
    };
    await writeTaskCheckpoint(root, {
      ...checkpoint,
      milestone: "source-resolved",
      sourceRelations: [relation],
    });
    await writeTaskCheckpoint(root, {
      ...checkpoint,
      milestone: "batch-completed",
      decisions: [],
      sourceRelations: [],
    });
    await expect(
      loadTaskSourceLedger(root, checkpoint.taskId),
    ).resolves.toMatchObject({ relations: [] });
    await rm(root, { recursive: true, force: true });
  });

  it("compacts dense checkpoints into the strict capsule budget", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-capsule-"));
    const capsule = await writeTaskCheckpoint(root, {
      taskId: "task-dense",
      milestone: "risk-boundary",
      objective: "x".repeat(2_000),
      objectiveApproved: true,
      decisions: Array.from({ length: 12 }, (_, index) => ({
        id: `source-openapi-${index}`,
        kind: "openapi" as const,
        reference: `https://internal.example.test/contracts/${"x".repeat(400)}/${index}`,
        origin: "manual" as const,
        state: "confirmed" as const,
        required: true,
      })),
      sourceReceiptIds: [],
      handles: [
        ...Array.from(
        { length: 7 },
        (_, index) => `code:${"component-".repeat(20)}${index}`,
        ),
        "continuation:task-budget:0123456789abcdef",
      ],
      covered: Array.from({ length: 12 }, (_, index) => `covered-${"x".repeat(300)}-${index}`),
      remaining: Array.from({ length: 12 }, (_, index) => `remaining-${"x".repeat(300)}-${index}`),
      budgetChars: 12_000,
      nextSafeAction: "y".repeat(1_000),
      head: "abc123",
    });
    expect(Buffer.byteLength(JSON.stringify(capsule), "utf8")).toBeLessThanOrEqual(
      4_096,
    );
    expect(capsule.handles).toContain(
      "continuation:task-budget:0123456789abcdef",
    );
  });

  it("persists an idempotent locked surface and advances lifecycle monotonically", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"));
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-locked-surface-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "Checkout.tsx"),
      "export const Checkout = () => <main>Checkout</main>;\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "locked-surface",
        dependencies: { react: "^19.0.0" },
      }),
      "utf8",
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
    const lockInput = {
      taskId: "task-lock",
      intent: "Extend checkout",
      primary: {
        kind: "component" as const,
        id: "react:src/Checkout.tsx:Checkout",
        path: "src/Checkout.tsx",
      },
      allowedFiles: ["src/Checkout.tsx"],
      referenceFiles: ["src/Checkout.test.tsx"],
      exclusions: ["src/Profile.tsx"],
      reuseDecision: {
        decision: "extend" as const,
        rationale: "The existing checkout owns this responsibility.",
        selectedComponentIds: ["react:src/Checkout.tsx:Checkout"],
      },
      sourceLedger: {
        hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        receiptIds: ["receipt-0123456789abcdef"],
        openApiAuthority: true,
        confirmedOperations: [
          { method: "get", path: "/orders/", operationId: "listOrders" },
        ],
      },
      handles: [
        "code:react:src/Checkout.tsx:Checkout",
        "entity:component:checkout-form",
        "delivery:task-lock:0123456789abcdef",
      ],
      at: "2026-07-31T12:00:00.000Z",
    };
    const locked = await lockTaskChangeSurface(root, lockInput);
    await writeTaskCheckpoint(root, {
      taskId: "task-lock",
      milestone: "batch-completed",
      objective: "Extend checkout",
      objectiveApproved: true,
      decisions: [],
      sourceReceiptIds: ["receipt-0123456789abcdef"],
      handles: ["code:react:src/Checkout.tsx:Checkout"],
      covered: ["sources", "locked change scope"],
      remaining: ["implementation", "validation"],
      budgetChars: 2_400,
      changeSurface: locked,
      nextSafeAction: "Implement the locked surface.",
      at: "2026-07-31T12:00:00.000Z",
    });

    const resumed = await loadTaskResumeCapsule(root, "task-lock");
    expect(resumed?.changeSurface).toEqual(locked);
    expect(resumed).toMatchObject({
      schemaVersion: 5,
      lifecycle: { phase: "scoped" },
      changeSurface: {
        schemaVersion: 2,
        taskId: "task-lock",
        integrityHash: locked.integrityHash,
        lockId: locked.lockId,
        primary: { kind: "component", path: "src/Checkout.tsx" },
        allowedFiles: ["src/Checkout.tsx"],
        reuseDecision: { decision: "extend" },
        evidence: {
          sourceLedger: {
            openApiAuthority: true,
            confirmedOperations: [
              { method: "GET", path: "/orders", operationId: "listOrders" },
            ],
          },
        },
        gitBaseline: { truncated: false },
      },
    });
    await expect(lockTaskChangeSurface(root, lockInput)).resolves.toMatchObject({
      lockId: locked.lockId,
      revision: 1,
    });
    await expect(
      lockTaskChangeSurface(root, {
        ...lockInput,
        allowedFiles: ["src/Checkout.tsx", "src/Escape.tsx"],
      }),
    ).rejects.toThrow(/invalidation reason/i);
    await writeTaskCheckpoint(root, {
      taskId: "task-lock",
      milestone: "change-validated",
      objective: "Extend checkout",
      objectiveApproved: true,
      decisions: [],
      sourceReceiptIds: [],
      handles: [],
      covered: ["validation"],
      remaining: ["outcome"],
      budgetChars: 2_400,
      validation: {
        lockId: locked.lockId,
        deltaHash: "a".repeat(64),
        validatedAt: "2026-07-31T12:01:00.000Z",
      },
      nextSafeAction: "Record the outcome.",
      at: "2026-07-31T12:01:00.000Z",
    });
    const invalidated = await writeTaskCheckpoint(root, {
      taskId: "task-lock",
      milestone: "risk-boundary",
      objective: "Extend checkout",
      objectiveApproved: true,
      decisions: [],
      sourceReceiptIds: [],
      handles: [],
      covered: ["source drift detected"],
      remaining: ["relock", "validation"],
      budgetChars: 2_400,
      changeInvalidation: {
        reason: "The prepared source evidence changed.",
        invalidatedAt: "2026-07-31T12:01:30.000Z",
      },
      nextSafeAction: "Relock before validation.",
      at: "2026-07-31T12:01:30.000Z",
    });
    expect(invalidated.lifecycle.phase).toBe("scoped");
    expect(invalidated.validation).toBeUndefined();
    expect(invalidated.changeInvalidation).toMatchObject({
      previousLockId: locked.lockId,
      relockRequired: true,
    });
    await writeFile(
      path.join(root, "src", "Checkout.tsx"),
      "export const Checkout = () => <main>Updated checkout</main>;\n",
      "utf8",
    );
    const relocked = await lockTaskChangeSurface(root, {
      ...lockInput,
      allowedFiles: ["src/Checkout.tsx", "src/Escape.tsx"],
      invalidationReason: "The user expanded the approved implementation boundary.",
      at: "2026-07-31T12:02:00.000Z",
    });
    expect(relocked).toMatchObject({
      revision: 2,
      supersedes: locked.lockId,
      invalidationReason:
        "The user expanded the approved implementation boundary.",
      allowedFiles: ["src/Checkout.tsx", "src/Escape.tsx"],
    });
    expect(relocked.gitBaseline.handle).toBe(locked.gitBaseline.handle);
    const relockDelta = await compareGitDelta(root, relocked.gitBaseline);
    expect(relockDelta.files).toBe(1);
    expect(relockDelta.entries[0]).toMatchObject({ path: "src/Checkout.tsx" });

    const rescoped = await writeTaskCheckpoint(root, {
      taskId: "task-lock",
      milestone: "batch-completed",
      objective: "Extend checkout",
      objectiveApproved: true,
      decisions: [],
      sourceReceiptIds: [],
      handles: [],
      covered: ["scope invalidated", "locked change scope"],
      remaining: ["validation"],
      budgetChars: 2_400,
      changeSurface: relocked,
      nextSafeAction: "Validate the expanded locked surface.",
      at: "2026-07-31T12:02:00.000Z",
    });
    expect(rescoped.lifecycle).toMatchObject({
      phase: "scoped",
      scopedAt: "2026-07-31T12:02:00.000Z",
    });
    expect(rescoped.validation).toBeUndefined();
    expect(rescoped.changeInvalidation).toBeUndefined();

    await writeTaskCheckpoint(root, {
      taskId: "task-lock",
      milestone: "change-validated",
      objective: "Extend checkout",
      objectiveApproved: true,
      decisions: [],
      sourceReceiptIds: [],
      handles: [],
      covered: ["validation"],
      remaining: ["outcome"],
      budgetChars: 2_400,
      validation: {
        lockId: relocked.lockId,
        deltaHash: "b".repeat(64),
        validatedAt: "2026-07-31T12:05:00.000Z",
      },
      nextSafeAction: "Record the outcome.",
      at: "2026-07-31T12:05:00.000Z",
    });
    expect((await loadTaskResumeCapsule(root, "task-lock"))?.lifecycle.phase).toBe(
      "validated",
    );
    await writeTaskCheckpoint(root, {
      taskId: "task-lock",
      status: "completed",
      milestone: "completed",
      objective: "Extend checkout",
      objectiveApproved: true,
      decisions: [],
      sourceReceiptIds: [],
      handles: [],
      covered: ["outcome"],
      remaining: [],
      budgetChars: 2_400,
      completion: {
        result: "partial",
        summary: `Runtime foundation completed. ${"x".repeat(800)}`,
        verification: Array.from(
          { length: 12 },
          (_, index) => `verification-${index}-${"v".repeat(300)}`,
        ),
        files: Array.from(
          { length: 50 },
          (_, index) => `src/feature-${index}/${"component-".repeat(12)}.ts`,
        ),
        deliveryReceipt: "delivery:task-lock:0123456789abcdef",
      },
      nextSafeAction: "Task complete.",
      at: "2026-07-31T12:10:00.000Z",
    });
    const completed = await loadTaskResumeCapsule(root, "task-lock");
    expect(completed?.lifecycle.phase).toBe("completed");
    expect(completed?.completion?.deliveryReceipt).toBe(
      "delivery:task-lock:0123456789abcdef",
    );
    expect(completed?.completion?.lock).toEqual({
      id: relocked.lockId,
      revision: relocked.revision,
    });
    expect(completed).not.toHaveProperty("changeSurface");
    expect(Buffer.byteLength(JSON.stringify(completed), "utf8")).toBeLessThanOrEqual(
      4_096,
    );
    await rm(root, { recursive: true, force: true });
  });

  it("rejects a tampered ChangeSurface capsule and a missing immutable lock artifact", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-lock-integrity-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "lock-integrity", dependencies: { react: "^19.0.0" } }),
      "utf8",
    );
    await writeFile(
      path.join(root, "src", "App.tsx"),
      "export const App = () => <main />;\n",
      "utf8",
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
    const lock = await lockTaskChangeSurface(root, {
      taskId: "task-integrity",
      intent: "Update App",
      primary: {
        kind: "component",
        id: "react:src/App.tsx:App",
        path: "src/App.tsx",
      },
      allowedFiles: [
        "src/App.tsx",
        ...Array.from({ length: 6 }, (_, index) =>
          `src/feature/Allowed${index}.tsx`,
        ),
      ],
      referenceFiles: Array.from(
        { length: 3 },
        (_, index) => `src/reference/Example${index}.tsx`,
      ),
      exclusions: Array.from(
        { length: 2 },
        (_, index) => `src/excluded-${index}/**`,
      ),
      reuseDecision: {
        decision: "extend",
        rationale: "App owns the requested behavior.",
        selectedComponentIds: Array.from(
          { length: 4 },
          (_, index) => `react:selected:${index}`,
        ),
        rejectedComponentIds: Array.from(
          { length: 4 },
          (_, index) => `react:rejected:${index}`,
        ),
      },
      handles: Array.from(
        { length: 4 },
        (_, index) => `code:react:src/reference/Example${index}.tsx:Example${index}`,
      ),
    });
    await writeTaskCheckpoint(root, {
      taskId: "task-integrity",
      milestone: "batch-completed",
      objective: "Update App",
      objectiveApproved: true,
      decisions: [],
      sourceReceiptIds: [],
      handles: [],
      covered: ["scope"],
      remaining: ["implementation"],
      budgetChars: 2_400,
      changeSurface: lock,
      nextSafeAction: "Implement.",
    });
    const identity = await resolveProjectIdentity(root);
    const capsuleDirectory = path.join(
      projectStorageDirectory(identity.logicalId),
      "task-state",
      "capsules",
    );
    const [capsuleName] = (await readdir(capsuleDirectory)).filter((name) =>
      name.endsWith(".json"),
    );
    expect(capsuleName).toBeDefined();
    const capsulePath = path.join(capsuleDirectory, capsuleName!);
    const serialized = await readFile(capsulePath, "utf8");
    expect(Buffer.byteLength(JSON.stringify(lock), "utf8")).toBeGreaterThan(1_400);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(4_096);
    const tampered = JSON.parse(serialized) as {
      changeSurfaceArtifact: { integrityHash: string };
    };
    tampered.changeSurfaceArtifact.integrityHash = "f".repeat(64);
    await writeFile(capsulePath, JSON.stringify(tampered), "utf8");
    await expect(
      loadTaskResumeCapsule(root, "task-integrity"),
    ).rejects.toThrow(/capsule is invalid/i);

    await writeFile(capsulePath, serialized, "utf8");
    await rm(await lockedChangeSurfaceArtifactPath(root, lock));
    await expect(
      loadTaskResumeCapsule(root, "task-integrity"),
    ).rejects.toThrow(/artifact is missing/i);
    await rm(root, { recursive: true, force: true });
  });

  it("keeps the authoritative ledger complete across compact later checkpoints", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-ledger-merge-"));
    const decisions = Array.from({ length: 16 }, (_, index) => {
      const reference = `https://example.test/requirements/${index}`;
      return {
        id: taskSourceId("jira", reference),
        kind: "jira" as const,
        reference,
        origin: "explicit" as const,
        state: "confirmed" as const,
        required: true,
        relationship: "primary" as const,
        decidedAt: `2026-07-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
      };
    });
    const receipts = Array.from(
      { length: 24 },
      (_, index) => `receipt-${index.toString(16).padStart(16, "0")}`,
    );
    await writeTaskCheckpoint(root, {
      taskId: "task-ledger-merge",
      milestone: "decision-confirmed",
      objective: "Preserve every confirmed source",
      objectiveApproved: true,
      decisions: decisions.slice(0, 12),
      sourceReceiptIds: receipts.slice(0, 16),
      handles: [],
      covered: ["intake"],
      remaining: ["implementation"],
      budgetChars: 800,
      nextSafeAction: "Continue with the authoritative ledger.",
    });
    await writeTaskCheckpoint(root, {
      taskId: "task-ledger-merge",
      milestone: "source-resolved",
      objective: "Preserve every confirmed source",
      objectiveApproved: true,
      decisions: decisions.slice(12),
      sourceReceiptIds: receipts.slice(16),
      handles: [],
      covered: ["intake", "sources"],
      remaining: ["implementation"],
      budgetChars: 800,
      nextSafeAction: "Implement from the resolved sources.",
    });
    await writeTaskCheckpoint(root, {
      taskId: "task-ledger-merge",
      milestone: "batch-completed",
      objective: "Preserve every confirmed source",
      objectiveApproved: true,
      decisions: [],
      sourceReceiptIds: [],
      handles: [],
      covered: ["implementation"],
      remaining: ["validation"],
      budgetChars: 800,
      nextSafeAction: "Validate without replacing source history.",
    });

    const ledger = await loadTaskSourceLedger(root, "task-ledger-merge");
    expect(ledger?.decisions).toHaveLength(16);
    expect(ledger?.receiptIds).toEqual(receipts);
    expect(ledger?.decisions[0]).toMatchObject({
      origin: "explicit",
      relationship: "primary",
      decidedAt: "2026-07-01T10:00:00.000Z",
    });
    expect((await loadTaskResumeCapsule(root, "task-ledger-merge"))?.decisions[0]).toMatchObject({
      origin: "explicit",
      relationship: "primary",
      decidedAt: "2026-07-01T10:00:00.000Z",
    });
    await rm(root, { recursive: true, force: true });
  });

  it("migrates a schema-v3 capsule in memory without losing legacy state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-v3-capsule-"));
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
        createdAt: "2026-07-30T10:00:00.000Z",
        updatedAt: "2026-07-30T10:05:00.000Z",
        objective: { text: "Continue a legacy task", approved: true },
        decisions: [],
        sourceReceiptIds: [],
        handles: ["code:legacy-component"],
        scope: { covered: ["intake"], remaining: ["implementation"] },
        workspace: { rootPath: root, head: "abc123" },
        budget: { contextChars: 2_400, estimatedTokens: 600 },
        nextSafeAction: "Continue the task.",
      }),
      "utf8",
    );

    await expect(loadTaskResumeCapsule(root, "task-v3")).resolves.toMatchObject({
      schemaVersion: 5,
      taskId: "task-v3",
      handles: ["code:legacy-component"],
      lifecycle: {
        schemaVersion: 1,
        phase: "prepared",
        preparedAt: "2026-07-30T10:00:00.000Z",
      },
    });
    await rm(root, { recursive: true, force: true });
  });

  it("downgrades a v1 ChangeSurface to prepared untrusted state and permits an explicit v2 relock", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-v1-surface-"));
    const directory = path.join(
      root,
      ".component-atlas",
      "task-state",
      "capsules",
    );
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "v1-surface", dependencies: { react: "^19.0.0" } }),
      "utf8",
    );
    await writeFile(
      path.join(root, "src", "App.tsx"),
      "export const App = () => <main />;\n",
      "utf8",
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
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "task-v1-lock.json"),
      JSON.stringify({
        schemaVersion: 4,
        taskId: "task-v1-lock",
        status: "completed",
        createdAt: "2026-07-30T10:00:00.000Z",
        updatedAt: "2026-07-30T10:05:00.000Z",
        expiresAt: "2026-08-01T10:05:00.000Z",
        objective: { text: "Continue a v1 locked task", approved: true },
        decisions: [],
        sourceReceiptIds: ["receipt-0123456789abcdef"],
        handles: ["code:react:src/App.tsx:App"],
        scope: { covered: ["intake"], remaining: ["delivery"] },
        workspace: { rootPath: root, head: "abc123" },
        budget: { contextChars: 2_400, estimatedTokens: 600 },
        lifecycle: {
          schemaVersion: 1,
          phase: "completed",
          preparedAt: "2026-07-30T10:00:00.000Z",
          completedAt: "2026-07-30T10:05:00.000Z",
        },
        changeSurface: { schemaVersion: 1, lockId: "0".repeat(24) },
        validation: {
          lockId: "0".repeat(24),
          deltaHash: "0".repeat(64),
          validatedAt: "2026-07-30T10:04:00.000Z",
        },
        completion: {
          result: "success",
          summary: "Legacy completion",
          verification: ["legacy"],
          files: ["src/App.tsx"],
        },
        nextSafeAction: "Deliver.",
      }),
      "utf8",
    );

    const migrated = await loadTaskResumeCapsule(root, "task-v1-lock");
    expect(migrated).toMatchObject({
      schemaVersion: 5,
      status: "active",
      objective: { text: "Continue a v1 locked task" },
      sourceReceiptIds: ["receipt-0123456789abcdef"],
      handles: ["code:react:src/App.tsx:App"],
      lifecycle: { phase: "prepared" },
      nextSafeAction:
        "Relock ChangeSurface as v2 before implementation or validation.",
    });
    expect(migrated).not.toHaveProperty("changeSurface");
    expect(migrated).not.toHaveProperty("validation");
    expect(migrated).not.toHaveProperty("completion");

    const relocked = await lockTaskChangeSurface(root, {
      taskId: "task-v1-lock",
      intent: "Continue a v1 locked task",
      primary: {
        kind: "component",
        id: "react:src/App.tsx:App",
        path: "src/App.tsx",
      },
      allowedFiles: ["src/App.tsx"],
      reuseDecision: {
        decision: "extend",
        rationale: "The existing App component owns the task.",
      },
    });
    expect(relocked).toMatchObject({
      schemaVersion: 2,
      taskId: "task-v1-lock",
      revision: 1,
    });
    expect(isLockedChangeSurface(relocked)).toBe(true);
    await rm(root, { recursive: true, force: true });
  });
});
