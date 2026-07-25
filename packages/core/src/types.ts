export const GRAPH_SCHEMA_VERSION = 1 as const;

export type Framework = "vue" | "react";
export type ComponentVisibility = "public" | "feature" | "private";
export type EdgeKind = "renders" | "tested_by" | "similar_to";
export type DecisionKind =
  | "reuse"
  | "extend"
  | "compose"
  | "extract-and-reuse"
  | "create";

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
}

export interface ComponentSearchResult {
  component: ComponentNode;
  score: number;
  reasons: string[];
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
