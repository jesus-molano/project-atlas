#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import {
  access,
  appendFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildReuseContext,
  componentImpact,
  findComponent,
  searchComponents,
  similarComponents,
  type DecisionKind,
  type Framework,
} from "@component-atlas/core";
import { startMcpServer } from "@component-atlas/mcp";
import {
  graphSummary,
  loadProjectGraph,
  recordDecision,
  scanProject,
} from "@component-atlas/runtime";
import { Command } from "commander";
import open from "open";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function waitForUrl(url: string, attempts = 30): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The local server may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Local server did not become ready at ${url}.`);
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printComponent(component: ReturnType<typeof findComponent>): void {
  if (!component) return;
  printJson(component);
}

async function configureGlobalIgnore(): Promise<string> {
  const configured = spawnSync(
    "git",
    ["config", "--global", "--get", "core.excludesFile"],
    { encoding: "utf8" },
  ).stdout.trim();
  const filePath = configured
    ? path.resolve(configured.replace(/^~(?=$|[\\/])/, os.homedir()))
    : path.join(os.homedir(), ".gitignore_global");
  await mkdir(path.dirname(filePath), { recursive: true });
  const current = (await fileExists(filePath)) ? await readFile(filePath, "utf8") : "";
  const lines = current.split(/\r?\n/).map((line) => line.trim());
  if (!lines.includes(".component-atlas/")) {
    if (current && !current.endsWith("\n")) await appendFile(filePath, "\n", "utf8");
    await appendFile(filePath, ".component-atlas/\n", "utf8");
  }
  if (!configured) {
    const result = spawnSync(
      "git",
      ["config", "--global", "core.excludesFile", filePath],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(result.stderr || "Failed to configure Git global excludes.");
    }
  }
  return filePath;
}

function requireFound<T>(value: T | undefined, selector: string): T {
  if (!value) throw new Error(`Component "${selector}" was not found.`);
  return value;
}

async function openViewer(
  rootPath: string,
  options: { port: string; browser: boolean },
): Promise<void> {
  const graph = await scanProject(rootPath);
  const currentFile = fileURLToPath(import.meta.url);
  const repositoryRoot = path.resolve(path.dirname(currentFile), "../../..");
  const serverEntry = path.join(
    repositoryRoot,
    "apps",
    "viewer",
    ".output",
    "server",
    "index.mjs",
  );
  if (!(await fileExists(serverEntry))) {
    throw new Error(
      `Viewer build not found at ${serverEntry}. Run "pnpm --filter @component-atlas/viewer build".`,
    );
  }
  const url = `http://127.0.0.1:${options.port}`;
  const child = spawn(process.execPath, [serverEntry], {
    stdio: "inherit",
    env: {
      ...process.env,
      ATLAS_PROJECT_ROOT: graph.project.rootPath,
      NITRO_HOST: "127.0.0.1",
      NITRO_PORT: options.port,
    },
  });
  const shutdown = (): void => {
    if (!child.killed) child.kill();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  child.once("error", (error) => {
    process.stderr.write(`Viewer process failed: ${error.message}\n`);
  });
  child.on("exit", (code) => {
    if (code && code !== 0) process.exitCode = code;
  });
  await waitForUrl(url);
  if (options.browser) await open(url);
  process.stdout.write(`Component Atlas map is running at ${url}\n`);
}

export function createProgram(): Command {
  const program = new Command()
    .name("component-atlas")
    .description("Reuse-first component intelligence for coding agents.")
    .version("0.1.0")
    .showSuggestionAfterError();

  program
    .command("setup")
    .description("Globally ignore per-project .component-atlas artifacts.")
    .action(async () => {
      const filePath = await configureGlobalIgnore();
      process.stdout.write(`Configured .component-atlas/ in ${filePath}\n`);
    });

  program
    .command("scan")
    .argument("[path]", "repository root", ".")
    .option("--framework <framework>", "vue or react")
    .option("--json", "print the full graph")
    .description("Scan a repository and refresh its local component graph.")
    .action(
      async (
        rootPath: string,
        options: { framework?: Framework; json?: boolean },
      ) => {
        const graph = await scanProject(
          rootPath,
          options.framework ? { framework: options.framework } : {},
        );
        printJson(options.json ? graph : graphSummary(graph));
      },
    );

  program
    .command("search")
    .argument("<path>", "repository root")
    .argument("<query>", "component intent, name, prop, or path")
    .option("-l, --limit <number>", "maximum results", "10")
    .description("Find reuse candidates.")
    .action(async (rootPath: string, query: string, options: { limit: string }) => {
      const graph = await loadProjectGraph(rootPath);
      printJson(searchComponents(graph, query, Number(options.limit)));
    });

  program
    .command("context")
    .argument("<path>", "repository root")
    .argument("<intent>", "frontend intent or component responsibility")
    .option("-l, --limit <number>", "maximum candidates", "3")
    .description("Return compact reuse context for a coding agent.")
    .action(async (rootPath: string, intent: string, options: { limit: string }) => {
      const graph = await loadProjectGraph(rootPath);
      printJson(buildReuseContext(graph, intent, Number(options.limit)));
    });

  program
    .command("show")
    .argument("<path>", "repository root")
    .argument("<component>", "id, name, runtime name, or source path")
    .description("Show one indexed component.")
    .action(async (rootPath: string, selector: string) => {
      const graph = await loadProjectGraph(rootPath);
      printComponent(requireFound(findComponent(graph, selector), selector));
    });

  program
    .command("similar")
    .argument("<path>", "repository root")
    .argument("<component>", "id, name, runtime name, or source path")
    .description("Find explainably similar components.")
    .action(async (rootPath: string, selector: string) => {
      const graph = await loadProjectGraph(rootPath);
      const component = requireFound(findComponent(graph, selector), selector);
      printJson(similarComponents(graph, component.id));
    });

  program
    .command("impact")
    .argument("<path>", "repository root")
    .argument("<component>", "id, name, runtime name, or source path")
    .description("List direct and transitive consumers.")
    .action(async (rootPath: string, selector: string) => {
      const graph = await loadProjectGraph(rootPath);
      const component = requireFound(findComponent(graph, selector), selector);
      printJson(componentImpact(graph, component.id));
    });

  program
    .command("decision")
    .argument("<path>", "repository root")
    .requiredOption("--intent <text>", "what UI is being implemented")
    .requiredOption(
      "--decision <kind>",
      "reuse, extend, compose, extract-and-reuse, or create",
    )
    .requiredOption("--rationale <text>", "why this decision is appropriate")
    .option("--select <ids...>", "selected component ids")
    .option("--reject <ids...>", "rejected component ids")
    .option("--author <name>", "decision author")
    .description("Record a reuse-first implementation decision.")
    .action(
      async (
        rootPath: string,
        options: {
          intent: string;
          decision: DecisionKind;
          rationale: string;
          select?: string[];
          reject?: string[];
          author?: string;
        },
      ) => {
        printJson(
          await recordDecision({
            rootPath,
            intent: options.intent,
            decision: options.decision,
            rationale: options.rationale,
            selectedComponentIds: options.select ?? [],
            rejectedComponentIds: options.reject ?? [],
            ...(options.author ? { author: options.author } : {}),
          }),
        );
      },
    );

  program
    .command("open")
    .argument("[path]", "repository root", ".")
    .option("-p, --port <port>", "local viewer port", "4173")
    .option("--no-browser", "do not open the default browser")
    .description("Refresh the graph and launch the read-only relationship map.")
    .action(
      async (
        rootPath: string,
        options: { port: string; browser: boolean },
      ) => openViewer(rootPath, options),
    );

  program
    .command("mcp")
    .description("Start the Component Atlas MCP server over stdio.")
    .action(startMcpServer);

  return program;
}

const entryPath = process.argv[1];
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  createProgram().parseAsync().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
