import type {
  AgentSourceDecision,
  AgentSourceIdentity,
  AgentSourceReceipt,
  AgentSourceReceiptAdapter,
  AgentSourceReceiptProvider,
} from "./types.js";

const RECEIPT_ID = /^receipt-[a-f0-9]{16}$/u;
const PROVIDERS = new Set<AgentSourceReceiptProvider>([
  "figma",
  "jira",
  "confluence",
  "openapi",
  "github",
  "other",
]);
const ADAPTERS = new Set<AgentSourceReceiptAdapter>([
  "figma-desktop-mcp-local",
  "figma-remote-connector",
  "atlassian-rovo",
  "openapi-local-file",
  "openapi-pasted",
  "openapi-public-http",
  "openapi-internal-connector",
  "github-connector",
  "atlas-cache",
  "manual-import",
  "other",
]);
const SCOPES = new Set([
  "file",
  "page",
  "node",
  "selection",
  "issue",
  "document",
  "operation",
  "repository",
  "unknown",
]);

function text(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f]/u.test(value)
  ) {
    throw new Error("SourceReceipt text is invalid.");
  }
  return value.trim();
}

function omitNullObjectFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitNullObjectFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== null)
      .map(([key, item]) => [key, omitNullObjectFields(item)]),
  );
}

function referenceUrl(reference: string): URL | undefined {
  try {
    return /^https?:\/\//iu.test(reference) ? new URL(reference) : undefined;
  } catch {
    return undefined;
  }
}

function normalizedUrl(input: URL): string {
  const url = new URL(input);
  url.hash = "";
  const entries = [...url.searchParams.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  url.search = "";
  for (const [key, value] of entries) url.searchParams.append(key, value);
  return url.toString().replace(/\/$/u, "");
}

function normalizedNodeId(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().replace("-", ":");
  return normalized && /^[A-Za-z0-9_.:-]{1,240}$/u.test(normalized)
    ? normalized
    : undefined;
}

function identityFromReference(
  provider: AgentSourceReceiptProvider,
  reference: string,
): AgentSourceIdentity {
  const value = text(reference, 1_000);
  const url = referenceUrl(value);
  const host = url?.hostname.toLowerCase();
  if (provider === "figma") {
    const fileKey =
      url?.pathname.match(
        /^\/(?:design|file|proto|board|make|slides)\/([^/?#]+)/iu,
      )?.[1] ?? (!url && /^[A-Za-z0-9_-]+$/u.test(value) ? value : undefined);
    if (!fileKey) throw new Error("SourceReceipt Figma identity is invalid.");
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
    if (!issueKey) throw new Error("SourceReceipt Jira identity is invalid.");
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
    return {
      provider,
      canonicalId: pageId
        ? host
          ? `${host}:${pageId}`
          : pageId
        : url
          ? normalizedUrl(url)
          : value,
      ...(url ? { url: normalizedUrl(url) } : {}),
      ...(host ? { host } : {}),
      ...(pageId ? { pageId } : {}),
    };
  }
  return {
    provider,
    canonicalId:
      provider === "github"
        ? (url ? normalizedUrl(url) : value).toLowerCase()
        : url
          ? normalizedUrl(url)
          : value.replaceAll("\\", "/"),
    ...(url ? { url: normalizedUrl(url) } : {}),
    ...(host ? { host } : {}),
  };
}

function identityMatches(
  requested: AgentSourceIdentity,
  resolved: AgentSourceIdentity,
): boolean {
  if (requested.provider !== resolved.provider) return false;
  for (const field of [
    "fileKey",
    "nodeId",
    "issueKey",
    "pageId",
    "version",
    "host",
  ] as const) {
    if (requested[field] && requested[field] !== resolved[field]) return false;
  }
  return Boolean(
    requested.fileKey ||
      requested.issueKey ||
      requested.pageId ||
      requested.canonicalId === resolved.canonicalId,
  );
}

function receiptId(receipt: AgentSourceReceipt): string {
  const value = [
    receipt.sourceDecisionId,
    receipt.resolved.provider,
    receipt.resolved.canonicalId,
    receipt.adapter,
    receipt.operation,
    receipt.observedAt,
    receipt.contentHash ?? "",
  ].join("\0");
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

export function parseAgentSourceReceipt(value: unknown): AgentSourceReceipt {
  if (!value || typeof value !== "object") {
    throw new Error("SourceReceipt must be an object.");
  }
  const receipt = omitNullObjectFields(value) as AgentSourceReceipt;
  if (
    receipt.schemaVersion !== 1 ||
    !RECEIPT_ID.test(String(receipt.id)) ||
    !PROVIDERS.has(receipt.provider) ||
    !ADAPTERS.has(receipt.adapter) ||
    receipt.requested?.provider !== receipt.provider ||
    receipt.resolved?.provider !== receipt.provider ||
    !SCOPES.has(receipt.scope?.kind) ||
    !["exact", "partial", "candidate"].includes(receipt.coverage) ||
    !["current", "stale", "unknown"].includes(receipt.freshness)
  ) {
    throw new Error("SourceReceipt is invalid.");
  }
  text(receipt.sourceDecisionId, 160);
  text(receipt.requested.canonicalId, 1_000);
  text(receipt.resolved.canonicalId, 1_000);
  text(receipt.route, 500);
  text(receipt.operation, 160);
  text(receipt.scope.id, 500);
  text(receipt.observedAt, 100);
  if (!Number.isFinite(Date.parse(receipt.observedAt))) {
    throw new Error("SourceReceipt observation time is invalid.");
  }
  if (!identityMatches(receipt.requested, receipt.resolved)) {
    throw new Error("SourceReceipt resolved identity differs from requested.");
  }
  if (receipt.fallback && !receipt.fallback.identityPreserved) {
    throw new Error("SourceReceipt fallback changed identity.");
  }
  if (receipt.id !== receiptId(receipt)) {
    throw new Error("SourceReceipt ID does not match immutable fields.");
  }
  return receipt;
}

export function assertAgentSourceReceiptMatchesDecision(
  decision: AgentSourceDecision,
  receipt: AgentSourceReceipt,
): void {
  if (
    decision.state !== "confirmed" ||
    decision.id !== receipt.sourceDecisionId ||
    decision.kind !== receipt.provider
  ) {
    throw new Error("SourceReceipt is not bound to the confirmed source.");
  }
  const expected = identityFromReference(decision.kind, decision.reference);
  if (
    !identityMatches(expected, receipt.requested) ||
    !identityMatches(expected, receipt.resolved)
  ) {
    throw new Error("SourceReceipt identity differs from the confirmed source.");
  }
  if (receipt.coverage !== "exact" || receipt.freshness !== "current") {
    throw new Error("SourceReceipt evidence must be exact and current.");
  }
}
