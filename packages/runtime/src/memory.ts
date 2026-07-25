import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  buildReuseContext,
  searchComponentContext,
  type ComponentGraph,
} from "@component-atlas/core";
import {
  decisionGate,
  designIndexSummary,
  rankDesignCandidates,
  type DesignFinding,
} from "@component-atlas/design";
import {
  MEMORY_SCHEMA_VERSION,
  assertMemoryContentSafe,
  compactMemorySearch,
  fitBudgetedResponse,
  memoryItemMarkdown,
  parseMemoryMarkdown,
  rankMemoryItems,
  type MemoryFinding,
  type MemoryItem,
  type MemoryItemDraft,
  type MemoryProposal,
  type MemoryScope,
  type MemorySearchOptions,
} from "@component-atlas/memory";
import { AtlasStore } from "@component-atlas/store";
import fg from "fast-glob";
import { loadProjectGraph } from "./index.js";

export { fitBudgetedResponse } from "@component-atlas/memory";

const MEMORY_PATTERNS = [
  "project-memory/**/*.md",
  "docs/project-memory/**/*.md",
  ".component-atlas/memory/**/*.md",
];

function slash(value: string): string {
  return value.replaceAll(path.sep, "/");
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function memoryId(
  namespace: string,
  type: string,
  title: string,
): string {
  return `memory:${hash(
    `${namespace}\0${type}\0${title.toLowerCase()}`,
  ).slice(0, 20)}`;
}

function proposalId(projectId: string, createdAt: string, rationale: string) {
  return `proposal:${hash(`${projectId}\0${createdAt}\0${rationale}`).slice(0, 20)}`;
}

function boundedLimit(value: number | undefined, fallback = 5): number {
  return Number.isInteger(value) && (value ?? 0) > 0
    ? Math.min(value ?? fallback, 10)
    : fallback;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function memoryStore(graph: ComponentGraph): AtlasStore {
  return new AtlasStore(graph.project.id);
}

async function ensureMemoryIndexed(
  rootPath: string,
  graph: ComponentGraph,
): Promise<void> {
  const store = memoryStore(graph);
  try {
    if (store.memoryCounts(graph.project.id).total > 0) return;
  } finally {
    store.close();
  }
  await indexProjectMemory(rootPath);
}

export async function indexProjectMemory(rootPath: string) {
  const graph = await loadProjectGraph(rootPath);
  const absoluteRoot = graph.project.rootPath;
  const files = await fg(MEMORY_PATTERNS, {
    cwd: absoluteRoot,
    absolute: true,
    onlyFiles: true,
    unique: true,
    dot: true,
    ignore: ["**/node_modules/**"],
  });
  const entries: Array<{ item: MemoryItem; sourceHash: string }> = [];
  const sourceById = new Map<string, string>();
  for (const filePath of files.sort()) {
    const source = await readFile(filePath, "utf8");
    if (!source.startsWith("---")) continue;
    const relativePath = slash(path.relative(absoluteRoot, filePath));
    const local = relativePath.startsWith(".component-atlas/");
    const item = parseMemoryMarkdown(source, {
      projectId: graph.project.id,
      projectName: graph.project.name,
      sourcePath: relativePath,
      defaultScope: local ? "local" : "canonical",
    });
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
    store.replaceMarkdownMemory(graph.project.id, entries);
    const counts = store.memoryCounts(graph.project.id);
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
    const item = store.loadMemoryItem(graph.project.id, id);
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
    const items = store.listMemoryItems(graph.project.id);
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
      .listDecisions(graph.project.id)
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
        components: graph.components.length,
        relations: graph.edges.length,
        modules: [...modules.entries()]
          .sort((left, right) => right[1] - left[1])
          .slice(0, 8)
          .map(([name, components]) => ({ name, components })),
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
        counts: store.memoryCounts(graph.project.id),
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

function memoryGate(findings: MemoryFinding[]) {
  const required = findings.filter(
    (finding) => finding.level === "decision-required" && finding.question,
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
      question: finding.question!,
      evidence: finding.evidence
        .slice(0, 2)
        .map((item) => (item.length > 180 ? `${item.slice(0, 179)}…` : item)),
      recommendation: finding.recommendation,
    })),
  };
}

function findingsForMemory(
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
    const candidates = store.searchMemoryCandidates(graph.project.id, query, 100);
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

export async function getTaskContext(
  rootPath: string,
  task: string,
  options: {
    figmaFile?: string;
    budgetChars?: number;
    refreshMemory?: boolean;
    topK?: number;
  } = {},
) {
  const graph = await loadProjectGraph(rootPath);
  if (options.refreshMemory) await indexProjectMemory(rootPath);
  else await ensureMemoryIndexed(rootPath, graph);
  const store = memoryStore(graph);
  try {
    const topK = boundedLimit(options.topK, 3);
    const memoryCandidates = store.searchMemoryCandidates(
      graph.project.id,
      task,
      100,
    );
    const rankedMemory = rankMemoryItems(memoryCandidates, task).slice(0, topK);
    const reuse = buildReuseContext(graph, task, topK);
    const indexes = store.listDesignIndexes(graph.project.id);
    const selectedIndex = options.figmaFile
      ? indexes.find(
          (index) =>
            index.file.key === options.figmaFile ||
            index.file.url === options.figmaFile,
        )
      : indexes.length === 1
        ? indexes[0]
        : undefined;
    const design = selectedIndex
      ? rankDesignCandidates(selectedIndex, task, {
          limit: topK,
          codeSignals: reuse.candidates.map(
            (candidate) => candidate.component.name,
          ),
        })
      : undefined;
    const memoryFindings = findingsForMemory(
      rankMemoryItems(memoryCandidates, task, {
        includeInactive: true,
      }),
    );
    const designFindings: DesignFinding[] = design?.findings ?? [];
    const findings = [
      ...memoryFindings,
      ...designFindings.map((finding) => ({
        ...finding,
        source: "design" as const,
      })),
    ];
    const gate = {
      memory: memoryGate(memoryFindings),
      design: design ? decisionGate(designFindings) : { status: "clear", questions: [] },
    };
    const overallGate = {
      status:
        gate.memory.status === "blocked" || gate.design.status === "blocked"
          ? ("blocked" as const)
          : gate.memory.status === "review" || gate.design.status === "review"
            ? ("review" as const)
            : ("clear" as const),
      questions: [...gate.memory.questions, ...gate.design.questions],
    };
    const payload = {
      schemaVersion: 1,
      task: task.trim(),
      project: {
        name: graph.project.name,
        framework: graph.project.framework,
        scannedAt: graph.project.scannedAt,
      },
      memory: rankedMemory.slice(0, topK).map(({ item, score, reasons }) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        summary: item.summary,
        authority: item.authority,
        confidence: item.confidence,
        score,
        reasons: reasons.slice(0, 2),
      })),
      code: reuse.candidates.slice(0, topK).map((candidate) => ({
        id: candidate.component.id,
        name: candidate.component.name,
        path: candidate.component.path,
        scope: candidate.component.scope,
        reasons: candidate.match.reasons.slice(0, 2),
        directConsumers: candidate.impact.directConsumers,
        transitiveConsumers: candidate.impact.transitiveConsumers,
      })),
      design: {
        available: Boolean(selectedIndex),
        ...(indexes.length > 1 && !selectedIndex
          ? {
              selectionRequired: true,
              files: indexes.slice(0, 5).map((index) => ({
                key: index.file.key,
                name: index.file.name,
              })),
            }
          : {}),
        candidates:
          design?.candidates.slice(0, topK).map((candidate) => ({
            id: candidate.node.id,
            name: candidate.node.name,
            url: candidate.node.url,
            status: candidate.node.status,
            statusAvailability: candidate.node.statusAvailability,
            pageStatus: candidate.node.pageStatus,
            pageStatusAvailability: candidate.node.pageStatusAvailability,
            confidence: candidate.confidence,
            reasons: candidate.reasons.slice(0, 3),
          })) ?? [],
      },
      findings: findings.slice(0, 8),
      gate: { ...gate, overall: overallGate },
      nextSteps: [
        "Expand only the memory or component IDs needed for the decision.",
        "Run check_before_change on the chosen files before editing.",
        "After validation, record the outcome and propose any durable memory delta.",
      ],
    };
    return fitBudgetedResponse(payload, {
      budgetChars: options.budgetChars ?? 4_200,
      totalMatches:
        memoryCandidates.length +
        reuse.candidates.length +
        (design?.candidates.length ?? 0),
      expandableIds: [
        ...rankedMemory.map(({ item }) => item.id),
        ...reuse.candidates.map((candidate) => candidate.component.id),
        ...(design?.candidates.map((candidate) => candidate.node.id) ?? []),
      ],
      preserveKeys: ["findings", "questions"],
      preserveFirstKeys: ["memory", "code", "candidates"],
    });
  } finally {
    store.close();
  }
}

function proposalFindings(
  items: MemoryItemDraft[],
  existing: MemoryItem[],
): MemoryFinding[] {
  const findings: MemoryFinding[] = [];
  for (const draft of items) {
    const duplicate = existing.find(
      (item) =>
        item.status === "active" &&
        item.type === draft.type &&
        item.title.toLowerCase() === draft.title.toLowerCase() &&
        !(draft.supersedes ?? []).includes(item.id),
    );
    if (duplicate) {
      findings.push({
        id: `duplicate-memory:${duplicate.id}`,
        level: "warning",
        code: "duplicate-memory",
        title: `Possible duplicate memory: ${draft.title}`,
        evidence: [duplicate.summary, draft.summary],
        recommendation:
          "Update or supersede the existing item instead of creating a parallel rule.",
        memoryIds: [duplicate.id],
      });
    }
    for (const relation of draft.relations ?? []) {
      if (relation.kind !== "contradicts") continue;
      const target = existing.find(
        (item) => item.id === relation.targetId && item.status === "active",
      );
      if (!target) continue;
      findings.push({
        id: `memory-contradiction:proposal:${target.id}`,
        level: "decision-required",
        code: "memory-contradiction",
        title: `Proposed memory contradicts ${target.title}`,
        evidence: [target.summary, draft.summary],
        recommendation:
          "Confirm which rule remains authoritative and supersede the losing item explicitly.",
        question: `Should "${draft.title}" supersede "${target.title}"?`,
        memoryIds: [target.id],
      });
    }
  }
  return findings;
}

export interface ProposeMemoryUpdateInput {
  rootPath: string;
  rationale: string;
  evidence?: string[];
  proposedBy?: string;
  items: MemoryItemDraft[];
  budgetChars?: number;
}

export async function proposeMemoryUpdate(input: ProposeMemoryUpdateInput) {
  if (!input.rationale.trim() || input.items.length === 0) {
    throw new Error("A memory proposal needs a rationale and at least one item.");
  }
  assertMemoryContentSafe({
    rationale: input.rationale,
    evidence: input.evidence,
    items: input.items,
  });
  const graph = await loadProjectGraph(input.rootPath);
  await ensureMemoryIndexed(input.rootPath, graph);
  const store = memoryStore(graph);
  try {
    const createdAt = new Date().toISOString();
    const findings = proposalFindings(
      input.items,
      store.listMemoryItems(graph.project.id),
    );
    const proposal: MemoryProposal = {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      id: proposalId(graph.project.id, createdAt, input.rationale),
      projectId: graph.project.id,
      createdAt,
      status: "pending",
      rationale: input.rationale.trim(),
      evidence: (input.evidence ?? []).slice(0, 10),
      ...(input.proposedBy ? { proposedBy: input.proposedBy } : {}),
      items: input.items,
      findings,
    };
    store.saveMemoryProposal(proposal);
    return fitBudgetedResponse(
      {
        schemaVersion: 1,
        proposal: {
          id: proposal.id,
          status: proposal.status,
          rationale: proposal.rationale,
          items: proposal.items.map((item) => ({
            id: item.id,
            type: item.type,
            title: item.title,
            summary: item.summary,
            authority: item.authority,
            confidence: item.confidence,
          })),
        },
        findings,
        gate: memoryGate(findings),
        nextAction:
          "Review this proposal, resolve any decision-required finding, then call apply_memory_update with confirmed=true.",
      },
      {
        budgetChars: input.budgetChars,
        totalMatches: proposal.items.length,
        expandableIds: [proposal.id],
        preserveKeys: ["findings", "questions"],
      },
    );
  } finally {
    store.close();
  }
}

function itemFromDraft(
  draft: MemoryItemDraft,
  graph: ComponentGraph,
  createdAt: string,
  scope: MemoryScope,
): MemoryItem {
  const namespace =
    draft.namespace ?? graph.project.name.toLowerCase().replace(/\s+/g, "-");
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    id: draft.id ?? memoryId(namespace, draft.type, draft.title),
    projectId: graph.project.id,
    namespace,
    type: draft.type,
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    ...(draft.body?.trim() ? { body: draft.body.trim() } : {}),
    status: draft.status ?? "active",
    confidence: Math.max(0, Math.min(draft.confidence, 1)),
    authority: draft.authority,
    scope,
    createdAt,
    updatedAt: createdAt,
    ...(draft.verifiedAt ? { verifiedAt: draft.verifiedAt } : {}),
    ...(draft.owner ? { owner: draft.owner } : {}),
    tags: [...new Set(draft.tags ?? [])].slice(0, 20),
    provenance: {
      kind: "agent-proposal",
      ...(draft.provenance?.uri ? { uri: draft.provenance.uri } : {}),
      evidence: draft.provenance?.evidence ?? [],
    },
    supersedes: [...new Set(draft.supersedes ?? [])],
    ...(draft.expiresAt ? { expiresAt: draft.expiresAt } : {}),
    ...(draft.reviewAfter ? { reviewAfter: draft.reviewAfter } : {}),
    relations: draft.relations ?? [],
  };
}

function safeFileName(id: string): string {
  return id.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80);
}

async function writeMemoryItem(
  rootPath: string,
  item: MemoryItem,
  target: "local" | "canonical",
): Promise<MemoryItem> {
  const directory =
    target === "canonical"
      ? path.join(rootPath, "project-memory")
      : path.join(rootPath, ".component-atlas", "memory");
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${safeFileName(item.id)}.md`);
  const relativePath = slash(path.relative(rootPath, filePath));
  const next = { ...item, bodyPath: relativePath };
  await writeFile(filePath, memoryItemMarkdown(next), "utf8");
  return next;
}

async function rewriteSupersededSource(
  rootPath: string,
  item: MemoryItem,
): Promise<void> {
  if (!item.bodyPath) return;
  const absolute = path.resolve(rootPath, item.bodyPath);
  const relative = path.relative(rootPath, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to rewrite memory outside project scope: ${item.bodyPath}`);
  }
  if (await exists(absolute)) {
    await writeFile(absolute, memoryItemMarkdown(item), "utf8");
  }
}

export async function applyMemoryUpdate(
  rootPath: string,
  proposalIdValue: string,
  options: {
    confirmed: boolean;
    target?: "local" | "canonical";
    budgetChars?: number;
  },
) {
  if (!options.confirmed) {
    throw new Error(
      "Durable memory writes require confirmed=true after reviewing the proposal.",
    );
  }
  const graph = await loadProjectGraph(rootPath);
  const store = memoryStore(graph);
  try {
    const proposal = store.loadMemoryProposal(
      graph.project.id,
      proposalIdValue,
    );
    if (!proposal) throw new Error(`Memory proposal "${proposalIdValue}" was not found.`);
    if (proposal.status !== "pending") {
      throw new Error(
        `Memory proposal "${proposalIdValue}" is already ${proposal.status}.`,
      );
    }
    assertMemoryContentSafe(proposal);
    const appliedAt = new Date().toISOString();
    const target = options.target ?? "local";
    const applied: MemoryItem[] = [];
    for (const draft of proposal.items) {
      let item = itemFromDraft(
        draft,
        graph,
        appliedAt,
        target === "canonical"
          ? "canonical"
          : draft.scope === "episodic"
            ? "episodic"
            : "local",
      );
      for (const supersededId of item.supersedes) {
        const previous = store.loadMemoryItem(graph.project.id, supersededId);
        if (!previous) continue;
        const superseded: MemoryItem = {
          ...previous,
          status: "superseded",
          supersededBy: item.id,
          updatedAt: appliedAt,
        };
        store.saveMemoryItem(graph.project.id, superseded, "confirmed");
        await rewriteSupersededSource(graph.project.rootPath, superseded);
      }
      item = await writeMemoryItem(graph.project.rootPath, item, target);
      store.saveMemoryItem(graph.project.id, item, "confirmed");
      applied.push(item);
    }
    const updated: MemoryProposal = {
      ...proposal,
      status: "applied",
      appliedAt,
      appliedItemIds: applied.map((item) => item.id),
    };
    store.saveMemoryProposal(updated);
    return fitBudgetedResponse(
      {
        schemaVersion: 1,
        proposalId: updated.id,
        status: updated.status,
        target,
        applied: applied.map((item) => ({
          id: item.id,
          type: item.type,
          title: item.title,
          summary: item.summary,
          path: item.bodyPath,
        })),
      },
      {
        budgetChars: options.budgetChars,
        totalMatches: applied.length,
        expandableIds: applied.map((item) => item.id),
      },
    );
  } finally {
    store.close();
  }
}

export async function rejectMemoryUpdate(
  rootPath: string,
  proposalIdValue: string,
  options: {
    confirmed: boolean;
    reason: string;
    budgetChars?: number;
  },
) {
  if (!options.confirmed) {
    throw new Error(
      "Rejecting a memory proposal requires confirmed=true after reviewing it.",
    );
  }
  const reason = options.reason.trim();
  if (!reason) {
    throw new Error("Rejecting a memory proposal requires a reason.");
  }
  assertMemoryContentSafe({ reason });
  const graph = await loadProjectGraph(rootPath);
  const store = memoryStore(graph);
  try {
    const proposal = store.loadMemoryProposal(
      graph.project.id,
      proposalIdValue,
    );
    if (!proposal) {
      throw new Error(`Memory proposal "${proposalIdValue}" was not found.`);
    }
    if (proposal.status !== "pending") {
      throw new Error(
        `Memory proposal "${proposalIdValue}" is already ${proposal.status}.`,
      );
    }
    const rejectedAt = new Date().toISOString();
    const updated: MemoryProposal = {
      ...proposal,
      status: "rejected",
      findings: [
        ...proposal.findings,
        {
          id: `proposal-rejected:${proposal.id}`,
          level: "resolved",
          code: "low-impact-default",
          title: "Memory proposal rejected after review",
          evidence: [reason],
          recommendation:
            "Keep the rejection rationale with the proposal for auditability.",
        },
      ],
      rejectedAt,
      rejectionReason: reason,
    };
    store.saveMemoryProposal(updated);
    return fitBudgetedResponse(
      {
        schemaVersion: 1,
        proposalId: updated.id,
        status: updated.status,
        reason,
        rejectedAt,
      },
      {
        budgetChars: options.budgetChars,
        totalMatches: 1,
        expandableIds: [updated.id],
      },
    );
  } finally {
    store.close();
  }
}

export async function reviseMemoryProposal(input: {
  rootPath: string;
  proposalId: string;
  rationale: string;
  evidence?: string[];
  items: MemoryItemDraft[];
  budgetChars?: number;
}) {
  const rationale = input.rationale.trim();
  if (!rationale || input.items.length === 0) {
    throw new Error("A memory proposal needs a rationale and at least one item.");
  }
  assertMemoryContentSafe({
    rationale,
    evidence: input.evidence,
    items: input.items,
  });
  const graph = await loadProjectGraph(input.rootPath);
  await ensureMemoryIndexed(input.rootPath, graph);
  const store = memoryStore(graph);
  try {
    const proposal = store.loadMemoryProposal(graph.project.id, input.proposalId);
    if (!proposal) {
      throw new Error(`Memory proposal "${input.proposalId}" was not found.`);
    }
    if (proposal.status !== "pending") {
      throw new Error(
        `Memory proposal "${input.proposalId}" is already ${proposal.status}.`,
      );
    }
    const findings = proposalFindings(
      input.items,
      store.listMemoryItems(graph.project.id),
    );
    const updated: MemoryProposal = {
      ...proposal,
      rationale,
      evidence: (input.evidence ?? []).slice(0, 10),
      items: input.items,
      findings,
    };
    store.saveMemoryProposal(updated);
    return fitBudgetedResponse(
      {
        schemaVersion: 1,
        proposal: {
          id: updated.id,
          status: updated.status,
          rationale: updated.rationale,
          items: updated.items,
        },
        findings,
        gate: memoryGate(findings),
      },
      {
        budgetChars: input.budgetChars,
        totalMatches: updated.items.length,
        expandableIds: [updated.id],
        preserveKeys: ["findings", "questions"],
      },
    );
  } finally {
    store.close();
  }
}

export async function combineMemoryProposals(input: {
  rootPath: string;
  targetProposalId: string;
  sourceProposalId: string;
  confirmed: boolean;
  budgetChars?: number;
}) {
  if (!input.confirmed) {
    throw new Error(
      "Combining memory proposals requires confirmed=true after reviewing both.",
    );
  }
  if (input.targetProposalId === input.sourceProposalId) {
    throw new Error("Choose two different memory proposals to combine.");
  }
  const graph = await loadProjectGraph(input.rootPath);
  await ensureMemoryIndexed(input.rootPath, graph);
  const store = memoryStore(graph);
  try {
    const target = store.loadMemoryProposal(
      graph.project.id,
      input.targetProposalId,
    );
    const source = store.loadMemoryProposal(
      graph.project.id,
      input.sourceProposalId,
    );
    if (!target || !source) {
      throw new Error("One of the memory proposals was not found.");
    }
    if (target.status !== "pending" || source.status !== "pending") {
      throw new Error("Only pending memory proposals can be combined.");
    }
    const byIdentity = new Map<string, MemoryItemDraft>();
    for (const item of [...target.items, ...source.items]) {
      byIdentity.set(
        item.id ?? `${item.type}:${item.title.trim().toLowerCase()}`,
        item,
      );
    }
    const items = [...byIdentity.values()];
    const findings = proposalFindings(
      items,
      store.listMemoryItems(graph.project.id),
    );
    const merged: MemoryProposal = {
      ...target,
      rationale: `${target.rationale}\n\nCombined with ${source.id}: ${source.rationale}`,
      evidence: [...new Set([...target.evidence, ...source.evidence])].slice(0, 10),
      items,
      findings,
    };
    const combinedAt = new Date().toISOString();
    const retired: MemoryProposal = {
      ...source,
      status: "rejected",
      rejectedAt: combinedAt,
      rejectionReason: `Combined into ${target.id}.`,
    };
    assertMemoryContentSafe(merged);
    store.saveMemoryProposal(merged);
    store.saveMemoryProposal(retired);
    return fitBudgetedResponse(
      {
        schemaVersion: 1,
        targetProposalId: merged.id,
        sourceProposalId: retired.id,
        status: "combined",
        itemCount: items.length,
        findings,
      },
      {
        budgetChars: input.budgetChars,
        totalMatches: items.length,
        expandableIds: [merged.id, retired.id],
        preserveKeys: ["findings", "questions"],
      },
    );
  } finally {
    store.close();
  }
}

export interface RecordOutcomeInput {
  rootPath: string;
  task: string;
  result: "success" | "failure" | "partial";
  summary: string;
  evidence?: string[];
  relatedEntityIds?: string[];
  files?: string[];
  budgetChars?: number;
}

export async function recordProjectOutcome(input: RecordOutcomeInput) {
  assertMemoryContentSafe(input);
  const graph = await loadProjectGraph(input.rootPath);
  const createdAt = new Date().toISOString();
  const id = `outcome:${hash(
    `${graph.project.id}\0${createdAt}\0${input.task}`,
  ).slice(0, 20)}`;
  let item: MemoryItem = {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    id,
    projectId: graph.project.id,
    namespace: graph.project.name.toLowerCase().replace(/\s+/g, "-"),
    type: "outcome",
    title: `${input.result}: ${input.task}`.slice(0, 120),
    summary: input.summary.trim(),
    body: [
      `Task: ${input.task}`,
      `Result: ${input.result}`,
      ...(input.files?.length ? [`Files: ${input.files.join(", ")}`] : []),
    ].join("\n"),
    status: "active",
    confidence: input.result === "success" ? 0.9 : 0.8,
    authority:
      input.result === "success" && (input.evidence?.length ?? 0) > 0
        ? "verified"
        : "observed",
    scope: "episodic",
    createdAt,
    updatedAt: createdAt,
    tags: [input.result, ...(input.result === "failure" ? ["failed"] : [])],
    provenance: {
      kind: "task-outcome",
      evidence: (input.evidence ?? []).slice(0, 12),
    },
    supersedes: [],
    relations: (input.relatedEntityIds ?? []).map((targetId) => ({
      kind: "related_to",
      targetId,
    })),
  };
  item = await writeMemoryItem(graph.project.rootPath, item, "local");
  const store = memoryStore(graph);
  try {
    store.saveMemoryItem(graph.project.id, item, "outcome");
  } finally {
    store.close();
  }
  return fitBudgetedResponse(
    {
      schemaVersion: 1,
      outcome: {
        id: item.id,
        result: input.result,
        summary: item.summary,
        path: item.bodyPath,
        authority: item.authority,
      },
      nextAction:
        "If this task established a durable decision, convention, constraint, or fix, propose it separately with propose_memory_update.",
    },
    {
      budgetChars: input.budgetChars,
      totalMatches: 1,
      expandableIds: [item.id],
    },
  );
}
