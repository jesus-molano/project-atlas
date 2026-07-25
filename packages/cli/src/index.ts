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
  buildComponentContext,
  buildImpactContext,
  buildReuseContext,
  buildSimilarityContext,
  componentImpact,
  findComponent,
  searchComponentContext,
  searchComponents,
  similarComponents,
  type DecisionKind,
  type Framework,
} from "@component-atlas/core";
import type { MemoryStatus, MemoryType } from "@component-atlas/memory";
import { startMcpServer } from "@component-atlas/mcp";
import {
  findTaskDesignCandidates,
  getProjectMemoryItem,
  getTaskContext,
  graphSummary,
  indexProjectMemory,
  inspectFigmaDesignNode,
  listFigmaDesignIndexes,
  loadProjectGraph,
  mapFigmaDesign,
  applyMemoryUpdate,
  checkBeforeChange,
  orientProject,
  proposeMemoryUpdate,
  recordDecision,
  recordProjectOutcome,
  scanProject,
  searchProjectMemory,
  type MapFigmaDesignInput,
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

function printBudgetedJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function printComponent(component: ReturnType<typeof findComponent>): void {
  if (!component) return;
  printJson(component);
}

function parseLimit(value: string, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Limit must be a positive integer, received "${value}".`);
  }
  return Math.min(parsed, maximum);
}

function parseBudget(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 800) {
    throw new Error(
      `Budget must be an integer of at least 800 characters, received "${value}".`,
    );
  }
  return Math.min(parsed, 12_000);
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
    .option("--raw", "include full indexed nodes")
    .description("Find compact reuse candidates.")
    .action(
      async (
        rootPath: string,
        query: string,
        options: { limit: string; raw?: boolean },
      ) => {
        const graph = await loadProjectGraph(rootPath);
        const limit = parseLimit(options.limit, 50);
        printJson(
          options.raw
            ? searchComponents(graph, query, limit)
            : searchComponentContext(graph, query, limit),
        );
      },
    );

  program
    .command("context")
    .argument("<path>", "repository root")
    .argument("<intent>", "frontend intent or component responsibility")
    .option("-l, --limit <number>", "maximum candidates", "3")
    .description("Return compact reuse context for a coding agent.")
    .action(async (rootPath: string, intent: string, options: { limit: string }) => {
      const graph = await loadProjectGraph(rootPath);
      printJson(buildReuseContext(graph, intent, parseLimit(options.limit, 5)));
    });

  program
    .command("show")
    .argument("<path>", "repository root")
    .argument("<component>", "id, name, runtime name, or source path")
    .option("--raw", "include the full indexed node")
    .description("Show compact context for one component.")
    .action(
      async (rootPath: string, selector: string, options: { raw?: boolean }) => {
        const graph = await loadProjectGraph(rootPath);
        if (options.raw) {
          printComponent(requireFound(findComponent(graph, selector), selector));
          return;
        }
        printJson(buildComponentContext(graph, selector));
      },
    );

  program
    .command("similar")
    .argument("<path>", "repository root")
    .argument("<component>", "id, name, runtime name, or source path")
    .option("-l, --limit <number>", "maximum candidates", "5")
    .option("--raw", "include full indexed nodes and evidence")
    .description("Find compact, explainably similar components.")
    .action(
      async (
        rootPath: string,
        selector: string,
        options: { limit: string; raw?: boolean },
      ) => {
        const graph = await loadProjectGraph(rootPath);
        const limit = parseLimit(options.limit, 20);
        if (options.raw) {
          const component = requireFound(findComponent(graph, selector), selector);
          printJson(similarComponents(graph, component.id).slice(0, limit));
          return;
        }
        printJson(buildSimilarityContext(graph, selector, limit));
      },
    );

  program
    .command("impact")
    .argument("<path>", "repository root")
    .argument("<component>", "id, name, runtime name, or source path")
    .option("--raw", "include full indexed consumer nodes")
    .description("Summarize direct and transitive consumers.")
    .action(
      async (rootPath: string, selector: string, options: { raw?: boolean }) => {
        const graph = await loadProjectGraph(rootPath);
        if (options.raw) {
          const component = requireFound(findComponent(graph, selector), selector);
          printJson(componentImpact(graph, component.id));
          return;
        }
        printJson(buildImpactContext(graph, selector));
      },
    );

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

  const memory = program
    .command("memory")
    .description(
      "Index and query scoped Project Atlas memory with hard response budgets.",
    );

  memory
    .command("index")
    .argument("[path]", "repository root", ".")
    .description("Rebuild the SQLite memory index from project Markdown.")
    .action(async (rootPath: string) => {
      printJson(await indexProjectMemory(rootPath));
    });

  memory
    .command("orient")
    .argument("[path]", "repository root", ".")
    .option("--budget <chars>", "hard response budget in characters", "3600")
    .option("--refresh", "refresh Markdown memory before orientation")
    .description("Return a small Project Atlas map and expandable handles.")
    .action(
      async (
        rootPath: string,
        options: { budget: string; refresh?: boolean },
      ) => {
        printBudgetedJson(
          await orientProject(rootPath, {
            budgetChars: parseBudget(options.budget),
            ...(options.refresh ? { refreshMemory: true } : {}),
          }),
        );
      },
    );

  memory
    .command("search")
    .argument("<path>", "repository root")
    .argument("<query>", "memory intent, area, decision, or term")
    .option("-l, --limit <number>", "maximum results", "5")
    .option("--cursor <cursor>", "opaque cursor from a previous response")
    .option("--type <types...>", "memory types to include")
    .option("--status <statuses...>", "memory statuses to include")
    .option("--include-inactive", "include superseded and archived memory")
    .option("--budget <chars>", "hard response budget in characters", "3600")
    .description("Search scoped memory and return compact expandable results.")
    .action(
      async (
        rootPath: string,
        query: string,
        options: {
          limit: string;
          cursor?: string;
          type?: string[];
          status?: string[];
          includeInactive?: boolean;
          budget: string;
        },
      ) => {
        printBudgetedJson(
          await searchProjectMemory(rootPath, query, {
            limit: parseLimit(options.limit, 10),
            budgetChars: parseBudget(options.budget),
            ...(options.cursor ? { cursor: options.cursor } : {}),
            ...(options.type
              ? {
                  types: options.type as MemoryType[],
                }
              : {}),
            ...(options.status
              ? {
                  statuses: options.status as MemoryStatus[],
                }
              : {}),
            ...(options.includeInactive ? { includeInactive: true } : {}),
          }),
        );
      },
    );

  memory
    .command("show")
    .argument("<path>", "repository root")
    .argument("<id>", "confirmed memory item ID")
    .option("--budget <chars>", "hard response budget in characters", "5000")
    .description("Expand one confirmed memory item.")
    .action(async (rootPath: string, id: string, options: { budget: string }) => {
      printBudgetedJson(
        await getProjectMemoryItem(rootPath, id, {
          budgetChars: parseBudget(options.budget),
        }),
      );
    });

  memory
    .command("task")
    .argument("<path>", "repository root")
    .argument("<task>", "task or implementation intent")
    .option("--figma-file <file>", "cached Figma URL or file key")
    .option("--budget <chars>", "shared hard response budget", "4200")
    .option("--refresh", "refresh Markdown memory before retrieval")
    .description("Combine memory, code, and optional design in one compact bundle.")
    .action(
      async (
        rootPath: string,
        task: string,
        options: { figmaFile?: string; budget: string; refresh?: boolean },
      ) => {
        printBudgetedJson(
          await getTaskContext(rootPath, task, {
            budgetChars: parseBudget(options.budget),
            ...(options.figmaFile ? { figmaFile: options.figmaFile } : {}),
            ...(options.refresh ? { refreshMemory: true } : {}),
          }),
        );
      },
    );

  memory
    .command("check")
    .argument("<path>", "repository root")
    .argument("<intent>", "planned change")
    .option("--file <files...>", "files likely to change")
    .option("--budget <chars>", "hard response budget in characters", "3600")
    .description("Warn before contradicting decisions or repeating failed attempts.")
    .action(
      async (
        rootPath: string,
        intent: string,
        options: { file?: string[]; budget: string },
      ) => {
        printBudgetedJson(
          await checkBeforeChange(rootPath, intent, {
            budgetChars: parseBudget(options.budget),
            ...(options.file ? { files: options.file } : {}),
          }),
        );
      },
    );

  memory
    .command("propose")
    .argument("<path>", "repository root")
    .requiredOption("--input <json>", "proposal JSON file")
    .option("--budget <chars>", "hard response budget in characters", "3600")
    .description("Store a reviewable memory proposal without promoting it.")
    .action(
      async (
        rootPath: string,
        options: { input: string; budget: string },
      ) => {
        const proposal = JSON.parse(
          await readFile(path.resolve(options.input), "utf8"),
        ) as Omit<
          Parameters<typeof proposeMemoryUpdate>[0],
          "rootPath" | "budgetChars"
        >;
        printBudgetedJson(
          await proposeMemoryUpdate({
            rootPath,
            ...proposal,
            budgetChars: parseBudget(options.budget),
          }),
        );
      },
    );

  memory
    .command("apply")
    .argument("<path>", "repository root")
    .argument("<proposal>", "reviewed proposal ID")
    .requiredOption("--confirm", "explicitly approve the durable write")
    .option("--target <target>", "local or canonical", "local")
    .option("--budget <chars>", "hard response budget in characters", "3600")
    .description("Apply a reviewed proposal to Markdown and SQLite.")
    .action(
      async (
        rootPath: string,
        proposal: string,
        options: { confirm: boolean; target: string; budget: string },
      ) => {
        if (!["local", "canonical"].includes(options.target)) {
          throw new Error('Memory target must be "local" or "canonical".');
        }
        printBudgetedJson(
          await applyMemoryUpdate(rootPath, proposal, {
            confirmed: options.confirm,
            target: options.target as "local" | "canonical",
            budgetChars: parseBudget(options.budget),
          }),
        );
      },
    );

  memory
    .command("outcome")
    .argument("<path>", "repository root")
    .requiredOption("--input <json>", "outcome JSON file")
    .option("--budget <chars>", "hard response budget in characters", "3600")
    .description("Record an auditable local task outcome.")
    .action(
      async (
        rootPath: string,
        options: { input: string; budget: string },
      ) => {
        const outcome = JSON.parse(
          await readFile(path.resolve(options.input), "utf8"),
        ) as Omit<
          Parameters<typeof recordProjectOutcome>[0],
          "rootPath" | "budgetChars"
        >;
        printBudgetedJson(
          await recordProjectOutcome({
            rootPath,
            ...outcome,
            budgetChars: parseBudget(options.budget),
          }),
        );
      },
    );

  const figma = program
    .command("figma")
    .description("Build and query the local lightweight Figma Design Index.");

  figma
    .command("map")
    .argument("<path>", "repository root")
    .argument("<figma-url>", "Figma file, page, or node URL")
    .requiredOption(
      "--metadata <file>",
      "file containing get_metadata XML or Figma REST JSON",
    )
    .option(
      "--format <format>",
      "auto, figma-mcp-xml, or figma-rest",
      "auto",
    )
    .option("--file-name <name>", "Figma file name")
    .option("--file-version <version>", "Figma file version")
    .option("--last-modified <date>", "Figma lastModified value")
    .option("--scope-node <id>", "page or node covered by this metadata")
    .option(
      "--enrichment <file>",
      "optional JSON with status, resources, libraries, Code Connect, or variables",
    )
    .option("--force", "reprocess an unchanged metadata snapshot")
    .description("Create or incrementally update one cached Figma map.")
    .action(
      async (
        rootPath: string,
        figmaUrl: string,
        options: {
          metadata: string;
          format: "auto" | "figma-mcp-xml" | "figma-rest";
          fileName?: string;
          fileVersion?: string;
          lastModified?: string;
          scopeNode?: string;
          enrichment?: string;
          force?: boolean;
        },
      ) => {
        if (
          !["auto", "figma-mcp-xml", "figma-rest"].includes(options.format)
        ) {
          throw new Error(
            `Invalid Figma metadata format "${options.format}".`,
          );
        }
        const metadata = await readFile(path.resolve(options.metadata), "utf8");
        const enrichment = options.enrichment
          ? (JSON.parse(
              await readFile(path.resolve(options.enrichment), "utf8"),
            ) as NonNullable<MapFigmaDesignInput["enrichment"]>)
          : undefined;
        printJson(
          await mapFigmaDesign({
            rootPath,
            figmaUrl,
            metadata,
            format: options.format,
            ...(options.fileName ? { fileName: options.fileName } : {}),
            ...(options.fileVersion ? { version: options.fileVersion } : {}),
            ...(options.lastModified
              ? { lastModified: options.lastModified }
              : {}),
            ...(options.scopeNode ? { scopeNodeId: options.scopeNode } : {}),
            ...(enrichment ? { enrichment } : {}),
            ...(options.force ? { force: true } : {}),
          }),
        );
      },
    );

  figma
    .command("list")
    .argument("<path>", "repository root")
    .description("List cached Figma maps without loading their full nodes.")
    .action(async (rootPath: string) => {
      printJson(await listFigmaDesignIndexes(rootPath));
    });

  figma
    .command("find")
    .argument("<path>", "repository root")
    .argument("<task>", "task or implementation intent")
    .option("--file <figma-file>", "Figma URL or file key")
    .option("-l, --limit <number>", "maximum candidates", "5")
    .description(
      "Rank a few explainable design candidates using Figma and Atlas signals.",
    )
    .action(
      async (
        rootPath: string,
        task: string,
        options: { file?: string; limit: string },
      ) => {
        printJson(
          await findTaskDesignCandidates(rootPath, task, {
            ...(options.file ? { figmaFile: options.file } : {}),
            limit: parseLimit(options.limit, 10),
          }),
        );
      },
    );

  figma
    .command("inspect")
    .argument("<path>", "repository root")
    .argument("<figma-file>", "Figma URL or file key")
    .argument("<node>", "confirmed node ID, exact name, path, or node URL")
    .description(
      "Inspect one confirmed cached node and return its deep-context handoff.",
    )
    .action(
      async (rootPath: string, figmaFile: string, node: string) => {
        printJson(await inspectFigmaDesignNode(rootPath, figmaFile, node));
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
