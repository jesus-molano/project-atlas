import { createHash } from "node:crypto";
import type {
  ContextCostAuditRecord,
  ContextCostDistribution,
  ContextCostExportBundle,
  ContextCostReport,
  ContextCostReportGroup,
  ContextCostTaskType,
  PortableContextCostRecord,
} from "@component-atlas/core";
import { AtlasStore } from "@component-atlas/store";
import { loadProjectGraph } from "./scan.js";

const MAX_COUNT = 1_000_000;
const MAX_CHARS = 10_000_000;
const MAX_TOKENS = 10_000_000;

export interface ContextContractCostInput {
  mcpToolCount?: number;
  mcpDescriptionChars?: number;
  mcpSchemaChars?: number;
  mcpSerializedChars?: number;
  mcpContractHash?: string;
  skillChars?: number;
  skillReferenceChars?: number;
  skillManifestHash?: string;
  measurement?: "exact" | "declared-estimate" | "unavailable";
}

export interface RecordContextCostAuditInput {
  rootPath: string;
  auditId?: string;
  task: string;
  taskType?: ContextCostTaskType;
  mode: ContextCostAuditRecord["mode"];
  recordedAt?: string;
  contract?: ContextContractCostInput;
  context?: Partial<ContextCostAuditRecord["context"]>;
  interaction?: Partial<ContextCostAuditRecord["interaction"]>;
  usage?: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
  };
}

function bounded(
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

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function taskClass(input: RecordContextCostAuditInput): ContextCostTaskType {
  if (input.taskType) return input.taskType;
  const context = input.context ?? {};
  if (
    input.task.length > 500 ||
    (context.receiptCount ?? 0) > 2 ||
    (context.delegationInputChars ?? 0) > 0
  ) {
    return "complex";
  }
  if (input.task.length <= 180 && (context.compactContextChars ?? 0) <= 2_400) {
    return "small";
  }
  return "frontend";
}

function normalizedContract(
  input: ContextContractCostInput | undefined,
): ContextCostAuditRecord["contract"] {
  const mcpToolCount = bounded(input?.mcpToolCount, 1_000, "mcpToolCount");
  const mcpDescriptionChars = bounded(
    input?.mcpDescriptionChars,
    MAX_CHARS,
    "mcpDescriptionChars",
  );
  const mcpSchemaChars = bounded(
    input?.mcpSchemaChars,
    MAX_CHARS,
    "mcpSchemaChars",
  );
  const mcpSerializedChars = bounded(
    input?.mcpSerializedChars,
    MAX_CHARS,
    "mcpSerializedChars",
  );
  const skillChars = bounded(input?.skillChars, MAX_CHARS, "skillChars");
  const skillReferenceChars = bounded(
    input?.skillReferenceChars,
    MAX_CHARS,
    "skillReferenceChars",
  );
  return {
    mcpToolCount,
    mcpDescriptionChars,
    mcpSchemaChars,
    mcpSerializedChars,
    mcpContractHash:
      input?.mcpContractHash ?? digest(`mcp:${mcpToolCount}:${mcpSerializedChars}`),
    skillChars,
    skillReferenceChars,
    skillManifestHash:
      input?.skillManifestHash ??
      digest(`skill:${skillChars}:${skillReferenceChars}`),
    measurement: input?.measurement ?? "unavailable",
  };
}

export async function recordContextCostAudit(
  input: RecordContextCostAuditInput,
): Promise<ContextCostAuditRecord> {
  const task = input.task.trim();
  if (!task || task.length > 6_000) {
    throw new Error("Task text is required and must stay below 6,000 characters.");
  }
  const graph = await loadProjectGraph(input.rootPath);
  const recordedAt = input.recordedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(recordedAt))) {
    throw new Error("Context cost recordedAt must be an ISO timestamp.");
  }
  const contract = normalizedContract(input.contract);
  const context: ContextCostAuditRecord["context"] = {
    promptChars: bounded(input.context?.promptChars, MAX_CHARS, "promptChars"),
    compactContextChars: bounded(
      input.context?.compactContextChars,
      MAX_CHARS,
      "compactContextChars",
    ),
    capsuleBytes: bounded(input.context?.capsuleBytes, MAX_CHARS, "capsuleBytes"),
    manifestBytes: bounded(
      input.context?.manifestBytes,
      MAX_CHARS,
      "manifestBytes",
    ),
    receiptCount: bounded(input.context?.receiptCount, MAX_COUNT, "receiptCount"),
    receiptBytes: bounded(input.context?.receiptBytes, MAX_CHARS, "receiptBytes"),
    delegationInputChars: bounded(
      input.context?.delegationInputChars,
      MAX_CHARS,
      "delegationInputChars",
    ),
    delegationOutputChars: bounded(
      input.context?.delegationOutputChars,
      MAX_CHARS,
      "delegationOutputChars",
    ),
  };
  const interaction: ContextCostAuditRecord["interaction"] = {
    questionCount: bounded(
      input.interaction?.questionCount,
      MAX_COUNT,
      "questionCount",
    ),
    retryCount: bounded(
      input.interaction?.retryCount,
      MAX_COUNT,
      "retryCount",
    ),
    truncated: input.interaction?.truncated ?? false,
    completed: input.interaction?.completed ?? false,
    reworkRequired: input.interaction?.reworkRequired ?? false,
  };
  const estimated = Math.ceil(
    (
      contract.mcpSerializedChars +
      contract.skillChars +
      contract.skillReferenceChars +
      (context.promptChars ||
        context.compactContextChars + context.delegationInputChars)
    ) / 4,
  );
  const hasSdkUsage = input.usage?.inputTokens !== undefined;
  const tokens: ContextCostAuditRecord["tokens"] = {
    source: hasSdkUsage ? "sdk" : "character-fallback",
    input: hasSdkUsage
      ? bounded(input.usage?.inputTokens, MAX_TOKENS, "inputTokens")
      : estimated,
    cachedInput: bounded(
      input.usage?.cachedInputTokens,
      MAX_TOKENS,
      "cachedInputTokens",
    ),
    output: bounded(input.usage?.outputTokens, MAX_TOKENS, "outputTokens"),
    estimated,
  };
  const taskFingerprint = digest(task).slice(0, 20);
  const id =
    input.auditId?.trim() ||
    digest(
      `${graph.project.id}\0${recordedAt}\0${taskFingerprint}\0${input.mode}`,
    ).slice(0, 24);
  if (!/^[A-Za-z0-9_.:-]{8,160}$/u.test(id)) {
    throw new Error("Context cost audit ID is invalid.");
  }
  const record: ContextCostAuditRecord = {
    schemaVersion: 1,
    id,
    projectId: graph.project.id,
    ...(graph.project.identity?.checkoutId
      ? { checkoutId: graph.project.identity.checkoutId }
      : {}),
    recordedAt,
    taskFingerprint,
    taskType: taskClass({ ...input, context }),
    mode: input.mode,
    contract,
    context,
    interaction,
    tokens,
  };
  const store = new AtlasStore(graph.project.id);
  try {
    store.saveContextCostAudit(record);
  } finally {
    store.close();
  }
  return record;
}

export async function listContextCostAudits(
  rootPath: string,
  limit = 100,
): Promise<ContextCostAuditRecord[]> {
  const graph = await loadProjectGraph(rootPath);
  const store = new AtlasStore(graph.project.id);
  try {
    return store.listContextCostAudits(graph.project.id, limit);
  } finally {
    store.close();
  }
}

export async function clearContextCostAudits(
  rootPath: string,
): Promise<{ cleared: number }> {
  const graph = await loadProjectGraph(rootPath);
  const store = new AtlasStore(graph.project.id);
  try {
    return { cleared: store.clearContextCostAudits(graph.project.id) };
  } finally {
    store.close();
  }
}

function distribution(values: number[]): ContextCostDistribution {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (ratio: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
  return {
    count: sorted.length,
    median: at(0.5),
    p95: at(0.95),
  };
}

function reportGroup(
  taskType: ContextCostReportGroup["taskType"],
  records: ContextCostAuditRecord[],
): ContextCostReportGroup {
  return {
    taskType,
    runs: records.length,
    inputTokens: distribution(records.map((record) => record.tokens.input)),
    cachedInputTokens: distribution(
      records.map((record) => record.tokens.cachedInput),
    ),
    outputTokens: distribution(records.map((record) => record.tokens.output)),
    promptChars: distribution(
      records.map((record) => record.context.promptChars),
    ),
    compactContextChars: distribution(
      records.map((record) => record.context.compactContextChars),
    ),
    questions: distribution(
      records.map((record) => record.interaction.questionCount),
    ),
    retries: distribution(
      records.map((record) => record.interaction.retryCount),
    ),
    completionRate:
      records.length === 0
        ? 0
        : Number(
            (
              records.filter((record) => record.interaction.completed).length /
              records.length
            ).toFixed(4),
          ),
  };
}

export async function contextCostReport(
  rootPath: string,
  limit = 500,
): Promise<ContextCostReport> {
  const graph = await loadProjectGraph(rootPath);
  const records = await listContextCostAudits(rootPath, limit);
  return {
    schemaVersion: 1,
    projectId: graph.project.id,
    generatedAt: new Date().toISOString(),
    groups: [
      reportGroup("all", records),
      ...(["small", "frontend", "complex"] as const).map((taskType) =>
        reportGroup(
          taskType,
          records.filter((record) => record.taskType === taskType),
        ),
      ),
    ],
  };
}

export async function exportContextCostAudits(
  rootPath: string,
  limit = 2_000,
): Promise<ContextCostExportBundle> {
  const graph = await loadProjectGraph(rootPath);
  const records = await listContextCostAudits(rootPath, limit);
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    sourceFingerprint: digest(graph.project.id),
    records: records.map(
      ({ id, projectId: _projectId, checkoutId: _checkoutId, ...record }) => ({
        ...record,
        sourceId: id,
      }),
    ),
  };
}

function portableRecord(
  projectId: string,
  bundle: ContextCostExportBundle,
  record: PortableContextCostRecord,
): ContextCostAuditRecord {
  if (
    record.schemaVersion !== 1 ||
    !/^[A-Za-z0-9_.:-]{8,160}$/u.test(record.sourceId) ||
    !/^[a-f0-9]{20}$/u.test(record.taskFingerprint) ||
    !["small", "frontend", "complex"].includes(record.taskType) ||
    !["prepare", "implement", "continue", "correct", "benchmark"].includes(
      record.mode,
    ) ||
    Number.isNaN(Date.parse(record.recordedAt))
  ) {
    throw new Error("Portable context-cost record identity is invalid.");
  }
  const contract = normalizedContract(record.contract);
  const context: ContextCostAuditRecord["context"] = {
    promptChars: bounded(record.context?.promptChars, MAX_CHARS, "promptChars"),
    compactContextChars: bounded(
      record.context?.compactContextChars,
      MAX_CHARS,
      "compactContextChars",
    ),
    capsuleBytes: bounded(
      record.context?.capsuleBytes,
      MAX_CHARS,
      "capsuleBytes",
    ),
    manifestBytes: bounded(
      record.context?.manifestBytes,
      MAX_CHARS,
      "manifestBytes",
    ),
    receiptCount: bounded(
      record.context?.receiptCount,
      MAX_COUNT,
      "receiptCount",
    ),
    receiptBytes: bounded(
      record.context?.receiptBytes,
      MAX_CHARS,
      "receiptBytes",
    ),
    delegationInputChars: bounded(
      record.context?.delegationInputChars,
      MAX_CHARS,
      "delegationInputChars",
    ),
    delegationOutputChars: bounded(
      record.context?.delegationOutputChars,
      MAX_CHARS,
      "delegationOutputChars",
    ),
  };
  const interaction: ContextCostAuditRecord["interaction"] = {
    questionCount: bounded(
      record.interaction?.questionCount,
      MAX_COUNT,
      "questionCount",
    ),
    retryCount: bounded(
      record.interaction?.retryCount,
      MAX_COUNT,
      "retryCount",
    ),
    truncated: record.interaction?.truncated === true,
    completed: record.interaction?.completed === true,
    reworkRequired: record.interaction?.reworkRequired === true,
  };
  if (!["sdk", "character-fallback"].includes(record.tokens?.source)) {
    throw new Error("Portable context-cost token source is invalid.");
  }
  const tokens: ContextCostAuditRecord["tokens"] = {
    source: record.tokens.source,
    input: bounded(record.tokens.input, MAX_TOKENS, "inputTokens"),
    cachedInput: bounded(
      record.tokens.cachedInput,
      MAX_TOKENS,
      "cachedInputTokens",
    ),
    output: bounded(record.tokens.output, MAX_TOKENS, "outputTokens"),
    estimated: bounded(record.tokens.estimated, MAX_TOKENS, "estimatedTokens"),
  };
  return {
    schemaVersion: 1,
    id: `import:${digest(
      `${bundle.sourceFingerprint}\0${record.sourceId}`,
    ).slice(0, 24)}`,
    projectId,
    recordedAt: record.recordedAt,
    taskFingerprint: record.taskFingerprint,
    taskType: record.taskType,
    mode: record.mode,
    contract,
    context,
    interaction,
    tokens,
  };
}

export async function importContextCostAudits(
  rootPath: string,
  input: ContextCostExportBundle,
): Promise<{ imported: number; sourceFingerprint: string }> {
  if (
    input?.schemaVersion !== 1 ||
    !/^[a-f0-9]{64}$/u.test(input.sourceFingerprint) ||
    Number.isNaN(Date.parse(input.exportedAt)) ||
    !Array.isArray(input.records) ||
    input.records.length > 2_000
  ) {
    throw new Error("Context-cost export bundle is invalid.");
  }
  const graph = await loadProjectGraph(rootPath);
  const records = input.records.map((record) =>
    portableRecord(graph.project.id, input, record),
  );
  const store = new AtlasStore(graph.project.id);
  try {
    for (const record of records) store.saveContextCostAudit(record, 2_000);
  } finally {
    store.close();
  }
  return {
    imported: records.length,
    sourceFingerprint: input.sourceFingerprint,
  };
}
