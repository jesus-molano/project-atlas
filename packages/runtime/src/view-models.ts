import type {
  MemoryAuthority,
  MemoryScope,
  MemoryStatus,
  MemoryType,
  ResponseMetrics,
} from "@component-atlas/memory";

/**
 * Provider-neutral contracts for the future Project Atlas GUI.
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
  status: "healthy" | "stale" | "unavailable" | "permission-required" | "error";
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

