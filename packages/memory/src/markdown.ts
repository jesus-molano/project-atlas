import { createHash } from "node:crypto";
import path from "node:path";
import {
  MEMORY_SCHEMA_VERSION,
  type MemoryAuthority,
  type MemoryItem,
  type MemoryRelation,
  type MemoryRelationKind,
  type MemoryScope,
  type MemoryStatus,
  type MemoryType,
} from "./types.js";

const MEMORY_TYPES = new Set<MemoryType>([
  "project",
  "domain",
  "glossary-term",
  "subsystem",
  "module",
  "convention",
  "decision",
  "constraint",
  "integration",
  "known-issue",
  "fragile-area",
  "attempt",
  "outcome",
  "plan",
  "debt",
  "note",
]);
const STATUSES = new Set<MemoryStatus>([
  "proposed",
  "active",
  "superseded",
  "archived",
  "rejected",
]);
const AUTHORITIES = new Set<MemoryAuthority>([
  "observed",
  "inferred",
  "decided",
  "verified",
]);
const SCOPES = new Set<MemoryScope>(["canonical", "local", "episodic"]);
const RELATION_KINDS = new Set<MemoryRelationKind>([
  "belongs_to",
  "depends_on",
  "implements",
  "affects",
  "decided_by",
  "motivated_by",
  "contradicts",
  "supersedes",
  "verified_by",
  "failed_for",
  "fixed_by",
  "related_to",
  "references_code",
  "references_design",
  "references_ticket",
]);

function scalar(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return trimmed.replace(/^["']|["']$/g, "");
    }
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return trimmed.replace(/^["']|["']$/g, "");
}

function parseFrontmatter(source: string): {
  data: Record<string, unknown>;
  body: string;
} {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error("Project memory Markdown requires YAML frontmatter.");
  }
  const data: Record<string, unknown> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) {
      throw new Error(`Unsupported frontmatter line: ${line}`);
    }
    const key = line.slice(0, separator).trim();
    data[key] = scalar(line.slice(separator + 1));
  }
  return { data, body: (match[2] ?? "").trim() };
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  const item = string(value);
  return item ? item.split(",").map((entry) => entry.trim()).filter(Boolean) : [];
}

function relations(value: unknown): MemoryRelation[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((candidate): MemoryRelation | undefined => {
      if (!candidate || typeof candidate !== "object") return undefined;
      const item = candidate as Record<string, unknown>;
      const kind = string(item.kind) as MemoryRelation["kind"] | undefined;
      const targetId = string(item.targetId);
      const summary = string(item.summary);
      if (!kind || !RELATION_KINDS.has(kind) || !targetId) return undefined;
      return { kind, targetId, ...(summary ? { summary } : {}) };
    })
    .filter((item): item is MemoryRelation => Boolean(item));
}

function stableMemoryId(
  namespace: string,
  type: MemoryType,
  title: string,
): string {
  return `memory:${createHash("sha256")
    .update(`${namespace}\0${type}\0${title.toLowerCase()}`)
    .digest("hex")
    .slice(0, 20)}`;
}

export interface ParseMemoryMarkdownOptions {
  projectId: string;
  projectName: string;
  sourcePath: string;
  defaultScope?: MemoryScope;
  now?: string;
}

export function parseMemoryMarkdown(
  source: string,
  options: ParseMemoryMarkdownOptions,
): MemoryItem {
  const { data, body } = parseFrontmatter(source);
  const type = string(data.type) as MemoryType | undefined;
  const title = string(data.title);
  const summary = string(data.summary);
  if (!type || !MEMORY_TYPES.has(type)) {
    throw new Error(`${options.sourcePath}: missing or invalid memory type.`);
  }
  if (!title || !summary) {
    throw new Error(`${options.sourcePath}: title and summary are required.`);
  }
  const declaredProject = string(data.project);
  if (
    declaredProject &&
    declaredProject !== options.projectId &&
    declaredProject !== options.projectName &&
    declaredProject !== "*"
  ) {
    throw new Error(
      `${options.sourcePath}: memory belongs to project "${declaredProject}", not "${options.projectName}".`,
    );
  }
  const namespace =
    string(data.namespace) ?? options.projectName.toLowerCase().replace(/\s+/g, "-");
  const status = (string(data.status) ?? "active") as MemoryStatus;
  const authority = (string(data.authority) ?? "observed") as MemoryAuthority;
  const scope = (string(data.scope) ??
    options.defaultScope ??
    "canonical") as MemoryScope;
  if (!STATUSES.has(status) || !AUTHORITIES.has(authority) || !SCOPES.has(scope)) {
    throw new Error(`${options.sourcePath}: invalid status, authority, or scope.`);
  }
  const now = options.now ?? new Date().toISOString();
  const confidence =
    typeof data.confidence === "number"
      ? Math.max(0, Math.min(data.confidence, 1))
      : 0.7;
  const owner = string(data.owner);
  const verifiedAt = string(data.verified_at);
  const expiresAt = string(data.expires_at);
  const reviewAfter = string(data.review_after);
  const supersededBy = string(data.superseded_by);
  const createdAt = string(data.created_at) ?? now;
  const updatedAt = string(data.updated_at) ?? createdAt;
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    id: string(data.id) ?? stableMemoryId(namespace, type, title),
    projectId: options.projectId,
    namespace,
    type,
    title,
    summary,
    ...(body ? { body } : {}),
    bodyPath: options.sourcePath.replaceAll(path.sep, "/"),
    status,
    confidence,
    authority,
    scope,
    createdAt,
    updatedAt,
    ...(verifiedAt ? { verifiedAt } : {}),
    ...(owner ? { owner } : {}),
    tags: strings(data.tags),
    provenance: {
      kind: "markdown",
      uri: options.sourcePath.replaceAll(path.sep, "/"),
      evidence: strings(data.evidence),
    },
    supersedes: strings(data.supersedes),
    ...(supersededBy ? { supersededBy } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(reviewAfter ? { reviewAfter } : {}),
    relations: relations(data.relations),
  };
}

function field(name: string, value: unknown): string {
  return `${name}: ${JSON.stringify(value)}`;
}

export function memoryItemMarkdown(item: MemoryItem): string {
  const frontmatter = [
    "---",
    field("id", item.id),
    field("project", item.projectId),
    field("namespace", item.namespace),
    field("type", item.type),
    field("title", item.title),
    field("summary", item.summary),
    field("status", item.status),
    field("confidence", item.confidence),
    field("authority", item.authority),
    field("scope", item.scope),
    field("created_at", item.createdAt),
    field("updated_at", item.updatedAt),
    ...(item.verifiedAt ? [field("verified_at", item.verifiedAt)] : []),
    ...(item.owner ? [field("owner", item.owner)] : []),
    field("tags", item.tags),
    field("supersedes", item.supersedes),
    ...(item.supersededBy
      ? [field("superseded_by", item.supersededBy)]
      : []),
    ...(item.expiresAt ? [field("expires_at", item.expiresAt)] : []),
    ...(item.reviewAfter ? [field("review_after", item.reviewAfter)] : []),
    field("relations", item.relations),
    field("evidence", item.provenance.evidence ?? []),
    "---",
  ];
  const backlinks = item.relations
    .map(
      (relation) =>
        `- ${relation.kind}: [[${relation.targetId}]]${
          relation.summary ? ` — ${relation.summary}` : ""
        }`,
    )
    .join("\n");
  return `${frontmatter.join("\n")}

# ${item.title}

${item.body ?? item.summary}

${backlinks ? `## Relations\n\n${backlinks}\n` : ""}`;
}
