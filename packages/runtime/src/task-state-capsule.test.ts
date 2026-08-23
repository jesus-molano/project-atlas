import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createSourceReceipt,
  sourceIdentityFromReference,
  taskSourceId,
} from "@component-atlas/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isLockedChangeSurface } from "./change-surface-lock.js";
import {
  loadPersistedSourceReceipt,
  persistSourceReceipts,
  taskContextResumeHandles,
} from "./task-state.js";

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

describe("task capsule boundaries", () => {
  it("keeps persisted source receipts immutable and gives changed evidence a new ID", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-receipt-once-"));
    const reference = "APP-42";
    const identity = sourceIdentityFromReference("jira", reference);
    const receipt = createSourceReceipt({
      sourceDecisionId: taskSourceId("jira", reference), provider: "jira", requested: identity,
      resolved: identity, adapter: "atlassian-rovo", route: "jira", operation: "read-issue",
      scope: { kind: "issue", id: reference }, observedAt: "2026-07-31T10:00:00.000Z",
      coverage: "exact", freshness: "current",
    });
    await persistSourceReceipts(root, [receipt]);
    expect(() => createSourceReceipt({ ...receipt, freshness: "stale" })).toThrow(/immutable/iu);
    const changed = createSourceReceipt({ ...receipt, id: undefined, freshness: "stale" });
    expect(changed.id).not.toBe(receipt.id);
    await expect(persistSourceReceipts(root, [changed])).resolves.toBeUndefined();
    await expect(loadPersistedSourceReceipt(root, receipt.id)).resolves.toMatchObject({ freshness: "current" });
    await rm(root, { recursive: true, force: true });
  });

  it("does not treat an absent change surface as a valid lock", () => {
    expect(isLockedChangeSurface(undefined)).toBe(false);
  });

  it("derives only compact, unique and explicitly expandable context handles", () => {
    expect(taskContextResumeHandles({ selections: ["design:FileKey::12:34", "visual:vd-task-42:0123456789abcdef", "visual:vd-task-42:0123456789abcdef", "figma-asset:task-42:0123456789abcdef01234567", "delivery:task-42:0123456789abcdef", "entity:component:checkout-form", "visual:not-expandable", "invalid"], code: [{ id: "checkout-form" }, { id: "checkout-form" }], memory: [{ id: "contract-rule" }], design: { candidates: [{ id: "12:34" }] } })).toEqual(["design:FileKey::12:34", "visual:vd-task-42:0123456789abcdef", "figma-asset:task-42:0123456789abcdef01234567", "delivery:task-42:0123456789abcdef", "entity:component:checkout-form", "code:checkout-form", "memory:contract-rule", "design:12:34"]);
  });
});
