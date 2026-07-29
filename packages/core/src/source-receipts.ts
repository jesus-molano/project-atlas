export const SOURCE_RECEIPT_SCHEMA_VERSION = 2 as const;
export const LEGACY_SOURCE_RECEIPT_SCHEMA_VERSION = 1 as const;

export type SourceReceiptProvider =
  | "figma"
  | "jira"
  | "confluence"
  | "openapi"
  | "github"
  | "other";

export type SourceReceiptAdapter =
  | "figma-desktop-mcp-local"
  | "figma-remote-connector"
  | "atlassian-rovo"
  | "openapi-local-file"
  | "openapi-pasted"
  | "openapi-public-http"
  | "openapi-internal-connector"
  | "github-connector"
  | "browser-in-app"
  | "chrome-browser"
  | "web-http"
  | "atlas-cache"
  | "manual-import"
  | "other";

export type SourceReceiptScopeKind =
  | "file"
  | "page"
  | "node"
  | "selection"
  | "issue"
  | "document"
  | "operation"
  | "repository"
  | "unknown";

export interface SourceIdentity {
  provider: SourceReceiptProvider;
  canonicalId: string;
  url?: string;
  host?: string;
  fileKey?: string;
  nodeId?: string;
  issueKey?: string;
  pageId?: string;
  operationId?: string;
  method?: string;
  path?: string;
  version?: string;
}

export interface SourceReceipt {
  schemaVersion:
    | typeof LEGACY_SOURCE_RECEIPT_SCHEMA_VERSION
    | typeof SOURCE_RECEIPT_SCHEMA_VERSION;
  id: string;
  sourceDecisionId: string;
  provider: SourceReceiptProvider;
  requested: SourceIdentity;
  resolved: SourceIdentity;
  adapter: SourceReceiptAdapter;
  route: string;
  operation: string;
  scope: {
    kind: SourceReceiptScopeKind;
    id: string;
    parentId?: string;
  };
  scopeRelation?: {
    kind: "same-scope" | "contained-scope";
    sourceId: string;
    targetId: string;
    ancestorIds?: string[];
    proofHash?: string;
  };
  derivation?: {
    kind:
      | "same-origin-redirect"
      | "swagger-ui-config"
      | "swagger-ui-config-url"
      | "swagger-ui-initializer";
    sourceId: string;
    targetId: string;
    evidenceHash: string;
    redirectChain?: string[];
  };
  contentHash?: string;
  observedAt: string;
  fallback?: {
    fromAdapter: SourceReceiptAdapter;
    condition: string;
    identityPreserved: boolean;
  };
  coverage: "exact" | "partial" | "candidate";
  freshness: "current" | "stale" | "unknown";
}

interface ReceiptSourceDecision {
  id: string;
  kind: SourceReceiptProvider;
  reference: string;
  state: string;
  routePolicy?: {
    primaryAdapter: string;
    fallback: "deny" | "ask" | "allow-list";
    allowedFallbackAdapters?: string[];
  };
}

const NODE_ID = /^[A-Za-z0-9_.:-]{1,240}$/u;
const MAX_TEXT = 1_000;

function short(value: string, maximum = MAX_TEXT): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maximum ||
    /[\u0000-\u001f]/u.test(normalized)
  ) {
    throw new Error("Source receipt text is invalid.");
  }
  return normalized;
}

function normalizedNodeId(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().replace("-", ":");
  return normalized && NODE_ID.test(normalized) ? normalized : undefined;
}

function referenceUrl(reference: string): URL | undefined {
  try {
    return /^https?:\/\//iu.test(reference.trim())
      ? new URL(reference.trim())
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizedUrl(url: URL): string {
  url.hash = "";
  const parameters = [...url.searchParams.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  url.search = "";
  for (const [key, value] of parameters) url.searchParams.append(key, value);
  return url.toString().replace(/\/$/u, "");
}

export function sourceIdentityFromReference(
  provider: SourceReceiptProvider,
  reference: string,
): SourceIdentity {
  const value = short(reference);
  const url = referenceUrl(value);
  const host = url?.hostname.toLowerCase();

  if (provider === "figma") {
    const route = url?.pathname.match(
      /^\/(?:design|file|proto|board|make|slides)\/([^/?#]+)/iu,
    );
    const fileKey = route?.[1] ?? (!url && /^[A-Za-z0-9_-]+$/u.test(value) ? value : undefined);
    if (!fileKey) throw new Error("The Figma source identity is invalid.");
    const nodeId = normalizedNodeId(url?.searchParams.get("node-id"));
    return {
      provider,
      canonicalId: nodeId ? `${fileKey}::${nodeId}` : fileKey,
      ...(url ? { url: normalizedUrl(url) } : {}),
      ...(host ? { host } : {}),
      fileKey,
      ...(nodeId ? { nodeId } : {}),
    };
  }

  if (provider === "jira") {
    const issueKey =
      url?.pathname.match(/\/browse\/([A-Z][A-Z0-9]{1,9}-\d+)(?:\/|$)/u)?.[1] ??
      value.match(/^[A-Z][A-Z0-9]{1,9}-\d+$/u)?.[0];
    if (!issueKey) throw new Error("The Jira source identity is invalid.");
    return {
      provider,
      canonicalId: host ? `${host}:${issueKey}` : issueKey,
      ...(url ? { url: normalizedUrl(url) } : {}),
      ...(host ? { host } : {}),
      issueKey,
    };
  }

  if (provider === "confluence") {
    const pageId =
      url?.searchParams.get("pageId") ??
      url?.pathname.match(/\/pages\/(\d+)(?:\/|$)/u)?.[1] ??
      value.match(/^confluence[:#]\s*([A-Za-z0-9_-]+)$/iu)?.[1];
    const canonicalId = pageId
      ? host
        ? `${host}:${pageId}`
        : pageId
      : url
        ? normalizedUrl(url)
        : value;
    return {
      provider,
      canonicalId,
      ...(url ? { url: normalizedUrl(url) } : {}),
      ...(host ? { host } : {}),
      ...(pageId ? { pageId } : {}),
    };
  }

  if (provider === "github") {
    return {
      provider,
      canonicalId: url ? normalizedUrl(url).toLowerCase() : value.toLowerCase(),
      ...(url ? { url: normalizedUrl(url) } : {}),
      ...(host ? { host } : {}),
    };
  }

  return {
    provider,
    canonicalId: url ? normalizedUrl(url) : value.replaceAll("\\", "/"),
    ...(url ? { url: normalizedUrl(url) } : {}),
    ...(host ? { host } : {}),
  };
}

export function sourceIdentityMatches(
  requested: SourceIdentity,
  resolved: SourceIdentity,
): boolean {
  if (requested.provider !== resolved.provider) return false;
  if (requested.fileKey && requested.fileKey !== resolved.fileKey) return false;
  if (requested.nodeId && requested.nodeId !== resolved.nodeId) return false;
  if (requested.issueKey && requested.issueKey !== resolved.issueKey) return false;
  if (requested.pageId && requested.pageId !== resolved.pageId) return false;
  if (requested.version && requested.version !== resolved.version) return false;
  if (requested.host && requested.host !== resolved.host) return false;
  if (
    !requested.fileKey &&
    !requested.issueKey &&
    !requested.pageId &&
    requested.canonicalId !== resolved.canonicalId
  ) {
    return false;
  }
  return true;
}

export function sourceReceiptId(input: {
  schemaVersion?: 1 | 2;
  sourceDecisionId: string;
  resolved: SourceIdentity;
  adapter: SourceReceiptAdapter;
  operation: string;
  observedAt: string;
  contentHash?: string;
  scope?: SourceReceipt["scope"];
  scopeRelation?: SourceReceipt["scopeRelation"];
  derivation?: SourceReceipt["derivation"];
}): string {
  const immutable = [
    input.sourceDecisionId,
    input.resolved.provider,
    input.resolved.canonicalId,
    input.adapter,
    input.operation,
    input.observedAt,
    input.contentHash ?? "",
  ];
  if ((input.schemaVersion ?? SOURCE_RECEIPT_SCHEMA_VERSION) >= 2) {
    immutable.push(
      input.scope?.kind ?? "",
      input.scope?.id ?? "",
      input.scope?.parentId ?? "",
      input.scopeRelation?.kind ?? "",
      input.scopeRelation?.sourceId ?? "",
      input.scopeRelation?.targetId ?? "",
      ...(input.scopeRelation?.ancestorIds ?? []),
      input.scopeRelation?.proofHash ?? "",
    );
    if (input.derivation) {
      immutable.push(
        "derivation",
        input.derivation.kind,
        input.derivation.sourceId,
        input.derivation.targetId,
        input.derivation.evidenceHash,
        ...(input.derivation.redirectChain ?? []),
      );
    }
  }
  const value = immutable.join("\0");
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16_777_619);
    second = Math.imul(second ^ code, 2_246_822_519);
  }
  return `receipt-${(first >>> 0).toString(16).padStart(8, "0")}${(
    second >>> 0
  )
    .toString(16)
    .padStart(8, "0")}`;
}

export function createSourceReceipt(
  input: Omit<SourceReceipt, "schemaVersion" | "id"> & {
    schemaVersion?: typeof SOURCE_RECEIPT_SCHEMA_VERSION;
    id?: string;
  },
): SourceReceipt {
  const observedAt = short(input.observedAt, 100);
  if (!Number.isFinite(Date.parse(observedAt))) {
    throw new Error("Source receipt observedAt must be a valid date-time.");
  }
  if (
    input.provider !== input.requested.provider ||
    input.provider !== input.resolved.provider
  ) {
    throw new Error("Source receipt provider and identities do not match.");
  }
  if (!sourceIdentityMatches(input.requested, input.resolved)) {
    throw new Error("Resolved source identity does not match the requested source.");
  }
  const sourceDecisionId = short(input.sourceDecisionId, 160);
  const operation = short(input.operation, 160);
  const route = short(input.route, 500);
  const scopeId = short(input.scope.id, 500);
  const contentHash = input.contentHash
    ? short(input.contentHash, 200)
    : undefined;
  const scopeRelation = input.scopeRelation
    ? {
        kind: input.scopeRelation.kind,
        sourceId: short(input.scopeRelation.sourceId, 500),
        targetId: short(input.scopeRelation.targetId, 500),
        ...(input.scopeRelation.ancestorIds
          ? {
              ancestorIds: [
                ...new Set(
                  input.scopeRelation.ancestorIds.map((id) => short(id, 500)),
                ),
              ].slice(0, 128),
            }
          : {}),
        ...(input.scopeRelation.proofHash
          ? { proofHash: short(input.scopeRelation.proofHash, 200) }
          : {}),
      }
    : undefined;
  const derivation = input.derivation
    ? {
        kind: input.derivation.kind,
        sourceId: short(input.derivation.sourceId, 1_000),
        targetId: short(input.derivation.targetId, 1_000),
        evidenceHash: short(input.derivation.evidenceHash, 200),
        ...(input.derivation.redirectChain
          ? {
              redirectChain: input.derivation.redirectChain
                .map((item) => short(item, 1_000))
                .slice(0, 4),
            }
          : {}),
      }
    : undefined;
  if (
    scopeRelation &&
    (!["same-scope", "contained-scope"].includes(scopeRelation.kind) ||
      scopeRelation.targetId !== scopeId ||
      (scopeRelation.kind === "same-scope" &&
        scopeRelation.sourceId !== scopeRelation.targetId) ||
      (scopeRelation.kind === "contained-scope" &&
        scopeRelation.sourceId === scopeRelation.targetId))
  ) {
    throw new Error("Source receipt scope relation is invalid.");
  }
  if (
    derivation &&
    (![
      "same-origin-redirect",
      "swagger-ui-config",
      "swagger-ui-config-url",
      "swagger-ui-initializer",
    ].includes(derivation.kind) ||
      derivation.sourceId !== input.requested.canonicalId ||
      derivation.sourceId === derivation.targetId ||
      !/^sha256:[a-f0-9]{64}$/u.test(derivation.evidenceHash))
  ) {
    throw new Error("Source receipt derivation is invalid.");
  }
  const normalized = {
    ...input,
    sourceDecisionId,
    operation,
    route,
    scope: {
      ...input.scope,
      id: scopeId,
      ...(input.scope.parentId
        ? { parentId: short(input.scope.parentId, 500) }
        : {}),
    },
    ...(scopeRelation ? { scopeRelation } : {}),
    ...(derivation ? { derivation } : {}),
    ...(contentHash ? { contentHash } : {}),
    observedAt,
  };
  const expectedId = sourceReceiptId({
    sourceDecisionId,
    resolved: input.resolved,
    adapter: input.adapter,
    operation,
    observedAt,
    ...(contentHash ? { contentHash } : {}),
    scope: normalized.scope,
    ...(scopeRelation ? { scopeRelation } : {}),
    ...(derivation ? { derivation } : {}),
  });
  if (input.id && input.id !== expectedId) {
    throw new Error("Source receipt ID does not match its immutable fields.");
  }
  return {
    ...normalized,
    schemaVersion: SOURCE_RECEIPT_SCHEMA_VERSION,
    id: expectedId,
  };
}

export function parseSourceReceipt(value: unknown): SourceReceipt {
  if (!value || typeof value !== "object") {
    throw new Error("Source receipt must be an object.");
  }
  const receipt = value as Partial<SourceReceipt>;
  if (
    ![
      LEGACY_SOURCE_RECEIPT_SCHEMA_VERSION,
      SOURCE_RECEIPT_SCHEMA_VERSION,
    ].includes(receipt.schemaVersion as 1 | 2) ||
    typeof receipt.id !== "string" ||
    typeof receipt.sourceDecisionId !== "string" ||
    !receipt.requested ||
    !receipt.resolved ||
    typeof receipt.adapter !== "string" ||
    typeof receipt.route !== "string" ||
    typeof receipt.operation !== "string" ||
    !receipt.scope ||
    typeof receipt.observedAt !== "string" ||
    !["exact", "partial", "candidate"].includes(String(receipt.coverage)) ||
    !["current", "stale", "unknown"].includes(String(receipt.freshness))
  ) {
    throw new Error("Source receipt is invalid.");
  }
  if (receipt.schemaVersion === LEGACY_SOURCE_RECEIPT_SCHEMA_VERSION) {
    const legacy = receipt as SourceReceipt;
    const expectedId = sourceReceiptId({
      schemaVersion: LEGACY_SOURCE_RECEIPT_SCHEMA_VERSION,
      sourceDecisionId: short(legacy.sourceDecisionId, 160),
      resolved: legacy.resolved,
      adapter: legacy.adapter,
      operation: short(legacy.operation, 160),
      observedAt: short(legacy.observedAt, 100),
      ...(legacy.contentHash
        ? { contentHash: short(legacy.contentHash, 200) }
        : {}),
    });
    if (
      legacy.id !== expectedId ||
      !Number.isFinite(Date.parse(legacy.observedAt)) ||
      !sourceIdentityMatches(legacy.requested, legacy.resolved) ||
      (legacy.fallback && !legacy.fallback.identityPreserved)
    ) {
      throw new Error("Legacy source receipt is invalid.");
    }
    return legacy;
  }
  const {
    schemaVersion: _schemaVersion,
    id,
    ...currentReceipt
  } = receipt as SourceReceipt;
  return createSourceReceipt({
    ...currentReceipt,
    id,
  });
}

export function assertSourceReceiptMatchesDecision(
  decision: ReceiptSourceDecision,
  receipt: SourceReceipt,
): void {
  if (decision.state !== "confirmed") {
    throw new Error("Only a confirmed source may produce an evidence receipt.");
  }
  if (
    decision.id !== receipt.sourceDecisionId ||
    decision.kind !== receipt.provider
  ) {
    throw new Error("Source receipt is not bound to the confirmed source decision.");
  }
  const routePolicy = decision.routePolicy;
  if (routePolicy && receipt.adapter !== routePolicy.primaryAdapter) {
    const allowed =
      routePolicy.fallback === "allow-list" &&
      routePolicy.allowedFallbackAdapters?.includes(receipt.adapter);
    if (!allowed) {
      throw new Error(
        routePolicy.fallback === "deny"
          ? "The confirmed source forbids provider fallback."
          : "Provider fallback requires an explicit allow-list decision.",
      );
    }
    if (
      !receipt.fallback ||
      receipt.fallback.fromAdapter !== routePolicy.primaryAdapter
    ) {
      throw new Error(
        "An allowed provider fallback must record the primary adapter and fallback condition.",
      );
    }
  }
  const requested = sourceIdentityFromReference(decision.kind, decision.reference);
  if (
    !sourceIdentityMatches(requested, receipt.requested) ||
    !sourceIdentityMatches(requested, receipt.resolved)
  ) {
    throw new Error("Source receipt identity differs from the confirmed source.");
  }
  if (
    receipt.fallback &&
    (!receipt.fallback.identityPreserved ||
      !sourceIdentityMatches(receipt.requested, receipt.resolved))
  ) {
    throw new Error("A fallback may not replace the confirmed source identity.");
  }
  if (receipt.coverage !== "exact" || receipt.freshness !== "current") {
    throw new Error(
      "Authoritative evidence requires exact coverage from a current source observation.",
    );
  }
}

export function derivePendingSecondarySource(
  parent: ReceiptSourceDecision,
  provider: SourceReceiptProvider,
  reference: string,
): {
  kind: SourceReceiptProvider;
  reference: string;
  origin: "inferred";
  state: "pending";
  required: false;
  parentSourceId: string;
  relationship: "linked-secondary";
} {
  return {
    kind: provider,
    reference: short(reference),
    origin: "inferred",
    state: "pending",
    required: false,
    parentSourceId: parent.id,
    relationship: "linked-secondary",
  };
}
