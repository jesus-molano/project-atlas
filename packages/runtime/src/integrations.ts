import { createHash } from "node:crypto";
import type {
  AgentRunAuditRecord,
  CapabilityObservation,
  CapabilityState,
  ConnectorKind,
  EnrichmentKind,
  ProjectCapabilityReport,
  TaskEvaluationRecord,
} from "@component-atlas/core";
import { AtlasStore } from "@component-atlas/store";
import { assertMemoryContentSafe } from "@component-atlas/memory";
import { loadProjectGraph } from "./index.js";

const CONNECTORS = new Set<ConnectorKind>([
  "figma",
  "atlassian-rovo",
  "github",
]);
const ENRICHMENTS = new Set<EnrichmentKind>([
  "ready-for-dev",
  "figma-variables",
  "code-connect",
  "figma-libraries",
]);
const STATES = new Set<CapabilityState>([
  "connected",
  "detected",
  "unavailable",
  "not-exposed",
  "permission-required",
  "unknown",
  "degraded",
]);

export interface CapabilityObservationInput {
  id: ConnectorKind | EnrichmentKind;
  state: CapabilityState;
  detail?: string;
}

function capabilityKind(
  id: ConnectorKind | EnrichmentKind,
): "connector" | "enrichment" {
  if (CONNECTORS.has(id as ConnectorKind)) return "connector";
  if (ENRICHMENTS.has(id as EnrichmentKind)) return "enrichment";
  throw new Error(`Unknown Project Atlas capability "${id}".`);
}

export async function reportProjectCapabilities(
  rootPath: string,
  inputs: CapabilityObservationInput[],
  checkedAt = new Date().toISOString(),
): Promise<ProjectCapabilityReport> {
  if (inputs.length === 0 || inputs.length > 16) {
    throw new Error("Report between 1 and 16 capability observations.");
  }
  assertMemoryContentSafe(inputs);
  const graph = await loadProjectGraph(rootPath);
  const seen = new Set<string>();
  const observations = inputs.map((input): CapabilityObservation => {
    if (seen.has(input.id)) {
      throw new Error(`Capability "${input.id}" was reported more than once.`);
    }
    seen.add(input.id);
    if (!STATES.has(input.state)) {
      throw new Error(`Invalid capability state "${input.state}".`);
    }
    if (input.detail && input.detail.length > 240) {
      throw new Error("Capability detail must stay below 240 characters.");
    }
    return {
      id: input.id,
      kind: capabilityKind(input.id),
      state: input.state,
      provenance: "session-report",
      checkedAt,
      ...(input.detail ? { detail: input.detail } : {}),
    };
  });
  const report: ProjectCapabilityReport = {
    schemaVersion: 1,
    projectId: graph.project.id,
    checkedAt,
    observations,
  };
  const store = new AtlasStore(graph.project.id);
  try {
    store.saveCapabilityReport(report);
  } finally {
    store.close();
  }
  return report;
}

function derivedObservations(
  checkedAt: string,
  indexes: ReturnType<AtlasStore["listDesignIndexes"]>,
): CapabilityObservation[] {
  const hasDesign = indexes.length > 0;
  const hasObservableStatus = indexes.some(
    (index) => index.devStatus.availability !== "source-unavailable",
  );
  const hasGlobalVariables = indexes.some(
    (index) => index.variables.availability === "global",
  );
  const hasSelectionVariables = indexes.some(
    (index) => index.variables.availability === "selection-only",
  );
  const variablesNeedPermission = indexes.some(
    (index) => index.variables.availability === "permission-required",
  );
  const codeConnections = indexes.reduce(
    (total, index) => total + index.stats.codeConnections,
    0,
  );
  const libraries = indexes.reduce(
    (total, index) => total + index.libraries.length,
    0,
  );
  return [
    {
      id: "figma",
      kind: "connector",
      state: hasDesign ? "detected" : "unknown",
      provenance: "design-index",
      checkedAt,
      detail: hasDesign
        ? `${indexes.length} cached design file(s); live session state is not assumed.`
        : "No cached design evidence; live connector state has not been reported.",
    },
    ...(["atlassian-rovo", "github"] as const).map(
      (id): CapabilityObservation => ({
        id,
        kind: "connector",
        state: "unknown",
        provenance: "local-index",
        checkedAt,
        detail: "No current session observation has been reported.",
      }),
    ),
    {
      id: "ready-for-dev",
      kind: "enrichment",
      state: hasObservableStatus
        ? "detected"
        : hasDesign
          ? "not-exposed"
          : "unknown",
      provenance: "design-index",
      checkedAt,
      detail: hasObservableStatus
        ? "At least one indexed source exposes Dev Mode status."
        : hasDesign
          ? "Cached source does not expose this field; absence is not inferred."
          : "No design source is indexed.",
    },
    {
      id: "figma-variables",
      kind: "enrichment",
      state: hasGlobalVariables || hasSelectionVariables
        ? "detected"
        : variablesNeedPermission
          ? "permission-required"
        : hasDesign
          ? "not-exposed"
          : "unknown",
      provenance: "design-index",
      checkedAt,
      detail: hasGlobalVariables
        ? "Global collection summaries are indexed."
        : hasSelectionVariables
          ? "Only the node/selection fallback is available; it is not a global Variables catalog."
          : variablesNeedPermission
            ? "The confirmed global Variables source requires additional permission or eligible plan access; no absence is inferred."
          : hasDesign
            ? "No file-global variable catalog is exposed by the indexed source; no absence is inferred."
            : "No design source is indexed.",
    },
    {
      id: "code-connect",
      kind: "enrichment",
      state: codeConnections > 0
        ? "detected"
        : hasDesign
          ? "not-exposed"
          : "unknown",
      provenance: "design-index",
      checkedAt,
      detail: codeConnections
        ? `${codeConnections} cached code connection(s).`
        : hasDesign
          ? "No mapping is exposed by the cached design source."
          : "No design source is indexed.",
    },
    {
      id: "figma-libraries",
      kind: "enrichment",
      state: libraries > 0
        ? "detected"
        : hasDesign
          ? "not-exposed"
          : "unknown",
      provenance: "design-index",
      checkedAt,
      detail: libraries
        ? `${libraries} cached library reference(s).`
        : hasDesign
          ? "No library metadata is exposed by the cached design source."
          : "No design source is indexed.",
    },
  ];
}

export async function getProjectCapabilities(
  rootPath: string,
): Promise<ProjectCapabilityReport> {
  const graph = await loadProjectGraph(rootPath);
  const store = new AtlasStore(graph.project.id);
  try {
    const checkedAt = new Date().toISOString();
    const derived = derivedObservations(
      checkedAt,
      store.listDesignIndexes(graph.project.id),
    );
    const reported = store.loadCapabilityReport(graph.project.id);
    const merged = new Map(derived.map((item) => [item.id, item]));
    for (const observation of reported?.observations ?? []) {
      merged.set(observation.id, observation);
    }
    return {
      schemaVersion: 1,
      projectId: graph.project.id,
      checkedAt: reported?.checkedAt ?? checkedAt,
      observations: [...merged.values()],
    };
  } finally {
    store.close();
  }
}

export interface RecordTaskEvaluationInput {
  rootPath: string;
  task: string;
  topThreeCorrect?: boolean;
  falseDuplicateCount?: number;
  necessaryQuestions?: number;
  unnecessaryQuestions?: number;
  contextChars?: number;
  preparationMs?: number;
  conflictCount?: number;
  reworkRequired?: boolean;
}

function boundedInteger(
  value: number | undefined,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? 0;
  if (!Number.isInteger(resolved) || resolved < 0 || resolved > maximum) {
    throw new Error(`${label} must be an integer between 0 and ${maximum}.`);
  }
  return resolved;
}

export async function recordTaskEvaluation(
  input: RecordTaskEvaluationInput,
): Promise<TaskEvaluationRecord> {
  const task = input.task.trim();
  if (!task || task.length > 2_000) {
    throw new Error("Task text is required and must stay below 2,000 characters.");
  }
  const graph = await loadProjectGraph(input.rootPath);
  const recordedAt = new Date().toISOString();
  const taskFingerprint = createHash("sha256")
    .update(task)
    .digest("hex")
    .slice(0, 20);
  const record: TaskEvaluationRecord = {
    schemaVersion: 1,
    id: createHash("sha256")
      .update(`${graph.project.id}\0${recordedAt}\0${taskFingerprint}`)
      .digest("hex")
      .slice(0, 24),
    projectId: graph.project.id,
    recordedAt,
    taskFingerprint,
    ...(input.topThreeCorrect === undefined
      ? {}
      : { topThreeCorrect: input.topThreeCorrect }),
    falseDuplicateCount: boundedInteger(
      input.falseDuplicateCount,
      100,
      "falseDuplicateCount",
    ),
    necessaryQuestions: boundedInteger(
      input.necessaryQuestions,
      20,
      "necessaryQuestions",
    ),
    unnecessaryQuestions: boundedInteger(
      input.unnecessaryQuestions,
      20,
      "unnecessaryQuestions",
    ),
    contextChars: boundedInteger(input.contextChars, 100_000, "contextChars"),
    preparationMs: boundedInteger(
      input.preparationMs,
      3_600_000,
      "preparationMs",
    ),
    conflictCount: boundedInteger(
      input.conflictCount,
      100,
      "conflictCount",
    ),
    reworkRequired: input.reworkRequired ?? false,
  };
  const store = new AtlasStore(graph.project.id);
  try {
    store.saveTaskEvaluation(record);
  } finally {
    store.close();
  }
  return record;
}

export async function listTaskEvaluations(
  rootPath: string,
  limit = 20,
): Promise<TaskEvaluationRecord[]> {
  const graph = await loadProjectGraph(rootPath);
  const store = new AtlasStore(graph.project.id);
  try {
    return store.listTaskEvaluations(graph.project.id, limit);
  } finally {
    store.close();
  }
}

export async function clearTaskEvaluations(
  rootPath: string,
): Promise<{ cleared: number }> {
  const graph = await loadProjectGraph(rootPath);
  const store = new AtlasStore(graph.project.id);
  try {
    return { cleared: store.clearTaskEvaluations(graph.project.id) };
  } finally {
    store.close();
  }
}

export async function listAgentRunAudits(
  rootPath: string,
  limit = 20,
): Promise<AgentRunAuditRecord[]> {
  const graph = await loadProjectGraph(rootPath);
  const store = new AtlasStore(graph.project.id);
  try {
    return store.listAgentRunAudits(graph.project.id, limit);
  } finally {
    store.close();
  }
}

export async function clearAgentRunAudits(
  rootPath: string,
): Promise<{ cleared: number }> {
  const graph = await loadProjectGraph(rootPath);
  const store = new AtlasStore(graph.project.id);
  try {
    return { cleared: store.clearAgentRunAudits(graph.project.id) };
  } finally {
    store.close();
  }
}
