export const MEMORY_SCHEMA_VERSION = 1 as const;

export type MemoryType =
  | "project"
  | "domain"
  | "glossary-term"
  | "subsystem"
  | "module"
  | "convention"
  | "decision"
  | "constraint"
  | "integration"
  | "known-issue"
  | "fragile-area"
  | "attempt"
  | "outcome"
  | "plan"
  | "debt"
  | "note";

export type MemoryStatus =
  | "proposed"
  | "active"
  | "superseded"
  | "archived"
  | "rejected";

export type MemoryAuthority =
  | "observed"
  | "inferred"
  | "decided"
  | "verified";

export type MemoryScope = "canonical" | "local" | "episodic";

export type MemoryRelationKind =
  | "belongs_to"
  | "depends_on"
  | "implements"
  | "affects"
  | "decided_by"
  | "motivated_by"
  | "contradicts"
  | "supersedes"
  | "verified_by"
  | "failed_for"
  | "fixed_by"
  | "related_to"
  | "references_code"
  | "references_design"
  | "references_ticket";

export interface MemoryRelation {
  kind: MemoryRelationKind;
  targetId: string;
  summary?: string;
}

export interface MemoryProvenance {
  kind:
    | "markdown"
    | "agent-proposal"
    | "task-outcome"
    | "legacy-decision"
    | "import";
  uri?: string;
  evidence?: string[];
}

export interface MemoryItem {
  schemaVersion: typeof MEMORY_SCHEMA_VERSION;
  id: string;
  projectId: string;
  checkoutId?: string;
  namespace: string;
  type: MemoryType;
  title: string;
  summary: string;
  body?: string;
  bodyPath?: string;
  status: MemoryStatus;
  confidence: number;
  authority: MemoryAuthority;
  scope: MemoryScope;
  createdAt: string;
  updatedAt: string;
  verifiedAt?: string;
  owner?: string;
  tags: string[];
  provenance: MemoryProvenance;
  supersedes: string[];
  supersededBy?: string;
  expiresAt?: string;
  reviewAfter?: string;
  relations: MemoryRelation[];
}

export interface MemoryItemDraft {
  id?: string;
  namespace?: string;
  type: MemoryType;
  title: string;
  summary: string;
  body?: string;
  status?: Exclude<MemoryStatus, "superseded">;
  confidence: number;
  authority: MemoryAuthority;
  scope?: MemoryScope;
  verifiedAt?: string;
  owner?: string;
  tags?: string[];
  provenance?: Partial<MemoryProvenance>;
  supersedes?: string[];
  expiresAt?: string;
  reviewAfter?: string;
  relations?: MemoryRelation[];
}

export interface MemoryFinding {
  id: string;
  level: "decision-required" | "warning" | "resolved";
  code:
    | "memory-contradiction"
    | "duplicate-memory"
    | "failed-attempt"
    | "stale-memory"
    | "superseded-memory"
    | "cold-start"
    | "secret-like-content"
    | "low-impact-default";
  title: string;
  evidence: string[];
  recommendation: string;
  question?: string;
  memoryIds?: string[];
}

export interface MemoryProposal {
  schemaVersion: typeof MEMORY_SCHEMA_VERSION;
  id: string;
  projectId: string;
  createdAt: string;
  status: "pending" | "applied" | "rejected";
  rationale: string;
  evidence: string[];
  proposedBy?: string;
  items: MemoryItemDraft[];
  findings: MemoryFinding[];
  appliedAt?: string;
  appliedItemIds?: string[];
  rejectedAt?: string;
  rejectionReason?: string;
}

export type MemoryWriteTarget = "local" | "canonical";

export interface MemoryProposalReviewItem {
  id: string;
  type: MemoryType;
  title: string;
  scope: MemoryScope;
  path: string;
  supersedes: string[];
}

export interface MemoryProposalReview {
  schemaVersion: typeof MEMORY_SCHEMA_VERSION;
  proposalId: string;
  proposalStatus: MemoryProposal["status"];
  target: MemoryWriteTarget;
  canApply: boolean;
  requiresCanonicalConfirmation: boolean;
  gate: {
    status: "clear" | "review" | "blocked";
    blockingFindingIds: string[];
    warningFindingIds: string[];
  };
  impact: {
    directory: ".component-atlas/memory" | "project-memory";
    itemCount: number;
    supersededIds: string[];
    items: MemoryProposalReviewItem[];
  };
}

export interface MemorySearchOptions {
  types?: MemoryType[];
  statuses?: MemoryStatus[];
  tags?: string[];
  limit?: number;
  cursor?: string;
  budgetChars?: number;
  includeInactive?: boolean;
}

export interface MemorySearchHit {
  id: string;
  type: MemoryType;
  title: string;
  summary: string;
  status: MemoryStatus;
  authority: MemoryAuthority;
  confidence: number;
  scope: MemoryScope;
  updatedAt: string;
  reviewAfter?: string;
  tags: string[];
  score: number;
  reasons: string[];
  expandable: true;
}

export interface ResponseMetrics {
  budgetChars: number;
  usedChars: number;
  estimatedTokens: number;
  truncated: boolean;
  totalMatches: number;
  nextCursor?: string;
  expandableIds: string[];
  retrieval?: {
    indexedBytesInjected: 0;
    hits: number;
    misses: number;
    retries: number;
    connectorsQueried: string[];
    receiptsExpanded: number;
  };
}
