import { describe, expect, it } from "vitest";
import {
  assertSourceReceiptMatchesDecision,
  createSourceReceipt,
  derivePendingSecondarySource,
  sourceIdentityFromReference,
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
