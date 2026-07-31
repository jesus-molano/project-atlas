import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { databasePath } from "@component-atlas/store";
import { afterEach, describe, expect, it } from "vitest";
import {
  configureUsageTelemetry,
  disableUsageTelemetry,
  exportUsageTracesV2,
  importCodexJsonlUsage,
  ingestUsageTelemetryPayload,
  listUsageTracesV2,
  scanProject,
  usageTelemetryStatus,
} from "./index.js";

const temporary: string[] = [];

async function fixture(): Promise<{ root: string; codexHome: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-usage-v2-"));
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-usage-data-"));
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "atlas-codex-home-"));
  temporary.push(root, dataHome, codexHome);
  process.env.PROJECT_ATLAS_HOME = dataHome;
  process.env.CODEX_HOME = codexHome;
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "usage-v2-fixture",
    dependencies: { vue: "^3.0.0" },
  }));
  await scanProject(root, { writeArtifacts: false });
  return { root, codexHome };
}

function attribute(key: string, value: string | number) {
  return {
    key,
    value: typeof value === "number"
      ? { intValue: String(value) }
      : { stringValue: value },
  };
}

afterEach(async () => {
  delete process.env.PROJECT_ATLAS_HOME;
  delete process.env.CODEX_HOME;
  await Promise.all(
    temporary.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("UsageTraceV2", () => {
  it("ingests exact OTLP JSON while discarding prompts, code, arguments, and outputs", async () => {
    const { root } = await fixture();
    const secret = "PRIVATE_PROMPT_AND_SOURCE_CODE";
    await ingestUsageTelemetryPayload("logs", {
      resourceLogs: [{
        resource: { attributes: [attribute("service.name", "codex")] },
        scopeLogs: [{
          logRecords: [{
            timeUnixNano: "1785456000000000000",
            body: { stringValue: "codex.sse_event" },
            attributes: [
              attribute("conversation.id", "session-exact-1"),
              attribute("cwd", root),
              attribute("model", "gpt-test"),
              attribute("kind", "response.completed"),
              attribute("input_tokens", 28_000),
              attribute("cached_input_tokens", 20_000),
              attribute("output_tokens", 900),
              attribute("reasoning_output_tokens", 640),
              attribute("total_tokens", 28_900),
              attribute("prompt", secret),
              attribute("tool.arguments", secret),
              attribute("tool.output", secret),
            ],
          }],
        }],
      }],
    }, { defaultRootPath: root, coreContractChars: 6_387, skillChars: 4_664 });
    await ingestUsageTelemetryPayload("logs", {
      resourceLogs: [{
        scopeLogs: [{ logRecords: [{
          body: { stringValue: "codex.tool_result" },
          attributes: [
            attribute("conversation.id", "session-exact-1"),
            attribute("cwd", root),
            attribute("tool", "mcp__component-atlas__atlas_prepare_task"),
            attribute("output_chars", 1_200),
            attribute("tool.output", secret),
          ],
        }] }],
      }],
    }, { defaultRootPath: root, coreContractChars: 6_387, skillChars: 4_664 });
    await ingestUsageTelemetryPayload("compact", {
      session_id: "session-exact-1",
      cwd: root,
      trigger: "auto",
      transcript_path: secret,
    }, { defaultRootPath: root });

    const [trace] = await listUsageTracesV2(root);
    expect(trace).toMatchObject({
      schemaVersion: 2,
      source: "codex-otel",
      exactTotals: true,
      state: "completed",
      model: "gpt-test",
      tokens: {
        input: 28_000,
        cachedInput: 20_000,
        output: 900,
        reasoning: 640,
        total: 28_900,
      },
      interaction: {
        turns: 1,
        toolCalls: 1,
        compactions: { manual: 0, automatic: 1 },
      },
      atlas: {
        contractTokens: 1_597,
        contextTokens: 0,
        responseTokens: 300,
        estimated: true,
      },
      privacy: {
        promptsStored: false,
        codeStored: false,
        toolPayloadsStored: false,
      },
    });
    const graph = await scanProject(root, { writeArtifacts: false });
    expect((await readFile(databasePath(graph.project.id))).toString("utf8"))
      .not.toContain(secret);
    const exported = await exportUsageTracesV2(root);
    expect(JSON.stringify(exported)).not.toContain(secret);
  });

  it("imports exact JSONL totals with explicit provenance", async () => {
    const { root } = await fixture();
    const jsonl = path.join(root, "usage.jsonl");
    await writeFile(jsonl, `${JSON.stringify({
      timestamp: "2026-07-31T12:00:00.000Z",
      type: "event_msg",
      session_id: "jsonl-session",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 80,
            output_tokens: 25,
            reasoning_output_tokens: 10,
            total_tokens: 125,
          },
        },
      },
    })}\n`);
    const [trace] = await importCodexJsonlUsage(root, jsonl);
    expect(trace).toMatchObject({
      source: "codex-jsonl",
      exactTotals: true,
      tokens: { input: 100, cachedInput: 80, output: 25, reasoning: 10, total: 125 },
    });
  });

  it("backs up and mutates only its managed config block", async () => {
    const { codexHome } = await fixture();
    const configPath = path.join(codexHome, "config.toml");
    await writeFile(configPath, "model = \"custom\"\n");
    const configured = await configureUsageTelemetry({
      cliEntryPath: "C:/atlas/dist/index.js",
      nodePath: "C:/node/node.exe",
    });
    expect(configured).toMatchObject({
      configured: true,
      hookConfigured: true,
      logUserPrompt: false,
    });
    expect(configured.backupPath).toBeTruthy();
    const content = await readFile(configPath, "utf8");
    expect(content).toContain("model = \"custom\"");
    expect(content).toContain("log_user_prompt = false");
    expect(content).toContain("protocol = \"json\"");
    expect(content.match(/project-atlas telemetry >>>/gu)).toHaveLength(1);
    await configureUsageTelemetry({
      cliEntryPath: "C:/atlas/dist/index.js",
      nodePath: "C:/node/node.exe",
    });
    expect((await readFile(configPath, "utf8")).match(/project-atlas telemetry >>>/gu))
      .toHaveLength(1);
    const disabled = await disableUsageTelemetry();
    expect(disabled.configured).toBe(false);
    expect(await readFile(configPath, "utf8")).toBe("model = \"custom\"\n");
    expect(await usageTelemetryStatus()).toMatchObject({ configured: false });
  });
});
