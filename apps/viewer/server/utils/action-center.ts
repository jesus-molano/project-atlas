import { createHash, randomUUID } from "node:crypto";
import {
  ACTION_CENTER_SCHEMA_VERSION,
  actionStateForCommand,
  applyActionResolutions,
  compactActionDelta,
  isBulkSafeAction,
  isOpenActionState,
  nextMaterialAction,
  validateActionMutation,
  type ActionCenterItem,
  type ActionCenterMutation,
  type ActionCenterSnapshot,
  type ActionEvidenceHandle,
  type ActionResolution,
  type AgentRunAuditRecord,
  type ProjectCapabilityReport,
} from "@component-atlas/core";
import { designIndexSummary } from "@component-atlas/design";
import { assertMemoryContentSafe } from "@component-atlas/memory";
import type { ProjectAtlasSnapshot } from "@component-atlas/runtime";
import { AtlasStore } from "@component-atlas/store";
import { createError } from "h3";
import { getAgentRun, resumeAgentRun } from "./agent-runs";

function shortHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 20);
}

function evidenceFingerprint(evidence: ActionEvidenceHandle[]): string {
  return shortHash(
    evidence.map((entry) => [
      entry.source,
      entry.id,
      entry.handle,
      entry.label,
      entry.summary,
      entry.uri,
      entry.observedAt,
    ]),
  );
}

function checkoutId(snapshot: ProjectAtlasSnapshot): string {
  return (
    snapshot.graph.project.identity?.checkoutId ??
    shortHash(snapshot.graph.project.rootPath.toLowerCase())
  );
}

function baseItem(
  snapshot: ProjectAtlasSnapshot,
  input: Omit<
    ActionCenterItem,
    | "schemaVersion"
    | "projectId"
    | "checkoutId"
    | "evidenceFingerprint"
    | "detectedAt"
    | "updatedAt"
  > & { detectedAt?: string; updatedAt?: string },
): ActionCenterItem {
  const detectedAt = input.detectedAt ?? snapshot.capturedAt;
  const updatedAt = input.updatedAt ?? detectedAt;
  return {
    ...input,
    schemaVersion: ACTION_CENTER_SCHEMA_VERSION,
    projectId: snapshot.graph.project.id,
    checkoutId: checkoutId(snapshot),
    evidenceFingerprint: evidenceFingerprint(input.evidence),
    detectedAt,
    updatedAt,
  };
}

function memoryEvidence(
  item: ProjectAtlasSnapshot["memoryItems"][number],
): ActionEvidenceHandle {
  return {
    id: item.id,
    source: "memory",
    label: item.title,
    handle: `memory:${item.id}`,
    summary: item.summary.slice(0, 500),
    ...(item.provenance.uri ? { uri: item.provenance.uri } : {}),
    observedAt: item.updatedAt,
  };
}

function contradictionItems(snapshot: ProjectAtlasSnapshot): ActionCenterItem[] {
  const active = new Map(
    snapshot.memoryItems
      .filter((item) => item.status === "active")
      .map((item) => [item.id, item]),
  );
  const seen = new Set<string>();
  return snapshot.memoryItems.flatMap((item) =>
    item.relations.flatMap((relation) => {
      const other = active.get(relation.targetId);
      if (
        relation.kind !== "contradicts" ||
        !active.has(item.id) ||
        !other
      ) {
        return [];
      }
      const pair = [item.id, other.id].sort();
      const key = pair.join("::");
      if (seen.has(key)) return [];
      seen.add(key);
      const evidence = [memoryEvidence(item), memoryEvidence(other)];
      return [
        baseItem(snapshot, {
          id: `contradiction:${key}`,
          type: "contradiction",
          state: "awaiting-decision",
          severity: "high",
          blocking: true,
          title: `${item.title} conflicts with ${other.title}`,
          detected:
            "Atlas found two active Project Memory rules that contradict each other.",
          whyItMatters:
            "Both rules cannot govern the same implementation without an explicit authority and scope.",
          affectedTask: `Any task governed by ${pair.join(" or ")}`,
          consequence:
            "A task can implement the wrong rule or oscillate between incompatible outcomes.",
          recommendation:
            "Compare provenance, choose the authoritative source and scope, or request clarification.",
          source: "memory",
          provenance: evidence.map((entry) => ({
            source: "memory" as const,
            canonicalId: entry.id,
            rule: "active-memory-contradiction",
            observedAt: entry.observedAt ?? snapshot.capturedAt,
          })),
          evidence,
          options: evidence.map((entry) => ({
            id: entry.handle,
            label: `${entry.label} is authoritative`,
            detail: entry.summary,
          })),
        }),
      ];
    }),
  );
}

function memoryRiskItems(snapshot: ProjectAtlasSnapshot): ActionCenterItem[] {
  const now = snapshot.capturedAt;
  return snapshot.memoryItems.flatMap((item) => {
    if (item.status === "superseded") {
      const evidence = [memoryEvidence(item)];
      return [
        baseItem(snapshot, {
          id: `superseded:${item.id}`,
          type: "warning",
          state: "superseded",
          severity: "info",
          blocking: false,
          title: item.title,
          detected: "Atlas found knowledge already marked as superseded.",
          whyItMatters: "Inactive guidance should not be used as current context.",
          affectedTask: item.supersededBy
            ? `Tasks should use replacement ${item.supersededBy}`
            : "Tasks retrieving Project Memory",
          consequence: "None while consumers use the active replacement.",
          recommendation: "Use the active replacement.",
          source: "memory",
          provenance: [{
            source: "memory",
            canonicalId: item.id,
            rule: "superseded-memory",
            observedAt: item.updatedAt,
          }],
          evidence,
          updatedAt: item.updatedAt,
        }),
      ];
    }
    if (item.status !== "active") return [];
    const stale = Boolean(item.reviewAfter && item.reviewAfter < now);
    const fragile =
      item.type === "fragile-area" ||
      item.type === "known-issue" ||
      ((item.type === "attempt" || item.type === "outcome") &&
        item.tags.includes("failed"));
    if (!stale && !fragile) return [];
    const evidence = [memoryEvidence(item)];
    const affectedHandles = item.relations
      .map((relation) => relation.targetId)
      .slice(0, 3);
    return [
      baseItem(snapshot, {
        id: `${stale ? "stale" : "risk"}:${item.id}`,
        type: fragile ? "risk" : "warning",
        state: stale ? "stale" : "new",
        severity: fragile ? "high" : "medium",
        blocking: false,
        title: stale ? `Review ${item.title}` : item.title,
        detected: stale
          ? `The review date ${item.reviewAfter} passed.`
          : "Atlas matched this task area to a fragile area, known issue, or failed attempt.",
        whyItMatters: stale
          ? "The stored rule may no longer match current code or design."
          : "Repeating the same approach can reproduce a known failure.",
        affectedTask:
          affectedHandles.join(", ") || "The current task using this memory item",
        consequence: stale
          ? "Codex may rely on outdated guidance."
          : "The task may regress the affected behavior or repeat prior rework.",
        recommendation: stale
          ? "Verify the memory against current evidence, add it as a check, postpone it, or ignore it with a reason."
          : "Mitigate in the current task, create a bounded follow-up task, or explicitly accept the risk.",
        source: "memory",
        provenance: [{
          source: "memory",
          canonicalId: item.id,
          rule: stale ? "memory-review-date" : "fragile-memory",
          observedAt: item.updatedAt,
        }],
        evidence,
        componentIds: item.relations
          .filter((relation) => relation.kind === "references_code")
          .map((relation) => relation.targetId)
          .slice(0, 8),
        updatedAt: item.updatedAt,
      }),
    ];
  });
}

function designItems(snapshot: ProjectAtlasSnapshot): ActionCenterItem[] {
  return snapshot.designIndexes.flatMap((index) =>
    designIndexSummary(index).findings
      .filter((finding) => finding.level !== "resolved")
      .map((finding) => {
        const evidence: ActionEvidenceHandle[] = [
          {
            id: index.file.key,
            source: "design",
            label: index.file.name ?? index.file.key,
            handle: `design:${index.file.key}`,
            summary: finding.evidence.slice(0, 3).join(" ").slice(0, 500),
            uri: index.file.url,
            observedAt: index.indexedAt,
          },
          ...(finding.nodeIds ?? []).slice(0, 6).map((nodeId) => ({
            id: nodeId,
            source: "design" as const,
            label: nodeId,
            handle: `design:${index.file.key}:${nodeId}`,
            summary: "Affected indexed design node.",
            observedAt: index.indexedAt,
          })),
        ];
        const decision = finding.level === "decision-required";
        return baseItem(snapshot, {
          id: `design:${index.file.key}:${finding.id}`,
          type: decision ? "decision-required" : "warning",
          state: decision ? "awaiting-decision" : "new",
          severity: decision ? "high" : "medium",
          blocking: decision,
          title: finding.title,
          detected: `Atlas applied the ${finding.code} rule to indexed design metadata.`,
          whyItMatters:
            finding.evidence[0] ?? "The design evidence is incomplete or ambiguous.",
          affectedTask: `Implementation using ${index.file.name ?? index.file.key} and ${(finding.nodeIds ?? []).length || 1} indexed target(s)`,
          consequence: decision
            ? "Implementation should not continue until the ambiguity is resolved."
            : "The task may drift from the indexed design intent.",
          recommendation: finding.recommendation,
          source: "design",
          provenance: [{
            source: "design",
            canonicalId: finding.id,
            rule: finding.code,
            observedAt: index.indexedAt,
          }],
          evidence,
          componentIds: finding.nodeIds?.slice(0, 8),
          detectedAt: index.indexedAt,
          updatedAt: index.indexedAt,
        });
      }),
  );
}

function awaitingRunItems(
  snapshot: ProjectAtlasSnapshot,
  runs: AgentRunAuditRecord[],
): ActionCenterItem[] {
  return runs
    .filter(
      (run) =>
        run.projectId === snapshot.graph.project.id &&
        run.checkoutId === checkoutId(snapshot) &&
        run.state === "awaiting-input",
    )
    .map((run) => {
      const evidence: ActionEvidenceHandle[] = [{
        id: run.id,
        source: "agent",
        label: `Run ${run.id.slice(0, 8)}`,
        handle: `agent:${run.id}`,
        summary: `Awaiting one material answer · ${run.contextChars}/${run.budgetChars} context characters.`,
        observedAt: run.updatedAt,
      }];
      return baseItem(snapshot, {
        id: `run-decision:${run.id}`,
        type: "decision-required",
        state: "awaiting-decision",
        severity: "high",
        blocking: true,
        title: "Codex is waiting for a project decision",
        detected:
          "The originating run completed with needs-input and remains bound to this checkout.",
        whyItMatters:
          "Only a human answer can unblock this run; starting or resuming another run would lose provenance.",
        affectedTask: `Originating Codex run ${run.id.slice(0, 8)}`,
        consequence: "The originating task remains paused.",
        recommendation:
          "Record a concise answer and continue this exact run, or postpone it with explicit scope.",
        source: "agent",
        provenance: [{
          source: "agent",
          canonicalId: run.id,
          rule: "agent-run-needs-input",
          observedAt: run.updatedAt,
        }],
        evidence,
        runId: run.id,
        detectedAt: run.startedAt,
        updatedAt: run.updatedAt,
      });
    });
}

function missingEvidenceItems(
  snapshot: ProjectAtlasSnapshot,
  capabilities: ProjectCapabilityReport,
): ActionCenterItem[] {
  return capabilities.observations
    .filter(
      (observation) =>
        observation.kind === "connector" &&
        ["unavailable", "permission-required", "degraded"].includes(
          observation.state,
        ),
    )
    .map((observation) => {
      const connector: NonNullable<ActionCenterItem["connector"]> =
        observation.id === "atlassian-rovo"
          ? "atlassian-rovo"
          : observation.id === "figma"
            ? "figma"
            : "github";
      const evidence: ActionEvidenceHandle[] = [{
        id: observation.id,
        source: "integration",
        label: observation.id,
        handle: `integration:${observation.id}`,
        summary: `${observation.state}: ${observation.detail ?? "No connector detail available."}`,
        observedAt: observation.checkedAt,
      }];
      return baseItem(snapshot, {
        id: `missing-evidence:${observation.id}`,
        type: "missing-evidence",
        state: "new",
        severity: "medium",
        blocking: false,
        title: `${observation.id} evidence is not available`,
        detected: `The local capability report says ${observation.id} is ${observation.state}.`,
        whyItMatters:
          "A task that depends on this source cannot claim its requirements or design evidence were verified.",
        affectedTask: `Tasks depending on ${observation.id}`,
        consequence:
          "Atlas will continue in a clearly degraded mode and exclude unavailable evidence.",
        recommendation:
          "Connect or select the source, choose an alternative handle, or explicitly continue without it.",
        source: "integration",
        provenance: [{
          source: "integration",
          canonicalId: observation.id,
          rule: "connector-capability",
          observedAt: observation.checkedAt,
        }],
        evidence,
        connector,
        detectedAt: observation.checkedAt,
        updatedAt: observation.checkedAt,
      });
    });
}

export function buildActionCenterSnapshot(
  snapshot: ProjectAtlasSnapshot,
  capabilities: ProjectCapabilityReport,
  runs: AgentRunAuditRecord[],
  resolutions: ActionResolution[],
): ActionCenterSnapshot {
  const projected = [
    ...contradictionItems(snapshot),
    ...awaitingRunItems(snapshot, runs),
    ...designItems(snapshot),
    ...memoryRiskItems(snapshot),
    ...missingEvidenceItems(snapshot, capabilities),
  ];
  const items = applyActionResolutions(projected, resolutions, snapshot.capturedAt);
  return {
    schemaVersion: ACTION_CENTER_SCHEMA_VERSION,
    projectId: snapshot.graph.project.id,
    checkoutId: checkoutId(snapshot),
    workspaceFingerprint: snapshot.fingerprint,
    generatedAt: snapshot.capturedAt,
    items,
    counts: {
      materialBlockers: items.filter(
        (item) => item.blocking && isOpenActionState(item.state),
      ).length,
      open: items.filter((item) => isOpenActionState(item.state)).length,
      stale: items.filter((item) => item.state === "stale").length,
    },
  };
}

export function listActionResolutionsForSnapshot(
  snapshot: ProjectAtlasSnapshot,
): ActionResolution[] {
  const store = new AtlasStore(snapshot.graph.project.id);
  try {
    return store.listActionResolutions(
      snapshot.graph.project.id,
      checkoutId(snapshot),
    );
  } finally {
    store.close();
  }
}

export interface ActionMutationResult {
  resolution: ActionResolution;
  duplicate: boolean;
  delta?: ReturnType<typeof compactActionDelta>;
  followUpTask?: { id: string; intent: string; handles: string[] };
  continuedRun?: ReturnType<typeof resumeAgentRun>;
  connector?: { id: string; available: false; next: "connections" };
}

function resolutionFromMutation(
  center: ActionCenterSnapshot,
  item: ActionCenterItem,
  mutation: ActionCenterMutation,
  resolvedAt: string,
): ActionResolution {
  const followUpId =
    mutation.command === "create-follow-up-task" ? randomUUID() : undefined;
  return {
    schemaVersion: ACTION_CENTER_SCHEMA_VERSION,
    id: randomUUID(),
    itemId: item.id,
    projectId: center.projectId,
    checkoutId: center.checkoutId,
    ...(mutation.runId ? { runId: mutation.runId } : {}),
    ...(mutation.taskId || followUpId
      ? { taskId: mutation.taskId ?? followUpId }
      : {}),
    command: mutation.command,
    state: actionStateForCommand(mutation.command),
    scope: mutation.scope,
    reason: mutation.reason.trim(),
    ...(mutation.selectedOption
      ? { selectedOption: mutation.selectedOption }
      : {}),
    ...(mutation.authorityHandle
      ? { authorityHandle: mutation.authorityHandle }
      : {}),
    ...(mutation.alternativeHandle
      ? { alternativeHandle: mutation.alternativeHandle }
      : {}),
    ...(mutation.deferUntil ? { deferUntil: mutation.deferUntil } : {}),
    evidenceFingerprint: item.evidenceFingerprint,
    idempotencyKey: mutation.idempotencyKey,
    resolvedAt,
  };
}

function assertCurrentMutation(
  center: ActionCenterSnapshot,
  mutation: ActionCenterMutation,
  options: { bulk?: boolean } = {},
): ActionCenterItem {
  if (mutation.expectedWorkspaceFingerprint !== center.workspaceFingerprint) {
    throw createError({
      statusCode: 409,
      statusMessage:
        "The Atlas checkout snapshot changed after review. Refresh before acting.",
    });
  }
  const item = center.items.find((candidate) => candidate.id === mutation.itemId);
  if (!item) {
    throw createError({
      statusCode: 404,
      statusMessage: "The action item no longer exists in this checkout.",
    });
  }
  const errors = validateActionMutation(item, mutation, options);
  if (errors.length) {
    throw createError({ statusCode: 409, statusMessage: errors.join(" ") });
  }
  assertMemoryContentSafe({
    reason: mutation.reason,
    selectedOption: mutation.selectedOption,
    authorityHandle: mutation.authorityHandle,
    alternativeHandle: mutation.alternativeHandle,
  });
  return item;
}

export function executeActionMutation(
  center: ActionCenterSnapshot,
  mutation: ActionCenterMutation,
): ActionMutationResult {
  const item = assertCurrentMutation(center, mutation);
  const store = new AtlasStore(center.projectId);
  try {
    const duplicate = store
      .listActionResolutions(center.projectId, center.checkoutId)
      .find((resolution) => resolution.idempotencyKey === mutation.idempotencyKey);
    if (duplicate) {
      if (duplicate.itemId !== item.id) {
        throw createError({
          statusCode: 409,
          statusMessage: "The idempotency key is already bound to another action item.",
        });
      }
      return { resolution: duplicate, duplicate: true };
    }

    const delta = compactActionDelta(item, mutation);
    let continuedRun: ReturnType<typeof resumeAgentRun> | undefined;
    if (mutation.command === "save-decision-and-continue") {
      const run = getAgentRun(item.runId!);
      if (
        run.id !== mutation.runId ||
        run.projectId !== center.projectId ||
        run.checkoutId !== center.checkoutId ||
        run.state !== "awaiting-input"
      ) {
        throw createError({
          statusCode: 409,
          statusMessage:
            "The originating run is unavailable, belongs to another scope, or is no longer awaiting this decision.",
        });
      }
      continuedRun = resumeAgentRun(item.runId!, {
        answer: JSON.stringify(delta),
      });
    }

    const resolution = resolutionFromMutation(
      center,
      item,
      mutation,
      new Date().toISOString(),
    );
    const saved = store.saveActionResolution(resolution);
    return {
      resolution: saved,
      duplicate: false,
      ...(["resolve-decision", "mitigate-current-task", "add-check", "use-alternative"].includes(
        mutation.command,
      )
        ? { delta }
        : {}),
      ...(mutation.command === "create-follow-up-task"
        ? {
            followUpTask: {
              id: saved.taskId!,
              intent: `${item.recommendation} Resolve Atlas action ${item.id}.`,
              handles: item.evidence.map((entry) => entry.handle).slice(0, 8),
            },
          }
        : {}),
      ...(continuedRun ? { continuedRun } : {}),
      ...(mutation.command === "connect-source"
        ? {
            connector: {
              id: item.connector ?? "unknown",
              available: false as const,
              next: "connections" as const,
            },
          }
        : {}),
    };
  } finally {
    store.close();
  }
}

export function executeBulkActionMutations(
  center: ActionCenterSnapshot,
  mutations: ActionCenterMutation[],
): ActionMutationResult[] {
  if (!mutations.length || mutations.length > 50) {
    throw createError({
      statusCode: 400,
      statusMessage: "Bulk actions require between 1 and 50 items.",
    });
  }
  const itemIds = new Set<string>();
  const requestKeys = new Set<string>();
  const items = mutations.map((mutation) => {
    if (!isBulkSafeAction(mutation.command)) {
      throw createError({
        statusCode: 409,
        statusMessage: `${mutation.command} is not bulk-safe.`,
      });
    }
    if (itemIds.has(mutation.itemId) || requestKeys.has(mutation.idempotencyKey)) {
      throw createError({
        statusCode: 409,
        statusMessage: "Bulk actions require unique items and idempotency keys.",
      });
    }
    itemIds.add(mutation.itemId);
    requestKeys.add(mutation.idempotencyKey);
    return assertCurrentMutation(center, mutation, { bulk: true });
  });

  const store = new AtlasStore(center.projectId);
  try {
    const prior = store.listActionResolutions(center.projectId, center.checkoutId);
    const duplicates = new Map(
      prior.map((resolution) => [resolution.idempotencyKey, resolution]),
    );
    const now = new Date().toISOString();
    const pending: ActionResolution[] = [];
    const projected = mutations.map((mutation, index) => {
      const duplicate = duplicates.get(mutation.idempotencyKey);
      if (duplicate) {
        if (duplicate.itemId !== items[index]!.id) {
          throw createError({
            statusCode: 409,
            statusMessage:
              "An idempotency key is already bound to another action item.",
          });
        }
        return { resolution: duplicate, duplicate: true };
      }
      const resolution = resolutionFromMutation(
        center,
        items[index]!,
        mutation,
        now,
      );
      pending.push(resolution);
      return { resolution, duplicate: false };
    });
    const saved = store.saveActionResolutions(pending);
    let cursor = 0;
    return projected.map((result) =>
      result.duplicate
        ? result
        : { resolution: saved[cursor++]!, duplicate: false },
    );
  } finally {
    store.close();
  }
}

export function resolveNextItem(center: ActionCenterSnapshot): string | undefined {
  return nextMaterialAction(center.items)?.id;
}
