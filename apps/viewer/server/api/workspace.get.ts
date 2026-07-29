import type { MemoryItem } from "@component-atlas/memory";
import type { ProjectAtlasSnapshot } from "@component-atlas/runtime";
import { designIndexSummary } from "@component-atlas/design";
import {
  buildProjectOverviewViewModel,
  getProjectCapabilities,
  listAgentRunAudits,
  listTaskEvaluations,
} from "@component-atlas/runtime";
import { agentAdapterStatus } from "../utils/agent-runs";
import {
  buildActionCenterSnapshot,
  listActionResolutionsForSnapshot,
} from "../utils/action-center";
import { loadProjectAtlasSnapshot, projectGitState } from "../utils/project";

function uniqueContradictions(items: MemoryItem[]) {
  const active = new Map(
    items.filter((item) => item.status === "active").map((item) => [item.id, item]),
  );
  const seen = new Set<string>();
  return items.flatMap((item) =>
    item.relations.flatMap((relation) => {
      if (
        relation.kind !== "contradicts" ||
        !active.has(item.id) ||
        !active.has(relation.targetId)
      ) {
        return [];
      }
      const key = [item.id, relation.targetId].sort().join("::");
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          id: `contradiction:${key}`,
          level: "decision-required" as const,
          kind: "contradiction",
          title: `${item.title} conflicts with ${active.get(relation.targetId)!.title}`,
          evidence: [item.summary, active.get(relation.targetId)!.summary],
          recommendation:
            "Review provenance and explicitly supersede the rule that is no longer authoritative.",
          memoryIds: [item.id, relation.targetId],
        },
      ];
    }),
  );
}

function projectRisks(snapshot: ProjectAtlasSnapshot) {
  const now = new Date().toISOString();
  const stale = snapshot.memoryItems
    .filter(
      (item) =>
        item.status === "active" && item.reviewAfter && item.reviewAfter < now,
    )
    .map((item) => ({
      id: `stale:${item.id}`,
      level: "warning" as const,
      kind: "stale-knowledge",
      title: `Review ${item.title}`,
      evidence: [`Review date passed: ${item.reviewAfter}.`, item.summary],
      recommendation:
        "Verify this knowledge against current code or product evidence.",
      memoryIds: [item.id],
    }));
  const fragile = snapshot.memoryItems
    .filter(
      (item) =>
        item.status === "active" &&
        (item.type === "fragile-area" ||
          item.type === "known-issue" ||
          ((item.type === "attempt" || item.type === "outcome") &&
            item.tags.includes("failed"))),
    )
    .map((item) => ({
      id: `fragile:${item.id}`,
      level: "warning" as const,
      kind:
        item.type === "attempt" || item.type === "outcome"
          ? "failed-attempt"
          : item.type,
      title: item.title,
      evidence: [item.summary, ...(item.provenance.evidence ?? []).slice(0, 2)],
      recommendation:
        item.type === "attempt" || item.type === "outcome"
          ? "Check why the prior approach failed before changing this area."
          : "Inspect the linked evidence and affected entities before editing.",
      memoryIds: [item.id],
    }));
  const superseded = snapshot.memoryItems
    .filter((item) => item.status === "superseded")
    .map((item) => ({
      id: `superseded:${item.id}`,
      level: "resolved" as const,
      kind: "superseded",
      title: item.title,
      evidence: [
        item.supersededBy
          ? `Superseded by ${item.supersededBy}.`
          : "Marked as superseded.",
      ],
      recommendation: "Use the active replacement.",
      memoryIds: [item.id, ...(item.supersededBy ? [item.supersededBy] : [])],
    }));
  const design = snapshot.designIndexes.flatMap((index) =>
    designIndexSummary(index).findings.map((finding) => ({
      id: `design:${index.file.key}:${finding.id}`,
      level: finding.level,
      kind: finding.code,
      title: finding.title,
      evidence: [
        `${index.file.name ?? index.file.key} · indexed ${index.indexedAt}`,
        ...finding.evidence,
      ],
      recommendation: finding.recommendation,
      memoryIds: [],
      designNodeIds: finding.nodeIds ?? [],
    })),
  );
  return [
    ...uniqueContradictions(snapshot.memoryItems),
    ...design,
    ...fragile,
    ...stale,
    ...superseded,
  ];
}

export default defineEventHandler(async () => {
  const snapshot = loadProjectAtlasSnapshot();
  const [capabilities, evaluations, agentRuns, agent] = await Promise.all([
    getProjectCapabilities(snapshot.graph.project.rootPath),
    listTaskEvaluations(snapshot.graph.project.rootPath, 20),
    listAgentRunAudits(snapshot.graph.project.rootPath, 12),
    agentAdapterStatus(),
  ]);
  const currentDecisions = [
    ...snapshot.componentDecisions.map((decision) => ({
      id: decision.id,
      type: "component-reuse" as const,
      title: `${decision.decision}: ${decision.intent}`,
      summary: decision.rationale,
      status: "recorded" as const,
      provenance: "code-atlas" as const,
      updatedAt: decision.createdAt,
    })),
    ...snapshot.memoryItems
      .filter(
        (item) =>
          item.status === "active" &&
          ["decision", "constraint", "convention"].includes(item.type),
      )
      .map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        summary: item.summary,
        status: item.status,
        provenance: "project-memory" as const,
        updatedAt: item.updatedAt,
      })),
  ].filter(
    (decision, index, items) =>
      items.findIndex((candidate) => candidate.id === decision.id) === index,
  );
  const actionResolutions = listActionResolutionsForSnapshot(snapshot);
  const actionCenter = buildActionCenterSnapshot(
    snapshot,
    capabilities,
    agentRuns,
    actionResolutions,
  );
  return {
    schemaVersion: 1,
    generatedAt: snapshot.capturedAt,
    fingerprint: snapshot.fingerprint,
    graph: snapshot.graph,
    overview: buildProjectOverviewViewModel(snapshot, snapshot.capturedAt),
    designIndexes: snapshot.designIndexes,
    memoryItems: snapshot.memoryItems,
    memoryProposals: snapshot.memoryProposals,
    currentDecisions,
    capabilities,
    agent,
    evaluations,
    agentRuns,
    actionResolutions: actionResolutions.slice(0, 12),
    actionCenterCounts: actionCenter.counts,
    git: projectGitState(),
    risks: projectRisks(snapshot),
  };
});
