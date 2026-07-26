import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import fg from "fast-glob";
import {
  GRAPH_SCHEMA_VERSION,
  buildGraphEdges,
  searchComponentContext,
  slash,
  type ComponentDecision,
  type ComponentGraph,
  type ComponentNode,
  type DesignToken,
  type DesignTokenKind,
  type DecisionKind,
  type Framework,
  type ProjectScanState,
} from "@component-atlas/core";
import {
  buildFigmaDesignIndex,
  decisionGate,
  designIndexSummary,
  inspectDesignNode,
  isDesignSnapshotCurrent,
  mergeDesignIndexes,
  parseFigmaReference,
  rankDesignCandidates,
  type BuildFigmaDesignIndexInput,
  type DesignCandidateResult,
  type DesignFileIndex,
  type DesignFinding,
  type DesignIndexSummary,
  type DesignNodeInspection,
} from "@component-atlas/design";
import {
  AtlasStore,
  databaseExists,
} from "@component-atlas/store";
import { resolveProjectIdentity } from "./identity.js";

const execFileAsync = promisify(execFile);

interface PackageJson {
  name?: string;
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface ScanProjectOptions {
  framework?: Framework;
  writeArtifacts?: boolean;
  projectKey?: string;
  incremental?: boolean;
  signal?: AbortSignal;
}

export interface RecordDecisionInput {
  rootPath: string;
  intent: string;
  decision: DecisionKind;
  selectedComponentIds?: string[];
  rejectedComponentIds?: string[];
  rationale: string;
  author?: string;
}

export interface MapFigmaDesignInput extends BuildFigmaDesignIndexInput {
  rootPath: string;
  force?: boolean;
}

export interface MapFigmaDesignResult {
  status: "created" | "updated" | "unchanged";
  summary: DesignIndexSummary;
}

export interface TaskDesignCandidateResult extends DesignCandidateResult {
  task: string;
  project: {
    name: string;
    framework: Framework;
    scannedAt: string;
  };
  designFile: DesignFileIndex["file"];
  atlasCandidates: ReturnType<typeof searchComponentContext>;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function packageJson(rootPath: string): Promise<PackageJson> {
  const filePath = path.join(rootPath, "package.json");
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as PackageJson;
  } catch (error) {
    throw new Error(`Cannot read ${filePath}: ${String(error)}`);
  }
}

function tokenKind(name: string, value: string): DesignTokenKind {
  if (
    /color|background|foreground|surface|accent|brand|text|border|fill/i.test(
      name,
    ) ||
    /^(#|rgb|hsl|oklch|lab|lch|color\()/i.test(value)
  ) {
    return "color";
  }
  if (/radius|rounded/i.test(name)) return "radius";
  if (/shadow/i.test(name)) return "shadow";
  if (/font|type|text-size|line-height/i.test(name)) return "typography";
  if (/space|gap|padding|margin|size/i.test(name)) return "space";
  return "other";
}

async function scanDesignTokens(rootPath: string): Promise<DesignToken[]> {
  const files = await fg(
    [
      "app/**/*.{css,scss,sass}",
      "src/**/*.{css,scss,sass}",
      "assets/**/*.{css,scss,sass}",
      "styles/**/*.{css,scss,sass}",
      "*.{css,scss,sass}",
    ],
    {
      cwd: rootPath,
      absolute: true,
      onlyFiles: true,
      unique: true,
      ignore: [
        "**/node_modules/**",
        "**/.nuxt/**",
        "**/.next/**",
        "**/.output/**",
      ],
    },
  );
  const tokens = new Map<string, DesignToken>();
  for (const filePath of files.sort()) {
    const source = await readFile(filePath, "utf8");
    for (const match of source.matchAll(/--([A-Za-z0-9_-]+)\s*:\s*([^;{}]+);/g)) {
      const name = match[1];
      const value = match[2]?.trim();
      if (!name || !value || value.startsWith("var(")) continue;
      tokens.set(name, {
        name,
        value,
        kind: tokenKind(name, value),
        sourcePath: slash(path.relative(rootPath, filePath)),
      });
    }
  }
  return [...tokens.values()].slice(0, 500);
}

export async function detectFramework(rootPath: string): Promise<Framework> {
  const manifest = await packageJson(rootPath);
  const dependencies = {
    ...manifest.devDependencies,
    ...manifest.dependencies,
  };
  if (dependencies.nuxt || dependencies.vue || (await exists(path.join(rootPath, "nuxt.config.ts")))) {
    return "vue";
  }
  if (
    dependencies.next ||
    dependencies.react ||
    (await exists(path.join(rootPath, "next.config.ts"))) ||
    (await exists(path.join(rootPath, "next.config.js")))
  ) {
    return "react";
  }
  throw new Error(
    `Could not detect Vue/Nuxt or React/Next in ${path.resolve(rootPath)}.`,
  );
}

function catalogMarkdown(graph: ComponentGraph): string {
  const counts = {
    public: graph.components.filter((item) => item.visibility === "public").length,
    feature: graph.components.filter((item) => item.visibility === "feature").length,
    private: graph.components.filter((item) => item.visibility === "private").length,
  };
  const rows = graph.components
    .map((component) => {
      const props = component.props.map((prop) => prop.name).join(", ") || "—";
      return `| ${component.effectiveName} | ${component.visibility} | \`${component.relativePath}\` | ${props} |`;
    })
    .join("\n");
  return `# Project Atlas code catalog

Generated ${graph.project.scannedAt}. Re-run \`component-atlas scan\` to refresh.

- Framework: ${graph.project.framework}
- Components: ${graph.components.length}
- Public: ${counts.public}
- Feature: ${counts.feature}
- Private/local: ${counts.private}
- Relationships: ${graph.edges.length}

| Component | Scope | Source | Props |
| --- | --- | --- | --- |
${rows}
`;
}

async function writeProjectArtifacts(graph: ComponentGraph): Promise<void> {
  const directory = path.join(graph.project.rootPath, ".component-atlas");
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(directory, "project.json"),
      `${JSON.stringify(
        {
          schemaVersion: graph.schemaVersion,
          project: graph.project,
          database: "Stored outside the repository in local application data.",
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
    writeFile(path.join(directory, "catalog.md"), catalogMarkdown(graph), "utf8"),
  ]);
}

const SCAN_PATTERNS = [
  "package.json",
  "tsconfig*.json",
  "nuxt.config.*",
  "vite.config.*",
  "next.config.*",
  "app/**/*.{vue,ts,tsx,js,jsx,css,scss,sass}",
  "src/**/*.{vue,ts,tsx,js,jsx,css,scss,sass}",
  "components/**/*.{vue,ts,tsx,js,jsx,css,scss,sass}",
  "pages/**/*.{vue,ts,tsx,js,jsx}",
  "layouts/**/*.{vue,ts,tsx,js,jsx}",
  "assets/**/*.{css,scss,sass}",
  "styles/**/*.{css,scss,sass}",
  "test/**/*.{ts,tsx,js,jsx}",
  "tests/**/*.{ts,tsx,js,jsx}",
  "**/__tests__/**/*.{ts,tsx,js,jsx}",
];

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Project Atlas scan was aborted.");
  }
}

async function scanFileHashes(
  rootPath: string,
  previous?: ProjectScanState,
  currentHead?: string,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const files = await fg(SCAN_PATTERNS, {
    cwd: rootPath,
    onlyFiles: true,
    unique: true,
    ignore: [
      "**/node_modules/**",
      "**/.nuxt/**",
      "**/.next/**",
      "**/.output/**",
      "**/.component-atlas/**",
    ],
  });
  let gitChanges: Set<string> | undefined;
  if (previous?.head && currentHead) {
    try {
      const [committed, working] = await Promise.all([
        previous.head === currentHead
          ? Promise.resolve("")
          : execFileAsync(
              "git",
              [
                "-C",
                rootPath,
                "diff",
                "--name-only",
                "--no-renames",
                previous.head,
                currentHead,
              ],
              {
                encoding: "utf8",
                timeout: 5_000,
                windowsHide: true,
                maxBuffer: 1024 * 1024,
              },
            ).then((result) => result.stdout),
        execFileAsync(
          "git",
          [
            "-C",
            rootPath,
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
          ],
          {
            encoding: "utf8",
            timeout: 5_000,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
          },
        ).then((result) => result.stdout),
      ]);
      gitChanges = new Set(
        [
          ...committed.split(/\r?\n/),
          ...working.split(/\r?\n/).flatMap((line) => {
            const value = line.slice(3).trim();
            if (!value) return [];
            return value.includes(" -> ")
              ? value.split(" -> ").map((item) => item.trim())
              : [value];
          }),
        ]
          .filter(Boolean)
          .map(slash),
      );
    } catch {
      gitChanges = undefined;
    }
  }
  const hashes: Record<string, string> = {};
  for (const relativePath of files.sort()) {
    throwIfAborted(signal);
    const normalized = slash(relativePath);
    const reusable =
      gitChanges && !gitChanges.has(normalized)
        ? previous?.files[normalized]
        : undefined;
    hashes[normalized] =
      reusable ??
      createHash("sha256")
        .update(await readFile(path.join(rootPath, relativePath)))
        .digest("hex");
  }
  return hashes;
}

function scanFingerprint(files: Record<string, string>): string {
  return createHash("sha256")
    .update(
      Object.entries(files)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([file, hash]) => `${file}\0${hash}`)
        .join("\n"),
    )
    .digest("hex")
    .slice(0, 20);
}

function configurationFingerprint(files: Record<string, string>): string {
  return createHash("sha256")
    .update(
      Object.entries(files)
        .filter(([file]) =>
          /(^|\/)(?:package\.json|tsconfig[^/]*\.json|(?:nuxt|vite|next)\.config\.)/i.test(
            file,
          ),
        )
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([file, hash]) => `${file}\0${hash}`)
        .join("\n"),
    )
    .digest("hex")
    .slice(0, 20);
}

function changedFilePaths(
  previous: Record<string, string>,
  current: Record<string, string>,
): string[] {
  return [...new Set([...Object.keys(previous), ...Object.keys(current)])]
    .filter((file) => previous[file] !== current[file])
    .sort();
}

function isComponentSource(file: string, framework: Framework): boolean {
  if (framework === "vue") {
    return (
      /\.vue$/i.test(file) &&
      /(^|\/)(?:app\/)?(?:components|pages|layouts)\//i.test(file)
    );
  }
  return (
    /\.(?:tsx|jsx)$/i.test(file) &&
    /(^|\/)(?:src|app|components)\//i.test(file) &&
    !/\.(?:test|spec|stories)\./i.test(file)
  );
}

function canScanIncrementally(
  changedFiles: string[],
  framework: Framework,
): boolean {
  return changedFiles.every(
    (file) =>
      isComponentSource(file, framework) ||
      /\.(?:css|scss|sass)$/i.test(file),
  );
}

async function scanComponents(
  framework: Framework,
  rootPath: string,
  include?: string[],
): Promise<ComponentNode[]> {
  return framework === "vue"
    ? import("@component-atlas/adapter-vue").then(({ scanVueProject }) =>
        scanVueProject({ rootPath, ...(include ? { include } : {}) }),
      )
    : import("@component-atlas/adapter-react").then(({ scanReactProject }) =>
        scanReactProject({ rootPath, ...(include ? { include } : {}) }),
      );
}

async function migrateLegacyProject(
  rootPath: string,
  identity: Awaited<ReturnType<typeof resolveProjectIdentity>>,
): Promise<void> {
  if (
    identity.logicalId === identity.legacyPathId ||
    !databaseExists(identity.legacyPathId)
  ) {
    return;
  }
  if (databaseExists(identity.logicalId)) {
    const current = new AtlasStore(identity.logicalId);
    try {
      if (current.loadGraph(identity.logicalId)) return;
    } finally {
      current.close();
    }
  }
  const legacy = new AtlasStore(identity.legacyPathId);
  try {
    const snapshot = legacy.readProjectSnapshot(identity.legacyPathId);
    if (
      !snapshot.graph ||
      path.resolve(snapshot.graph.project.rootPath).toLowerCase() !==
        path.resolve(rootPath).toLowerCase()
    ) {
      return;
    }
    const target = new AtlasStore(identity.logicalId);
    try {
      const {
        legacyPathId: _legacyPathId,
        ...identityMetadata
      } = identity;
      const graph: ComponentGraph = {
        ...snapshot.graph,
        project: {
          ...snapshot.graph.project,
          id: identity.logicalId,
          rootPath,
          identity: identityMetadata,
        },
      };
      target.replaceGraph(graph);
      for (const index of snapshot.designIndexes) {
        target.saveDesignIndex(identity.logicalId, index);
      }
      for (const item of snapshot.memoryItems) {
        target.saveMemoryItem(identity.logicalId, {
          ...item,
          projectId: identity.logicalId,
        });
      }
      for (const proposal of snapshot.memoryProposals) {
        target.saveMemoryProposal({
          ...proposal,
          projectId: identity.logicalId,
        });
      }
      for (const decision of snapshot.componentDecisions) {
        target.saveDecision({
          ...decision,
          projectId: identity.logicalId,
        });
      }
    } finally {
      target.close();
    }
  } finally {
    legacy.close();
  }
}

export async function scanProject(
  inputPath: string,
  options: ScanProjectOptions = {},
): Promise<ComponentGraph> {
  const startedAt = Date.now();
  const identity = await resolveProjectIdentity(inputPath, {
    ...(options.projectKey ? { projectKey: options.projectKey } : {}),
    fresh: true,
  });
  const rootPath = identity.worktreePath;
  await migrateLegacyProject(rootPath, identity);
  throwIfAborted(options.signal);
  const manifest = await packageJson(rootPath);
  const framework = options.framework ?? (await detectFramework(rootPath));
  const store = new AtlasStore(identity.logicalId);
  let previousGraph: ComponentGraph | undefined;
  let previousState: ProjectScanState | undefined;
  try {
    previousGraph = store.loadGraph(identity.logicalId, identity.checkoutId);
    previousState = store.loadScanState(
      identity.logicalId,
      identity.checkoutId,
    );
  } finally {
    store.close();
  }
  const files = await scanFileHashes(
    rootPath,
    previousState,
    identity.head,
    options.signal,
  );
  const configHash = configurationFingerprint(files);
  const changedFiles = previousState
    ? changedFilePaths(previousState.files, files)
    : Object.keys(files);
  const incremental =
    options.incremental !== false &&
    previousGraph &&
    previousState &&
    previousState.framework === framework &&
    previousState.configurationFingerprint === configHash &&
    canScanIncrementally(changedFiles, framework);
  let mode: "full" | "incremental" | "unchanged";
  let components: ComponentNode[];
  let tokens: DesignToken[];
  if (incremental && previousGraph && changedFiles.length === 0) {
    mode = "unchanged";
    components = previousGraph.components;
    tokens = previousGraph.tokens;
  } else if (incremental && previousGraph) {
    mode = "incremental";
    const sourceChanges = changedFiles.filter((file) =>
      isComponentSource(file, framework),
    );
    const existingSources = sourceChanges.filter((file) => files[file]);
    const rescanned = existingSources.length
      ? await scanComponents(framework, rootPath, existingSources)
      : [];
    const changedSet = new Set(sourceChanges.map((file) => slash(file)));
    components = [
      ...previousGraph.components.filter(
        (component) => !changedSet.has(component.relativePath),
      ),
      ...rescanned,
    ].sort((left, right) => left.id.localeCompare(right.id));
    tokens = changedFiles.some((file) => /\.(?:css|scss|sass)$/i.test(file))
      ? await scanDesignTokens(rootPath)
      : previousGraph.tokens;
  } else {
    mode = "full";
    components = await scanComponents(framework, rootPath);
    tokens = await scanDesignTokens(rootPath);
  }
  throwIfAborted(options.signal);
  const checkedAt = new Date().toISOString();
  const fingerprint = scanFingerprint(files);
  const {
    legacyPathId: _legacyPathId,
    ...identityMetadata
  } = identity;
  const metadata = {
    id: identity.logicalId,
    name: manifest.name ?? path.basename(rootPath),
    rootPath,
    framework,
    ...(manifest.packageManager ? { packageManager: manifest.packageManager } : {}),
    scannedAt: checkedAt,
    sourceFiles: new Set(components.map((component) => component.relativePath)).size,
    identity: identityMetadata,
    scan: {
      mode,
      fingerprint,
      checkedAt,
      changedFiles: changedFiles.length,
      durationMs: Date.now() - startedAt,
    },
  };
  const graph: ComponentGraph = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    project: metadata,
    components,
    edges: buildGraphEdges(components),
    tokens,
  };
  const nextState: ProjectScanState = {
    schemaVersion: 1,
    projectId: identity.logicalId,
    checkoutId: identity.checkoutId,
    framework,
    ...(identity.head ? { head: identity.head } : {}),
    configurationFingerprint: configHash,
    files,
    completedAt: checkedAt,
  };
  const nextStore = new AtlasStore(metadata.id);
  try {
    nextStore.replaceGraph(graph);
    nextStore.saveScanState(nextState);
  } finally {
    nextStore.close();
  }
  if (options.writeArtifacts !== false) await writeProjectArtifacts(graph);
  return graph;
}

export async function loadProjectGraph(
  inputPath: string,
  options: { scanIfMissing?: boolean; projectKey?: string } = {},
): Promise<ComponentGraph> {
  const identity = await resolveProjectIdentity(inputPath, {
    ...(options.projectKey ? { projectKey: options.projectKey } : {}),
  });
  await migrateLegacyProject(identity.worktreePath, identity);
  const store = new AtlasStore(identity.logicalId);
  try {
    const graph = store.loadGraph(identity.logicalId, identity.checkoutId);
    if (graph) return graph;
  } finally {
    store.close();
  }
  if (options.scanIfMissing === false) {
    throw new Error(
      `No Project Atlas index exists for ${identity.worktreePath}.`,
    );
  }
  return scanProject(identity.worktreePath, {
    ...(options.projectKey ? { projectKey: options.projectKey } : {}),
  });
}

export async function recordDecision(
  input: RecordDecisionInput,
): Promise<ComponentDecision> {
  const allowedDecisions: DecisionKind[] = [
    "reuse",
    "extend",
    "compose",
    "extract-and-reuse",
    "create",
  ];
  if (!allowedDecisions.includes(input.decision)) {
    throw new Error(
      `Invalid decision "${input.decision}". Expected ${allowedDecisions.join(", ")}.`,
    );
  }
  const rootPath = path.resolve(input.rootPath);
  const graph = await loadProjectGraph(rootPath);
  const createdAt = new Date().toISOString();
  const id = createHash("sha256")
    .update(
      [
        graph.project.id,
        createdAt,
        input.intent,
        input.decision,
        input.rationale,
      ].join("\0"),
    )
    .digest("hex")
    .slice(0, 24);
  const decision: ComponentDecision = {
    id,
    projectId: graph.project.id,
    createdAt,
    intent: input.intent,
    decision: input.decision,
    selectedComponentIds: input.selectedComponentIds ?? [],
    rejectedComponentIds: input.rejectedComponentIds ?? [],
    rationale: input.rationale,
    ...(input.author ? { author: input.author } : {}),
  };
  const store = new AtlasStore(graph.project.id);
  try {
    store.saveDecision(decision);
  } finally {
    store.close();
  }
  const directory = path.join(rootPath, ".component-atlas", "decisions");
  await mkdir(directory, { recursive: true });
  const slug = slash(input.intent)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const fileName = `${createdAt.slice(0, 10)}-${slug || decision.id}.md`;
  await writeFile(
    path.join(directory, fileName),
    `# Component decision

- Intent: ${input.intent}
- Decision: ${input.decision}
- Recorded: ${createdAt}
- Selected: ${decision.selectedComponentIds.join(", ") || "none"}
- Rejected: ${decision.rejectedComponentIds.join(", ") || "none"}

## Rationale

${input.rationale}
`,
    "utf8",
  );
  return decision;
}

export function graphSummary(graph: ComponentGraph): Record<string, unknown> {
  const edgeCounts = Object.fromEntries(
    ["renders", "similar_to", "tested_by"].map((kind) => [
      kind,
      graph.edges.filter((edge) => edge.kind === kind).length,
    ]),
  );
  return {
    projectId: graph.project.id,
    project: graph.project.name,
    framework: graph.project.framework,
    identity: graph.project.identity
      ? {
          source: graph.project.identity.source,
          repositoryFingerprint: graph.project.identity.repositoryFingerprint,
          checkoutId: graph.project.identity.checkoutId,
          branch: graph.project.identity.branch,
        }
      : undefined,
    components: graph.components.length,
    public: graph.components.filter((item) => item.visibility === "public").length,
    feature: graph.components.filter((item) => item.visibility === "feature").length,
    private: graph.components.filter((item) => item.visibility === "private").length,
    edges: edgeCounts,
    tokens: graph.tokens.length,
    scannedAt: graph.project.scannedAt,
    scan: graph.project.scan,
  };
}

export async function mapFigmaDesign(
  input: MapFigmaDesignInput,
): Promise<MapFigmaDesignResult> {
  const rootPath = path.resolve(input.rootPath);
  const graph = await loadProjectGraph(rootPath);
  const incoming = buildFigmaDesignIndex(input);
  const store = new AtlasStore(graph.project.id);
  try {
    const existing = store.loadDesignIndex(
      graph.project.id,
      incoming.file.key,
    );
    if (
      existing &&
      !input.force &&
      isDesignSnapshotCurrent(existing, incoming)
    ) {
      return { status: "unchanged", summary: designIndexSummary(existing) };
    }
    const next = existing
      ? mergeDesignIndexes(existing, incoming)
      : incoming;
    store.saveDesignIndex(graph.project.id, next);
    return {
      status: existing ? "updated" : "created",
      summary: designIndexSummary(next),
    };
  } finally {
    store.close();
  }
}

export async function listFigmaDesignIndexes(
  rootPath: string,
): Promise<DesignIndexSummary[]> {
  const graph = await loadProjectGraph(rootPath);
  const store = new AtlasStore(graph.project.id);
  try {
    return store
      .listDesignIndexes(graph.project.id)
      .map(designIndexSummary);
  } finally {
    store.close();
  }
}

export async function loadFigmaDesignIndex(
  rootPath: string,
  figmaFile: string,
): Promise<DesignFileIndex> {
  const graph = await loadProjectGraph(rootPath);
  const reference = parseFigmaReference(figmaFile);
  const store = new AtlasStore(graph.project.id);
  try {
    const index = store.loadDesignIndex(graph.project.id, reference.fileKey);
    if (!index) {
      throw new Error(
        `No Design Index exists for Figma file ${reference.fileKey}. Map its sparse metadata first.`,
      );
    }
    return index;
  } finally {
    store.close();
  }
}

export async function findTaskDesignCandidates(
  rootPath: string,
  task: string,
  options: { figmaFile?: string; limit?: number } = {},
): Promise<TaskDesignCandidateResult> {
  const graph = await loadProjectGraph(rootPath);
  const store = new AtlasStore(graph.project.id);
  let designIndex: DesignFileIndex;
  try {
    const indexes = store.listDesignIndexes(graph.project.id);
    if (options.figmaFile) {
      const reference = parseFigmaReference(options.figmaFile);
      const selected = indexes.find(
        (index) => index.file.key === reference.fileKey,
      );
      if (!selected) {
        throw new Error(
          `No Design Index exists for Figma file ${reference.fileKey}.`,
        );
      }
      designIndex = selected;
    } else {
      if (indexes.length === 0) {
        throw new Error(
          "No Figma Design Index exists for this repository. Map one file before requesting design candidates.",
        );
      }
      if (indexes.length > 1) {
        throw new Error(
          `This repository has ${indexes.length} Figma indexes. Specify figma_file to keep candidate ranking explicit.`,
        );
      }
      designIndex = indexes[0]!;
    }
  } finally {
    store.close();
  }
  const atlasCandidates = searchComponentContext(graph, task, 3);
  const result = rankDesignCandidates(designIndex, task, {
    ...(options.limit ? { limit: options.limit } : {}),
    codeSignals: atlasCandidates.map(
      (candidate) => candidate.component.name,
    ),
  });
  const apiFindings = atlasCandidates.flatMap((candidate): DesignFinding[] => {
    const component = graph.components.find(
      (item) => item.id === candidate.component.id,
    );
    if (!component) return [];
    const booleanProps = component.props.filter((prop) =>
      /\bboolean\b/i.test(prop.type),
    );
    if (component.props.length < 12 && booleanProps.length < 4) return [];
    return [
      {
        id: `suspicious-component-api:${component.id}`,
        level: "warning",
        code: "suspicious-component-api",
        title: `Existing component API may be costly to extend: ${component.effectiveName}`,
        evidence: [
          `${component.relativePath} exposes ${component.props.length} props.`,
          ...(booleanProps.length >= 4
            ? [
                `Boolean variants: ${booleanProps
                  .slice(0, 8)
                  .map((prop) => prop.name)
                  .join(", ")}.`,
              ]
            : []),
        ],
        recommendation:
          "Inspect responsibility and change impact before adding another prop; prefer composition or extraction when the new behavior is independent.",
      },
    ];
  });
  const findings = [...result.findings, ...apiFindings];
  return {
    task: task.trim(),
    project: {
      name: graph.project.name,
      framework: graph.project.framework,
      scannedAt: graph.project.scannedAt,
    },
    designFile: designIndex.file,
    atlasCandidates,
    candidates: result.candidates,
    findings,
    gate: decisionGate(findings),
  };
}

export async function inspectFigmaDesignNode(
  rootPath: string,
  figmaFile: string,
  selector: string,
): Promise<DesignNodeInspection> {
  const index = await loadFigmaDesignIndex(rootPath, figmaFile);
  return inspectDesignNode(index, selector);
}

export * from "./memory.js";
export * from "./view-models.js";
export * from "./identity.js";
export * from "./integrations.js";
