export const GRAPH_SCHEMA_VERSION = 2 as const;

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
