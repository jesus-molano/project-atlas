import {
  mkdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { ComponentGraph } from "@component-atlas/core";
import {
  MEMORY_SCHEMA_VERSION,
  assertMemoryContentSafe,
  fitBudgetedResponse,
  memoryItemMarkdown,
  type MemoryFinding,
  type MemoryItem,
  type MemoryItemDraft,
  type MemoryProposal,
  type MemoryProposalReview,
  type MemoryScope,
  type MemoryWriteTarget,
} from "@component-atlas/memory";
import {
  projectStorageDirectory,
} from "@component-atlas/store";
import { loadProjectGraph } from "./scan.js";
import {
  slash,
  hash,
  memoryId,
  proposalId,
  exists,
  memoryStore,
  graphCheckoutId,
  ensureMemoryIndexed,
  memoryGate,
} from "./memory.js";

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

const memoryTypes = new Set<MemoryItem["type"]>([
  "project",
  "domain",
  "glossary-term",
  "subsystem",
  "module",
  "convention",
  "decision",
  "constraint",
  "integration",
  "known-issue",
  "fragile-area",
  "attempt",
  "outcome",
  "plan",
  "debt",
  "note",
]);
const memoryAuthorities = new Set<MemoryItem["authority"]>([
  "observed",
  "inferred",
  "decided",
  "verified",
]);
const memoryScopes = new Set<MemoryScope>([
  "canonical",
  "local",
  "episodic",
]);

function assertMemoryDrafts(items: MemoryItemDraft[]): void {
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) {
    throw new Error("A memory proposal requires between 1 and 20 typed items.");
  }
  for (const [index, item] of items.entries()) {
    if (
      !item ||
      typeof item !== "object" ||
      !memoryTypes.has(item.type) ||
      !memoryAuthorities.has(item.authority) ||
      !item.title?.trim() ||
      !item.summary?.trim() ||
      !Number.isFinite(item.confidence) ||
      item.confidence < 0 ||
      item.confidence > 1 ||
      (item.scope !== undefined && !memoryScopes.has(item.scope))
    ) {
      throw new Error(`Memory proposal item ${index + 1} is invalid.`);
    }
  }
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
  assertMemoryDrafts(input.items);
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
      store.listMemoryItems(graph.project.id, graphCheckoutId(graph)),
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
    ...(scope === "canonical"
      ? {}
      : { checkoutId: graphCheckoutId(graph) }),
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

function proposalReview(
  proposal: MemoryProposal,
  graph: ComponentGraph,
  target: MemoryWriteTarget,
): MemoryProposalReview {
  const gate = memoryGate(proposal.findings);
  const directory =
    target === "canonical"
      ? ("atlas-storage/memory/canonical" as const)
      : ("atlas-storage/memory/local" as const);
  const items = proposal.items.map((draft) => {
    const item = itemFromDraft(
      draft,
      graph,
      proposal.createdAt,
      target === "canonical"
        ? "canonical"
        : draft.scope === "episodic"
          ? "episodic"
          : "local",
    );
    return {
      id: item.id,
      type: item.type,
      title: item.title,
      scope: item.scope,
      path: `${directory}/${safeFileName(item.id)}.md`,
      supersedes: item.supersedes,
    };
  });
  const blockingFindingIds = proposal.findings
    .filter((finding) => finding.level === "decision-required")
    .map((finding) => finding.id);
  const warningFindingIds = proposal.findings
    .filter((finding) => finding.level === "warning")
    .map((finding) => finding.id);
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    proposalId: proposal.id,
    proposalStatus: proposal.status,
    target,
    canApply: proposal.status === "pending" && blockingFindingIds.length === 0,
    requiresCanonicalConfirmation: target === "canonical",
    gate: {
      status: gate.status,
      blockingFindingIds,
      warningFindingIds,
    },
    impact: {
      directory,
      itemCount: items.length,
      supersededIds: [
        ...new Set(items.flatMap((item) => item.supersedes)),
      ],
      items,
    },
  };
}

export async function reviewMemoryProposal(
  rootPath: string,
  proposalIdValue: string,
  options: { target?: MemoryWriteTarget } = {},
): Promise<MemoryProposalReview> {
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
    return proposalReview(proposal, graph, options.target ?? "local");
  } finally {
    store.close();
  }
}

async function writeMemoryItem(
  rootPath: string,
  item: MemoryItem,
  target: MemoryWriteTarget,
): Promise<MemoryItem> {
  const directory =
    target === "canonical"
      ? path.join(
          projectStorageDirectory(item.projectId),
          "memory",
          "canonical",
        )
      : path.join(
          projectStorageDirectory(item.projectId),
          "memory",
          "local",
        );
  await mkdir(directory, { recursive: true });
  const storageRoot = projectStorageDirectory(item.projectId);
  const [realStorageRoot, realDirectory] = await Promise.all([
    realpath(storageRoot),
    realpath(directory),
  ]);
  const directoryRelative = path.relative(realStorageRoot, realDirectory);
  if (
    directoryRelative.startsWith("..") ||
    path.isAbsolute(directoryRelative)
  ) {
    throw new Error("Refusing to write memory outside Project Atlas storage.");
  }
  const filePath = path.join(directory, `${safeFileName(item.id)}.md`);
  const relativePath = `atlas-storage/${slash(
    path.relative(storageRoot, filePath),
  )}`;
  const next = { ...item, bodyPath: relativePath };
  await writeFile(filePath, memoryItemMarkdown(next), "utf8");
  return next;
}

async function rewriteSupersededSource(
  rootPath: string,
  item: MemoryItem,
): Promise<void> {
  if (!item.bodyPath) return;
  if (!item.bodyPath.startsWith("atlas-storage/")) {
    // Repository-local memory is legacy read-only compatibility data.
    return;
  }
  const storageRoot = projectStorageDirectory(item.projectId);
  const storageRelative = item.bodyPath.slice("atlas-storage/".length);
  const absolute = path.resolve(storageRoot, storageRelative);
  const relative = path.relative(storageRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `Refusing to rewrite memory outside Project Atlas storage: ${item.bodyPath}`,
    );
  }
  if (await exists(absolute)) {
    const [realRoot, realSource] = await Promise.all([
      realpath(storageRoot),
      realpath(absolute),
    ]);
    const realRelative = path.relative(realRoot, realSource);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new Error(
        `Refusing to rewrite memory outside project scope: ${item.bodyPath}`,
      );
    }
    await writeFile(realSource, memoryItemMarkdown(item), "utf8");
  }
}

export async function applyMemoryUpdate(
  rootPath: string,
  proposalIdValue: string,
  options: {
    confirmed: boolean;
    target?: MemoryWriteTarget;
    canonicalConfirmed?: boolean;
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
    const target = options.target ?? "local";
    const review = proposalReview(proposal, graph, target);
    if (!review.canApply) {
      const titles = proposal.findings
        .filter((finding) => finding.level === "decision-required")
        .map((finding) => finding.title)
        .join("; ");
      throw new Error(
        `Memory proposal "${proposalIdValue}" has unresolved decision-required findings and cannot be applied${titles ? `: ${titles}` : "."}`,
      );
    }
    if (target === "canonical" && options.canonicalConfirmed !== true) {
      throw new Error(
        "Canonical Project Memory writes require canonicalConfirmed=true after reviewing the centralized Atlas storage paths.",
      );
    }
    assertMemoryContentSafe(proposal);
    const appliedAt = new Date().toISOString();
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
        const previous = store.loadMemoryItem(
          graph.project.id,
          supersededId,
          graphCheckoutId(graph),
        );
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
        impact: review.impact,
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
  assertMemoryDrafts(input.items);
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
      store.listMemoryItems(graph.project.id, graphCheckoutId(graph)),
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
      store.listMemoryItems(graph.project.id, graphCheckoutId(graph)),
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
  if (
    !input.task.trim() ||
    !input.summary.trim() ||
    !["success", "failure", "partial"].includes(input.result)
  ) {
    throw new Error(
      "A task outcome requires a task, a summary, and a valid result.",
    );
  }
  assertMemoryContentSafe(input);
  const graph = await loadProjectGraph(input.rootPath);
  const createdAt = new Date().toISOString();
  const id = `outcome:${hash(
    `${graph.project.id}\0${graphCheckoutId(graph)}\0${createdAt}\0${input.task}`,
  ).slice(0, 20)}`;
  let item: MemoryItem = {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    id,
    projectId: graph.project.id,
    checkoutId: graphCheckoutId(graph),
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
