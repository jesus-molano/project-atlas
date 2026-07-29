import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { taskSourceId, type TaskSourceDecision } from "@component-atlas/core";
import { projectStorageDirectory } from "@component-atlas/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveProjectIdentity } from "./identity.js";
import {
  loadConfirmedTaskSourceDecision,
  loadTaskResumeCapsule,
  loadTaskResumeTransport,
  pruneExpiredTaskState,
  taskContextResumeHandles,
  writeTaskCheckpoint,
} from "./task-state.js";

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
  if (previousDataHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousDataHome;
  await rm(dataHome, { recursive: true, force: true });
});

describe("task checkpoint and resume", () => {
  it("derives only compact, unique and explicitly expandable context handles", () => {
    expect(
      taskContextResumeHandles({
        selections: [
          "design:FileKey::12:34",
          "visual:vd-task-42:0123456789abcdef",
          "visual:vd-task-42:0123456789abcdef",
          "figma-asset:task-42:0123456789abcdef01234567",
          "visual:not-expandable",
          "invalid",
        ],
        code: [{ id: "checkout-form" }, { id: "checkout-form" }],
        memory: [{ id: "contract-rule" }],
        design: { candidates: [{ id: "12:34" }] },
      }),
    ).toEqual([
      "design:FileKey::12:34",
      "visual:vd-task-42:0123456789abcdef",
      "figma-asset:task-42:0123456789abcdef01234567",
      "code:checkout-form",
      "memory:contract-rule",
      "design:12:34",
    ]);
  });

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
        "memory:contract-rule",
        "visual:not-expandable",
      ],
      covered: ["intake"],
      remaining: ["implementation", "validation"],
      budgetChars: 2_400,
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
      "memory:contract-rule",
    ]);
    expect(capsule?.schemaVersion).toBe(2);
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
      handles: [],
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
    const finalReceipt = await readFile(
      path.join(
        projectStorageDirectory(identity.logicalId),
        "task-state",
        "final",
        "task-closed.json",
      ),
      "utf8",
    );
    expect(finalReceipt).toContain('"head": "def456"');
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
      handles: Array.from(
        { length: 12 },
        (_, index) => `code:${"component-".repeat(20)}${index}`,
      ),
      covered: Array.from({ length: 12 }, (_, index) => `covered-${"x".repeat(300)}-${index}`),
      remaining: Array.from({ length: 12 }, (_, index) => `remaining-${"x".repeat(300)}-${index}`),
      budgetChars: 12_000,
      nextSafeAction: "y".repeat(1_000),
      head: "abc123",
    });
    expect(Buffer.byteLength(JSON.stringify(capsule), "utf8")).toBeLessThanOrEqual(
      4_096,
    );
  });
});
