import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { taskSourceId, type TaskSourceDecision } from "@component-atlas/core";
import { describe, expect, it, vi } from "vitest";
import {
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

describe("task checkpoint and resume", () => {
  it("derives only compact, unique and explicitly expandable context handles", () => {
    expect(
      taskContextResumeHandles({
        selections: ["design:FileKey::12:34", "invalid"],
        code: [{ id: "checkout-form" }, { id: "checkout-form" }],
        memory: [{ id: "contract-rule" }],
        design: { candidates: [{ id: "12:34" }] },
      }),
    ).toEqual([
      "design:FileKey::12:34",
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
      handles: ["code:checkout-form", "memory:contract-rule"],
      covered: ["intake"],
      remaining: ["implementation", "validation"],
      budgetChars: 2_400,
      nextSafeAction: "Expand code:checkout-form only.",
      head: "abc123",
      at: "2026-07-29T12:00:00.000Z",
    });
    const expand = vi.fn();
    const capsule = await loadTaskResumeCapsule(root, "task-42");
    expect(capsule?.handles).toEqual([
      "code:checkout-form",
      "memory:contract-rule",
    ]);
    expect(expand).not.toHaveBeenCalled();
    const transport = await loadTaskResumeTransport(root, "task-42");
    expect(transport?.bytes).toBeLessThanOrEqual(4_096);
    expect(["toon", "json"]).toContain(transport?.format);
    expect(transport?.body).toContain("nextSafeAction");
    expect(transport?.fallbackAvailable).toBe(true);
    expect(transport).not.toHaveProperty("fallbackJson");
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
    const finalReceipt = await readFile(
      path.join(
        root,
        ".component-atlas",
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
