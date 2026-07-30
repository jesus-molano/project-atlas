import type {
  MemoryItem,
  MemoryProposal,
  MemoryAuthority,
  MemoryScope,
  MemoryStatus,
  MemoryType,
  ResponseMetrics,
} from "@component-atlas/memory";
import { rankMemoryItems } from "@component-atlas/memory";
import {
  searchComponentContext,
  type ComponentDecision,
  type ComponentGraph,
} from "@component-atlas/core";
import {
  designIndexSummary,
  rankDesignCandidates,
  type DesignFileIndex,
} from "@component-atlas/design";

/**
 * Provider-neutral contracts shared by the Project Atlas GUI, CLI, and MCP.
 *
 * These are intentionally view models, not a second persistence model. A local
 * API can compose them from the same runtime functions used by CLI and MCP.
 */
export type ProjectAtlasSection =
  | "overview"
  | "code"
  | "design"
  | "memory"
  | "decisions-risks"
  | "task-context"
  | "memory-inbox"
  | "integrations-health"
  | "settings";

export interface ProvenanceViewModel {
  source: "repository" | "figma" | "markdown" | "agent" | "task" | "legacy";
  label: string;
  uri?: string;
  updatedAt?: string;
  verifiedAt?: string;
  stale: boolean;
}

export interface ProjectAtlasEnvelope<T> {
  schemaVersion: 1;
  projectId: string;
  projectName: string;
  generatedAt: string;
  section: ProjectAtlasSection;
  data: T;
  provenance: ProvenanceViewModel[];
}

export interface ContextInspectorItem {
  id: string;
  source: "code" | "design" | "memory" | "task";
  label: string;
  included: boolean;
  estimatedChars: number;
  estimatedTokens: number;
  truncationPriority: number;
}

export interface ContextInspectorViewModel {
  budgetChars: number;
  estimatedChars: number;
  estimatedTokens: number;
  hardCapReached: boolean;
  items: ContextInspectorItem[];
  willTruncate: string[];
  metrics?: ResponseMetrics;
}

export interface SourceHealthViewModel {
  id: string;
  source: "repository" | "figma" | "jira" | "confluence" | "memory";
  label: string;
  status:
    | "healthy"
    | "stale"
    | "degraded"
    | "unavailable"
    | "permission-required"
    | "error";
  lastIndexedAt?: string;
  detail?: string;
  refreshAvailable: boolean;
}

export interface ProjectOverviewViewModel {
  project: {
    id: string;
    name: string;
    framework: string;
    rootPath: string;
  };
  counts: {
    components: number;
    designNodes: number;
    memoryItems: number;
    currentDecisions: number;
    pendingMemoryProposals: number;
    warnings: number;
  };
  sources: SourceHealthViewModel[];
  recentChanges: Array<{
    id: string;
    label: string;
    source: SourceHealthViewModel["source"];
    occurredAt: string;
  }>;
  attention: Array<{
    id: string;
    severity: "decision-required" | "warning" | "info";
    source: "code" | "design" | "memory" | "integration";
    title: string;
    detail: string;
    recommendation: string;
    targetId?: string;
  }>;
}

export interface MemoryListItemViewModel {
  id: string;
  type: MemoryType;
  title: string;
  summary: string;
  status: MemoryStatus;
  authority: MemoryAuthority;
  scope: MemoryScope;
  confidence: number;
  updatedAt: string;
  reviewAfter?: string;
  provenance: ProvenanceViewModel[];
}

export interface MemoryProposalViewModel {
  id: string;
  status: "pending" | "applied" | "rejected";
  rationale: string;
  createdAt: string;
  evidence: string[];
  items: MemoryListItemViewModel[];
  conflicts: Array<{
    existingId: string;
    proposedId: string;
    recommendation: string;
  }>;
}

export interface ProjectSearchResultViewModel {
  id: string;
  source: "code" | "design" | "memory";
  kind: string;
  title: string;
  subtitle: string;
  status?: string;
  confidence?: number;
  score: number;
  reasons: string[];
  target: {
    section: "code" | "design" | "memory";
    id: string;
  };
  provenance: ProvenanceViewModel[];
}

export interface ProjectSearchViewModel {
  query: string;
  totalMatches: number;
  results: ProjectSearchResultViewModel[];
  counts: {
    code: number;
    design: number;
    memory: number;
  };
}

export interface ProjectAtlasSnapshot {
  fingerprint: string;
  capturedAt: string;
  graph: ComponentGraph;
  designIndexes: DesignFileIndex[];
  memoryItems: MemoryItem[];
  memoryProposals: MemoryProposal[];
  componentDecisions: ComponentDecision[];
}

function ageInDays(value: string | undefined, now: Date): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, (now.getTime() - timestamp) / 86_400_000);
}

function sourceFreshness(
  value: string | undefined,
  staleAfterDays: number,
  now: Date,
): "healthy" | "stale" {
  const days = ageInDays(value, now);
  return days !== undefined && days > staleAfterDays ? "stale" : "healthy";
}

function uniqueContradictions(items: MemoryItem[]) {
  const active = new Set(
    items.filter((item) => item.status === "active").map((item) => item.id),
  );
  const pairs = new Set<string>();
  for (const item of items) {
    if (!active.has(item.id)) continue;
    for (const relation of item.relations) {
      if (relation.kind !== "contradicts" || !active.has(relation.targetId)) {
        continue;
      }
      pairs.add([item.id, relation.targetId].sort().join("::"));
    }
  }
  return [...pairs];
}

export function buildProjectOverviewViewModel(
  snapshot: ProjectAtlasSnapshot,
  generatedAt = new Date().toISOString(),
): ProjectAtlasEnvelope<ProjectOverviewViewModel> {
  const now = new Date(generatedAt);
  const {
    graph,
    designIndexes,
    memoryItems,
    memoryProposals,
    componentDecisions,
  } = snapshot;
  const pendingProposals = memoryProposals.filter(
    (proposal) => proposal.status === "pending",
  );
  const designNodes = designIndexes.reduce(
    (total, index) => total + index.nodes.length,
    0,
  );
  const contradictions = uniqueContradictions(memoryItems);
  const staleMemory = memoryItems.filter(
    (item) =>
      item.status === "active" &&
      item.reviewAfter &&
      item.reviewAfter < generatedAt,
  );
  const fragileMemory = memoryItems.filter(
    (item) =>
      item.status === "active" &&
      (item.type === "fragile-area" ||
        item.type === "known-issue" ||
        ((item.type === "attempt" || item.type === "outcome") &&
          item.tags.includes("failed"))),
  );
  const designFindings = designIndexes.flatMap((index) =>
    designIndexSummary(index).findings.map((finding) => ({
      ...finding,
      fileKey: index.file.key,
      fileName: index.file.name ?? index.file.key,
    })),
  );
  const openDesignFindings = designFindings.filter(
    (finding) => finding.level !== "resolved",
  );
  const warnings =
    contradictions.length +
    staleMemory.length +
    fragileMemory.length +
    openDesignFindings.length;
  const latestDesign = designIndexes
    .map((index) => index.indexedAt)
    .sort()
    .at(-1);
  const latestMemory = memoryItems
    .map((item) => item.updatedAt)
    .sort()
    .at(-1);
  const sources: SourceHealthViewModel[] = [
    {
      id: "repository",
      source: "repository",
      label: "Repository index",
      status: graph.project.scan?.coverage?.errorFiles
        ? "error"
        : graph.project.scan?.coverage &&
            !graph.project.scan.coverage.complete
          ? "degraded"
          : sourceFreshness(graph.project.scannedAt, 1, now),
      lastIndexedAt: graph.project.scannedAt,
      detail: `${graph.components.length} code nodes · ${graph.edges.length} relations`,
      refreshAvailable: true,
    },
    designIndexes.length
      ? {
          id: "figma",
          source: "figma",
          label: "Design Index",
          status: sourceFreshness(latestDesign, 7, now),
          ...(latestDesign ? { lastIndexedAt: latestDesign } : {}),
          detail: `${designIndexes.length} files · ${designNodes} indexed nodes`,
          refreshAvailable: true,
        }
      : {
          id: "figma",
          source: "figma",
          label: "Design Index",
          status: "unavailable",
          detail: "No Figma metadata mapped for this project",
          refreshAvailable: true,
        },
    {
      id: "memory",
      source: "memory",
      label: "Project Memory",
      status:
        memoryItems.length === 0
          ? "healthy"
          : sourceFreshness(latestMemory, 30, now),
      ...(latestMemory ? { lastIndexedAt: latestMemory } : {}),
      detail:
        memoryItems.length === 0
          ? "Cold start · no declared memory yet"
          : `${memoryItems.length} items · ${pendingProposals.length} pending proposals`,
      refreshAvailable: true,
    },
  ];
  const recentChanges = [
    {
      id: `repository:${graph.project.scannedAt}`,
      label: "Repository graph indexed",
      source: "repository" as const,
      occurredAt: graph.project.scannedAt,
    },
    ...designIndexes.map((index) => ({
      id: `figma:${index.file.key}:${index.indexedAt}`,
      label: `${index.file.name ?? index.file.key} design metadata indexed`,
      source: "figma" as const,
      occurredAt: index.indexedAt,
    })),
    ...memoryItems.slice(0, 8).map((item) => ({
      id: `memory:${item.id}:${item.updatedAt}`,
      label: `${item.type}: ${item.title}`,
      source: "memory" as const,
      occurredAt: item.updatedAt,
    })),
    ...componentDecisions.slice(0, 8).map((decision) => ({
      id: `decision:${decision.id}:${decision.createdAt}`,
      label: `${decision.decision}: ${decision.intent}`,
      source: "repository" as const,
      occurredAt: decision.createdAt,
    })),
  ]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 8);
  const attention: ProjectOverviewViewModel["attention"] = [
    ...contradictions.slice(0, 3).map((pair) => ({
      id: `contradiction:${pair}`,
      severity: "decision-required" as const,
      source: "memory" as const,
      title: "Active project rules contradict each other",
      detail: pair.replace("::", " ↔ "),
      recommendation:
        "Review the evidence and supersede the rule that is no longer authoritative.",
    })),
    ...pendingProposals.slice(0, 3).map((proposal) => ({
      id: proposal.id,
      severity: "info" as const,
      source: "memory" as const,
      title: "Memory proposal awaiting review",
      detail: proposal.rationale,
      recommendation:
        "Inspect its evidence and diff before approving, editing, or rejecting it.",
      targetId: proposal.id,
    })),
    ...openDesignFindings.slice(0, 3).map((finding) => ({
      id: `design:${finding.fileKey}:${finding.id}`,
      severity:
        finding.level === "decision-required"
          ? ("decision-required" as const)
          : ("warning" as const),
      source: "design" as const,
      title: finding.title,
      detail: finding.evidence.slice(0, 2).join(" "),
      recommendation: finding.recommendation,
      ...(finding.nodeIds?.[0] ? { targetId: finding.nodeIds[0] } : {}),
    })),
    ...fragileMemory.slice(0, 3).map((item) => ({
      id: `fragile:${item.id}`,
      severity: "warning" as const,
      source: "memory" as const,
      title: item.title,
      detail: item.summary,
      recommendation:
        "Check the linked evidence before changing this area.",
      targetId: item.id,
    })),
    ...staleMemory.slice(0, 3).map((item) => ({
      id: `stale:${item.id}`,
      severity: "warning" as const,
      source: "memory" as const,
      title: `Review stale knowledge: ${item.title}`,
      detail: item.summary,
      recommendation:
        "Verify it against current code or product evidence before relying on it.",
      targetId: item.id,
    })),
  ].slice(0, 8);
  const provenance: ProvenanceViewModel[] = [
    {
      source: "repository",
      label: graph.project.rootPath,
      updatedAt: graph.project.scannedAt,
      stale: sources[0]!.status === "stale",
    },
    ...designIndexes.slice(0, 4).map((index) => ({
      source: "figma" as const,
      label: index.file.name ?? index.file.key,
      uri: index.file.url,
      updatedAt: index.indexedAt,
      stale:
        sourceFreshness(index.indexedAt, 7, now) === "stale",
    })),
  ];
  return {
    schemaVersion: 1,
    projectId: graph.project.id,
    projectName: graph.project.name,
    generatedAt,
    section: "overview",
    data: {
      project: {
        id: graph.project.id,
        name: graph.project.name,
        framework: graph.project.framework,
        rootPath: graph.project.rootPath,
      },
      counts: {
        components: graph.components.filter(
          (component) => (component.kind ?? "component") === "component",
        ).length,
        designNodes,
        memoryItems: memoryItems.length,
        currentDecisions:
          componentDecisions.length +
          memoryItems.filter(
            (item) =>
              item.status === "active" &&
              ["decision", "constraint", "convention"].includes(item.type),
          ).length,
        pendingMemoryProposals: pendingProposals.length,
        warnings,
      },
      sources,
      recentChanges,
      attention,
    },
    provenance,
  };
}

export function buildProjectSearchViewModel(
  snapshot: ProjectAtlasSnapshot,
  query: string,
  limitPerSource = 5,
): ProjectSearchViewModel {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return {
      query: "",
      totalMatches: 0,
      results: [],
      counts: { code: 0, design: 0, memory: 0 },
    };
  }
  const codeCandidates = searchComponentContext(
    snapshot.graph,
    normalizedQuery,
    limitPerSource,
  );
  const componentCode: ProjectSearchResultViewModel[] = codeCandidates.map(
    (candidate) => ({
      id: candidate.component.id,
      source: "code",
      kind: candidate.component.scope,
      title: candidate.component.name,
      subtitle: candidate.component.path,
      score: candidate.score,
      reasons: candidate.reasons.slice(0, 3),
      target: { section: "code", id: candidate.component.id },
      provenance: [
        {
          source: "repository",
          label: candidate.component.path,
          updatedAt: snapshot.graph.project.scannedAt,
          stale: false,
        },
      ],
    }),
  );
  const loweredQuery = normalizedQuery.toLowerCase();
  const entityCode: ProjectSearchResultViewModel[] = (snapshot.graph.entities ?? [])
    .map((entity) => {
      const endpoint = [
        entity.endpoint?.method,
        entity.endpoint?.path,
        entity.endpoint?.operationId,
      ]
        .filter(Boolean)
        .join(" ");
      const reasons = [
        entity.name.toLowerCase() === loweredQuery ? "exact name" : undefined,
        entity.relativePath.toLowerCase() === loweredQuery ||
        entity.relativePath.split("/").at(-1)?.toLowerCase() === loweredQuery
          ? "exact path"
          : undefined,
        entity.name.toLowerCase().includes(loweredQuery) ? "name" : undefined,
        entity.relativePath.toLowerCase().includes(loweredQuery)
          ? "path"
          : undefined,
        endpoint.toLowerCase().includes(loweredQuery) ? "endpoint" : undefined,
      ].filter((reason): reason is string => Boolean(reason));
      const score =
        (reasons.includes("exact path") ? 102 : 0) +
        (reasons.includes("exact name") ? 100 : 0) +
        (reasons.includes("name") ? 12 : 0) +
        (reasons.includes("path") ? 8 : 0) +
        (reasons.includes("endpoint") ? 6 : 0);
      return {
        entity,
        reasons,
        score,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.entity.relativePath.localeCompare(right.entity.relativePath),
    )
    .map(({ entity, reasons, score }) => ({
      id: entity.id,
      source: "code" as const,
      kind: entity.kind,
      title: entity.name,
      subtitle: entity.relativePath,
      score,
      reasons: reasons.slice(0, 3),
      target: { section: "code" as const, id: entity.id },
      provenance: [
        {
          source: "repository" as const,
          label: entity.relativePath,
          updatedAt: snapshot.graph.project.scannedAt,
          stale: false,
        },
      ],
    }));
  const code = [...componentCode, ...entityCode]
    .sort(
      (left, right) =>
        right.score - left.score || left.title.localeCompare(right.title),
    )
    .slice(0, limitPerSource);
  const codeSignals = code.map((result) => result.title);
  const design: ProjectSearchResultViewModel[] = snapshot.designIndexes
    .flatMap((index) =>
      rankDesignCandidates(index, normalizedQuery, {
        limit: limitPerSource,
        codeSignals,
      }).candidates.map((candidate) => ({
        id: `${index.file.key}:${candidate.node.id}`,
        source: "design" as const,
        kind: candidate.node.type,
        title: candidate.node.name,
        subtitle: candidate.node.path,
        status: candidate.node.status,
        confidence:
          candidate.confidence === "high"
            ? 0.9
            : candidate.confidence === "medium"
              ? 0.65
              : 0.4,
        score: candidate.score,
        reasons: candidate.reasons.slice(0, 3),
        target: {
          section: "design" as const,
          id: `${index.file.key}::${candidate.node.id}`,
        },
        provenance: [
          {
            source: "figma" as const,
            label: index.file.name ?? index.file.key,
            uri: candidate.node.url,
            updatedAt: index.indexedAt,
            stale: false,
          },
        ],
      })),
    )
    .sort((left, right) => right.score - left.score)
    .slice(0, limitPerSource);
  const memory: ProjectSearchResultViewModel[] = rankMemoryItems(
    snapshot.memoryItems,
    normalizedQuery,
    { includeInactive: true },
  )
    .slice(0, limitPerSource)
    .map(({ item, score, reasons }) => ({
      id: item.id,
      source: "memory",
      kind: item.type,
      title: item.title,
      subtitle: item.summary,
      status: item.status,
      confidence: item.confidence,
      score,
      reasons: reasons.slice(0, 3),
      target: { section: "memory", id: item.id },
      provenance: [
        {
          source:
            item.provenance.kind === "task-outcome" ? "task" : "markdown",
          label: item.bodyPath ?? item.provenance.kind,
          updatedAt: item.updatedAt,
          stale: Boolean(item.reviewAfter && item.reviewAfter < new Date().toISOString()),
          ...(item.provenance.uri ? { uri: item.provenance.uri } : {}),
          ...(item.verifiedAt ? { verifiedAt: item.verifiedAt } : {}),
        },
      ],
    }));
  const results = [...code, ...design, ...memory];
  return {
    query: normalizedQuery,
    totalMatches: results.length,
    results,
    counts: {
      code: code.length,
      design: design.length,
      memory: memory.length,
    },
  };
}
