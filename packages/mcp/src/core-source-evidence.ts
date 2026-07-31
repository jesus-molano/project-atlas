import { createHash } from "node:crypto";
import {
  assertSourceReceiptMatchesDecision,
  classifyTaskSource,
  createSourceReceipt,
  defaultTaskSourceAuthorityRole,
  defaultTaskSourceRoutePolicy,
  detectTaskSources,
  ensureTaskSourceDecisions,
  normalizeTaskSourceDecisions,
  normalizeTaskSourceRelations,
  sourceIdentityFromReference,
  taskSourceId,
  type TaskSourceDecision,
  type TaskSourceRelation,
  type SourceReceipt,
} from "@component-atlas/core";
import {
  loadPersistedSourceReceipt,
  loadTaskSourceLedger,
  mapFigmaDesign,
  persistSourceReceipts,
  extractOpenApiTaskContext,
  type ConfirmedOpenApiSource,
  type TaskResumeCapsule,
} from "@component-atlas/runtime";
import { z } from "zod";
import { sourceLedgerFingerprint } from "./core-tool-helpers.js";

const MAX_FIGMA_METADATA_BYTES = 2_000_000;
const MAX_OPENAPI_CONTENT_BYTES = 1_500_000;
const TRANSIENT_OPENAPI_ADAPTERS = new Set<string>([
  "openapi-local-file",
  "openapi-pasted",
  "openapi-public-http",
  "openapi-internal-connector",
  "manual-import",
  "other",
]);
const SECRET_URL_PARAMETER_KEYS = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "bearertoken",
  "clientsecret",
  "jwt",
  "password",
  "passwd",
  "secret",
  "sig",
  "signature",
  "token",
  "xamzcredential",
  "xamzsecuritytoken",
  "xamzsignature",
  "xgoogcredential",
  "xgoogsignature",
]);

function hasSecretParameter(keys: Iterable<string>): boolean {
  return [...keys].some((key) =>
    SECRET_URL_PARAMETER_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/gu, "")),
  );
}

function urlHasCredentials(value: string): boolean {
  let url: URL;
  try {
    url = value.startsWith("//")
      ? new URL(value, "https://project-atlas.invalid")
      : new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return true;
  if (hasSecretParameter(url.searchParams.keys())) return true;
  const fragment = url.hash.replace(/^#/u, "");
  if (!fragment) return false;
  if (hasSecretParameter(new URLSearchParams(fragment).keys())) return true;
  const fragmentQuery = fragment.indexOf("?");
  return (
    fragmentQuery >= 0 &&
    hasSecretParameter(
      new URLSearchParams(fragment.slice(fragmentQuery + 1)).keys(),
    )
  );
}

export function containsCredentializedUrl(value: string): boolean {
  const trimmed = value.trim();
  if (urlHasCredentials(trimmed)) return true;
  const candidates = [
    ...(value.match(/[a-z][a-z0-9+.-]*:[^\s<>"']+/giu) ?? []),
    ...(value.match(/\/\/[^\s<>"']+/gu) ?? []),
  ];
  return candidates.some((candidate) =>
    urlHasCredentials(candidate.replace(/[),.;\]}]+$/gu, "")),
  );
}

function safeSourceLocator(maximum: number) {
  return z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => !containsCredentializedUrl(value), {
      message:
        "Source locators must not contain URL credentials or secret signature parameters.",
    });
}

export const sourceKind = z.enum([
  "jira",
  "confluence",
  "figma",
  "github",
  "openapi",
  "other",
]);
const sourceState = z.enum([
  "pending",
  "confirmed",
  "omitted",
  "unavailable",
  "replaced",
]);
const sourceAuthorityRole = z.enum([
  "requirement",
  "visual",
  "contract",
  "implementation-reference",
]);
const sourceAdapter = z.enum([
  "figma-desktop-mcp-local",
  "figma-remote-connector",
  "atlassian-rovo",
  "openapi-local-file",
  "openapi-pasted",
  "openapi-public-http",
  "openapi-internal-connector",
  "github-connector",
  "browser-in-app",
  "chrome-browser",
  "web-http",
  "atlas-cache",
  "manual-import",
  "other",
]);
const sourceEvidenceInput = z.object({
  adapter: sourceAdapter,
  route: safeSourceLocator(500),
  operation: z.string().min(1).max(160),
  observed_at: z.string().datetime(),
  resolved_reference: safeSourceLocator(1_000).optional(),
  content_hash: z.string().max(200).optional(),
  freshness: z.enum(["current", "stale", "unknown"]).optional(),
  scope: z
    .object({
      kind: z.enum([
        "file",
        "page",
        "node",
        "selection",
        "issue",
        "document",
        "operation",
        "repository",
        "unknown",
      ]),
      id: z.string().min(1).max(500),
      parent_id: z.string().max(500).optional(),
    })
    .optional(),
  fallback: z
    .object({
      from_adapter: sourceAdapter,
      condition: z.string().min(1).max(500),
      identity_preserved: z.boolean(),
    })
    .optional(),
  figma_metadata: z
    .union([z.string().max(2_000_000), z.record(z.unknown())])
    .optional(),
  figma_format: z.enum(["auto", "figma-mcp-xml", "figma-rest"]).optional(),
  figma_file_name: z.string().max(240).optional(),
  figma_version: z.string().max(240).optional(),
  figma_last_modified: z.string().max(100).optional(),
  figma_scope_node_id: z.string().max(240).optional(),
  figma_scope_page_id: z.string().max(240).optional(),
  figma_scope_page_name: z.string().max(240).optional(),
  openapi_operation: z
    .object({
      method: z.enum([
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "HEAD",
        "OPTIONS",
      ]),
      path: z.string().regex(/^\/[A-Za-z0-9._~!$&'()*+,;=:@%{}/-]*$/u),
      operation_id: z.string().min(1).max(200).optional(),
    })
    .optional(),
  openapi_content: z.string().min(1).max(1_500_000).optional(),
});

export const sourceInput = z.object({
  reference: safeSourceLocator(1_000),
  kind: sourceKind.optional(),
  state: sourceState.optional(),
  required: z.boolean().optional(),
  replacement_for: z.string().min(1).max(100).optional(),
  relationship: z
    .enum(["primary", "search-candidate", "linked-secondary"])
    .optional(),
  authority_role: sourceAuthorityRole.optional(),
  primary_adapter: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/u).optional(),
  fallback: z.enum(["deny", "ask", "allow-list"]).optional(),
  allowed_fallback_adapters: z
    .array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/u))
    .max(8)
    .optional(),
  evidence: sourceEvidenceInput.optional(),
});

export const sourceRelationInput = z.object({
  from_source_id: z.string().min(1).max(160),
  to_source_id: z.string().min(1).max(160),
  kind: z.enum([
    "references-design",
    "constrains-contract",
    "secondary-implementation-reference",
  ]),
  target_scope: z
    .object({
      provider: sourceKind,
      kind: z.enum(["file", "page", "node", "selection", "operation", "unknown"]),
      id: z.string().min(1).max(500),
    })
    .optional(),
  confirmed_at: z.string().datetime().optional(),
});

export function capsuleDecisions(
  capsule: TaskResumeCapsule | undefined,
): TaskSourceDecision[] {
  if (!capsule) return [];
  return normalizeTaskSourceDecisions(
    capsule.decisions.map((decision) => ({
      ...decision,
      origin: decision.origin ?? "manual",
      relationship: decision.relationship ?? "primary",
      authorityRole:
        decision.authorityRole ?? defaultTaskSourceAuthorityRole(decision.kind),
      routePolicy:
        decision.routePolicy ??
        defaultTaskSourceRoutePolicy(decision.kind, decision.reference),
    })),
  );
}

export interface AuthoritativeTaskSources {
  decisions: TaskSourceDecision[];
  relations: TaskSourceRelation[];
  receiptIds: string[];
}

export async function authoritativeTaskSources(
  rootPath: string,
  taskId: string,
  capsule: TaskResumeCapsule,
): Promise<AuthoritativeTaskSources> {
  const ledger = await loadTaskSourceLedger(rootPath, taskId);
  if (ledger) {
    return {
      decisions: ledger.decisions,
      relations: ledger.relations,
      receiptIds: ledger.receiptIds,
    };
  }
  const fallback = {
    decisions: capsuleDecisions(capsule),
    relations: capsule.sourceRelations ?? [],
    receiptIds: capsule.sourceReceiptIds,
  };
  const lockedLedgerHash = capsule.changeSurface?.evidence.sourceLedger.hash;
  const lockedLedger = capsule.changeSurface?.evidence.sourceLedger;
  if (
    (lockedLedger?.decisionCount !== undefined &&
      lockedLedger.decisionCount !== fallback.decisions.length) ||
    (lockedLedger?.relationCount !== undefined &&
      lockedLedger.relationCount !== fallback.relations.length) ||
    (lockedLedger?.receiptCount !== undefined &&
      lockedLedger.receiptCount !== fallback.receiptIds.length) ||
    (lockedLedgerHash &&
      lockedLedgerHash !==
        sourceLedgerFingerprint(
          fallback.decisions,
          fallback.relations,
          fallback.receiptIds,
        ))
  ) {
    throw new Error(
      `Task ${taskId} is missing the authoritative source ledger required by its locked source fingerprint.`,
    );
  }
  return fallback;
}

export function normalizedSources(
  objective: string,
  prior: TaskSourceDecision[],
  supplied: Array<z.infer<typeof sourceInput>>,
): TaskSourceDecision[] {
  const explicit = supplied.map((source) => {
    const kind = source.kind ?? classifyTaskSource(source.reference);
    const id = taskSourceId(kind, source.reference);
    const previous = prior.find((candidate) => candidate.id === id);
    const state = source.state ?? previous?.state ?? ("pending" as const);
    const defaultRoute = defaultTaskSourceRoutePolicy(kind, source.reference);
    const fallback = source.fallback ?? previous?.routePolicy?.fallback ?? "ask";
    const allowedFallbackAdapters =
      source.allowed_fallback_adapters !== undefined
        ? source.allowed_fallback_adapters
        : previous?.routePolicy?.allowedFallbackAdapters;
    const decidedAt =
      state === "pending"
        ? undefined
        : previous?.state === state && previous.decidedAt
          ? previous.decidedAt
          : new Date().toISOString();
    return {
      kind,
      reference: source.reference,
      origin: "explicit" as const,
      state,
      required: source.required ?? previous?.required ?? false,
      ...(source.replacement_for ?? previous?.replacementFor
        ? { replacementFor: source.replacement_for ?? previous?.replacementFor }
        : {}),
      relationship:
        source.relationship ?? previous?.relationship ?? ("primary" as const),
      authorityRole:
        source.authority_role ??
        previous?.authorityRole ??
        defaultTaskSourceAuthorityRole(kind),
      routePolicy: {
        primaryAdapter:
          source.primary_adapter ??
          previous?.routePolicy?.primaryAdapter ??
          defaultRoute.primaryAdapter,
        fallback,
        ...(allowedFallbackAdapters?.length
          ? { allowedFallbackAdapters }
          : {}),
      },
      ...(decidedAt ? { decidedAt } : {}),
    };
  });
  const merged = new Map(
    [...prior, ...detectTaskSources(objective), ...normalizeTaskSourceDecisions(explicit)].map(
      (source) => [source.id, source],
    ),
  );
  return ensureTaskSourceDecisions(objective, [...merged.values()]);
}

export function normalizedSourceRelations(
  supplied: Array<z.infer<typeof sourceRelationInput>>,
  decisions: TaskSourceDecision[],
): TaskSourceRelation[] {
  return normalizeTaskSourceRelations(
    supplied.map((relation) => ({
      fromSourceId: relation.from_source_id,
      toSourceId: relation.to_source_id,
      kind: relation.kind,
      ...(relation.target_scope
        ? {
            targetScope: {
              provider: relation.target_scope.provider,
              kind: relation.target_scope.kind,
              id: relation.target_scope.id,
            },
          }
        : {}),
      ...(relation.confirmed_at ? { confirmedAt: relation.confirmed_at } : {}),
    })),
    decisions,
  );
}

function defaultReceiptScope(
  decision: TaskSourceDecision,
  identity: ReturnType<typeof sourceIdentityFromReference>,
) {
  if (decision.kind === "figma") {
    return identity.nodeId
      ? {
          kind: "node" as const,
          id: identity.nodeId,
          ...(identity.fileKey ? { parentId: identity.fileKey } : {}),
        }
      : { kind: "file" as const, id: identity.fileKey ?? identity.canonicalId };
  }
  if (decision.kind === "jira") {
    return { kind: "issue" as const, id: identity.issueKey ?? identity.canonicalId };
  }
  if (decision.kind === "confluence") {
    return { kind: "document" as const, id: identity.pageId ?? identity.canonicalId };
  }
  if (decision.kind === "github") {
    return { kind: "repository" as const, id: identity.canonicalId };
  }
  if (decision.kind === "openapi") {
    return { kind: "document" as const, id: identity.canonicalId };
  }
  return { kind: "unknown" as const, id: identity.canonicalId };
}

export interface BoundSourceEvidence {
  receiptIds: string[];
  transientOpenApiSources: ConfirmedOpenApiSource[];
}

function serializedOpenApiContent(
  value: z.infer<typeof sourceEvidenceInput>["openapi_content"],
): string | undefined {
  if (value === undefined) return undefined;
  if (Buffer.byteLength(value, "utf8") > MAX_OPENAPI_CONTENT_BYTES) {
    throw new Error(
      "OpenAPI content exceeds the 1.5 MB transient handoff budget.",
    );
  }
  return value;
}

export async function bindSourceEvidenceBundle(
  rootPath: string,
  decisions: TaskSourceDecision[],
  supplied: Array<z.infer<typeof sourceInput>>,
  existingReceiptIds: string[],
): Promise<BoundSourceEvidence> {
  const receipts: SourceReceipt[] = [];
  const transientOpenApiSources: ConfirmedOpenApiSource[] = [];
  const figmaMappings: Array<Parameters<typeof mapFigmaDesign>[0]> = [];
  for (const source of supplied) {
    if (!source.evidence) continue;
    const kind = source.kind ?? classifyTaskSource(source.reference);
    const decision = decisions.find(
      (candidate) => candidate.id === taskSourceId(kind, source.reference),
    );
    if (!decision || decision.state !== "confirmed") {
      throw new Error(
        `Evidence for ${source.reference} requires an explicitly confirmed source decision.`,
      );
    }
    const openApiContent = serializedOpenApiContent(
      source.evidence.openapi_content,
    );
    if (openApiContent !== undefined) {
      if (kind !== "openapi") {
        throw new Error(
          "openapi_content evidence is valid only for OpenAPI sources.",
        );
      }
      if (source.evidence.openapi_operation) {
        throw new Error(
          "Supply either the OpenAPI document content or one manual operation, not both.",
        );
      }
      if (
        source.evidence.scope !== undefined &&
        source.evidence.scope.kind !== "document"
      ) {
        throw new Error(
          "Transient OpenAPI content must use document scope; operation receipts are derived by Atlas.",
        );
      }
      if (!TRANSIENT_OPENAPI_ADAPTERS.has(source.evidence.adapter)) {
        throw new Error(
          "Transient OpenAPI content requires an OpenAPI, manual-import or explicitly other adapter.",
        );
      }
      // Parse before any receipt or design-index side effect. The objective is
      // deliberately empty here: this pass validates the bounded document;
      // task-aware operation ranking runs later in prepareTaskContext.
      extractOpenApiTaskContext(openApiContent, "");
    }
    if (source.evidence.figma_metadata !== undefined) {
      const serializedMetadata =
        typeof source.evidence.figma_metadata === "string"
          ? source.evidence.figma_metadata
          : JSON.stringify(source.evidence.figma_metadata);
      if (
        Buffer.byteLength(serializedMetadata, "utf8") >
        MAX_FIGMA_METADATA_BYTES
      ) {
        throw new Error(
          "Figma metadata exceeds the 2 MB task evidence budget.",
        );
      }
    }
    const requested = sourceIdentityFromReference(decision.kind, decision.reference);
    const resolved = sourceIdentityFromReference(
      decision.kind,
      source.evidence.resolved_reference ?? decision.reference,
    );
    if (source.evidence.openapi_operation) {
      if (decision.kind !== "openapi") {
        throw new Error("openapi_operation evidence is valid only for OpenAPI sources.");
      }
      resolved.method = source.evidence.openapi_operation.method;
      resolved.path = source.evidence.openapi_operation.path;
      if (source.evidence.openapi_operation.operation_id) {
        resolved.operationId = source.evidence.openapi_operation.operation_id;
      }
    }
    if (decision.kind === "figma" && source.evidence.figma_version) {
      resolved.version = source.evidence.figma_version;
    }
    const scope = source.evidence.scope
      ? {
          kind: source.evidence.scope.kind,
          id: source.evidence.scope.id,
          ...(source.evidence.scope.parent_id
            ? { parentId: source.evidence.scope.parent_id }
            : {}),
        }
      : source.evidence.openapi_operation
        ? {
            kind: "operation" as const,
            id: `${source.evidence.openapi_operation.method} ${source.evidence.openapi_operation.path}`,
            parentId: requested.canonicalId,
          }
        : defaultReceiptScope(decision, resolved);
    const sourceScopeId = requested.nodeId ?? requested.fileKey ?? requested.canonicalId;
    const scopeRelation =
      decision.kind === "figma" && sourceScopeId
        ? {
            kind:
              sourceScopeId === scope.id
                ? ("same-scope" as const)
                : ("contained-scope" as const),
            sourceId: sourceScopeId,
            targetId: scope.id,
          }
        : undefined;
    const computedOpenApiHash = openApiContent
      ? `sha256:${createHash("sha256").update(openApiContent).digest("hex")}`
      : undefined;
    if (
      computedOpenApiHash &&
      source.evidence.content_hash !== undefined &&
      source.evidence.content_hash !== computedOpenApiHash
    ) {
      throw new Error(
        "The transient OpenAPI content does not match its declared SHA-256 digest.",
      );
    }
    const receipt = createSourceReceipt({
      sourceDecisionId: decision.id,
      provider: decision.kind,
      requested,
      resolved,
      adapter: source.evidence.adapter,
      route: source.evidence.route,
      operation: source.evidence.operation,
      scope,
      ...(scopeRelation ? { scopeRelation } : {}),
      observedAt: source.evidence.observed_at,
      ...(computedOpenApiHash ?? source.evidence.content_hash
        ? {
            contentHash:
              computedOpenApiHash ?? source.evidence.content_hash!,
          }
        : {}),
      ...(source.evidence.fallback
        ? {
            fallback: {
              fromAdapter: source.evidence.fallback.from_adapter,
              condition: source.evidence.fallback.condition,
              identityPreserved: source.evidence.fallback.identity_preserved,
            },
          }
        : {}),
      coverage: "exact",
      freshness: source.evidence.freshness ?? "current",
    });
    assertSourceReceiptMatchesDecision(decision, receipt);
    receipts.push(receipt);

    if (openApiContent !== undefined) {
      transientOpenApiSources.push({
        sourceDecisionId: decision.id,
        reference: decision.reference,
        required: decision.required,
        content: openApiContent,
        contentHash: computedOpenApiHash!,
        sourceReceipt: receipt,
        adapter: source.evidence.adapter as NonNullable<
          ConfirmedOpenApiSource["adapter"]
        >,
        route: source.evidence.route,
        operation: source.evidence.operation,
        observedAt: source.evidence.observed_at,
        ...(source.evidence.fallback
          ? {
              fallback: {
                fromAdapter: source.evidence.fallback.from_adapter,
                condition: source.evidence.fallback.condition,
                identityPreserved:
                  source.evidence.fallback.identity_preserved,
              },
            }
          : {}),
        ...(decision.routePolicy
          ? { routePolicy: decision.routePolicy }
          : {}),
      });
    }

    if (decision.kind === "figma" && source.evidence.figma_metadata) {
      figmaMappings.push({
        rootPath,
        figmaUrl: decision.reference,
        confirmedSourceReference: decision.reference,
        metadata: source.evidence.figma_metadata,
        ...(source.evidence.figma_format ? { format: source.evidence.figma_format } : {}),
        ...(source.evidence.figma_file_name ? { fileName: source.evidence.figma_file_name } : {}),
        ...(source.evidence.figma_version ? { version: source.evidence.figma_version } : {}),
        ...(source.evidence.figma_last_modified
          ? { lastModified: source.evidence.figma_last_modified }
          : {}),
        ...(source.evidence.figma_scope_node_id
          ? { scopeNodeId: source.evidence.figma_scope_node_id }
          : {}),
        ...(source.evidence.figma_scope_page_id
          ? { scopePageId: source.evidence.figma_scope_page_id }
          : {}),
        ...(source.evidence.figma_scope_page_name
          ? { scopePageName: source.evidence.figma_scope_page_name }
          : {}),
        sourceReceipt: receipt,
      });
    }
  }

  // The whole batch is validated before either durable side effect. Receipts
  // are then committed first: a mapping failure can be retried idempotently
  // without ever leaving an authoritative design index with no audit receipt.
  if (receipts.length > 0) await persistSourceReceipts(rootPath, receipts);
  for (const mapping of figmaMappings) await mapFigmaDesign(mapping);

  const linked: SourceReceipt[] = [];
  for (const receiptId of existingReceiptIds) {
    const receipt = await loadPersistedSourceReceipt(rootPath, receiptId);
    const decision = decisions.find(
      (candidate) => candidate.id === receipt.sourceDecisionId,
    );
    // The ledger is append-only for audit, while authority is a current-state
    // view. Replaced/omitted decisions keep their historical receipt but may
    // never feed the next lock.
    if (!decision || decision.state !== "confirmed") continue;
    assertSourceReceiptMatchesDecision(decision, receipt);
    linked.push(receipt);
  }
  // Keep the authoritative ledger complete here. writeTaskCheckpoint applies
  // the smaller resume-capsule projection while persisting up to 128 IDs in
  // the durable ledger.
  linked.push(...receipts);
  const receiptIds = [...new Set(linked.map((receipt) => receipt.id))];
  if (receiptIds.length > 128) {
    throw new Error("A task source ledger supports at most 128 receipt IDs.");
  }
  return { receiptIds, transientOpenApiSources };
}

export async function bindSourceEvidence(
  rootPath: string,
  decisions: TaskSourceDecision[],
  supplied: Array<z.infer<typeof sourceInput>>,
  existingReceiptIds: string[],
): Promise<string[]> {
  return (
    await bindSourceEvidenceBundle(
      rootPath,
      decisions,
      supplied,
      existingReceiptIds,
    )
  ).receiptIds;
}

export async function activeCurrentSourceReceiptIds(
  rootPath: string,
  decisions: TaskSourceDecision[],
  receiptIds: string[],
): Promise<string[]> {
  const active: string[] = [];
  for (const receiptId of [...new Set(receiptIds)]) {
    const receipt = await loadPersistedSourceReceipt(rootPath, receiptId);
    const decision = decisions.find(
      (candidate) => candidate.id === receipt.sourceDecisionId,
    );
    if (!decision || decision.state !== "confirmed") continue;
    assertSourceReceiptMatchesDecision(decision, receipt);
    if (receipt.coverage === "exact" && receipt.freshness === "current") {
      active.push(receipt.id);
    }
  }
  return active;
}

export async function confirmedOperationsFromReceipts(
  rootPath: string,
  receiptIds: string[],
  decisions?: TaskSourceDecision[],
): Promise<Array<{ method: string; path: string; operationId?: string }>> {
  const candidates: SourceReceipt[] = [];
  for (const receiptId of receiptIds) {
    const receipt = await loadPersistedSourceReceipt(rootPath, receiptId);
    if (receipt.provider !== "openapi") continue;
    if (decisions) {
      const decision = decisions.find(
        (candidate) => candidate.id === receipt.sourceDecisionId,
      );
      if (!decision || decision.state !== "confirmed") continue;
      assertSourceReceiptMatchesDecision(decision, receipt);
    }
    if (receipt.coverage !== "exact" || receipt.freshness !== "current") {
      continue;
    }
    candidates.push(receipt);
  }
  const contentAddressedDecisions = new Set(
    candidates
      .filter((candidate) => Boolean(candidate.contentHash))
      .map((candidate) => candidate.sourceDecisionId),
  );
  // Once Atlas has an immutable document observation for a decision, older
  // hashless/manual operation receipts remain audit history only. Mixing them
  // back into the current operation set could authorize an endpoint removed
  // by the newer governing contract.
  const authoritativeCandidates = candidates.filter(
    (candidate) =>
      !contentAddressedDecisions.has(candidate.sourceDecisionId) ||
      Boolean(candidate.contentHash),
  );
  const latestObservationByDecision = new Map<string, string>();
  for (const receipt of authoritativeCandidates.filter(
    (candidate) => candidate.contentHash,
  )) {
    const current = latestObservationByDecision.get(receipt.sourceDecisionId);
    if (!current || Date.parse(receipt.observedAt) > Date.parse(current)) {
      latestObservationByDecision.set(
        receipt.sourceDecisionId,
        receipt.observedAt,
      );
    }
  }
  const latest = authoritativeCandidates.filter(
    (receipt) =>
      !receipt.contentHash ||
      receipt.observedAt ===
        latestObservationByDecision.get(receipt.sourceDecisionId),
  );
  for (const [sourceDecisionId, observedAt] of latestObservationByDecision) {
    const hashes = new Set(
      latest
        .filter(
          (receipt) =>
            receipt.sourceDecisionId === sourceDecisionId &&
            receipt.observedAt === observedAt,
        )
        .map((receipt) => receipt.contentHash)
        .filter((hash): hash is string => Boolean(hash)),
    );
    if (hashes.size > 1) {
      throw new Error(
        `OpenAPI source ${sourceDecisionId} has conflicting content hashes at its latest observation. Re-observe the governing contract before locking.`,
      );
    }
  }
  const operations = [];
  for (const receipt of latest) {
    const identity = receipt.resolved;
    if (!identity.method || !identity.path) continue;
    operations.push({
      method: identity.method.toUpperCase(),
      path: identity.path,
      ...(identity.operationId ? { operationId: identity.operationId } : {}),
    });
  }
  return operations.filter(
    (operation, index, collection) =>
      collection.findIndex(
        (candidate) =>
          candidate.method === operation.method &&
          candidate.path === operation.path &&
          candidate.operationId === operation.operationId,
      ) === index,
  );
}

export async function requiredSourcesWithoutCurrentReceipts(
  rootPath: string,
  decisions: TaskSourceDecision[],
  receiptIds: string[],
): Promise<TaskSourceDecision[]> {
  const activeReceiptIds = await activeCurrentSourceReceiptIds(
    rootPath,
    decisions,
    receiptIds,
  );
  const resolvedSourceIds = new Set<string>();
  for (const receiptId of activeReceiptIds) {
    const receipt = await loadPersistedSourceReceipt(rootPath, receiptId);
    resolvedSourceIds.add(receipt.sourceDecisionId);
  }
  return decisions.filter(
    (decision) =>
      decision.required &&
      decision.state === "confirmed" &&
      !resolvedSourceIds.has(decision.id),
  );
}
