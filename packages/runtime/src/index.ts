import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { scanReactProject } from "@component-atlas/adapter-react";
import { scanVueProject } from "@component-atlas/adapter-vue";
import {
  GRAPH_SCHEMA_VERSION,
  buildGraphEdges,
  buildPlaygroundContract,
  findComponent,
  projectId,
  slash,
  type ComponentDecision,
  type ComponentGraph,
  type ComponentPlaygroundContract,
  type DesignToken,
  type DesignTokenKind,
  type DecisionKind,
  type Framework,
  type PreviewScenario,
  type PreviewStyleEnvironment,
  type PreviewViewport,
} from "@component-atlas/core";
import { AtlasStore } from "@component-atlas/store";

interface PackageJson {
  name?: string;
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface ScanProjectOptions {
  framework?: Framework;
  writeArtifacts?: boolean;
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

export interface SavePreviewScenarioInput {
  rootPath: string;
  component: string;
  name: string;
  id?: string;
  props?: Record<string, unknown>;
  tokens?: Record<string, string>;
  viewport?: PreviewViewport;
  background?: string;
  notes?: string;
}

const PREVIEW_STYLE_CANDIDATES = [
  "app/assets/css/main.css",
  "app/assets/css/app.css",
  "assets/css/main.css",
  "assets/css/app.css",
  "styles/main.css",
  "src/app/globals.css",
  "app/globals.css",
  "src/styles/globals.css",
  "styles/globals.css",
];

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

export async function detectPreviewStyleEnvironment(
  inputPath: string,
): Promise<PreviewStyleEnvironment> {
  const rootPath = path.resolve(inputPath);
  const entries: string[] = [];
  const contents: string[] = [];
  for (const candidate of PREVIEW_STYLE_CANDIDATES) {
    const filePath = path.join(rootPath, candidate);
    if (!(await exists(filePath))) continue;
    entries.push(slash(path.relative(rootPath, filePath)));
    contents.push(await readFile(filePath, "utf8"));
  }

  const manifest = await packageJson(rootPath);
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
  };
  const tailwindVersion = dependencies.tailwindcss;
  const usesTailwindImport = contents.some((content) =>
    /@import\s+(?:url\(\s*)?["']tailwindcss["']/.test(content),
  );
  const pipeline =
    usesTailwindImport || /^(\^|~|>=?)?4(?:\.|$)/.test(tailwindVersion ?? "")
      ? "tailwind-v4"
      : tailwindVersion
        ? "tailwind-v3"
        : entries.length > 0
          ? "project-css"
          : "none";

  return {
    pipeline,
    entryPoints: entries,
    sourceRegistration:
      pipeline === "tailwind-v4"
        ? "project-root"
        : pipeline === "tailwind-v3"
          ? "project-config"
          : "not-applicable",
  };
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
  return `# Component Atlas catalog

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

export async function scanProject(
  inputPath: string,
  options: ScanProjectOptions = {},
): Promise<ComponentGraph> {
  const rootPath = path.resolve(inputPath);
  const manifest = await packageJson(rootPath);
  const framework = options.framework ?? (await detectFramework(rootPath));
  const components =
    framework === "vue"
      ? await scanVueProject({ rootPath })
      : await scanReactProject({ rootPath });
  const tokens = await scanDesignTokens(rootPath);
  const metadata = {
    id: projectId(rootPath),
    name: manifest.name ?? path.basename(rootPath),
    rootPath,
    framework,
    ...(manifest.packageManager ? { packageManager: manifest.packageManager } : {}),
    scannedAt: new Date().toISOString(),
    sourceFiles: new Set(components.map((component) => component.relativePath)).size,
  };
  const graph: ComponentGraph = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    project: metadata,
    components,
    edges: buildGraphEdges(components),
    tokens,
  };
  const store = new AtlasStore(metadata.id);
  try {
    store.replaceGraph(graph);
  } finally {
    store.close();
  }
  if (options.writeArtifacts !== false) await writeProjectArtifacts(graph);
  return graph;
}

export async function loadProjectGraph(
  inputPath: string,
  options: { scanIfMissing?: boolean } = {},
): Promise<ComponentGraph> {
  const rootPath = path.resolve(inputPath);
  const id = projectId(rootPath);
  const store = new AtlasStore(id);
  try {
    const graph = store.loadGraph(id);
    if (graph) return graph;
  } finally {
    store.close();
  }
  if (options.scanIfMissing === false) {
    throw new Error(`No Component Atlas index exists for ${rootPath}.`);
  }
  return scanProject(rootPath);
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

export async function listPreviewScenarios(
  inputPath: string,
  componentSelector?: string,
): Promise<PreviewScenario[]> {
  const graph = await loadProjectGraph(inputPath);
  const component = componentSelector
    ? findComponent(graph, componentSelector)
    : undefined;
  if (componentSelector && !component) {
    throw new Error(`Component "${componentSelector}" was not found.`);
  }
  const store = new AtlasStore(graph.project.id);
  try {
    return store.listScenarios(graph.project.id, component?.id);
  } finally {
    store.close();
  }
}

export async function getComponentPlayground(
  inputPath: string,
  componentSelector: string,
): Promise<ComponentPlaygroundContract> {
  const graph = await loadProjectGraph(inputPath);
  const component = findComponent(graph, componentSelector);
  if (!component) {
    throw new Error(`Component "${componentSelector}" was not found.`);
  }
  const scenarios = await listPreviewScenarios(inputPath, component.id);
  const styling = await detectPreviewStyleEnvironment(graph.project.rootPath);
  return buildPlaygroundContract(graph, component, scenarios, styling);
}

export async function savePreviewScenario(
  input: SavePreviewScenarioInput,
): Promise<PreviewScenario> {
  const rootPath = path.resolve(input.rootPath);
  const name = input.name.trim();
  if (!name) throw new Error("Scenario name is required.");
  const graph = await loadProjectGraph(rootPath);
  const component = findComponent(graph, input.component);
  if (!component) {
    throw new Error(`Component "${input.component}" was not found.`);
  }
  const viewport = input.viewport ?? { width: 768, height: 560 };
  if (
    !Number.isInteger(viewport.width) ||
    !Number.isInteger(viewport.height) ||
    viewport.width < 240 ||
    viewport.width > 2560 ||
    viewport.height < 200 ||
    viewport.height > 1600
  ) {
    throw new Error("Viewport must be between 240x200 and 2560x1600.");
  }
  const now = new Date().toISOString();
  const existing = input.id
    ? (await listPreviewScenarios(rootPath, component.id)).find(
        (scenario) => scenario.id === input.id,
      )
    : undefined;
  const id =
    input.id ??
    createHash("sha256")
      .update(`${graph.project.id}\0${component.id}\0${name}`)
      .digest("hex")
      .slice(0, 24);
  const scenario: PreviewScenario = {
    id,
    projectId: graph.project.id,
    componentId: component.id,
    name,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    props: input.props ?? {},
    tokens: input.tokens ?? {},
    viewport,
    background: input.background ?? "#11161d",
    ...(input.notes ? { notes: input.notes } : {}),
  };
  const store = new AtlasStore(graph.project.id);
  try {
    store.saveScenario(scenario);
  } finally {
    store.close();
  }
  const directory = path.join(rootPath, ".component-atlas", "scenarios");
  await mkdir(directory, { recursive: true });
  const fileName = `${component.effectiveName}-${name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  await writeFile(
    path.join(directory, `${fileName || scenario.id}.json`),
    `${JSON.stringify(scenario, null, 2)}\n`,
    "utf8",
  );
  return scenario;
}

export function graphSummary(graph: ComponentGraph): Record<string, unknown> {
  const edgeCounts = Object.fromEntries(
    ["renders", "similar_to", "tested_by"].map((kind) => [
      kind,
      graph.edges.filter((edge) => edge.kind === kind).length,
    ]),
  );
  return {
    project: graph.project.name,
    framework: graph.project.framework,
    components: graph.components.length,
    public: graph.components.filter((item) => item.visibility === "public").length,
    feature: graph.components.filter((item) => item.visibility === "feature").length,
    private: graph.components.filter((item) => item.visibility === "private").length,
    edges: edgeCounts,
    tokens: graph.tokens.length,
    scannedAt: graph.project.scannedAt,
  };
}
