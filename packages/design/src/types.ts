export const DESIGN_INDEX_SCHEMA_VERSION = 1 as const;

export type DesignMetadataFormat = "auto" | "figma-mcp-xml" | "figma-rest";
export type DesignMetadataSource = Exclude<DesignMetadataFormat, "auto">;
export type DesignDevStatus = "ready-for-dev" | "completed" | "none";
export type DesignCandidateConfidence = "high" | "medium" | "low";
export type DesignFindingLevel =
  | "decision-required"
  | "warning"
  | "resolved";

export interface DesignFinding {
  id: string;
  level: DesignFindingLevel;
  code:
    | "confirm-design-target"
    | "ambiguous-design-target"
    | "no-design-match"
    | "duplicate-design-pattern"
    | "inconsistent-variants"
    | "ready-without-states"
    | "figma-code-mismatch"
    | "suspicious-component-api"
    | "source-contradiction"
    | "global-variables-unavailable"
    | "low-impact-default";
  title: string;
  evidence: string[];
  recommendation: string;
  question?: string;
  nodeIds?: string[];
}

export interface DesignDecisionGate {
  status: "blocked" | "review" | "clear";
  questions: Array<{
    findingId: string;
    question: string;
    evidence: string[];
    recommendation: string;
  }>;
}

export interface FigmaReference {
  fileKey: string;
  fileUrl: string;
  nodeId?: string;
}

export interface DesignAnnotation {
  label?: string;
  text: string;
  url?: string;
}

export interface DesignResourceLink {
  name: string;
  url: string;
}

export interface DesignCodeConnection {
  nodeId: string;
  componentName: string;
  source?: string;
  label?: string;
  version?: string;
}

export interface DesignLibrarySummary {
  name: string;
  key?: string;
  description?: string;
  source?: string;
}

export interface DesignComponentSummary {
  nodeId: string;
  name: string;
  description?: string;
  componentSetId?: string;
  variantProperties: string[];
}

export type DesignVariableValue =
  | string
  | number
  | boolean
  | { aliasTo: string }
  | { summary: string };

export interface DesignVariableCollectionSummary {
  id: string;
  name: string;
  modes: Array<{ id: string; name: string }>;
  variableCount: number;
  remoteVariables: number;
  resolvedTypes: string[];
}

export interface DesignVariableToken {
  id: string;
  name: string;
  collectionId: string;
  resolvedType: string;
  origin: "local" | "remote";
  scopes: string[];
  valuesByMode?: Record<string, DesignVariableValue>;
}

export interface DesignVariableCatalog {
  availability: "global" | "selection-only" | "unavailable";
  source: "figma-variables-api" | "figma-selection" | "none";
  valuesIncluded: boolean;
  collections: DesignVariableCollectionSummary[];
  variables: DesignVariableToken[];
  note?: string;
}

export interface DesignIndexNode {
  id: string;
  name: string;
  type: string;
  url: string;
  pageId: string;
  pageName: string;
  parentId?: string;
  depth: number;
  path: string[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  devStatus: DesignDevStatus;
  devStatusDescription?: string;
  annotations: DesignAnnotation[];
  resources: DesignResourceLink[];
  componentNames: string[];
  variantProperties: string[];
  codeConnections: DesignCodeConnection[];
  childIds: string[];
}

export interface DesignIndexPage {
  id: string;
  name: string;
  nodeIds: string[];
  readyForDev: number;
  completed: number;
}

export interface DesignSourceSnapshot {
  kind: DesignMetadataSource;
  scopeNodeId?: string;
  hash: string;
  indexedAt: string;
}

export interface DesignFileIndex {
  schemaVersion: typeof DESIGN_INDEX_SCHEMA_VERSION;
  provider: "figma";
  file: {
    key: string;
    url: string;
    name?: string;
    version?: string;
    lastModified?: string;
  };
  indexedAt: string;
  sources: DesignSourceSnapshot[];
  pages: DesignIndexPage[];
  nodes: DesignIndexNode[];
  components: DesignComponentSummary[];
  componentSets: DesignComponentSummary[];
  libraries: DesignLibrarySummary[];
  variables: DesignVariableCatalog;
  stats: {
    pages: number;
    nodes: number;
    readyForDev: number;
    completed: number;
    components: number;
    componentSets: number;
    codeConnections: number;
    variableCollections: number;
    variables: number;
  };
}

export interface DesignIndexEnrichment {
  libraries?: unknown[] | Record<string, unknown>;
  codeConnect?: Record<string, unknown>;
  devResources?: unknown[];
  devStatusByNode?: Record<string, unknown>;
  variableCatalog?: unknown;
}

export interface BuildFigmaDesignIndexInput {
  figmaUrl: string;
  metadata: string | Record<string, unknown>;
  format?: DesignMetadataFormat;
  fileName?: string;
  version?: string;
  lastModified?: string;
  scopeNodeId?: string;
  indexedAt?: string;
  enrichment?: DesignIndexEnrichment;
}

export interface DesignIndexSummary {
  schemaVersion: typeof DESIGN_INDEX_SCHEMA_VERSION;
  file: DesignFileIndex["file"];
  indexedAt: string;
  sources: number;
  stats: DesignFileIndex["stats"];
  variables: {
    availability: DesignVariableCatalog["availability"];
    collections: Array<{
      id: string;
      name: string;
      modes: string[];
      variableCount: number;
      resolvedTypes: string[];
    }>;
  };
  findings: DesignFinding[];
  gate: DesignDecisionGate;
  pages: Array<{
    id: string;
    name: string;
    readyForDev: number;
    completed: number;
    mainNodes: Array<{
      id: string;
      name: string;
      type: string;
      status: DesignDevStatus;
      url: string;
    }>;
  }>;
  nextActions: string[];
}

export interface DesignCandidate {
  rank: number;
  confidence: DesignCandidateConfidence;
  score: number;
  node: {
    id: string;
    name: string;
    type: string;
    url: string;
    page: string;
    path: string;
    status: DesignDevStatus;
  };
  reasons: string[];
  matchedTaskTerms: string[];
  relatedVariants: Array<{
    id: string;
    name: string;
    url: string;
    status: DesignDevStatus;
  }>;
}

export interface RankDesignCandidatesOptions {
  limit?: number;
  codeSignals?: string[];
}

export interface DesignCandidateResult {
  candidates: DesignCandidate[];
  findings: DesignFinding[];
  gate: DesignDecisionGate;
}

export interface DesignNodeInspection {
  file: DesignFileIndex["file"];
  node: DesignIndexNode;
  breadcrumbs: Array<{ id: string; name: string; type: string }>;
  children: Array<{
    id: string;
    name: string;
    type: string;
    status: DesignDevStatus;
    url: string;
  }>;
  relatedVariants: Array<{
    id: string;
    name: string;
    status: DesignDevStatus;
    url: string;
  }>;
  findings: DesignFinding[];
  gate: DesignDecisionGate;
  deepContextRequest: {
    confirmedNodeId: string;
    figmaUrl: string;
    requiredTools: ["get_design_context", "get_screenshot"];
    recommendedTools: string[];
    instruction: string;
  };
}
