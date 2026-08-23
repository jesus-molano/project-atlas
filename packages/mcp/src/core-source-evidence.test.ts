import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  createSourceReceipt,
  sourceIdentityFromReference,
  taskSourceId,
} from "@component-atlas/core";
import {
  listFigmaDesignIndexes,
  loadPersistedSourceReceipt,
  persistSourceReceipts,
} from "@component-atlas/runtime";
import { afterEach, describe, expect, it } from "vitest";
import {
  activeCurrentSourceReceiptIds,
  bindSourceEvidence,
  bindSourceEvidenceBundle,
  confirmedOperationsFromReceipts,
  containsCredentializedUrl,
  normalizedSources,
  requiredSourcesWithoutCurrentReceipts,
  sourceInput,
} from "./core-source-evidence.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("core source evidence", () => {
  it("rejects credentialized source locators before the handler can persist them", () => {
    const base = {
      kind: "openapi" as const,
      state: "confirmed" as const,
      evidence: {
        adapter: "openapi-internal-connector" as const,
        route: "internal-connector:read-openapi",
        operation: "read_openapi_document",
        observed_at: "2026-07-31T10:00:00.000Z",
      },
    };
    expect(
      sourceInput.safeParse({
        ...base,
        reference: "https://user:password@api.example.test/openapi.json",
      }).success,
    ).toBe(false);
    expect(
      sourceInput.safeParse({
        ...base,
        reference: "https://api.example.test/openapi.json",
        evidence: {
          ...base.evidence,
          resolved_reference:
            "https://api.example.test/openapi.json?access_token=private",
        },
      }).success,
    ).toBe(false);
    expect(
      sourceInput.safeParse({
        ...base,
        reference: "https://api.example.test/openapi.json",
        evidence: {
          ...base.evidence,
          route:
            "https://storage.example.test/openapi.json?X-Amz-Signature=private",
        },
      }).success,
    ).toBe(false);
    expect(
      sourceInput.safeParse({
        ...base,
        reference: "https://api.example.test/openapi.json?version=v2",
      }).success,
    ).toBe(true);
    expect(
      containsCredentializedUrl(
        "Use https://api.example.test/openapi.json?token=private as contract.",
      ),
    ).toBe(true);
    expect(
      containsCredentializedUrl(
        "https://api.example.test/openapi.json#access_token=private",
      ),
    ).toBe(true);
    expect(
      containsCredentializedUrl(
        "internal-connector:read?token=private",
      ),
    ).toBe(true);
    expect(
      containsCredentializedUrl("//user:private@api.example.test/openapi.json"),
    ).toBe(true);
  });

  it("keeps detected and supplied references pending until explicitly decided", () => {
    const reference = "https://github.com/example/project/issues/42";
    expect(normalizedSources(`Implement ${reference}`, [], [])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: taskSourceId("github", reference),
          state: "pending",
        }),
      ]),
    );
    expect(
      normalizedSources("Implement the issue", [], [{ reference, kind: "github" }]),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: "pending" }),
      ]),
    );
  });

  it("merges a partial source update without erasing its governing fields", () => {
    const reference = "https://api.example.test/openapi.json";
    const decidedAt = "2026-07-30T10:00:00.000Z";
    const prior = normalizedSources("Use the contract", [], [
      {
        reference,
        kind: "openapi",
        state: "confirmed",
        required: true,
        relationship: "primary",
        authority_role: "contract",
        primary_adapter: "openapi-internal-connector",
        fallback: "allow-list",
        allowed_fallback_adapters: ["openapi-pasted"],
        replacement_for: "source-obsolete-contract",
      },
    ]).map((source) => ({ ...source, decidedAt }));

    const [updated] = normalizedSources("Use the contract", prior, [
      { reference, kind: "openapi", state: "confirmed" },
    ]);

    expect(updated).toMatchObject({
      state: "confirmed",
      required: true,
      replacementFor: "source-obsolete-contract",
      relationship: "primary",
      authorityRole: "contract",
      decidedAt,
      routePolicy: {
        primaryAdapter: "openapi-internal-connector",
        fallback: "allow-list",
        allowedFallbackAdapters: ["openapi-pasted"],
      },
    });
  });

  it("persists exact connector evidence only for a confirmed source", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-core-receipt-"));
    roots.push(root);
    await execFileAsync("git", ["init"], { cwd: root });
    const reference = "https://github.com/example/project/issues/42";
    const supplied = [
      {
        reference,
        kind: "github" as const,
        state: "confirmed" as const,
        primary_adapter: "github-connector",
        fallback: "deny" as const,
        evidence: {
          adapter: "github-connector" as const,
          route: "github-app",
          operation: "read_issue",
          observed_at: "2026-07-31T10:00:00.000Z",
          freshness: "current" as const,
        },
      },
    ];
    const decisions = normalizedSources("Implement the issue", [], supplied);
    const ids = await bindSourceEvidence(root, decisions, supplied, []);
    expect(ids).toHaveLength(1);
    await expect(bindSourceEvidence(root, decisions, supplied, [])).resolves.toEqual(
      ids,
    );
    await expect(loadPersistedSourceReceipt(root, ids[0]!)).resolves.toMatchObject({
      provider: "github",
      sourceDecisionId: taskSourceId("github", reference),
      adapter: "github-connector",
      coverage: "exact",
      freshness: "current",
    });
  });

  it("binds an exact OpenAPI operation to its immutable source receipt", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-core-openapi-"));
    roots.push(root);
    await execFileAsync("git", ["init"], { cwd: root });
    const reference = "https://api.example.test/openapi.json";
    const supplied = [
      {
        reference,
        kind: "openapi" as const,
        state: "confirmed" as const,
        authority_role: "contract" as const,
        primary_adapter: "openapi-public-http",
        fallback: "deny" as const,
        evidence: {
          adapter: "openapi-public-http" as const,
          route: reference,
          operation: "resolve-operation",
          observed_at: "2026-07-31T10:00:00.000Z",
          freshness: "current" as const,
          openapi_operation: {
            method: "POST" as const,
            path: "/v1/accounts/{accountId}/verify",
            operation_id: "verifyAccount",
          },
        },
      },
    ];
    const decisions = normalizedSources("Verify an account", [], supplied);
    const ids = await bindSourceEvidence(root, decisions, supplied, []);
    await expect(loadPersistedSourceReceipt(root, ids[0]!)).resolves.toMatchObject({
      provider: "openapi",
      scope: {
        kind: "operation",
        id: "POST /v1/accounts/{accountId}/verify",
      },
      resolved: {
        method: "POST",
        path: "/v1/accounts/{accountId}/verify",
        operationId: "verifyAccount",
      },
    });
    await expect(
      requiredSourcesWithoutCurrentReceipts(root, decisions, ids),
    ).resolves.toEqual([]);
  });

  it("rejects a mismatched digest before accepting transient OpenAPI content", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-core-openapi-hash-"));
    roots.push(root);
    await execFileAsync("git", ["init"], { cwd: root });
    const reference = "https://swagger.internal.example.test/openapi.json";
    const supplied = [
      {
        reference,
        kind: "openapi" as const,
        state: "confirmed" as const,
        required: true,
        authority_role: "contract" as const,
        primary_adapter: "openapi-internal-connector",
        fallback: "deny" as const,
        evidence: {
          adapter: "openapi-internal-connector" as const,
          route: "internal-connector:openapi",
          operation: "read_openapi_document",
          observed_at: "2026-07-31T10:00:00.000Z",
          freshness: "current" as const,
          content_hash: `sha256:${"0".repeat(64)}`,
          openapi_content: JSON.stringify({
            openapi: "3.1.0",
            info: { title: "Private API", version: "1" },
            paths: { "/orders": { get: { responses: {} } } },
          }),
        },
      },
    ];
    const decisions = normalizedSources("Read orders", [], supplied);

    await expect(
      bindSourceEvidenceBundle(root, decisions, supplied, []),
    ).rejects.toThrow(/does not match its declared SHA-256 digest/i);
  });

  it("bounds transient OpenAPI content by UTF-8 bytes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-core-openapi-cap-"));
    roots.push(root);
    await execFileAsync("git", ["init"], { cwd: root });
    const reference = "pasted:private-orders-contract";
    const supplied = [
      {
        reference,
        kind: "openapi" as const,
        state: "confirmed" as const,
        required: true,
        authority_role: "contract" as const,
        primary_adapter: "openapi-pasted",
        fallback: "deny" as const,
        evidence: {
          adapter: "openapi-pasted" as const,
          route: "caller:pasted-openapi",
          operation: "read_pasted_openapi",
          observed_at: "2026-07-31T10:00:00.000Z",
          freshness: "current" as const,
          openapi_content: JSON.stringify({
            openapi: "3.1.0",
            info: {
              title: "Private API",
              version: "1",
              description: "é".repeat(760_000),
            },
            paths: {},
          }),
        },
      },
    ];
    const decisions = normalizedSources("Read orders", [], supplied);

    await expect(
      bindSourceEvidenceBundle(root, decisions, supplied, []),
    ).rejects.toThrow(/1.5 MB transient handoff budget/i);
  });

  it("bounds structured or multibyte Figma metadata by UTF-8 bytes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-core-figma-cap-"));
    roots.push(root);
    await execFileAsync("git", ["init"], { cwd: root });
    const reference =
      "https://www.figma.com/design/AbC123/Checkout?node-id=1-2";
    const supplied = [
      {
        reference,
        kind: "figma" as const,
        state: "confirmed" as const,
        authority_role: "visual" as const,
        evidence: {
          adapter: "figma-remote-connector" as const,
          route: reference,
          operation: "get-design-context",
          observed_at: "2026-07-31T10:00:00.000Z",
          freshness: "current" as const,
          figma_metadata: "é".repeat(1_100_000),
          figma_format: "figma-mcp-xml" as const,
        },
      },
    ];
    const decisions = normalizedSources("Implement the Figma node", [], supplied);

    await expect(
      bindSourceEvidence(root, decisions, supplied, []),
    ).rejects.toThrow(/2 MB task evidence budget/i);
  });

  it("binds normalized Figma revision and observed node scope into its receipt", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-core-figma-identity-"));
    roots.push(root);
    await execFileAsync("git", ["init"], { cwd: root });
    const reference =
      "https://www.figma.com/design/AbC123/Checkout?node-id=1-2";
    const supplied = [
      {
        reference,
        kind: "figma" as const,
        state: "confirmed" as const,
        authority_role: "visual" as const,
        primary_adapter: "figma-remote-connector",
        fallback: "deny" as const,
        evidence: {
          adapter: "figma-remote-connector" as const,
          route: "figma-remote:get_design_context",
          operation: "get_design_context",
          observed_at: "2026-08-23T10:00:00.000Z",
          freshness: "current" as const,
          figma_version: "v42",
          figma_last_modified: "2026-08-23T09:55:00+00:00",
          figma_scope_node_id: "1-2",
        },
      },
    ];
    const decisions = normalizedSources("Implement checkout", [], supplied);
    const [receiptId] = await bindSourceEvidence(root, decisions, supplied, []);

    await expect(loadPersistedSourceReceipt(root, receiptId!)).resolves.toMatchObject({
      resolved: {
        fileKey: "AbC123",
        nodeId: "1:2",
        version: "v42",
        lastModified: "2026-08-23T09:55:00.000Z",
      },
      scope: { kind: "selection", id: "1:2" },
    });
  });

  it("validates the full evidence batch before writing a Figma mapping", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-core-figma-batch-"));
    roots.push(root);
    await execFileAsync("git", ["init"], { cwd: root });
    await writeFile(
      path.join(root, "package.json"),
      "{\"name\":\"figma-batch-fixture\",\"private\":true,\"dependencies\":{\"vue\":\"^3.5.0\"}}\n",
      "utf8",
    );
    const figmaReference =
      "https://www.figma.com/design/AbC123/Checkout?node-id=1-2";
    const githubReference = "https://github.com/example/project/issues/42";
    const supplied = [
      {
        reference: figmaReference,
        kind: "figma" as const,
        state: "confirmed" as const,
        primary_adapter: "figma-remote-connector",
        fallback: "deny" as const,
        evidence: {
          adapter: "figma-remote-connector" as const,
          route: figmaReference,
          operation: "get-design-context",
          observed_at: "2026-07-31T10:00:00.000Z",
          figma_metadata: {
            document: {
              id: "0:0",
              name: "Checkout",
              type: "DOCUMENT",
              children: [],
            },
          },
          figma_format: "figma-rest" as const,
        },
      },
      {
        reference: githubReference,
        kind: "github" as const,
        state: "confirmed" as const,
        evidence: {
          adapter: "github-connector" as const,
          route: "github-app",
          operation: "read_issue",
          observed_at: "2026-07-31T10:00:00.000Z",
          openapi_operation: {
            method: "GET" as const,
            path: "/must-not-be-accepted",
          },
        },
      },
    ];
    const decisions = normalizedSources("Implement the two sources", [], supplied);

    await expect(
      bindSourceEvidence(root, decisions, supplied, []),
    ).rejects.toThrow(/only for OpenAPI/i);
    await expect(listFigmaDesignIndexes(root)).resolves.toEqual([]);
  });

  it("does not treat confirmation alone as retrieval of a required source", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-core-required-"));
    roots.push(root);
    await execFileAsync("git", ["init"], { cwd: root });
    const reference = "https://api.example.test/openapi.json";
    const decisions = normalizedSources("Use the required contract", [], [
      {
        reference,
        kind: "openapi",
        state: "confirmed",
        required: true,
        authority_role: "contract",
      },
    ]);
    await expect(
      requiredSourcesWithoutCurrentReceipts(root, decisions, []),
    ).resolves.toEqual([
      expect.objectContaining({ reference, required: true, state: "confirmed" }),
    ]);
  });

  it("keeps historical receipts but authorizes only the current replacement", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-core-replaced-"));
    roots.push(root);
    await execFileAsync("git", ["init"], { cwd: root });
    const references = [
      "https://api.example.test/v1/openapi.json",
      "https://api.example.test/v2/openapi.json",
    ];
    const supplied = references.map((reference, index) => ({
      reference,
      kind: "openapi" as const,
      state: "confirmed" as const,
      authority_role: "contract" as const,
      evidence: {
        adapter: "openapi-public-http" as const,
        route: reference,
        operation: "resolve-operation",
        observed_at: new Date(Date.UTC(2026, 6, 30, index)).toISOString(),
        freshness: "current" as const,
        openapi_operation: {
          method: "GET" as const,
          path: index === 0 ? "/v1/catalog" : "/v2/catalog",
        },
      },
    }));
    const initial = normalizedSources("Use the current API", [], supplied);
    const historicalIds = await bindSourceEvidence(root, initial, supplied, []);
    const current = normalizedSources("Use the current API", initial, [
      {
        reference: references[0]!,
        kind: "openapi",
        state: "replaced",
      },
    ]);
    const activeIds = await activeCurrentSourceReceiptIds(
      root,
      current,
      historicalIds,
    );
    expect(activeIds).toHaveLength(1);
    await expect(
      confirmedOperationsFromReceipts(root, historicalIds, current),
    ).resolves.toEqual([
      expect.objectContaining({ method: "GET", path: "/v2/catalog" }),
    ]);
  });

  it("supersedes hashless history and authorizes only the latest content-addressed OpenAPI observation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-core-openapi-current-"));
    roots.push(root);
    await execFileAsync("git", ["init"], { cwd: root });
    const reference = "https://api.example.test/openapi.json";
    const decisions = normalizedSources("Use the current API", [], [
      {
        reference,
        kind: "openapi",
        state: "confirmed",
        authority_role: "contract",
        primary_adapter: "openapi-public-http",
        fallback: "deny",
      },
    ]);
    const identity = sourceIdentityFromReference("openapi", reference);
    const observations = [
      createSourceReceipt({
        sourceDecisionId: decisions[0]!.id,
        provider: "openapi",
        requested: identity,
        resolved: { ...identity, method: "GET", path: "/manual/orders" },
        adapter: "openapi-public-http",
        route: reference,
        operation: "resolve-operation",
        scope: { kind: "operation", id: "GET /manual/orders" },
        observedAt: "2026-07-29T10:00:00.000Z",
        coverage: "exact",
        freshness: "current",
      }),
      createSourceReceipt({
        sourceDecisionId: decisions[0]!.id,
        provider: "openapi",
        requested: identity,
        resolved: { ...identity, method: "GET", path: "/v1/orders" },
        adapter: "openapi-public-http",
        route: reference,
        operation: "derive-confirmed-operation",
        scope: { kind: "operation", id: "GET /v1/orders" },
        contentHash: `sha256:${"a".repeat(64)}`,
        observedAt: "2026-07-30T10:00:00.000Z",
        coverage: "exact",
        freshness: "current",
      }),
      createSourceReceipt({
        sourceDecisionId: decisions[0]!.id,
        provider: "openapi",
        requested: identity,
        resolved: { ...identity, method: "GET", path: "/v2/orders" },
        adapter: "openapi-public-http",
        route: reference,
        operation: "derive-confirmed-operation",
        scope: { kind: "operation", id: "GET /v2/orders" },
        contentHash: `sha256:${"b".repeat(64)}`,
        observedAt: "2026-07-31T10:00:00.000Z",
        coverage: "exact",
        freshness: "current",
      }),
    ];
    await persistSourceReceipts(root, observations);

    await expect(
      confirmedOperationsFromReceipts(
        root,
        observations.map((receipt) => receipt.id),
        decisions,
      ),
    ).resolves.toEqual([{ method: "GET", path: "/v2/orders" }]);
  });

  it("keeps newly bound evidence when the durable receipt ledger already has 20 entries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-core-receipt-cap-"));
    roots.push(root);
    await execFileAsync("git", ["init"], { cwd: root });
    const reference = "APP-42";
    const identity = sourceIdentityFromReference("jira", reference);
    const decisions = normalizedSources("Implement the issue", [], [
      { reference, kind: "jira", state: "confirmed" },
    ]);
    const historical = Array.from({ length: 20 }, (_, index) =>
      createSourceReceipt({
        sourceDecisionId: decisions[0]!.id,
        provider: "jira",
        requested: identity,
        resolved: identity,
        adapter: "atlassian-rovo",
        route: "jira",
        operation: "read-issue",
        scope: { kind: "issue", id: reference },
        observedAt: new Date(Date.UTC(2026, 6, 1, 0, 0, index)).toISOString(),
        coverage: "exact",
        freshness: "current",
      }),
    );
    await persistSourceReceipts(root, historical);
    const supplied = [
      {
        reference,
        kind: "jira" as const,
        state: "confirmed" as const,
        evidence: {
          adapter: "atlassian-rovo" as const,
          route: "jira",
          operation: "read-issue-latest",
          observed_at: "2026-07-31T12:00:00.000Z",
          freshness: "current" as const,
        },
      },
    ];
    const receiptIds = await bindSourceEvidence(
      root,
      decisions,
      supplied,
      historical.map((receipt) => receipt.id),
    );
    expect(receiptIds).toHaveLength(21);
    const projected = await Promise.all(
      receiptIds.map((receiptId) => loadPersistedSourceReceipt(root, receiptId)),
    );
    expect(projected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: "read-issue-latest" }),
      ]),
    );
  });
});
