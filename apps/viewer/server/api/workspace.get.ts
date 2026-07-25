import type { MemoryItem } from "@component-atlas/memory";
import type { ProjectAtlasSnapshot } from "@component-atlas/runtime";
import { designIndexSummary } from "@component-atlas/design";
import { loadProjectAtlasSnapshot } from "../utils/project";

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

export default defineEventHandler(() => {
  const snapshot = loadProjectAtlasSnapshot();
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    designIndexes: snapshot.designIndexes,
    memoryItems: snapshot.memoryItems,
    memoryProposals: snapshot.memoryProposals,
    risks: projectRisks(snapshot),
  };
});
