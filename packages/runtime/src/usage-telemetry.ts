import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  ContextCostAuditRecord,
  PortableUsageTraceV2,
  UsageTraceExportBundleV2,
  UsageTraceState,
  UsageTraceV2,
} from "@component-atlas/core";
import { AtlasStore } from "@component-atlas/store";
import { resolveProjectIdentity } from "./identity.js";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const CONFIG_START = "# >>> project-atlas telemetry >>>";
const CONFIG_END = "# <<< project-atlas telemetry <<<";

type JsonRecord = Record<string, unknown>;

export interface UsageTelemetryOptions {
  host?: "127.0.0.1";
  port?: number;
  defaultRootPath?: string;
  coreContractChars?: number;
  skillChars?: number;
}

export interface UsageTelemetryStatus {
  configured: boolean;
  configPath: string;
  endpoint: string;
  logUserPrompt: false;
  hookConfigured: boolean;
}

interface NormalizedTelemetryEvent {
  sessionId: string;
  rootPath: string;
  observedAt: string;
  name: string;
  model?: string;
  state?: UsageTraceState;
  turns?: number;
  toolCalls?: number;
  errors?: number;
  durationMs?: number;
  tokens?: Partial<UsageTraceV2["tokens"]>;
  tokenMode?: "add" | "max";
  compaction?: "manual" | "automatic";
  atlasTool?: boolean;
  frontendSkill?: boolean;
  atlasContextChars?: number;
  atlasResponseChars?: number;
}

function hash(value: string, length = 24): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const wrapped = object(value);
  for (const key of ["stringValue", "intValue", "doubleValue", "boolValue"]) {
    if (wrapped[key] !== undefined) return String(wrapped[key]);
  }
  return undefined;
}

function numeric(value: unknown): number | undefined {
  const candidate = Number(textValue(value) ?? value);
  return Number.isFinite(candidate) && candidate >= 0 ? Math.round(candidate) : undefined;
}

function attributes(value: unknown): JsonRecord {
  return Object.fromEntries(
    array(value).flatMap((entry) => {
      const item = object(entry);
      const key = textValue(item.key);
      return key ? [[key, textValue(item.value) ?? ""]] : [];
    }),
  );
}

function firstText(source: JsonRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = textValue(source[key]);
    if (value) return value;
  }
  return undefined;
}

function firstNumber(source: JsonRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = numeric(source[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function isoFromUnixNano(value: unknown): string {
  const raw = textValue(value);
  if (!raw || !/^\d+$/u.test(raw)) return new Date().toISOString();
  const millis = Number(BigInt(raw) / BigInt(1_000_000));
  return Number.isFinite(millis) ? new Date(millis).toISOString() : new Date().toISOString();
}

function sessionFrom(attrs: JsonRecord, fallback: string): string {
  return firstText(attrs, [
    "conversation.id",
    "conversation_id",
    "session.id",
    "session_id",
    "thread.id",
    "thread_id",
  ]) ?? fallback;
}

function rootFrom(attrs: JsonRecord, fallback: string): string {
  return firstText(attrs, [
    "cwd",
    "project.root",
    "project_root",
    "atlas.project_root",
  ]) ?? fallback;
}

function tokenFields(attrs: JsonRecord): Partial<UsageTraceV2["tokens"]> {
  const result: Partial<UsageTraceV2["tokens"]> = {};
  const input = firstNumber(attrs, ["input_tokens", "input_token_count", "usage.input_tokens"]);
  const cachedInput = firstNumber(attrs, ["cached_input_tokens", "cached_input_token_count", "usage.cached_input_tokens"]);
  const output = firstNumber(attrs, ["output_tokens", "output_token_count", "usage.output_tokens"]);
  const reasoning = firstNumber(attrs, ["reasoning_output_tokens", "reasoning_token_count", "usage.reasoning_output_tokens"]);
  const total = firstNumber(attrs, ["total_tokens", "total_token_count", "usage.total_tokens"]);
  if (input !== undefined) result.input = input;
  if (cachedInput !== undefined) result.cachedInput = cachedInput;
  if (output !== undefined) result.output = output;
  if (reasoning !== undefined) result.reasoning = reasoning;
  if (total !== undefined) result.total = total;
  return result;
}

function normalizedLogEvents(payload: JsonRecord, options: Required<UsageTelemetryOptions>): NormalizedTelemetryEvent[] {
  const events: NormalizedTelemetryEvent[] = [];
  for (const resourceLog of array(payload.resourceLogs)) {
    const resource = object(resourceLog);
    const resourceAttrs = attributes(object(resource.resource).attributes);
    for (const scopeLog of array(resource.scopeLogs)) {
      for (const rawRecord of array(object(scopeLog).logRecords)) {
        const record = object(rawRecord);
        const attrs = { ...resourceAttrs, ...attributes(record.attributes) };
        const body = textValue(record.body);
        const name = firstText(attrs, ["event.name", "event_name", "name"]) ?? body ?? "codex.event";
        const kind = firstText(attrs, ["kind", "event.kind", "type"]);
        const tool = firstText(attrs, ["tool", "tool.name", "tool_name"]);
        const success = firstText(attrs, ["success", "event.success"]);
        const tokens = tokenFields(attrs);
        const model = firstText(attrs, ["model", "gen_ai.request.model"]);
        const durationMs = firstNumber(attrs, ["duration_ms", "duration.ms"]);
        const atlasResponseChars = firstNumber(attrs, ["output_chars", "tool.output_chars"]);
        const completed = kind === "response.completed" || name.endsWith("turn.completed");
        const failed = success === "false" || /(?:failed|error)$/u.test(kind ?? name);
        events.push({
          sessionId: sessionFrom(attrs, "otel-unattributed"),
          rootPath: rootFrom(attrs, options.defaultRootPath),
          observedAt: isoFromUnixNano(record.timeUnixNano ?? record.observedTimeUnixNano),
          name,
          ...(model ? { model } : {}),
          ...(completed ? { state: "completed" as const, turns: 1 } : {}),
          ...(failed ? { state: "failed" as const, errors: 1 } : {}),
          ...(/tool_(?:result|call)|tool\.call/u.test(name) ? { toolCalls: 1 } : {}),
          ...(durationMs !== undefined
            ? { durationMs }
            : {}),
          ...(Object.keys(tokens).length ? { tokens, tokenMode: "add" as const } : {}),
          ...(tool?.includes("atlas_") || tool?.includes("project-atlas") ? { atlasTool: true } : {}),
          ...(firstText(attrs, ["skill", "skill.name"]) === "frontend-task" ? { frontendSkill: true } : {}),
          ...(atlasResponseChars !== undefined
            ? { atlasResponseChars }
            : {}),
        });
      }
    }
  }
  return events;
}

function normalizedMetricEvents(payload: JsonRecord, options: Required<UsageTelemetryOptions>): NormalizedTelemetryEvent[] {
  const events: NormalizedTelemetryEvent[] = [];
  for (const resourceMetric of array(payload.resourceMetrics)) {
    const resource = object(resourceMetric);
    const resourceAttrs = attributes(object(resource.resource).attributes);
    for (const scopeMetric of array(resource.scopeMetrics)) {
      for (const rawMetric of array(object(scopeMetric).metrics)) {
        const metric = object(rawMetric);
        const name = textValue(metric.name) ?? "codex.metric";
        for (const containerKey of ["sum", "gauge", "histogram"]) {
          for (const rawPoint of array(object(metric[containerKey]).dataPoints)) {
            const point = object(rawPoint);
            const attrs = { ...resourceAttrs, ...attributes(point.attributes) };
            const tokenType = firstText(attrs, ["token_type", "type"]);
            const value = numeric(point.asInt ?? point.asDouble ?? point.sum ?? point.value);
            const tokenKey = tokenType === "cached_input"
              ? "cachedInput"
              : tokenType === "reasoning_output"
                ? "reasoning"
                : tokenType === "input" || tokenType === "output" || tokenType === "total"
                  ? tokenType
                  : undefined;
            const model = firstText(attrs, ["model"]);
            events.push({
              sessionId: sessionFrom(attrs, "otel-metrics"),
              rootPath: rootFrom(attrs, options.defaultRootPath),
              observedAt: isoFromUnixNano(point.timeUnixNano),
              name,
              ...(model ? { model } : {}),
              ...(name === "codex.turn.token_usage" && tokenKey && value !== undefined
                ? { tokens: { [tokenKey]: value } as Partial<UsageTraceV2["tokens"]>, tokenMode: "max" as const }
                : {}),
              ...(name === "task.compact"
                ? { compaction: firstText(attrs, ["trigger", "type"]) === "manual" ? "manual" as const : "automatic" as const }
                : {}),
            });
          }
        }
      }
    }
  }
  return events;
}

function blankTrace(
  projectId: string,
  checkoutId: string | undefined,
  sessionIdHash: string,
  observedAt: string,
  source: UsageTraceV2["source"],
): UsageTraceV2 {
  return {
    schemaVersion: 2,
    id: `usage:${hash(`${projectId}\0${sessionIdHash}`, 28)}`,
    projectId,
    ...(checkoutId ? { checkoutId } : {}),
    sessionIdHash,
    startedAt: observedAt,
    updatedAt: observedAt,
    source,
    exactTotals: false,
    state: "blocked",
    tokens: { input: 0, cachedInput: 0, output: 0, reasoning: 0, total: 0 },
    interaction: {
      turns: 0,
      toolCalls: 0,
      errors: 0,
      durationMs: 0,
      compactions: { manual: 0, automatic: 0 },
    },
    atlas: {
      contractTokens: 0,
      skillTokens: 0,
      contextTokens: 0,
      responseTokens: 0,
      totalTokens: 0,
      estimated: true,
    },
    privacy: { promptsStored: false, codeStored: false, toolPayloadsStored: false },
  };
}

async function saveNormalizedEvent(
  event: NormalizedTelemetryEvent,
  options: Required<UsageTelemetryOptions>,
  source: UsageTraceV2["source"] = "codex-otel",
): Promise<UsageTraceV2> {
  const identity = await resolveProjectIdentity(event.rootPath).catch(() =>
    resolveProjectIdentity(options.defaultRootPath),
  );
  const sessionIdHash = hash(event.sessionId);
  const store = new AtlasStore(identity.logicalId);
  try {
    const trace = store.findUsageTrace(identity.logicalId, sessionIdHash) ??
      blankTrace(identity.logicalId, identity.checkoutId, sessionIdHash, event.observedAt, source);
    trace.updatedAt = event.observedAt;
    if (event.model) trace.model = event.model;
    trace.state = event.state ?? trace.state;
    trace.interaction.turns += event.turns ?? 0;
    trace.interaction.toolCalls += event.toolCalls ?? 0;
    trace.interaction.errors += event.errors ?? 0;
    trace.interaction.durationMs += event.durationMs ?? 0;
    if (event.compaction) trace.interaction.compactions[event.compaction] += 1;
    for (const key of ["input", "cachedInput", "output", "reasoning", "total"] as const) {
      const value = event.tokens?.[key];
      if (value === undefined) continue;
      trace.tokens[key] = event.tokenMode === "max"
        ? Math.max(trace.tokens[key], value)
        : trace.tokens[key] + value;
    }
    if (!trace.tokens.total && trace.tokens.input > 0 && trace.tokens.output > 0) {
      trace.tokens.total = trace.tokens.input + trace.tokens.output;
    }
    trace.exactTotals =
      trace.tokens.total > 0 ||
      (trace.tokens.input > 0 && trace.tokens.output > 0);
    if (event.atlasTool) {
      trace.atlas.contractTokens = Math.ceil(options.coreContractChars / 4);
      trace.atlas.contextTokens += Math.ceil((event.atlasContextChars ?? 0) / 4);
      trace.atlas.responseTokens += Math.ceil((event.atlasResponseChars ?? 0) / 4);
    }
    if (event.frontendSkill) trace.atlas.skillTokens = Math.ceil(options.skillChars / 4);
    trace.atlas.totalTokens =
      trace.atlas.contractTokens +
      trace.atlas.skillTokens +
      trace.atlas.contextTokens +
      trace.atlas.responseTokens;
    store.saveUsageTrace(trace);
    return trace;
  } finally {
    store.close();
  }
}

export async function ingestUsageTelemetryPayload(
  kind: "logs" | "metrics" | "compact",
  payload: unknown,
  input: UsageTelemetryOptions = {},
): Promise<UsageTraceV2[]> {
  const options: Required<UsageTelemetryOptions> = {
    host: "127.0.0.1",
    port: input.port ?? 4318,
    defaultRootPath: path.resolve(input.defaultRootPath ?? process.cwd()),
    coreContractChars: input.coreContractChars ?? 0,
    skillChars: input.skillChars ?? 0,
  };
  const safePayload = object(payload);
  const events = kind === "logs"
    ? normalizedLogEvents(safePayload, options)
    : kind === "metrics"
      ? normalizedMetricEvents(safePayload, options)
      : [{
          sessionId: textValue(safePayload.session_id) ?? "compact-unattributed",
          rootPath: textValue(safePayload.cwd) ?? options.defaultRootPath,
          observedAt: new Date().toISOString(),
          name: "atlas.post_compact",
          compaction: textValue(safePayload.trigger) === "manual"
            ? "manual" as const
            : "automatic" as const,
        }];
  const saved: UsageTraceV2[] = [];
  for (const event of events) saved.push(await saveNormalizedEvent(event, options));
  return saved;
}

async function readJsonBody(request: IncomingMessage): Promise<JsonRecord> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Telemetry payload exceeds 2 MiB.");
    chunks.push(buffer);
  }
  return object(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
}

function reply(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

export async function startUsageTelemetryServer(input: UsageTelemetryOptions = {}): Promise<void> {
  const options: Required<UsageTelemetryOptions> = {
    host: "127.0.0.1",
    port: input.port ?? 4318,
    defaultRootPath: path.resolve(input.defaultRootPath ?? process.cwd()),
    coreContractChars: input.coreContractChars ?? 0,
    skillChars: input.skillChars ?? 0,
  };
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        reply(response, 200, { status: "ok", privacy: "metadata-only" });
        return;
      }
      if (request.method !== "POST") {
        reply(response, 404, { error: "not-found" });
        return;
      }
      const payload = await readJsonBody(request);
      const kind = request.url === "/v1/logs"
        ? "logs"
        : request.url === "/v1/metrics"
          ? "metrics"
          : request.url === "/v1/atlas/compact"
            ? "compact"
            : undefined;
      if (!kind) {
        reply(response, 404, { error: "not-found" });
        return;
      }
      const saved = await ingestUsageTelemetryPayload(kind, payload, options);
      reply(response, 200, { partialSuccess: {}, accepted: saved.length });
    } catch (error) {
      reply(response, 400, { error: error instanceof Error ? error.message : "invalid-payload" });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, resolve);
  });
  process.stdout.write(`Atlas telemetry listening on http://${options.host}:${options.port}\n`);
  await new Promise<void>((resolve) => {
    const close = () => server.close(() => resolve());
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
}

function codexConfigPath(): string {
  return path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "config.toml");
}

function managedRange(content: string): { start: number; end: number } | undefined {
  const start = content.indexOf(CONFIG_START);
  const endMarker = content.indexOf(CONFIG_END);
  if (start < 0 && endMarker < 0) return undefined;
  if (start < 0 || endMarker < start || content.indexOf(CONFIG_START, start + 1) >= 0 || content.indexOf(CONFIG_END, endMarker + 1) >= 0) {
    throw new Error("Atlas telemetry markers in config.toml are malformed.");
  }
  return { start, end: endMarker + CONFIG_END.length };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

export async function configureUsageTelemetry(input: {
  cliEntryPath: string;
  nodePath?: string;
  endpoint?: string;
}): Promise<UsageTelemetryStatus & { backupPath?: string }> {
  const configPath = codexConfigPath();
  const endpoint = input.endpoint ?? "http://127.0.0.1:4318";
  const parsedEndpoint = new URL(endpoint);
  if (parsedEndpoint.protocol !== "http:" || parsedEndpoint.hostname !== "127.0.0.1") {
    throw new Error("Atlas telemetry endpoint must use http://127.0.0.1.");
  }
  await mkdir(path.dirname(configPath), { recursive: true });
  const previous = await readFile(configPath, "utf8").catch(() => "");
  const range = managedRange(previous);
  const unmanaged = range
    ? `${previous.slice(0, range.start)}${previous.slice(range.end)}`
    : previous;
  if (/^\s*\[otel\]\s*$/mu.test(unmanaged)) {
    throw new Error("An unmanaged [otel] block already exists; Atlas left it unchanged.");
  }
  const nodePath = input.nodePath ?? process.execPath;
  const hookCommand = `${tomlString(nodePath)} ${tomlString(path.resolve(input.cliEntryPath))} telemetry compact-hook`;
  const block = [
    CONFIG_START,
    "[otel]",
    "environment = \"dev\"",
    "log_user_prompt = false",
    `exporter = { otlp-http = { endpoint = ${tomlString(`${endpoint}/v1/logs`)}, protocol = "json" } }`,
    `metrics_exporter = { otlp-http = { endpoint = ${tomlString(`${endpoint}/v1/metrics`)}, protocol = "json" } }`,
    "trace_exporter = \"none\"",
    "span_attributes = { \"atlas.telemetry\" = \"local-v2\" }",
    "",
    "[[hooks.PostCompact]]",
    "matcher = \"^(manual|auto)$\"",
    "[[hooks.PostCompact.hooks]]",
    "type = \"command\"",
    `command = ${tomlString(hookCommand)}`,
    `command_windows = ${tomlString(hookCommand)}`,
    "timeout = 3",
    CONFIG_END,
  ].join("\n");
  const next = `${unmanaged.trimEnd()}${unmanaged.trim() ? "\n\n" : ""}${block}\n`;
  let backupPath: string | undefined;
  if (previous && previous !== next) {
    backupPath = `${configPath}.atlas-backup-${new Date().toISOString().replace(/[:.]/gu, "-")}`;
    await copyFile(configPath, backupPath);
  }
  const temporary = `${configPath}.atlas-${randomUUID()}.tmp`;
  await writeFile(temporary, next, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, configPath);
  return { ...(await usageTelemetryStatus(endpoint)), ...(backupPath ? { backupPath } : {}) };
}

export async function disableUsageTelemetry(): Promise<UsageTelemetryStatus & { backupPath?: string }> {
  const configPath = codexConfigPath();
  const previous = await readFile(configPath, "utf8").catch(() => "");
  const range = managedRange(previous);
  if (!range) return usageTelemetryStatus();
  const next = `${previous.slice(0, range.start)}${previous.slice(range.end)}`
    .replace(/\n{3,}/gu, "\n\n")
    .trimEnd();
  const backupPath = `${configPath}.atlas-backup-${new Date().toISOString().replace(/[:.]/gu, "-")}`;
  await copyFile(configPath, backupPath);
  const temporary = `${configPath}.atlas-${randomUUID()}.tmp`;
  await writeFile(temporary, next ? `${next}\n` : "", { encoding: "utf8", mode: 0o600 });
  await rename(temporary, configPath);
  return { ...(await usageTelemetryStatus()), backupPath };
}

export async function usageTelemetryStatus(endpoint = "http://127.0.0.1:4318"): Promise<UsageTelemetryStatus> {
  const configPath = codexConfigPath();
  const content = await readFile(configPath, "utf8").catch(() => "");
  const range = managedRange(content);
  return {
    configured: Boolean(range),
    configPath,
    endpoint,
    logUserPrompt: false,
    hookConfigured: Boolean(range && content.slice(range.start, range.end).includes("hooks.PostCompact")),
  };
}

export async function recordCompactHook(input: unknown): Promise<void> {
  const payload = object(input);
  const safe = JSON.stringify({
    session_id: textValue(payload.session_id) ?? "unknown",
    cwd: textValue(payload.cwd) ?? process.cwd(),
    trigger: textValue(payload.trigger) === "manual" ? "manual" : "auto",
  });
  await fetch("http://127.0.0.1:4318/v1/atlas/compact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: safe,
    signal: AbortSignal.timeout(1_500),
  }).catch(() => undefined);
}

export async function listUsageTracesV2(rootPath: string, limit = 100): Promise<UsageTraceV2[]> {
  const identity = await resolveProjectIdentity(rootPath);
  const store = new AtlasStore(identity.logicalId);
  try {
    return store.listUsageTraces(identity.logicalId, limit);
  } finally {
    store.close();
  }
}

export async function clearUsageTracesV2(rootPath: string): Promise<{ cleared: number }> {
  const identity = await resolveProjectIdentity(rootPath);
  const store = new AtlasStore(identity.logicalId);
  try {
    return { cleared: store.clearUsageTraces(identity.logicalId) };
  } finally {
    store.close();
  }
}

export async function exportUsageTracesV2(
  rootPath: string,
  legacyRecords: ContextCostAuditRecord[] = [],
): Promise<UsageTraceExportBundleV2> {
  const identity = await resolveProjectIdentity(rootPath);
  const records = await listUsageTracesV2(rootPath, 5_000);
  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    sourceFingerprint: createHash("sha256").update(identity.logicalId).digest("hex"),
    records: records.map(({ id, projectId: _projectId, checkoutId: _checkoutId, ...record }) => ({
      ...record,
      sourceId: id,
    } satisfies PortableUsageTraceV2)),
    legacyRecords: legacyRecords.map(({ id, projectId: _projectId, checkoutId: _checkoutId, ...record }) => ({
      sourceId: id,
      label: "incomplete-estimate" as const,
      record: { ...record, sourceId: id },
    })),
  };
}

export async function importCodexJsonlUsage(rootPath: string, filePath: string): Promise<UsageTraceV2[]> {
  const content = await readFile(filePath, "utf8");
  const latest = new Map<string, JsonRecord>();
  for (const line of content.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    let record: JsonRecord;
    try {
      record = object(JSON.parse(line));
    } catch {
      continue;
    }
    const payload = object(record.payload);
    const info = object(payload.info);
    const usage = object(info.total_token_usage);
    if (record.type !== "event_msg" || payload.type !== "token_count" || !Object.keys(usage).length) continue;
    const session = firstText(record, ["session_id", "conversation_id"]) ?? path.basename(filePath);
    latest.set(session, { ...usage, timestamp: record.timestamp });
  }
  const options: Required<UsageTelemetryOptions> = {
    host: "127.0.0.1",
    port: 4318,
    defaultRootPath: rootPath,
    coreContractChars: 0,
    skillChars: 0,
  };
  const saved: UsageTraceV2[] = [];
  for (const [sessionId, usage] of latest) {
    saved.push(await saveNormalizedEvent({
      sessionId,
      rootPath,
      observedAt: textValue(usage.timestamp) ?? new Date().toISOString(),
      name: "codex.jsonl.token_count",
      state: "completed",
      tokens: tokenFields(usage),
      tokenMode: "max",
    }, options, "codex-jsonl"));
  }
  return saved;
}
