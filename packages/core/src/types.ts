import type { ScanSafetySession } from "./scan-safety.js";
import type { AtlasProvenance } from "./task-intake.js";

export const GRAPH_SCHEMA_VERSION = 5 as const;

export type Framework = "vue" | "react" | "astro";
export type MetaFramework = "next" | "nuxt" | "astro";
export type RouterMode = "pages" | "app" | "hybrid" | "vue-router" | "astro";
export type ComponentVisibility = "public" | "feature" | "private";
export type ComponentKind = "component" | "route" | "layout" | "special";
export type ComponentRuntime =
  | "universal"
  | "server"
  | "client"
  | "static"
  | "island-client"
  | "island-server";
export type EdgeKind =
  | "renders"
  | "tested_by"
  | "similar_to"
  | "uses_layout"
  | "route_parent"
  | "hydrates"
  | "defers"
  | "uses_composable"
  | "uses_store"
  | "calls_endpoint"
  | "demonstrated_by"
  | "uses_token"
  | "maps_to_design";
export type DecisionKind =
  | "reuse"
  | "extend"
  | "compose"
  | "extract-and-reuse"
  | "create"
  | "not-applicable";
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

export interface ComponentImportBinding {
  local: string;
  imported: string;
  specifier: string;
  resolvedPath?: string;
  dynamic?: boolean;
}

export interface ComponentRenderReference {
  name: string;
  importedLocal?: string;
  directive?: string;
}

export interface ComponentSlotContract {
  name: string;
  props: string[];
}

export interface ComponentNode {
  id: string;
  framework: Framework;
  kind?: ComponentKind;
  role?: string;
  runtime?: ComponentRuntime;
  routePath?: string;
  name: string;
  effectiveName: string;
  sourcePath: string;
  relativePath: string;
  visibility: ComponentVisibility;
  feature?: string;
  exported: boolean;
  exportName?: string;
  location: SourceLocation;
  props: ComponentProp[];
  events: ComponentEvent[];
  slots: string[];
  models: string[];
  renderedNames: string[];
  renderReferences?: ComponentRenderReference[];
  imports: string[];
  importBindings?: ComponentImportBinding[];
  logicDependencies?: string[];
  slotContracts?: ComponentSlotContract[];
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
  resolution?: "exact" | "framework-convention" | "inferred";
  provenance?: {
    sourcePath: string;
    symbol?: string;
  };
}

export interface ProjectPackageProfile {
  rootPath: string;
  relativeRoot: string;
  name: string;
  frameworks: Framework[];
  primaryFramework: Framework;
  metaFramework?: MetaFramework;
  router?: RouterMode;
  versions: Partial<Record<Framework | MetaFramework, string>>;
  confidence: "high" | "medium" | "low";
  evidence: string[];
}

export interface ProjectProfile {
  primaryFramework: Framework;
  frameworks: Framework[];
  packages: ProjectPackageProfile[];
  confidence: "high" | "medium" | "low";
  diagnostics: string[];
}

export interface ScanDiagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  path?: string;
  framework?: Framework;
}

export interface ScanCoverage {
  candidateFiles: number;
  parsedFiles: number;
  skippedFiles: number;
  errorFiles: number;
  diagnostics: ScanDiagnostic[];
  byFramework: Partial<
    Record<
      Framework,
      {
        candidateFiles: number;
        parsedFiles: number;
        skippedFiles: number;
        errorFiles: number;
      }
    >
  >;
  complete: boolean;
}

export interface ProjectMetadata {
  id: string;
  name: string;
  rootPath: string;
  framework: Framework;
  packageManager?: string;
  scannedAt: string;
  sourceFiles: number;
  profile?: ProjectProfile;
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
  coverage?: ScanCoverage;
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

export type FrontendEntityKind =
  | "module"
  | "service"
  | "composable"
  | "store"
  | "endpoint"
  | "story"
  | "test";

export interface FrontendEntity {
  id: string;
  kind: FrontendEntityKind;
  framework: Framework;
  name: string;
  sourcePath: string;
  relativePath: string;
  exported: boolean;
  exportName?: string;
  location: SourceLocation;
  sourceHash: string;
  resolution: "exact" | "framework-convention" | "inferred";
  provenance: {
    sourcePath: string;
    symbol?: string;
    analyzer:
      | "typescript-program"
      | "vue-compiler"
      | "astro-compiler"
      | "framework-convention"
      | "heuristic";
  };
  endpoint?: {
    client: "$fetch" | "useFetch" | "fetch" | "axios" | "generated-client";
    method?: string;
    path?: string;
    operationId?: string;
    openApiStatus?: "confirmed" | "unresolved" | "ambiguous";
  };
}

export interface ProjectThemeFingerprint {
  schemaVersion: 1;
  generatedAt: string;
  hash: string;
  confidence: "high" | "medium" | "low";
  coverage: {
    styleFiles: number;
    tokenCount: number;
    componentCount: number;
    figmaVariables: number;
  };
  values: {
    colors: string[];
    typography: string[];
    spacing: string[];
    radii: string[];
    shadows: string[];
    breakpoints: string[];
  };
  primitives: Array<{ name: string; uses: number; variants: string[] }>;
  patterns: {
    forms: string[];
    interactiveStates: string[];
    responsive: string[];
  };
  representativeSurfaces: Array<{
    componentId: string;
    routePath?: string;
    relativePath: string;
  }>;
  provenance: Array<{
    kind: "css" | "tailwind" | "component" | "figma-variable";
    source: string;
    hash: string;
    receiptId?: string;
  }>;
}

export type ContextCostTaskType = "small" | "frontend" | "complex";
export type ContextCostTokenSource = "sdk" | "character-fallback";

export interface ContextCostAuditRecord {
  schemaVersion: 1;
  id: string;
  projectId: string;
  checkoutId?: string;
  recordedAt: string;
  taskFingerprint: string;
  taskType: ContextCostTaskType;
  mode: "prepare" | "implement" | "continue" | "correct" | "benchmark";
  contract: {
    mcpToolCount: number;
    mcpDescriptionChars: number;
    mcpSchemaChars: number;
    mcpSerializedChars: number;
    mcpContractHash: string;
    skillChars: number;
    skillReferenceChars: number;
    skillManifestHash: string;
    measurement: "exact" | "declared-estimate" | "unavailable";
  };
  context: {
    promptChars: number;
    compactContextChars: number;
    capsuleBytes: number;
    manifestBytes: number;
    receiptCount: number;
    receiptBytes: number;
    delegationInputChars: number;
    delegationOutputChars: number;
  };
  interaction: {
    questionCount: number;
    retryCount: number;
    truncated: boolean;
    completed: boolean;
    reworkRequired: boolean;
    runId?: string;
    terminalState?: "completed" | "failed" | "cancelled" | "awaiting-input";
  };
  tokens: {
    source: ContextCostTokenSource;
    input: number;
    cachedInput: number;
    output: number;
    estimated: number;
  };
}

export interface ContextCostDistribution {
  count: number;
  median: number;
  p95: number;
}

export interface ContextCostReportGroup {
  taskType: ContextCostTaskType | "all";
  runs: number;
  sdkRuns: number;
  estimatedRuns: number;
  inputTokens: ContextCostDistribution;
  cachedInputTokens: ContextCostDistribution;
  outputTokens: ContextCostDistribution;
  promptChars: ContextCostDistribution;
  compactContextChars: ContextCostDistribution;
  questions: ContextCostDistribution;
  retries: ContextCostDistribution;
  completionRate: number;
}

export interface ContextCostReport {
  schemaVersion: 1;
  projectId: string;
  generatedAt: string;
  groups: ContextCostReportGroup[];
}

export interface PortableContextCostRecord
  extends Omit<ContextCostAuditRecord, "id" | "projectId" | "checkoutId"> {
  sourceId: string;
}

export interface ContextCostExportBundle {
  schemaVersion: 1;
  exportedAt: string;
  sourceFingerprint: string;
  records: PortableContextCostRecord[];
}

export type UsageTraceSource =
  | "codex-otel"
  | "codex-jsonl"
  | "character-estimate";

export type UsageTraceState =
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export interface UsageTraceV2 {
  schemaVersion: 2;
  id: string;
  projectId: string;
  checkoutId?: string;
  sessionIdHash: string;
  startedAt: string;
  updatedAt: string;
  model?: string;
  source: UsageTraceSource;
  exactTotals: boolean;
  state: UsageTraceState;
  tokens: {
    input: number;
    cachedInput: number;
    output: number;
    reasoning: number;
    total: number;
  };
  interaction: {
    turns: number;
    toolCalls: number;
    errors: number;
    durationMs: number;
    compactions: {
      manual: number;
      automatic: number;
    };
  };
  atlas: {
    contractTokens: number;
    skillTokens: number;
    contextTokens: number;
    responseTokens: number;
    totalTokens: number;
    estimated: true;
  };
  privacy: {
    promptsStored: false;
    codeStored: false;
    toolPayloadsStored: false;
  };
  legacy?: {
    incomplete: true;
    sourceSchemaVersion: 1;
  };
}

export interface PortableUsageTraceV2
  extends Omit<UsageTraceV2, "id" | "projectId" | "checkoutId"> {
  sourceId: string;
}

export interface UsageTraceExportBundleV2 {
  schemaVersion: 2;
  exportedAt: string;
  sourceFingerprint: string;
  records: PortableUsageTraceV2[];
  legacyRecords: Array<{
    sourceId: string;
    label: "incomplete-estimate";
    record: PortableContextCostRecord;
  }>;
}

export interface ComponentGraph {
  schemaVersion: typeof GRAPH_SCHEMA_VERSION;
  project: ProjectMetadata;
  components: ComponentNode[];
  entities: FrontendEntity[];
  edges: GraphEdge[];
  tokens: DesignToken[];
  themeFingerprint?: ProjectThemeFingerprint;
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
  kind?: ComponentKind;
  role?: string;
  runtime?: ComponentRuntime;
  routePath?: string;
}

export interface ComponentContextLink {
  id: string;
  name: string;
  scope: ComponentVisibility;
  kind?: ComponentKind;
}

export interface CompactProjectProfile {
  frameworks: Framework[];
  metaFrameworks: MetaFramework[];
  confidence: "high" | "medium" | "low";
  coverage?: {
    candidateFiles: number;
    parsedFiles: number;
    skippedFiles: number;
    errorFiles: number;
    complete: boolean;
  };
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
    profile?: CompactProjectProfile;
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

export interface ChangeSurfaceBundle {
  schemaVersion: 1;
  intent: string;
  selection: "explicit" | "ranked" | "unresolved" | "non-component";
  primarySurface?: {
    kind:
      | "component"
      | "route"
      | "service"
      | "state"
      | "api"
      | "configuration"
      | "files";
    id: string;
  };
  primary?: ComponentContextReference;
  references: Array<{
    component: ComponentContextReference;
    role: "secondary-reference" | "alternative";
    reasons: string[];
  }>;
  files: Array<{
    path: string;
    role:
      | "implementation"
      | "test"
      | "authorized"
      | "dependency-reference"
      | "consumer-reference";
    componentId?: string;
  }>;
  /** Explicit editable paths supplied by the caller; never presentation-truncated. */
  authorizedFiles: string[];
  publicApi?: {
    props: ComponentProp[];
    events: ComponentEvent[];
    slots: string[];
    models: string[];
  };
  impact?: {
    level: "contained" | "shared" | "high";
    directConsumers: number;
    transitiveConsumers: number;
  };
  outOfScope: string[];
  nextActions: string[];
}

export interface ComponentContextBundle {
  schemaVersion: 1;
  project: {
    name: string;
    framework: Framework;
    scannedAt: string;
    profile?: CompactProjectProfile;
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
  consideredCandidates?: Array<{
    componentId: string;
    outcome: "selected" | "rejected";
    reasons: string[];
    evidence: string[];
  }>;
  rationale: string;
  author?: string;
  scope?: "project" | "checkout";
  checkoutId?: string;
  taskId?: string;
  decisionKey?: string;
  status?: "active" | "superseded";
  supersedes?: string[];
  supersededBy?: string;
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
  packageProfile?: ProjectPackageProfile;
  /** Internal shared scan budget. Adapter consumers normally omit this. */
  scanSafetySession?: ScanSafetySession;
}

export interface AdapterScanResult {
  components: ComponentNode[];
  coverage: ScanCoverage;
}

export interface FrameworkAdapter {
  framework: Framework;
  scan(options: ScanOptions): Promise<ComponentNode[]>;
  scanDetailed?(options: ScanOptions): Promise<AdapterScanResult>;
}
