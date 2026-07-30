import {
  createHash,
} from "node:crypto";
import {
  access,
  readFile,
} from "node:fs/promises";
import path from "node:path";
import {
  searchComponentContext,
  type ComponentGraph,
} from "@component-atlas/core";
import {
  designIndexSummary,
  rankDesignCandidates,
} from "@component-atlas/design";
import {
  MEMORY_SCHEMA_VERSION,
  assertMemoryContentSafe,
  compactMemorySearch,
  fitBudgetedResponse,
  parseMemoryMarkdown,
  rankMemoryItems,
  type MemoryFinding,
  type MemoryItem,
  type MemorySearchOptions,
} from "@component-atlas/memory";
import {
  AtlasStore,
  projectStorageDirectory,
} from "@component-atlas/store";
import fg from "fast-glob";
import { loadProjectGraph } from "./scan.js";

export { fitBudgetedResponse } from "@component-atlas/memory";

const MEMORY_PATTERNS = [
  "project-memory/**/*.md",
  "docs/project-memory/**/*.md",
  ".component-atlas/memory/**/*.md",
];

export function slash(value: string): string {
  return value.replaceAll(path.sep, "/");
}

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function memoryId(
  namespace: string,
  type: string,
  title: string,
): string {
  return `memory:${hash(
    `${namespace}\0${type}\0${title.toLowerCase()}`,
  ).slice(0, 20)}`;
}

export function proposalId(projectId: string, createdAt: string, rationale: string) {
  return `proposal:${hash(`${projectId}\0${createdAt}\0${rationale}`).slice(0, 20)}`;
}

export function boundedLimit(value: number | undefined, fallback = 5): number {
  return Number.isInteger(value) && (value ?? 0) > 0
    ? Math.min(value ?? fallback, 10)
    : fallback;
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function memoryStore(graph: ComponentGraph): AtlasStore {
  return new AtlasStore(graph.project.id);
}

export function graphCheckoutId(graph: ComponentGraph): string {
  const checkoutId = graph.project.identity?.checkoutId;
  if (!checkoutId) {
    throw new Error("Project memory requires a resolved checkout identity.");
  }
  return checkoutId;
}

export async function ensureMemoryIndexed(
  rootPath: string,
  graph: ComponentGraph,
): Promise<void> {
  const store = memoryStore(graph);
  try {
    if (
      store.memoryCounts(graph.project.id, graphCheckoutId(graph)).total > 0
    ) {
      return;
    }
  } finally {
    store.close();
  }
  await indexProjectMemory(rootPath);
}

export async function indexProjectMemory(rootPath: string) {
  const graph = await loadProjectGraph(rootPath);
  const absoluteRoot = graph.project.rootPath;
  const legacyFiles = await fg(MEMORY_PATTERNS, {
    cwd: absoluteRoot,
    absolute: true,
    onlyFiles: true,
    unique: true,
    dot: true,
    ignore: ["**/node_modules/**"],
    followSymbolicLinks: false,
  });
  const storageRoot = projectStorageDirectory(graph.project.id);
  const storageFiles = await fg(["memory/**/*.md"], {
    cwd: storageRoot,
    absolute: true,
    onlyFiles: true,
    unique: true,
    dot: true,
    followSymbolicLinks: false,
  });
  const files = [...new Set([...legacyFiles, ...storageFiles])];
  const entries: Array<{ item: MemoryItem; sourceHash: string }> = [];
  const sourceById = new Map<string, string>();
  for (const filePath of files.sort()) {
    const source = await readFile(filePath, "utf8");
    if (!source.startsWith("---")) continue;
    const inStorage =
      path.relative(storageRoot, filePath) !== "" &&
      !path.relative(storageRoot, filePath).startsWith("..") &&
      !path.isAbsolute(path.relative(storageRoot, filePath));
    const relativePath = inStorage
      ? `atlas-storage/${slash(path.relative(storageRoot, filePath))}`
      : slash(path.relative(absoluteRoot, filePath));
    const local =
      relativePath.startsWith(".component-atlas/") ||
      relativePath.startsWith("atlas-storage/memory/local/");
    const parsed = parseMemoryMarkdown(source, {
      projectId: graph.project.id,
      projectName: graph.project.name,
      sourcePath: relativePath,
      defaultScope: local ? "local" : "canonical",
    });
    const item: MemoryItem =
      parsed.scope === "canonical"
        ? parsed
        : { ...parsed, checkoutId: graphCheckoutId(graph) };
    assertMemoryContentSafe(item);
    const duplicateSource = sourceById.get(item.id);
    if (duplicateSource) {
      throw new Error(
        `Duplicate Project Memory ID "${item.id}" in ${duplicateSource} and ${relativePath}. Supersede or merge the items explicitly.`,
      );
    }
    sourceById.set(item.id, relativePath);
    entries.push({
      item,
      sourceHash: hash(source),
    });
  }
  const store = memoryStore(graph);
  try {
    const checkoutId = graphCheckoutId(graph);
    store.replaceMarkdownMemory(graph.project.id, entries, checkoutId);
    const counts = store.memoryCounts(graph.project.id, checkoutId);
    return fitBudgetedResponse(
      {
        schemaVersion: MEMORY_SCHEMA_VERSION,
        project: graph.project.name,
        indexedFiles: files.length,
        indexedItems: entries.length,
        counts,
        sources: {
          canonical: entries.filter(
            (entry) => entry.item.scope === "canonical",
          ).length,
          local: entries.filter((entry) => entry.item.scope === "local").length,
          episodic: entries.filter(
            (entry) => entry.item.scope === "episodic",
          ).length,
        },
      },
      {
        totalMatches: entries.length,
        expandableIds: entries.map((entry) => entry.item.id),
      },
    );
  } finally {
    store.close();
  }
}

export async function searchProjectMemory(
  rootPath: string,
  query: string,
  options: MemorySearchOptions = {},
) {
  const graph = await loadProjectGraph(rootPath);
  await ensureMemoryIndexed(rootPath, graph);
  const store = memoryStore(graph);
  try {
    const candidates = store.searchMemoryCandidates(
      graph.project.id,
      query,
      100,
      graphCheckoutId(graph),
    );
    return compactMemorySearch(candidates, query, options);
  } finally {
    store.close();
  }
}

export async function getProjectMemoryItem(
  rootPath: string,
  id: string,
  options: { budgetChars?: number } = {},
) {
  const graph = await loadProjectGraph(rootPath);
  await ensureMemoryIndexed(rootPath, graph);
  const store = memoryStore(graph);
  try {
    const item = store.loadMemoryItem(
      graph.project.id,
      id,
      graphCheckoutId(graph),
    );
    if (!item) {
      throw new Error(`Project memory item "${id}" was not found.`);
    }
    return fitBudgetedResponse(
      {
        schemaVersion: MEMORY_SCHEMA_VERSION,
        item,
        relatedHandles: item.relations.map((relation) => ({
          kind: relation.kind,
          id: relation.targetId,
        })),
      },
      {
        budgetChars: options.budgetChars,
        totalMatches: 1,
        expandableIds: [
          item.id,
          ...item.relations.map((relation) => relation.targetId),
        ],
      },
    );
  } finally {
    store.close();
  }
}

function sourceCounts(items: MemoryItem[]) {
  return {
    canonical: items.filter((item) => item.scope === "canonical").length,
    local: items.filter((item) => item.scope === "local").length,
    episodic: items.filter((item) => item.scope === "episodic").length,
  };
}

export async function orientProject(
  rootPath: string,
  options: { budgetChars?: number; refreshMemory?: boolean } = {},
) {
  const graph = await loadProjectGraph(rootPath);
  if (options.refreshMemory) await indexProjectMemory(rootPath);
  else await ensureMemoryIndexed(rootPath, graph);
  const store = memoryStore(graph);
  try {
    const items = store.listMemoryItems(
      graph.project.id,
      graphCheckoutId(graph),
    );
    const active = items.filter((item) => item.status === "active");
    const domains = active
      .filter((item) => item.type === "domain")
      .slice(0, 5)
      .map((item) => ({ id: item.id, title: item.title, summary: item.summary }));
    const modules = new Map<string, number>();
    for (const component of graph.components) {
      const owner = component.feature ?? component.relativePath.split("/")[0] ?? "root";
      modules.set(owner, (modules.get(owner) ?? 0) + 1);
    }
    const indexes = store.listDesignIndexes(graph.project.id);
    const componentCatalog = store.listComponentCatalog(graph.project.id);
    const pendingProposals = store.listMemoryProposals(
      graph.project.id,
      "pending",
    );
    const memoryDecisions = active
      .filter((item) =>
        ["decision", "constraint", "convention"].includes(item.type),
      )
      .slice(0, 5)
      .map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        summary: item.summary,
      }));
    const reuseDecisions = store
      .listDecisions(
        graph.project.id,
        graph.project.identity?.checkoutId,
      )
      .slice(0, 5)
      .map((decision) => ({
        id: decision.id,
        type: "reuse-decision",
        title: `${decision.decision}: ${decision.intent}`,
        summary: decision.rationale,
        createdAt: decision.createdAt,
      }));
    const decisions = [...reuseDecisions, ...memoryDecisions].slice(0, 5);
    const payload = {
      schemaVersion: 1,
      project: {
        id: graph.project.id,
        name: graph.project.name,
        framework: graph.project.framework,
        scannedAt: graph.project.scannedAt,
      },
      codeAtlas: {
        nodes: graph.components.length,
        components: graph.components.filter(
          (component) => (component.kind ?? "component") === "component",
        ).length,
        relations: graph.edges.length,
        profile: graph.project.profile
          ? {
              frameworks: graph.project.profile.frameworks,
              packages: graph.project.profile.packages.length,
              metaFrameworks: [
                ...new Set(
                  graph.project.profile.packages.flatMap((packageProfile) =>
                    packageProfile.metaFramework
                      ? [packageProfile.metaFramework]
                      : [],
                  ),
                ),
              ],
              confidence: graph.project.profile.confidence,
            }
          : undefined,
        coverage: graph.project.scan?.coverage
          ? {
              candidateFiles: graph.project.scan.coverage.candidateFiles,
              parsedFiles: graph.project.scan.coverage.parsedFiles,
              skippedFiles: graph.project.scan.coverage.skippedFiles,
              errorFiles: graph.project.scan.coverage.errorFiles,
              complete: graph.project.scan.coverage.complete,
            }
          : undefined,
        modules: [...modules.entries()]
          .sort((left, right) => right[1] - left[1])
          .slice(0, 8)
          .map(([name, components]) => ({ name, components })),
        sharedCatalog: {
          entries: componentCatalog.length,
          divergent: componentCatalog.filter((entry) => entry.divergent).length,
          examples: componentCatalog.slice(0, 5).map((entry) => ({
            semanticKey: entry.semanticKey,
            name: entry.effectiveName,
            path: entry.relativePath,
            checkouts: entry.sightings.length,
            divergent: entry.divergent,
          })),
        },
      },
      designAtlas: {
        files: indexes.length,
        summaries: indexes.slice(0, 3).map((index) => {
          const summary = designIndexSummary(index);
          return {
            key: summary.file.key,
            name: summary.file.name,
            pages: summary.stats.pages,
            nodes: summary.stats.nodes,
            readyForDev: summary.stats.readyForDev,
          };
        }),
      },
      projectMemory: {
        counts: store.memoryCounts(
          graph.project.id,
          graphCheckoutId(graph),
        ),
        sources: sourceCounts(items),
        domains,
        currentDecisions: decisions,
        pendingProposals: pendingProposals.slice(0, 3).map((proposal) => ({
          id: proposal.id,
          rationale: proposal.rationale,
          items: proposal.items.length,
          createdAt: proposal.createdAt,
        })),
      },
      nextSteps: [
        "Search memory only for the current task or area.",
        "Request one item by ID when its summary is insufficient.",
        "Use get_task_context before broad manual exploration.",
      ],
    };
    return fitBudgetedResponse(payload, {
      budgetChars: options.budgetChars,
      totalMatches:
        graph.components.length + indexes.length + active.length,
      expandableIds: [
        ...[...domains, ...decisions].map((item) => item.id),
        ...pendingProposals.map((proposal) => proposal.id),
      ],
      preserveFirstKeys: ["pendingProposals"],
    });
  } finally {
    store.close();
  }
}

export function memoryGate(findings: MemoryFinding[]) {
  const required = findings.filter(
    (finding) => finding.level === "decision-required",
  );
  return {
    status:
      required.length > 0
        ? ("blocked" as const)
        : findings.some((finding) => finding.level === "warning")
          ? ("review" as const)
          : ("clear" as const),
    questions: required.map((finding) => ({
      findingId: finding.id,
      question:
        finding.question ??
        "Resolve this decision-required finding before applying the proposal.",
      evidence: finding.evidence
        .slice(0, 2)
        .map((item) => (item.length > 180 ? `${item.slice(0, 179)}…` : item)),
      recommendation: finding.recommendation,
    })),
  };
}

export function findingsForMemory(
  ranked: Array<{ item: MemoryItem; score: number; reasons: string[] }>,
  now = new Date().toISOString(),
): MemoryFinding[] {
  const relevant = ranked.slice(0, 12).map((candidate) => candidate.item);
  const byId = new Map(relevant.map((item) => [item.id, item]));
  const findings: MemoryFinding[] = [];
  const seenContradictions = new Set<string>();
  for (const item of relevant) {
    for (const relation of item.relations.filter(
      (candidate) => candidate.kind === "contradicts",
    )) {
      const target = byId.get(relation.targetId);
      if (!target || item.status !== "active" || target.status !== "active") {
        continue;
      }
      const key = [item.id, target.id].sort().join(":");
      if (seenContradictions.has(key)) continue;
      seenContradictions.add(key);
      findings.push({
        id: `memory-contradiction:${key}`,
        level: "decision-required",
        code: "memory-contradiction",
        title: "Active project memories contradict each other",
        evidence: [
          `${item.title}: ${item.summary}`,
          `${target.title}: ${target.summary}`,
        ],
        recommendation:
          "Prefer the more authoritative and recently verified item, then supersede the other explicitly.",
        question: `Which project rule should govern this change: "${item.title}" or "${target.title}"?`,
        memoryIds: [item.id, target.id],
      });
    }
    if (
      item.status === "active" &&
      (item.type === "fragile-area" || item.type === "known-issue")
    ) {
      findings.push({
        id: `fragile-area:${item.id}`,
        level: "warning",
        code: "failed-attempt",
        title: `Known risk in this area: ${item.title}`,
        evidence: [item.summary],
        recommendation:
          "Inspect the linked evidence and include a focused regression check before changing this area.",
        memoryIds: [item.id],
      });
    }
    if (
      item.status === "active" &&
      (item.type === "attempt" || item.type === "outcome") &&
      (item.tags.includes("failed") ||
        /\b(failed|failure|fallo|falló|no funcion)/i.test(
          `${item.summary} ${item.body ?? ""}`,
        ))
    ) {
      findings.push({
        id: `failed-attempt:${item.id}`,
        level: "warning",
        code: "failed-attempt",
        title: `A previous attempt failed: ${item.title}`,
        evidence: [item.summary],
        recommendation:
          "Do not repeat the same approach until its failure condition has been checked.",
        memoryIds: [item.id],
      });
    }
    if (
      item.status === "active" &&
      item.reviewAfter &&
      item.reviewAfter < now
    ) {
      findings.push({
        id: `stale-memory:${item.id}`,
        level: "warning",
        code: "stale-memory",
        title: `Project memory needs review: ${item.title}`,
        evidence: [`Review date passed: ${item.reviewAfter}.`, item.summary],
        recommendation:
          "Verify this item against current code or product evidence before relying on it.",
        memoryIds: [item.id],
      });
    }
    if (item.status === "superseded") {
      findings.push({
        id: `superseded-memory:${item.id}`,
        level: "resolved",
        code: "superseded-memory",
        title: `Superseded memory excluded: ${item.title}`,
        evidence: [
          item.supersededBy
            ? `Superseded by ${item.supersededBy}.`
            : "Status is superseded.",
        ],
        recommendation: "Use the active replacement instead.",
        memoryIds: [item.id, ...(item.supersededBy ? [item.supersededBy] : [])],
      });
    }
  }
  return findings;
}

export async function checkBeforeChange(
  rootPath: string,
  intent: string,
  options: {
    files?: string[];
    budgetChars?: number;
  } = {},
) {
  const graph = await loadProjectGraph(rootPath);
  await ensureMemoryIndexed(rootPath, graph);
  const query = `${intent} ${(options.files ?? []).join(" ")}`.trim();
  const store = memoryStore(graph);
  try {
    const candidates = store.searchMemoryCandidates(
      graph.project.id,
      query,
      100,
      graphCheckoutId(graph),
    );
    const ranked = rankMemoryItems(candidates, query, {
      includeInactive: true,
    });
    const memoryFindings =
      ranked.length === 0
        ? [
            {
              id: "cold-start:memory",
              level: "resolved" as const,
              code: "cold-start" as const,
              title: "No relevant project memory exists yet",
              evidence: ["The scoped memory search returned no matching items."],
              recommendation:
                "Continue with repository evidence and propose a memory delta only if the task teaches something durable.",
            },
          ]
        : findingsForMemory(ranked);
    const indexes = store.listDesignIndexes(graph.project.id);
    const designResult =
      indexes.length === 1
        ? rankDesignCandidates(indexes[0]!, intent, {
            limit: 3,
            codeSignals: searchComponentContext(graph, intent, 3).map(
              (candidate) => candidate.component.name,
            ),
          })
        : undefined;
    const designFindings = designResult?.findings ?? [];
    const memoryDecisionGate = memoryGate(memoryFindings);
    const designDecisionGate = designResult?.gate ?? {
      status: "clear" as const,
      questions: [],
    };
    const gate = {
      status:
        memoryDecisionGate.status === "blocked" ||
        designDecisionGate.status === "blocked"
          ? ("blocked" as const)
          : memoryDecisionGate.status === "review" ||
              designDecisionGate.status === "review"
            ? ("review" as const)
            : ("clear" as const),
      questions: [
        ...memoryDecisionGate.questions,
        ...designDecisionGate.questions,
      ],
      sources: {
        memory: memoryDecisionGate.status,
        design: designDecisionGate.status,
      },
    };
    const findings = [
      ...memoryFindings,
      ...designFindings.map((finding) => ({
        ...finding,
        source: "design" as const,
      })),
    ];
    return fitBudgetedResponse(
      {
        schemaVersion: 1,
        intent: intent.trim(),
        findings,
        gate,
        relevantMemory:
          findings.length > 0
            ? []
            : ranked.slice(0, 4).map(({ item, score }) => ({
                id: item.id,
                type: item.type,
                title: item.title,
                status: item.status,
                authority: item.authority,
                score,
              })),
      },
      {
        budgetChars: options.budgetChars,
        totalMatches: ranked.length,
        expandableIds: ranked.slice(0, 10).map(({ item }) => item.id),
        preserveKeys: ["findings", "questions"],
      },
    );
  } finally {
    store.close();
  }
}
