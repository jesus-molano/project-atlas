import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  measureFrontendTaskSkillCost,
  measureMcpContractCost,
} from "@component-atlas/mcp";
import {
  clearUsageTracesV2,
  configureUsageTelemetry,
  disableUsageTelemetry,
  exportUsageTracesV2,
  importCodexJsonlUsage,
  listContextCostAudits,
  listUsageTracesV2,
  recordCompactHook,
  startUsageTelemetryServer,
  usageTelemetryStatus,
} from "@component-atlas/runtime";
import type { Command } from "commander";

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseLimit(value: string, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`Limit must be between 1 and ${maximum}, received "${value}".`);
  }
  return parsed;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function registerTelemetryCommands(program: Command): void {
  const telemetry = program
    .command("telemetry")
    .description("Local, opt-in Codex usage telemetry without prompts or code.");

  telemetry.command("serve")
    .argument("[path]", "default repository root", ".")
    .option("--port <number>", "loopback OTLP/HTTP port", "4318")
    .description("Serve the local OTLP/HTTP JSON receiver on 127.0.0.1.")
    .action(async (rootPath: string, options: { port: string }) => {
      const port = Number(options.port);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error("Telemetry port must be between 1 and 65535.");
      }
      const [contract, skill] = await Promise.all([
        measureMcpContractCost("core"),
        measureFrontendTaskSkillCost(),
      ]);
      await startUsageTelemetryServer({
        port,
        defaultRootPath: path.resolve(rootPath),
        coreContractChars: contract.mcpSerializedChars,
        skillChars: skill.skillChars,
      });
    });

  telemetry.command("configure")
    .option("--endpoint <url>", "local receiver base URL", "http://127.0.0.1:4318")
    .description("Back up config.toml and install only the managed Atlas OTel block.")
    .action(async (options: { endpoint: string }) => {
      const cliEntryPath = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "index.js",
      );
      printJson(await configureUsageTelemetry({ cliEntryPath, endpoint: options.endpoint }));
    });

  telemetry.command("status")
    .description("Show managed configuration and privacy status.")
    .action(async () => printJson(await usageTelemetryStatus()));

  telemetry.command("disable")
    .description("Back up config.toml and remove only the managed Atlas block.")
    .action(async () => printJson(await disableUsageTelemetry()));

  telemetry.command("list")
    .argument("[path]", "repository root", ".")
    .option("--limit <number>", "maximum local traces", "100")
    .description("List UsageTraceV2 records for this project.")
    .action(async (rootPath: string, options: { limit: string }) => {
      printJson(await listUsageTracesV2(rootPath, parseLimit(options.limit, 5_000)));
    });

  telemetry.command("clear")
    .argument("[path]", "repository root", ".")
    .requiredOption("--confirm", "confirm deletion of local usage traces")
    .description("Clear UsageTraceV2 records without touching Codex history.")
    .action(async (rootPath: string, options: { confirm: boolean }) => {
      if (!options.confirm) throw new Error("Use --confirm to clear usage traces.");
      printJson(await clearUsageTracesV2(rootPath));
    });

  telemetry.command("export")
    .argument("[path]", "repository root", ".")
    .requiredOption("--output <json>", "portable schema-v2 JSON output")
    .description("Export exact traces and separately labelled legacy estimates.")
    .action(async (rootPath: string, options: { output: string }) => {
      const bundle = await exportUsageTracesV2(
        rootPath,
        await listContextCostAudits(rootPath, 2_000),
      );
      const outputPath = path.resolve(options.output);
      await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      printJson({
        output: outputPath,
        records: bundle.records.length,
        legacyRecords: bundle.legacyRecords.length,
        sourceFingerprint: bundle.sourceFingerprint,
      });
    });

  telemetry.command("import-jsonl")
    .argument("<jsonl>", "Codex rollout JSONL file")
    .argument("[path]", "repository root", ".")
    .description("Import exact token totals from a local Codex rollout.")
    .action(async (jsonlPath: string, rootPath: string) => {
      printJson(await importCodexJsonlUsage(rootPath, path.resolve(jsonlPath)));
    });

  telemetry.command("compact-hook", { hidden: true }).action(async () => {
    const input = await readStdin().catch(() => "{}");
    await recordCompactHook(JSON.parse(input || "{}"));
  });
}
