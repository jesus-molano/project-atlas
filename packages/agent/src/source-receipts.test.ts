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
});
