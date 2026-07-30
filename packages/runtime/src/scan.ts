import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  GRAPH_SCHEMA_VERSION,
  buildGraphEdges,
  componentId,
  slash,
  type AdapterScanResult,
  type ComponentGraph,
  type ComponentNode,
  type DesignToken,
  type DesignTokenKind,
  type Framework,
  type ProjectProfile,
  type ProjectScanState,
  type ScanCoverage,
} from "@component-atlas/core";
import {
  AtlasStore,
  projectStorageDirectory,
  rememberRecentProject,
} from "@component-atlas/store";
import fg from "fast-glob";
import { resolveProjectIdentity } from "./identity.js";
import { detectProjectProfile } from "./profile.js";
import { scanFrontendEntities } from "./frontend-entities.js";
import { buildThemeFingerprint } from "./theme-fingerprint.js";

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

async function packageJson(rootPath: string): Promise<PackageJson> {
  const filePath = path.join(rootPath, "package.json");
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as PackageJson;
  } catch (error) {
    throw new Error(`Cannot read ${filePath}: ${String(error)}`, {
      cause: error,
    });
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
  return (await detectProjectProfile(rootPath)).primaryFramework;
}

function catalogMarkdown(graph: ComponentGraph): string {
  const componentNodes = graph.components.filter(
    (item) => (item.kind ?? "component") === "component",
  );
  const counts = {
    public: componentNodes.filter((item) => item.visibility === "public").length,
    feature: componentNodes.filter((item) => item.visibility === "feature").length,
    private: componentNodes.filter((item) => item.visibility === "private").length,
  };
  const rows = graph.components
    .map((component) => {
      const props = component.props.map((prop) => prop.name).join(", ") || "—";
      return `| ${component.effectiveName} | ${component.kind ?? "component"} | ${component.visibility} | \`${component.relativePath}\` | ${props} |`;
    })
    .join("\n");
  return `# Project Atlas code catalog

Generated ${graph.project.scannedAt}. Re-run \`component-atlas scan\` to refresh.

- Framework: ${graph.project.framework}
- Code nodes: ${graph.components.length}
- Reusable components: ${componentNodes.length}
- Public: ${counts.public}
- Feature: ${counts.feature}
- Private/local: ${counts.private}
- Relationships: ${graph.edges.length}

| Node | Kind | Scope | Source | Props |
| --- | --- | --- | --- | --- |
${rows}
`;
}

async function writeProjectArtifacts(graph: ComponentGraph): Promise<void> {
  const directory = projectStorageDirectory(graph.project.id);
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
  "pnpm-workspace.yaml",
  "**/package.json",
  "**/tsconfig*.json",
  "**/{nuxt,vite,next,astro}.config.*",
  "**/app/**/*.{vue,astro,ts,tsx,js,jsx,css,scss,sass}",
  "**/src/**/*.{vue,astro,md,mdx,html,ts,tsx,js,jsx,css,scss,sass}",
  "**/components/**/*.{vue,astro,ts,tsx,js,jsx,css,scss,sass}",
  "**/pages/**/*.{vue,astro,md,mdx,html,ts,tsx,js,jsx}",
  "**/layouts/**/*.{vue,astro,ts,tsx,js,jsx}",
  "**/assets/**/*.{css,scss,sass}",
  "**/styles/**/*.{css,scss,sass}",
  "**/test/**/*.{ts,tsx,js,jsx}",
  "**/tests/**/*.{ts,tsx,js,jsx}",
  "**/__tests__/**/*.{ts,tsx,js,jsx}",
  "*.vue",
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
          /(^|\/)(?:package\.json|pnpm-workspace\.yaml|tsconfig[^/]*\.json|(?:nuxt|vite|next|astro)\.config\.)/i.test(
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
  if (framework === "astro") {
    return (
      /\.astro$/iu.test(file) ||
      /(^|\/)src\/pages\/.*\.(?:md|mdx|html)$/iu.test(file)
    );
  }
  if (framework === "vue") {
    return (
      /\.vue$/i.test(file) &&
      (
        /(^|\/)(?:app|src|components|pages|layouts)\//i.test(file) ||
        /(^|\/)(?:app|error)\.vue$/i.test(file)
      )
    );
  }
  return (
    /\.(?:tsx|jsx|js)$/i.test(file) &&
    /(^|\/)(?:src|app|components|pages)\//i.test(file) &&
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
  packageProfile?: ProjectProfile["packages"][number],
  include?: string[],
): Promise<AdapterScanResult> {
  const options = {
    rootPath,
    ...(packageProfile ? { packageProfile } : {}),
    ...(include ? { include } : {}),
  };
  if (framework === "vue") {
    return import("@component-atlas/adapter-vue").then(
      ({ scanVueProjectDetailed }) => scanVueProjectDetailed(options),
    );
  }
  if (framework === "astro") {
    return import("@component-atlas/adapter-astro").then(
      ({ scanAstroProjectDetailed }) => scanAstroProjectDetailed(options),
    );
  }
  return import("@component-atlas/adapter-react").then(
    ({ scanReactProjectDetailed }) => scanReactProjectDetailed(options),
  );
}

function mergeCoverage(results: ScanCoverage[]): ScanCoverage {
  const byFramework: ScanCoverage["byFramework"] = {};
  for (const result of results) {
    for (const [framework, counts] of Object.entries(result.byFramework)) {
      if (!counts) continue;
      const key = framework as Framework;
      const existing = byFramework[key] ?? {
        candidateFiles: 0,
        parsedFiles: 0,
        skippedFiles: 0,
        errorFiles: 0,
      };
      byFramework[key] = {
        candidateFiles: existing.candidateFiles + counts.candidateFiles,
        parsedFiles: existing.parsedFiles + counts.parsedFiles,
        skippedFiles: existing.skippedFiles + counts.skippedFiles,
        errorFiles: existing.errorFiles + counts.errorFiles,
      };
    }
  }
  const candidateFiles = results.reduce(
    (total, result) => total + result.candidateFiles,
    0,
  );
  const parsedFiles = results.reduce(
    (total, result) => total + result.parsedFiles,
    0,
  );
  const skippedFiles = results.reduce(
    (total, result) => total + result.skippedFiles,
    0,
  );
  const errorFiles = results.reduce(
    (total, result) => total + result.errorFiles,
    0,
  );
  return {
    candidateFiles,
    parsedFiles,
    skippedFiles,
    errorFiles,
    diagnostics: results.flatMap((result) => result.diagnostics).slice(0, 50),
    byFramework,
    complete:
      results.every((result) => result.complete) &&
      candidateFiles === parsedFiles + skippedFiles + errorFiles,
  };
}

function packageInclude(
  packageRelativeRoot: string,
  include: string[] | undefined,
): string[] | undefined {
  if (!include) return undefined;
  const prefix = packageRelativeRoot ? `${slash(packageRelativeRoot)}/` : "";
  return include.flatMap((file) => {
    const normalized = slash(file);
    if (!prefix) return [normalized];
    return normalized.startsWith(prefix) ? [normalized.slice(prefix.length)] : [];
  });
}

async function scanProfileComponents(
  profile: ProjectProfile,
  rootPath: string,
  include?: string[],
): Promise<AdapterScanResult> {
  const results: Array<{
    result: AdapterScanResult;
    packageProfile: ProjectProfile["packages"][number];
  }> = [];
  for (const packageProfile of profile.packages) {
    const scopedInclude = packageInclude(packageProfile.relativeRoot, include);
    if (include && scopedInclude?.length === 0) continue;
    for (const framework of packageProfile.frameworks) {
      const result = await scanComponents(
        framework,
        packageProfile.rootPath,
        packageProfile,
        scopedInclude,
      );
      results.push({ result, packageProfile });
    }
  }
  const components = results
    .flatMap(({ result, packageProfile }) =>
      result.components.map((component) => {
        if (!packageProfile.relativeRoot) return component;
        const relativePath = slash(
          path.join(packageProfile.relativeRoot, component.relativePath),
        );
        return {
          ...component,
          id: componentId(component.framework, relativePath, component.name),
          relativePath,
          testPaths: component.testPaths.map((testPath) =>
            slash(path.join(packageProfile.relativeRoot, testPath)),
          ),
        };
      }),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  let coverage = mergeCoverage(
    results.map(({ result, packageProfile }) => ({
      ...result.coverage,
      diagnostics: result.coverage.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        ...(diagnostic.path && packageProfile.relativeRoot
          ? {
              path: slash(
                path.join(packageProfile.relativeRoot, diagnostic.path),
              ),
            }
          : {}),
      })),
    })),
  );
  if (coverage.candidateFiles === 0) {
    coverage = {
      ...coverage,
      complete: false,
      diagnostics: [
        {
          severity: "warning",
          code: "no-frontend-candidates",
          message:
            "Frontend dependencies were detected, but no supported source files were discovered.",
        },
      ],
    };
  }
  return { components, coverage };
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
  throwIfAborted(options.signal);
  const manifest = await packageJson(rootPath);
  let profile: ProjectProfile;
  try {
    profile = await detectProjectProfile(rootPath);
  } catch (error) {
    if (!options.framework) throw error;
    profile = {
      primaryFramework: options.framework,
      frameworks: [options.framework],
      packages: [
        {
          rootPath,
          relativeRoot: "",
          name: manifest.name ?? path.basename(rootPath),
          frameworks: [options.framework],
          primaryFramework: options.framework,
          versions: {},
          confidence: "low",
          evidence: ["manual-framework-override"],
        },
      ],
      confidence: "low",
      diagnostics: ["Framework was selected manually; package evidence was unavailable."],
    };
  }
  if (options.framework) {
    const packages = profile.packages
      .filter((packageProfile) => packageProfile.frameworks.includes(options.framework!))
      .map((packageProfile) => ({
        ...packageProfile,
        frameworks: [options.framework!],
        primaryFramework: options.framework!,
      }));
    profile = {
      ...profile,
      primaryFramework: options.framework,
      frameworks: [options.framework],
      packages:
        packages.length > 0
          ? packages
          : [
              {
                rootPath,
                relativeRoot: "",
                name: manifest.name ?? path.basename(rootPath),
                frameworks: [options.framework],
                primaryFramework: options.framework,
                versions: {},
                confidence: "low",
                evidence: ["manual-framework-override"],
              },
            ],
    };
  }
  const framework = profile.primaryFramework;
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
    previousGraph.schemaVersion === GRAPH_SCHEMA_VERSION &&
    previousState &&
    previousState.framework === framework &&
    previousState.configurationFingerprint === configHash &&
    profile.packages.length === 1 &&
    profile.packages[0]?.relativeRoot === "" &&
    profile.frameworks.length === 1 &&
    canScanIncrementally(changedFiles, framework);
  let mode: "full" | "incremental" | "unchanged";
  let components: ComponentNode[];
  let tokens: DesignToken[];
  let coverage: ScanCoverage;
  if (incremental && previousGraph && changedFiles.length === 0) {
    mode = "unchanged";
    components = previousGraph.components;
    tokens = previousGraph.tokens;
    coverage =
      previousGraph.project.scan?.coverage ??
      {
        candidateFiles: previousGraph.project.sourceFiles,
        parsedFiles: previousGraph.project.sourceFiles,
        skippedFiles: 0,
        errorFiles: 0,
        diagnostics: [{
          severity: "warning",
          code: "legacy-coverage",
          message: "This snapshot predates explicit scan coverage and should be fully rescanned.",
        }],
        byFramework: {},
        complete: false,
      };
  } else if (incremental && previousGraph) {
    mode = "incremental";
    const sourceChanges = changedFiles.filter((file) =>
      isComponentSource(file, framework),
    );
    const existingSources = sourceChanges.filter((file) => files[file]);
    const rescanned = existingSources.length
      ? await scanProfileComponents(profile, rootPath, existingSources)
      : {
          components: [],
          coverage: mergeCoverage([]),
        };
    const changedSet = new Set(sourceChanges.map((file) => slash(file)));
    components = [
      ...previousGraph.components.filter(
        (component) => !changedSet.has(component.relativePath),
      ),
      ...rescanned.components,
    ].sort((left, right) => left.id.localeCompare(right.id));
    tokens = changedFiles.some((file) => /\.(?:css|scss|sass)$/i.test(file))
      ? await scanDesignTokens(rootPath)
      : previousGraph.tokens;
    const previousCoverage = previousGraph.project.scan?.coverage;
    coverage = previousCoverage
      ? {
          ...previousCoverage,
          diagnostics: [
            ...previousCoverage.diagnostics.filter(
              (diagnostic) =>
                !diagnostic.path ||
                !sourceChanges.includes(diagnostic.path),
            ),
            ...rescanned.coverage.diagnostics,
            {
              severity: "info" as const,
              code: "incremental-coverage",
              message:
                "Coverage counts were retained from the last full discovery; changed files were reparsed.",
            },
          ].slice(0, 50),
          complete:
            previousCoverage.complete && rescanned.coverage.errorFiles === 0,
        }
      : {
          ...rescanned.coverage,
          complete: false,
          diagnostics: [
            ...rescanned.coverage.diagnostics,
            {
              severity: "warning" as const,
              code: "legacy-coverage",
              message: "Run a full scan to establish repository-wide coverage.",
            },
          ],
        };
  } else {
    mode = "full";
    const scanned = await scanProfileComponents(profile, rootPath);
    components = scanned.components;
    coverage = scanned.coverage;
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
    profile,
    identity: identityMetadata,
    scan: {
      mode,
      fingerprint,
      checkedAt,
      changedFiles: changedFiles.length,
      durationMs: Date.now() - startedAt,
      coverage,
    },
  };
  const graph: ComponentGraph = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    project: metadata,
    components,
    entities: [],
    edges: [],
    tokens,
  };
  const semantic = await scanFrontendEntities(
    rootPath,
    profile.frameworks,
    components,
  );
  graph.entities = semantic.entities;
  graph.edges = [...buildGraphEdges(components), ...semantic.edges].filter(
    (edge, index, collection) =>
      collection.findIndex((candidate) => candidate.id === edge.id) === index,
  );
  graph.themeFingerprint = await buildThemeFingerprint(
    rootPath,
    components,
    tokens,
  );
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
  await rememberRecentProject({
    id: graph.project.id,
    name: graph.project.name,
    rootPath: graph.project.rootPath,
    ...(identity.checkoutId ? { checkoutId: identity.checkoutId } : {}),
    lastOpenedAt: checkedAt,
  });
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
  const store = new AtlasStore(identity.logicalId);
  try {
    const graph = store.loadGraph(identity.logicalId, identity.checkoutId);
    if (
      graph?.schemaVersion === GRAPH_SCHEMA_VERSION &&
      Array.isArray(graph.entities)
    ) {
      return graph;
    }
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
