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

  it("persists normalized Figma revision identity when the observation provides it", () => {
    const reference =
      "https://www.figma.com/design/FileKey/Product?node-id=10-20";
    const requested = sourceIdentityFromReference("figma", reference);
    const receipt = createSourceReceipt({
      sourceDecisionId: taskSourceId("figma", reference),
      provider: "figma",
      requested,
      resolved: {
        ...requested,
        version: "v42",
        lastModified: "2026-08-23T09:55:00+00:00",
      },
      adapter: "figma-desktop-mcp-local",
      route: "http://127.0.0.1:3845/mcp",
      operation: "get_design_context",
      scope: { kind: "node", id: "10:20", parentId: "FileKey" },
      observedAt: "2026-08-23T10:00:00.000Z",
      coverage: "exact",
      freshness: "current",
    });

    expect(receipt.resolved).toMatchObject({
      fileKey: "FileKey",
      nodeId: "10:20",
      version: "v42",
      lastModified: "2026-08-23T09:55:00.000Z",
    });
    expect(() =>
      parseSourceReceipt({
        ...receipt,
        resolved: {
          ...receipt.resolved,
          lastModified: "2026-08-23T10:55:00.000Z",
        },
      }),
    ).toThrow(/immutable fields/i);
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
    const parsed = parseSourceReceipt({ ...legacy, id });
    expect(parsed).toEqual({ ...legacy, id });
    expect(() =>
      createSourceReceipt({
        ...legacy,
        schemaVersion: 1,
      } as unknown as Parameters<typeof createSourceReceipt>[0]),
    ).toThrow(/cannot be upgraded/i);
    expect(() =>
      assertSourceReceiptMatchesDecision(
        {
          id: legacy.sourceDecisionId,
          kind: "jira",
          reference: "APP-42",
          state: "confirmed",
        },
        parsed,
      ),
    ).toThrow(/historical.*v3/i);
  });

  it("reads legacy v2 receipts but never accepts them as current authority", () => {
    const reference = "APP-42";
    const identity = sourceIdentityFromReference("jira", reference);
    const current = createSourceReceipt({
      sourceDecisionId: taskSourceId("jira", reference),
      provider: "jira",
      requested: identity,
      resolved: identity,
      adapter: "atlassian-rovo",
      route: "atlassian-rovo:get-issue",
      operation: "get-issue",
      scope: { kind: "issue", id: reference },
      observedAt: "2026-07-28T10:00:00.000Z",
      contentHash: "jira-export-v2",
      coverage: "exact",
      freshness: "current",
    });
    const legacyId = sourceReceiptId({
      schemaVersion: 2,
      sourceDecisionId: current.sourceDecisionId,
      resolved: current.resolved,
      adapter: current.adapter,
      operation: current.operation,
      observedAt: current.observedAt,
      contentHash: current.contentHash,
      scope: current.scope,
    });
    expect(legacyId).toBe("receipt-55cac2a1acefe519");
    const legacy = { ...current, schemaVersion: 2 as const, id: legacyId };

    expect(parseSourceReceipt(legacy)).toEqual(legacy);
    expect(() =>
      assertSourceReceiptMatchesDecision(
        {
          id: current.sourceDecisionId,
          kind: "jira",
          reference,
          state: "confirmed",
        },
        legacy,
      ),
    ).toThrow(/historical.*v3/i);
  });

  it("binds every authority field into the v3 SHA-256 identity", () => {
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
      scope: { kind: "issue", id: reference },
      observedAt: "2026-07-31T10:00:00.000Z",
      contentHash: "sha256:fixture",
      fallback: {
        fromAdapter: "atlassian-rovo",
        condition: "The primary adapter was unavailable.",
        identityPreserved: true,
      },
      coverage: "exact",
      freshness: "current",
    });

    expect(receipt.schemaVersion).toBe(3);
    expect(receipt.id).toBe(
      "receipt-fe1d409ab85199a6ce7f2b498c01010d7805575a932a1f26da2bfc1bc996f727",
    );
    const tampered = [
      { ...receipt, sourceDecisionId: "source-jira-tampered" },
      {
        ...receipt,
        provider: "other" as const,
        requested: { ...receipt.requested, provider: "other" as const },
        resolved: { ...receipt.resolved, provider: "other" as const },
      },
      { ...receipt, adapter: "other" as const },
      { ...receipt, freshness: "stale" as const },
      { ...receipt, coverage: "partial" as const },
      { ...receipt, route: "different-route" },
      { ...receipt, operation: "different-operation" },
      { ...receipt, scope: { ...receipt.scope, id: "APP-43" } },
      {
        ...receipt,
        scopeRelation: {
          kind: "same-scope" as const,
          sourceId: reference,
          targetId: reference,
        },
      },
      {
        ...receipt,
        derivation: {
          kind: "same-origin-redirect" as const,
          sourceId: reference,
          targetId: "APP-42-export",
          evidenceHash: `sha256:${"a".repeat(64)}`,
        },
      },
      { ...receipt, contentHash: "sha256:different" },
      { ...receipt, observedAt: "2026-07-31T10:00:01.000Z" },
      {
        ...receipt,
        fallback: {
          ...receipt.fallback!,
          condition: "A different fallback condition.",
        },
      },
      {
        ...receipt,
        requested: {
          ...receipt.requested,
          url: "https://example.invalid/browse/APP-42",
        },
      },
      {
        ...receipt,
        resolved: {
          ...receipt.resolved,
          url: "https://example.invalid/export/APP-42",
        },
      },
    ];
    for (const candidate of tampered) {
      expect(() => parseSourceReceipt(candidate)).toThrow(/immutable fields/i);
    }
  });

  it("records a derived OpenAPI spec without replacing confirmed Swagger UI identity", () => {
    const reference = "https://api.example.com/swagger";
    const identity = sourceIdentityFromReference("openapi", reference);
    const receipt = createSourceReceipt({
      sourceDecisionId: taskSourceId("openapi", reference),
      provider: "openapi",
      requested: identity,
      resolved: identity,
      adapter: "openapi-public-http",
      route: "https://api.example.com/openapi.json",
      operation: "canonicalize-swagger-ui-contract",
      scope: { kind: "document", id: identity.canonicalId },
      derivation: {
        kind: "swagger-ui-config",
        sourceId: identity.canonicalId,
        targetId: "https://api.example.com/openapi.json",
        evidenceHash: `sha256:${"a".repeat(64)}`,
      },
      observedAt: "2026-07-29T12:00:00.000Z",
      coverage: "exact",
      freshness: "current",
    });

    expect(receipt).toMatchObject({
      requested: { canonicalId: reference },
      resolved: { canonicalId: reference },
      derivation: {
        targetId: "https://api.example.com/openapi.json",
      },
    });
    expect(() => parseSourceReceipt(receipt)).not.toThrow();
    expect(() =>
      createSourceReceipt({
        ...receipt,
        id: undefined,
        derivation: {
          ...receipt.derivation!,
          sourceId: "https://api.example.com/openapi.json",
        },
      }),
    ).toThrow(/derivation/i);
  });

  it("binds OpenAPI method and path into the immutable receipt identity", () => {
    const reference = "https://api.example.com/openapi.json";
    const requested = sourceIdentityFromReference("openapi", reference);
    const resolved = {
      ...requested,
      method: "POST",
      path: "/v1/accounts/{accountId}/verify",
      operationId: "verifyAccount",
    };
    const receipt = createSourceReceipt({
      sourceDecisionId: taskSourceId("openapi", reference),
      provider: "openapi",
      requested,
      resolved,
      adapter: "openapi-public-http",
      route: reference,
      operation: "resolve-operation",
      scope: {
        kind: "operation",
        id: "POST /v1/accounts/{accountId}/verify",
        parentId: requested.canonicalId,
      },
      observedAt: "2026-07-31T10:00:00.000Z",
      coverage: "exact",
      freshness: "current",
    });
    expect(() =>
      parseSourceReceipt({
        ...receipt,
        resolved: { ...receipt.resolved, path: "/v1/other" },
      }),
    ).toThrow(/operation receipt|immutable fields/i);
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
