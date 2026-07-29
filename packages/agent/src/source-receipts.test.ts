import { describe, expect, it } from "vitest";
import {
  assertAgentSourceReceiptMatchesDecision,
  parseAgentSourceReceipt,
} from "./source-receipts.js";

const receiptFixture = {
  sourceDecisionId: "source-figma-38d70dcf",
  provider: "figma" as const,
  requested: {
    provider: "figma" as const,
    canonicalId: "FileKey::39:2731",
    url: "https://www.figma.com/design/FileKey/Login?node-id=39-2731",
    host: "www.figma.com",
    fileKey: "FileKey",
    nodeId: "39:2731",
  },
  resolved: {
    provider: "figma" as const,
    canonicalId: "FileKey::39:2731",
    url: "https://www.figma.com/design/FileKey/Login?node-id=39-2731",
    host: "www.figma.com",
    fileKey: "FileKey",
    nodeId: "39:2731",
  },
  adapter: "figma-desktop-mcp-local" as const,
  route: "http://127.0.0.1:3845/mcp",
  operation: "get_metadata",
  scope: {
    kind: "selection" as const,
    id: "2064:5554",
    parentId: "39:2731",
  },
  scopeRelation: {
    kind: "contained-scope" as const,
    sourceId: "39:2731",
    targetId: "2064:5554",
  },
  observedAt: "2026-07-29T10:00:00.000Z",
  coverage: "exact" as const,
  freshness: "current" as const,
  schemaVersion: 2 as const,
  id: "receipt-839d79d2f2ad09e6",
};

describe("agent SourceReceipt compatibility", () => {
  it("accepts the core v2 wire contract and enforces the task provider route", () => {
    const receipt = parseAgentSourceReceipt(receiptFixture);
    const decision = {
      id: receipt.sourceDecisionId,
      kind: "figma" as const,
      reference:
        "https://www.figma.com/design/FileKey/Login?node-id=39-2731",
      origin: "explicit" as const,
      state: "confirmed" as const,
      required: true,
      authorityRole: "visual" as const,
      routePolicy: {
        primaryAdapter: "figma-desktop-mcp-local",
        fallback: "deny" as const,
      },
    };

    expect(() =>
      assertAgentSourceReceiptMatchesDecision(decision, receipt),
    ).not.toThrow();
    expect(() =>
      assertAgentSourceReceiptMatchesDecision(decision, {
        ...receipt,
        adapter: "figma-remote-connector",
      }),
    ).toThrow(/fallback/i);
  });

  it("accepts a core v2 Swagger UI derivation without changing source identity", () => {
    const receipt = parseAgentSourceReceipt({
      sourceDecisionId: "source-openapi-324cbdaa",
      provider: "openapi",
      requested: {
        provider: "openapi",
        canonicalId: "https://api.example.com/swagger",
        url: "https://api.example.com/swagger",
        host: "api.example.com",
      },
      resolved: {
        provider: "openapi",
        canonicalId: "https://api.example.com/swagger",
        url: "https://api.example.com/swagger",
        host: "api.example.com",
      },
      adapter: "openapi-public-http",
      route: "https://api.example.com/openapi.json",
      operation: "canonicalize-swagger-ui-contract",
      scope: {
        kind: "document",
        id: "https://api.example.com/swagger",
      },
      derivation: {
        kind: "swagger-ui-config",
        sourceId: "https://api.example.com/swagger",
        targetId: "https://api.example.com/openapi.json",
        evidenceHash: `sha256:${"a".repeat(64)}`,
      },
      observedAt: "2026-07-29T12:00:00.000Z",
      coverage: "exact",
      freshness: "current",
      schemaVersion: 2,
      id: "receipt-d88f07f4839f1304",
    });

    expect(receipt.requested.canonicalId).toBe(
      "https://api.example.com/swagger",
    );
    expect(receipt.derivation?.targetId).toBe(
      "https://api.example.com/openapi.json",
    );
  });
});
