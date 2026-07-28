export const GRAPH_SCHEMA_VERSION = 3 as const;

export type Framework = "vue" | "react";
export type ComponentVisibility = "public" | "feature" | "private";
export type EdgeKind = "renders" | "tested_by" | "similar_to";
export type DecisionKind =
  | "reuse"
  | "extend"
  | "compose"
  | "extract-and-reuse"
  | "create";
export type DesignTokenKind =
  | "color"
  | "space"
  | "radius"
  | "typography"
  | "shadow"
  | "other";

export interface SourceLocation {
  line: number;
  column: number;
}

export interface ComponentProp {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
}

export interface ComponentEvent {
  name: string;
  payload?: string;
}

export interface ComponentNode {
  id: string;
  framework: Framework;
  kind?: "component" | "route" | "layout";
  name: string;
  effectiveName: string;
  sourcePath: string;
  relativePath: string;
  visibility: ComponentVisibility;
  feature?: string;
  exported: boolean;
  location: SourceLocation;
  props: ComponentProp[];
  events: ComponentEvent[];
  slots: string[];
  models: string[];
  renderedNames: string[];
  imports: string[];
  testPaths: string[];
  classTokens: string[];
  sourceHash: string;
}

export interface DesignToken {
  name: string;
  value: string;
  kind: DesignTokenKind;
  sourcePath: string;
}

export interface SimilarityEvidence {
  score: number;
  reasons: string[];
  sharedProps: string[];
  sharedRenderedComponents: string[];
  sharedClassTokens: string[];
}

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  source: string;
  target: string;
  evidence?: SimilarityEvidence;
}

export interface ProjectMetadata {
  id: string;
  name: string;
  rootPath: string;
  framework: Framework;
  packageManager?: string;
  scannedAt: string;
  sourceFiles: number;
  identity?: ProjectIdentityMetadata;
  scan?: ProjectScanSummary;
}

export type ProjectIdentitySource =
  | "override"
  | "remote"
  | "git-common-dir"
  | "path";

export interface ProjectIdentityMetadata {
  logicalId: string;
  repositoryFingerprint: string;
  source: ProjectIdentitySource;
  checkoutId: string;
  worktreePath: string;
  branch?: string;
  head?: string;
}

export interface ProjectScanSummary {
  mode: "full" | "incremental" | "unchanged";
  fingerprint: string;
  checkedAt: string;
  changedFiles: number;
  durationMs: number;
}

export interface ProjectScanState {
  schemaVersion: 1;
  projectId: string;
  checkoutId: string;
  framework: Framework;
  head?: string;
  configurationFingerprint: string;
  files: Record<string, string>;
  completedAt: string;
}

export type CapabilityState =
  | "connected"
  | "detected"
  | "unavailable"
  | "not-exposed"
  | "permission-required"
  | "unknown"
  | "degraded";

export type ConnectorKind = "figma" | "atlassian-rovo" | "github";
export type EnrichmentKind =
  | "ready-for-dev"
  | "figma-variables"
  | "code-connect"
  | "figma-libraries";

export interface CapabilityObservation {
  id: ConnectorKind | EnrichmentKind;
  kind: "connector" | "enrichment";
  state: CapabilityState;
  provenance: "session-report" | "design-index" | "local-index";
  checkedAt: string;
  detail?: string;
}

export interface ProjectCapabilityReport {
  schemaVersion: 1;
  projectId: string;
  checkedAt: string;
  observations: CapabilityObservation[];
}

export interface TaskEvaluationRecord {
  schemaVersion: 1;
  id: string;
  projectId: string;
  recordedAt: string;
  taskFingerprint: string;
  topThreeCorrect?: boolean;
  falseDuplicateCount: number;
  necessaryQuestions: number;
  unnecessaryQuestions: number;
  contextChars: number;
  preparationMs: number;
  conflictCount: number;
  reworkRequired: boolean;
}

export interface AgentRunAuditRecord {
  schemaVersion: 1;
  id: string;
  projectId: string;
  checkoutId?: string;
  startedAt: string;
  updatedAt: string;
  mode: "prepare" | "implement" | "continue" | "correct";
  state:
    | "queued"
    | "running"
    | "awaiting-input"
    | "completed"
    | "failed"
    | "cancelled";
  sourceKinds: Array<"jira" | "confluence" | "figma" | "github" | "other">;
  sourceDecisions?: {
    confirmed: number;
    omitted: number;
    unavailable: number;
    replaced: number;
  };
  selectedKinds: Array<"code" | "design" | "memory">;
  sandbox: "read-only" | "workspace-write";
  budgetChars: number;
  contextChars: number;
  estimatedTokens: number;
  truncated: boolean;
  eventCount: number;
  questionCount: number;
  stale: boolean;
  resultStatus?: "completed" | "needs-input";
}

export interface ComponentGraph {
  schemaVersion: typeof GRAPH_SCHEMA_VERSION;
  project: ProjectMetadata;
  components: ComponentNode[];
  edges: GraphEdge[];
  tokens: DesignToken[];
}

export interface ComponentSearchResult {
  component: ComponentNode;
  score: number;
  reasons: string[];
}

export interface ComponentContextReference {
  id: string;
  name: string;
  path: string;
  scope: ComponentVisibility;
  owner?: string;
}

export interface ComponentContextLink {
  id: string;
  name: string;
  scope: ComponentVisibility;
}

export interface CompactComponentSearchResult {
  component: ComponentContextReference;
  score: number;
  reasons: string[];
}

export interface ReuseContextCandidate {
  rank: number;
  component: ComponentContextReference;
  match: {
    reasons: string[];
  };
  api: {
    props: ComponentProp[];
    totalProps: number;
    events: ComponentEvent[];
    totalEvents: number;
    slots: string[];
    models: string[];
  };
  relations: {
    renders: ComponentContextLink[];
    renderedBy: ComponentContextLink[];
    similar: Array<{
      component: ComponentContextLink;
      score: number;
      reasons: string[];
    }>;
  };
  impact: {
    directConsumers: number;
    transitiveConsumers: number;
    direct: ComponentContextLink[];
  };
  tests: string[];
}

export interface ReuseContextBundle {
  schemaVersion: 1;
  intent: string;
  project: {
    name: string;
    framework: Framework;
    scannedAt: string;
  };
  index: {
    components: number;
    shared: number;
    feature: number;
    internal: number;
  };
  scopeLegend: Record<ComponentVisibility, string>;
  candidates: ReuseContextCandidate[];
  nextActions: string[];
}

export interface ComponentContextBundle {
  schemaVersion: 1;
  project: {
    name: string;
    framework: Framework;
    scannedAt: string;
  };
  component: ComponentContextReference;
  api: ReuseContextCandidate["api"];
  relations: ReuseContextCandidate["relations"];
  impact: ReuseContextCandidate["impact"];
  tests: string[];
  guidance: string[];
}

export interface ComponentImpactContext {
  component: ComponentContextReference;
  api: ReuseContextCandidate["api"];
  tests: string[];
  risk: "contained" | "moderate" | "high";
  directConsumers: number;
  transitiveConsumers: number;
  direct: ComponentContextLink[];
  transitive: ComponentContextLink[];
}

export interface ComponentSimilarityContext {
  component: ComponentContextReference;
  candidates: Array<{
    component: ComponentContextReference;
    score: number;
    reasons: string[];
  }>;
}

export interface ComponentDecision {
  id: string;
  projectId: string;
  createdAt: string;
  intent: string;
  decision: DecisionKind;
  selectedComponentIds: string[];
  rejectedComponentIds: string[];
  rationale: string;
  author?: string;
  scope?: "project" | "checkout";
  checkoutId?: string;
  provenance?: AtlasProvenance;
}

export interface ProjectComponentCatalogEntry {
  schemaVersion: 1;
  projectId: string;
  semanticKey: string;
  framework: Framework;
  name: string;
  effectiveName: string;
  relativePath: string;
  observedAt: string;
  sightings: Array<{
    checkoutId: string;
    componentId: string;
    sourceHash: string;
    visibility: ComponentVisibility;
    observedAt: string;
  }>;
  divergent: boolean;
  provenance: AtlasProvenance;
}

export interface ScanOptions {
  rootPath: string;
  include?: string[];
  exclude?: string[];
}

export interface FrameworkAdapter {
  framework: Framework;
  scan(options: ScanOptions): Promise<ComponentNode[]>;
}
import type { AtlasProvenance } from "./task-intake.js";
