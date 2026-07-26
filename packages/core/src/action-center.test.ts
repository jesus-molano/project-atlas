import { describe, expect, it } from "vitest";
import {
  ACTION_CENTER_SCHEMA_VERSION,
  applyActionResolutions,
  compactActionDelta,
  isBulkSafeAction,
  nextMaterialAction,
  validateActionMutation,
  type ActionCenterItem,
  type ActionCenterMutation,
} from "./action-center";

const item: ActionCenterItem = {
  schemaVersion: ACTION_CENTER_SCHEMA_VERSION,
  id: "contradiction:one",
  projectId: "project",
  checkoutId: "checkout",
  type: "contradiction",
  state: "awaiting-decision",
  severity: "high",
  blocking: true,
  title: "Two rules conflict",
  detected: "Atlas found two active rules.",
  whyItMatters: "Only one behavior can be implemented.",
  affectedTask: "SearchFilters",
  consequence: "The implementation may violate the authoritative rule.",
  recommendation: "Choose an authority.",
  source: "memory",
  provenance: [{
    source: "memory",
    canonicalId: "rule-one",
    rule: "active-memory-contradiction",
    observedAt: "2026-01-01T00:00:00.000Z",
  }],
  evidence: [{
    id: "rule-one",
    source: "memory",
    label: "Rule one",
    handle: "memory:rule-one",
    summary: "First rule",
  }],
  evidenceFingerprint: "evidence-v1",
  options: [{ id: "memory:rule-one", label: "Rule one is authoritative" }],
  detectedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function mutation(
  overrides: Partial<ActionCenterMutation> = {},
): ActionCenterMutation {
  return {
    schemaVersion: ACTION_CENTER_SCHEMA_VERSION,
    itemId: item.id,
    projectId: item.projectId,
    checkoutId: item.checkoutId,
    command: "resolve-contradiction",
    scope: "evidence",
    reason: "Rule one is authoritative.",
    selectedOption: "memory:rule-one",
    authorityHandle: "memory:rule-one",
    expectedWorkspaceFingerprint: "workspace",
    expectedEvidenceFingerprint: item.evidenceFingerprint,
    idempotencyKey: "request-1",
    ...overrides,
  };
}

describe("Action Center domain", () => {
  it("rejects stale evidence, wrong checkout, and unsafe bulk actions", () => {
    expect(
      validateActionMutation(
        item,
        mutation({ checkoutId: "other", expectedEvidenceFingerprint: "old" }),
        { bulk: true },
      ),
    ).toEqual(expect.arrayContaining([
      "Checkout identity does not match.",
      "Evidence changed after review.",
      "resolve-contradiction cannot be applied in bulk.",
    ]));
    expect(isBulkSafeAction("accept-risk")).toBe(false);
    expect(isBulkSafeAction("mark-reviewed")).toBe(true);
    expect(isBulkSafeAction("dismiss")).toBe(true);
    expect(isBulkSafeAction("add-check")).toBe(false);
  });

  it("invalidates a prior resolution when canonical evidence changes", () => {
    const [resolved] = applyActionResolutions([item], [{
      schemaVersion: ACTION_CENTER_SCHEMA_VERSION,
      id: "resolution",
      itemId: item.id,
      projectId: item.projectId,
      checkoutId: item.checkoutId,
      command: "resolve-contradiction",
      state: "resolved",
      scope: "evidence",
      reason: "Rule one wins.",
      evidenceFingerprint: "older-evidence",
      idempotencyKey: "request-1",
      resolvedAt: "2026-01-02T00:00:00.000Z",
    }]);
    expect(resolved).toMatchObject({ state: "stale", resolutionInvalidated: true });
  });

  it("invalidates run-scoped decisions outside the originating run", () => {
    const runItem = { ...item, runId: "run-new" };
    const [resolved] = applyActionResolutions([runItem], [{
      schemaVersion: ACTION_CENTER_SCHEMA_VERSION,
      id: "resolution",
      itemId: item.id,
      projectId: item.projectId,
      checkoutId: item.checkoutId,
      runId: "run-old",
      command: "save-decision-and-continue",
      state: "resolved",
      scope: "run",
      reason: "Answer",
      evidenceFingerprint: item.evidenceFingerprint,
      idempotencyKey: "request-2",
      resolvedAt: "2026-01-02T00:00:00.000Z",
    }]);
    expect(resolved).toMatchObject({ state: "stale", resolutionInvalidated: true });
  });

  it("orders material blockers first and emits only a bounded delta", () => {
    const warning: ActionCenterItem = {
      ...item,
      id: "warning:one",
      type: "warning",
      blocking: false,
      severity: "medium",
      state: "new",
    };
    expect(nextMaterialAction([warning, item])?.id).toBe(item.id);
    const delta = compactActionDelta(item, mutation(), 400);
    expect(JSON.stringify(delta).length).toBeLessThanOrEqual(400);
    expect(JSON.stringify(delta)).not.toContain(item.whyItMatters);
    expect(delta.evidenceHandles).toEqual(["memory:rule-one"]);
  });
});
