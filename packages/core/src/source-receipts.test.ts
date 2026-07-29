import { describe, expect, it } from "vitest";
import {
  assertSourceReceiptMatchesDecision,
  createSourceReceipt,
  derivePendingSecondarySource,
  parseSourceReceipt,
  sourceIdentityFromReference,
  sourceReceiptId,
} from "./source-receipts.js";
import { taskSourceId } from "./task-intake.js";

describe("source receipts", () => {
  it("binds an exact Figma node and rejects a substituted node", () => {
    const reference =
      "https://www.figma.com/design/FileKey/Product?node-id=10-20";
    const decision = {
      id: taskSourceId("figma", reference),
      kind: "figma" as const,
      reference,
      state: "confirmed",
    };
    const requested = sourceIdentityFromReference("figma", reference);
    const receipt = createSourceReceipt({
      sourceDecisionId: decision.id,
      provider: "figma",
      requested,
      resolved: requested,
      adapter: "figma-desktop-mcp-local",
      route: "http://127.0.0.1:3845/mcp",
      operation: "get_metadata",
      scope: { kind: "node", id: "10:20", parentId: "FileKey" },
      observedAt: "2026-07-29T10:00:00.000Z",
      contentHash: "metadata-hash",
      coverage: "exact",
      freshness: "current",
    });

    expect(() =>
      assertSourceReceiptMatchesDecision(decision, receipt),
    ).not.toThrow();
    expect(() =>
      createSourceReceipt({
        ...receipt,
        id: undefined,
        resolved: {
          ...receipt.resolved,
          canonicalId: "FileKey::99:99",
          nodeId: "99:99",
        },
      }),
    ).toThrow(/identity/i);
  });

  it("keeps linked Jira or Confluence evidence pending", () => {
    expect(
      derivePendingSecondarySource(
        {
          id: "source-jira",
          kind: "jira",
          reference: "APP-42",
          state: "confirmed",
        },
        "confluence",
        "https://example.atlassian.net/wiki/spaces/APP/pages/123/Spec",
      ),
    ).toMatchObject({
      state: "pending",
      relationship: "linked-secondary",
      parentSourceId: "source-jira",
    });
  });

  it("keeps a confirmed Figma page identity while observing a contained selection", () => {
    const reference =
      "https://www.figma.com/design/FileKey/Login?node-id=39-2731";
    const decision = {
      id: taskSourceId("figma", reference),
      kind: "figma" as const,
      reference,
      state: "confirmed",
      routePolicy: {
        primaryAdapter: "figma-desktop-mcp-local",
        fallback: "deny" as const,
      },
    };
    const identity = sourceIdentityFromReference("figma", reference);
    const receipt = createSourceReceipt({
      sourceDecisionId: decision.id,
      provider: "figma",
      requested: identity,
      resolved: identity,
      adapter: "figma-desktop-mcp-local",
      route: "http://127.0.0.1:3845/mcp",
      operation: "get_metadata",
      scope: {
        kind: "selection",
        id: "2064:5554",
        parentId: "39:2731",
      },
      scopeRelation: {
        kind: "contained-scope",
        sourceId: "39:2731",
        targetId: "2064:5554",
      },
      observedAt: "2026-07-29T10:00:00.000Z",
      coverage: "exact",
      freshness: "current",
    });

    expect(receipt.requested.canonicalId).toBe("FileKey::39:2731");
    expect(receipt.scopeRelation).toMatchObject({
      sourceId: "39:2731",
      targetId: "2064:5554",
    });
    expect(() =>
      assertSourceReceiptMatchesDecision(decision, receipt),
    ).not.toThrow();
  });

  it("rejects undeclared provider fallback and accepts an explicit allow-list", () => {
    const reference = "APP-42";
    const identity = sourceIdentityFromReference("jira", reference);
    const receipt = createSourceReceipt({
      sourceDecisionId: taskSourceId("jira", reference),
      provider: "jira",
      requested: identity,
      resolved: identity,
      adapter: "manual-import",
      route: "provided-export",
      operation: "read-issue",
      scope: { kind: "issue", id: "APP-42" },
      observedAt: "2026-07-29T10:00:00.000Z",
      fallback: {
        fromAdapter: "atlassian-rovo",
        condition: "Rovo unavailable and user explicitly allowed the export.",
        identityPreserved: true,
      },
      coverage: "exact",
      freshness: "current",
    });
    const base = {
      id: taskSourceId("jira", reference),
      kind: "jira" as const,
      reference,
      state: "confirmed",
    };
    expect(() =>
      assertSourceReceiptMatchesDecision(
        {
          ...base,
          routePolicy: {
            primaryAdapter: "atlassian-rovo",
            fallback: "ask",
          },
        },
        receipt,
      ),
    ).toThrow(/explicit allow-list/i);
    expect(() =>
      assertSourceReceiptMatchesDecision(
        {
          ...base,
          routePolicy: {
            primaryAdapter: "atlassian-rovo",
            fallback: "allow-list",
            allowedFallbackAdapters: ["manual-import"],
          },
        },
        receipt,
      ),
    ).not.toThrow();
  });

  it("reads legacy v1 receipts without rewriting or deleting them", () => {
    const identity = sourceIdentityFromReference("jira", "APP-42");
    const legacy = {
      schemaVersion: 1 as const,
      sourceDecisionId: taskSourceId("jira", "APP-42"),
      provider: "jira" as const,
      requested: identity,
      resolved: identity,
      adapter: "atlassian-rovo" as const,
      route: "atlassian-rovo:get-issue",
      operation: "get-issue",
      scope: { kind: "issue" as const, id: "APP-42" },
      observedAt: "2026-07-28T10:00:00.000Z",
      coverage: "exact" as const,
      freshness: "current" as const,
    };
    const id = sourceReceiptId({
      schemaVersion: 1,
      sourceDecisionId: legacy.sourceDecisionId,
      resolved: identity,
      adapter: legacy.adapter,
      operation: legacy.operation,
      observedAt: legacy.observedAt,
    });
    expect(parseSourceReceipt({ ...legacy, id })).toEqual({ ...legacy, id });
  });

  it("applies the same exact-identity rule to Jira and Confluence", () => {
    const jiraReference =
      "https://example.atlassian.net/browse/APP-42";
    const jiraDecision = {
      id: taskSourceId("jira", jiraReference),
      kind: "jira" as const,
      reference: jiraReference,
      state: "confirmed",
    };
    const jiraIdentity = sourceIdentityFromReference("jira", jiraReference);
    const jiraReceipt = createSourceReceipt({
      sourceDecisionId: jiraDecision.id,
      provider: "jira",
      requested: jiraIdentity,
      resolved: jiraIdentity,
      adapter: "atlassian-rovo",
      route: "atlassian-rovo:get-issue",
      operation: "get-issue",
      scope: { kind: "issue", id: "APP-42" },
      observedAt: "2026-07-29T10:00:00.000Z",
      coverage: "exact",
      freshness: "current",
    });
    expect(() =>
      assertSourceReceiptMatchesDecision(jiraDecision, jiraReceipt),
    ).not.toThrow();

    const confluenceReference =
      "https://example.atlassian.net/wiki/spaces/APP/pages/123/Spec";
    const confluenceDecision = {
      id: taskSourceId("confluence", confluenceReference),
      kind: "confluence" as const,
      reference: confluenceReference,
      state: "confirmed",
    };
    const confluenceIdentity = sourceIdentityFromReference(
      "confluence",
      confluenceReference,
    );
    const staleReceipt = createSourceReceipt({
      sourceDecisionId: confluenceDecision.id,
      provider: "confluence",
      requested: confluenceIdentity,
      resolved: confluenceIdentity,
      adapter: "atlassian-rovo",
      route: "atlassian-rovo:get-page",
      operation: "get-page",
      scope: { kind: "page", id: "123" },
      observedAt: "2026-07-01T10:00:00.000Z",
      coverage: "exact",
      freshness: "stale",
    });
    expect(() =>
      assertSourceReceiptMatchesDecision(confluenceDecision, staleReceipt),
    ).toThrow(/current source/i);
  });
});
