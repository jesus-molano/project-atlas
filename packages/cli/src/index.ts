#!/usr/bin/env node
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  access,
  appendFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessTaskRisk,
  buildComponentContext,
  buildImpactContext,
  buildReuseContext,
  buildSimilarityContext,
  componentImpact,
  findComponent,
  missingTaskSourceReference,
  searchComponentContext,
  searchComponents,
  similarComponents,
  taskSourceId,
  type DecisionKind,
  type Framework,
  type TaskSourceDecision,
  type TaskSourceKind,
} from "@component-atlas/core";
import type { MemoryStatus, MemoryType } from "@component-atlas/memory";
import { startMcpServer } from "@component-atlas/mcp";
import {
  findTaskDesignCandidates,
  fitBudgetedResponse,
  getProjectMemoryItem,
  getProjectCapabilities,
  graphSummary,
  indexProjectMemory,
  inspectFigmaDesignNode,
  listFigmaDesignIndexes,
  loadProjectGraph,
  mapFigmaDesign,
  applyMemoryUpdate,
  checkBeforeChange,
  orientProject,
  prepareTaskContext,
  proposeMemoryUpdate,
  recordDecision,
  recordProjectOutcome,
  recordTaskEvaluation,
  reportProjectCapabilities,
  listTaskEvaluations,
  clearTaskEvaluations,
  scanProject,
  searchProjectMemory,
  type MapFigmaDesignInput,
} from "@component-atlas/runtime";
import { Command, InvalidArgumentError } from "commander";
import open from "open";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export interface ViewerReadiness {
  sessionToken: string;
  expectedProjectId?: string;
}

export interface ViewerWaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
  signal?: AbortSignal;
  onProbeTimeout?: (diagnostic: string) => void;
}

function errorSummary(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause instanceof Error && cause.message !== error.message) {
    return `${error.message}: ${cause.message}`;
  }
  return error.message;
}

interface ViewerProbeStats {
  attempts: number;
  successes: number;
  timeouts: number;
  lastStatus?: number;
  lastElapsedMs: number;
  lastDetail: string;
}

class ViewerProbeError extends Error {
  constructor(
    readonly endpoint: string,
    readonly elapsedMs: number,
    readonly timedOut: boolean,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function probeViewerJson(
  url: string,
  endpoint: string,
  requestTimeoutMs: number,
  signal?: AbortSignal,
): Promise<{ elapsedMs: number; payload: unknown; status: number }> {
  const startedAt = Date.now();
  const timeoutSignal = AbortSignal.timeout(requestTimeoutMs);
  try {
    const response = await fetch(`${url}${endpoint}`, {
      signal: signal
        ? AbortSignal.any([timeoutSignal, signal])
        : timeoutSignal,
    });
    const elapsedMs = Date.now() - startedAt;
    if (!response.ok) {
      throw new ViewerProbeError(
        endpoint,
        elapsedMs,
        false,
        `${endpoint} returned HTTP ${response.status} after ${elapsedMs} ms`,
        response.status,
      );
    }
    try {
      return {
        elapsedMs,
        payload: (await response.json()) as unknown,
        status: response.status,
      };
    } catch (error) {
      throw new ViewerProbeError(
        endpoint,
        Date.now() - startedAt,
        false,
        `${endpoint} returned invalid JSON: ${errorSummary(error)}`,
      );
    }
  } catch (error) {
    if (error instanceof ViewerProbeError) throw error;
    const elapsedMs = Date.now() - startedAt;
    const timedOut = timeoutSignal.aborted && !signal?.aborted;
    throw new ViewerProbeError(
      endpoint,
      elapsedMs,
      timedOut,
      timedOut
        ? `${endpoint} timed out after ${elapsedMs} ms`
        : `${endpoint} failed after ${elapsedMs} ms: ${errorSummary(error)}`,
    );
  }
}

function formatViewerProbeStats(
  stats: Map<string, ViewerProbeStats>,
  firstTimeout: string | undefined,
): string {
  const endpoints = [...stats.entries()].map(([endpoint, state]) => {
    const status = state.lastStatus
      ? `HTTP ${state.lastStatus}, ${state.successes} successful`
      : "no response";
    const timeouts = state.timeouts
      ? `, ${state.timeouts} timed out`
      : "";
    return `${endpoint}: ${state.attempts} attempts, ${status}${timeouts}, last ${state.lastElapsedMs} ms (${state.lastDetail})`;
  });
  return [
    ...(firstTimeout ? [`first stalled endpoint ${firstTimeout}`] : []),
    ...endpoints,
  ].join("; ");
}

interface ViewerOutputRelay {
  bindFailure: Promise<never>;
  recentOutput: () => string;
}

function relayViewerOutput(child: ChildProcess): ViewerOutputRelay {
  let recentOutput = "";
  let bindFailureReported = false;
  let rejectBindFailure: (error: Error) => void = () => undefined;
  const bindFailure = new Promise<never>((_resolve, reject) => {
    rejectBindFailure = reject;
  });
  const forward =
    (target: NodeJS.WriteStream) =>
    (chunk: string | Buffer): void => {
      const text = String(chunk);
      target.write(chunk);
      recentOutput = `${recentOutput}${text}`.slice(-8_192);
      if (
        !bindFailureReported &&
        /EADDRINUSE|address already in use/i.test(recentOutput)
      ) {
        bindFailureReported = true;
        const bindLine =
          recentOutput
            .split(/\r?\n/)
            .find((line) => /EADDRINUSE|address already in use/i.test(line))
            ?.trim() ?? "address already in use";
        rejectBindFailure(new Error(`Viewer bind failed: ${bindLine}`));
      }
    };
  child.stdout?.on("data", forward(process.stdout));
  child.stderr?.on("data", forward(process.stderr));
  return {
    bindFailure,
    recentOutput: () => recentOutput.trim(),
  };
}

export async function waitForViewer(
  url: string,
  readiness: ViewerReadiness,
  options: ViewerWaitOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  const requestTimeoutMs = options.requestTimeoutMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;
  const probeStats = new Map<string, ViewerProbeStats>();
  let firstTimeout: string | undefined;
  let lastFailure = "the viewer did not accept a loopback connection";

  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      throw options.signal.reason;
    }
    try {
      const sessionEndpoint = "/api/agent/session";
      const sessionProbe = await probeViewerJson(
        url,
        sessionEndpoint,
        requestTimeoutMs,
        options.signal,
      );
      const sessionState = probeStats.get(sessionEndpoint) ?? {
        attempts: 0,
        successes: 0,
        timeouts: 0,
        lastElapsedMs: 0,
        lastDetail: "not requested",
      };
      sessionState.attempts += 1;
      sessionState.successes += 1;
      sessionState.lastStatus = sessionProbe.status;
      sessionState.lastElapsedMs = sessionProbe.elapsedMs;
      sessionState.lastDetail = `HTTP ${sessionProbe.status}`;
      probeStats.set(sessionEndpoint, sessionState);
      const session = sessionProbe.payload;
      if (
        !session ||
        typeof session !== "object" ||
        !("token" in session) ||
        session.token !== readiness.sessionToken
      ) {
        throw new Error(
          "the session endpoint did not return this launcher's session",
        );
      }

      if (
        "launch" in session &&
        session.launch &&
        typeof session.launch === "object" &&
        "mode" in session.launch
      ) {
        const launch = session.launch;
        if (
          readiness.expectedProjectId &&
          launch.mode === "project" &&
          "projectId" in launch &&
          launch.projectId === readiness.expectedProjectId
        ) {
          return;
        }
        if (!readiness.expectedProjectId && launch.mode === "selector") {
          return;
        }
        throw new Error(
          readiness.expectedProjectId
            ? "/api/agent/session returned a different project fingerprint"
            : "/api/agent/session returned a project session instead of the selector",
        );
      }

      const endpoint = readiness.expectedProjectId
        ? "/api/workspace"
        : "/api/projects";
      const stateProbe = await probeViewerJson(
        url,
        endpoint,
        requestTimeoutMs,
        options.signal,
      );
      const endpointState = probeStats.get(endpoint) ?? {
        attempts: 0,
        successes: 0,
        timeouts: 0,
        lastElapsedMs: 0,
        lastDetail: "not requested",
      };
      endpointState.attempts += 1;
      endpointState.successes += 1;
      endpointState.lastStatus = stateProbe.status;
      endpointState.lastElapsedMs = stateProbe.elapsedMs;
      endpointState.lastDetail = `HTTP ${stateProbe.status}`;
      probeStats.set(endpoint, endpointState);
      const payload = stateProbe.payload;
      if (!readiness.expectedProjectId) {
        if (
          payload &&
          typeof payload === "object" &&
          "projects" in payload &&
          Array.isArray(payload.projects) &&
          !("activeRoot" in payload)
        ) {
          return;
        }
        throw new Error(
          "/api/projects returned a state for a different launcher mode",
        );
      }
      if (
        payload &&
        typeof payload === "object" &&
        "graph" in payload &&
        payload.graph &&
        typeof payload.graph === "object" &&
        "project" in payload.graph &&
        payload.graph.project &&
        typeof payload.graph.project === "object" &&
        "id" in payload.graph.project &&
        payload.graph.project.id === readiness.expectedProjectId
      ) {
        return;
      }
      throw new Error(
        "/api/workspace returned a different project fingerprint",
      );
    } catch (error) {
      if (options.signal?.aborted) {
        throw options.signal.reason;
      }
      if (error instanceof ViewerProbeError) {
        const endpointState = probeStats.get(error.endpoint) ?? {
          attempts: 0,
          successes: 0,
          timeouts: 0,
          lastElapsedMs: 0,
          lastDetail: "not requested",
        };
        endpointState.attempts += 1;
        if (error.timedOut) endpointState.timeouts += 1;
        if (error.status) endpointState.lastStatus = error.status;
        endpointState.lastElapsedMs = error.elapsedMs;
        endpointState.lastDetail = error.message;
        probeStats.set(error.endpoint, endpointState);
        if (error.timedOut && !firstTimeout) {
          firstTimeout = `${error.endpoint} after ${error.elapsedMs} ms`;
          options.onProbeTimeout?.(
            `${error.endpoint} timed out after ${error.elapsedMs} ms`,
          );
        }
      }
      // The local server may still be binding its port.
      lastFailure = errorSummary(error);
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) {
      await new Promise<void>((resolve) => {
        let timer: NodeJS.Timeout;
        const finish = (): void => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", finish);
          resolve();
        };
        timer = setTimeout(
          finish,
          Math.min(pollIntervalMs, remainingMs),
        );
        options.signal?.addEventListener("abort", finish, { once: true });
      });
    }
  }
  const diagnostics = formatViewerProbeStats(probeStats, firstTimeout);
  throw new Error(
    `Local server did not become ready at ${url} within ${timeoutMs} ms. Last readiness check: ${lastFailure}.${diagnostics ? ` Readiness diagnostics: ${diagnostics}.` : ""}`,
  );
}

export async function findAvailableLoopbackPort(): Promise<number> {
  const server = net.createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(
        { host: "127.0.0.1", port: 0, exclusive: true },
        () => resolve(),
      );
    });
    const address = server.address();
    if (!address || typeof address === "string" || address.port <= 0) {
      throw new Error("Windows did not provide a free loopback port.");
    }
    return address.port;
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}

export function parseViewerPort(value: string): number | undefined {
  if (value.trim().toLowerCase() === "auto") return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Viewer port must be "auto" or an integer from 1 to 65535.');
  }
  return port;
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
  if (parsed > maximum) {
    throw new Error(`Limit must not exceed ${maximum}, received "${value}".`);
  }
  return parsed;
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

export async function configureGlobalIgnore(): Promise<string> {
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

export async function resolveBundledCodexBinary(
  repositoryRoot: string,
): Promise<string | undefined> {
  const target =
    process.platform === "win32" && process.arch === "x64"
      ? {
          packageSuffix: "-win32-x64",
          binary: path.join(
            "vendor",
            "x86_64-pc-windows-msvc",
            "bin",
            "codex.exe",
          ),
        }
      : process.platform === "win32" && process.arch === "arm64"
        ? {
            packageSuffix: "-win32-arm64",
            binary: path.join(
              "vendor",
              "aarch64-pc-windows-msvc",
              "bin",
              "codex.exe",
            ),
          }
        : process.platform === "linux" && process.arch === "x64"
          ? {
              packageSuffix: "-linux-x64",
              binary: path.join(
                "vendor",
                "x86_64-unknown-linux-musl",
                "bin",
                "codex",
              ),
            }
          : process.platform === "linux" && process.arch === "arm64"
            ? {
                packageSuffix: "-linux-arm64",
                binary: path.join(
                  "vendor",
                  "aarch64-unknown-linux-musl",
                  "bin",
                  "codex",
                ),
              }
            : process.platform === "darwin" && process.arch === "x64"
              ? {
                  packageSuffix: "-darwin-x64",
                  binary: path.join(
                    "vendor",
                    "x86_64-apple-darwin",
                    "bin",
                    "codex",
                  ),
                }
              : process.platform === "darwin" && process.arch === "arm64"
                ? {
                    packageSuffix: "-darwin-arm64",
                    binary: path.join(
                      "vendor",
                      "aarch64-apple-darwin",
                      "bin",
                      "codex",
                    ),
                  }
                : undefined;
  if (!target) return undefined;
  const pnpmRoot = path.join(repositoryRoot, "node_modules", ".pnpm");
  let entries: string[];
  try {
    entries = await readdir(pnpmRoot);
  } catch {
    return undefined;
  }
  const packageDirectory = entries
    .filter(
      (entry) =>
        entry.startsWith("@openai+codex@") &&
        entry.endsWith(target.packageSuffix),
    )
    .sort()
    .at(-1);
  if (!packageDirectory) return undefined;
  const candidate = path.join(
    pnpmRoot,
    packageDirectory,
    "node_modules",
    "@openai",
    "codex",
    target.binary,
  );
  return (await fileExists(candidate)) ? candidate : undefined;
}

async function openViewer(
  rootPath: string | undefined,
  options: { port: string; browser: boolean },
): Promise<void> {
  const graph = rootPath ? await scanProject(rootPath) : undefined;
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
      `Project Atlas is not built at ${serverEntry}. From ${repositoryRoot}, run "pnpm atlas" to build and open it.`,
    );
  }
  const codexPath = await resolveBundledCodexBinary(repositoryRoot);
  const explicitPort = parseViewerPort(options.port);
  const port = explicitPort ?? (await findAvailableLoopbackPort());
  const url = `http://127.0.0.1:${port}`;
  const sessionToken = randomBytes(32).toString("base64url");
  const {
    ATLAS_PROJECT_ROOT: _projectRoot,
    ATLAS_PROJECT_ID: _projectId,
    ATLAS_CHECKOUT_ID: _checkoutId,
    ATLAS_GUI_SESSION_TOKEN: _sessionToken,
    NITRO_HOST: _nitroHost,
    NITRO_PORT: _nitroPort,
    ...baseEnvironment
  } = process.env;
  const child = spawn(process.execPath, [serverEntry], {
    stdio: ["inherit", "pipe", "pipe"],
    windowsHide: true,
    env: {
      ...baseEnvironment,
      ...(graph
        ? {
            ATLAS_PROJECT_ROOT: graph.project.rootPath,
            ATLAS_PROJECT_ID: graph.project.id,
            ...(graph.project.identity?.checkoutId
              ? { ATLAS_CHECKOUT_ID: graph.project.identity.checkoutId }
              : {}),
          }
        : {}),
      ATLAS_CLI_ENTRY: currentFile,
      ATLAS_GUI_SESSION_TOKEN: sessionToken,
      ...(codexPath ? { ATLAS_CODEX_PATH: codexPath } : {}),
      NITRO_HOST: "127.0.0.1",
      NITRO_PORT: String(port),
    },
  });
  const outputRelay = relayViewerOutput(child);
  const startupController = new AbortController();
  const removeStartupShutdown = registerViewerShutdown(child);

  try {
    await Promise.race([
      waitForViewerChild(
        child,
        url,
        {
          sessionToken,
          ...(graph ? { expectedProjectId: graph.project.id } : {}),
        },
        {
          signal: startupController.signal,
          onProbeTimeout: (diagnostic) => {
            process.stderr.write(
              `Viewer readiness probe stalled: ${diagnostic}. The viewer is bound; waiting for this same process.\n`,
            );
          },
        },
      ),
      outputRelay.bindFailure,
    ]);
    if (options.browser) await open(url);
  } catch (error) {
    await stopViewerChild(child);
    const portKind = explicitPort
      ? `explicit loopback port ${port}`
      : `automatically selected loopback port ${port}`;
    const recentOutput = outputRelay.recentOutput();
    const outputDetail = recentOutput
      ? ` Last viewer output: ${recentOutput.split(/\r?\n/).at(-1)}`
      : "";
    throw new Error(
      `Project Atlas viewer failed to start on ${portKind}. ${errorSummary(error)}${outputDetail}`,
      { cause: error },
    );
  } finally {
    startupController.abort(new Error("Viewer startup check cancelled."));
    removeStartupShutdown();
  }

  manageViewerLifecycle(child);
  process.stdout.write(`Project Atlas GUI is running at ${url}\n`);
  process.stdout.write("Press Ctrl+C in this terminal to close it.\n");
}

export async function waitForViewerChild(
  child: ChildProcess,
  url: string,
  readiness: ViewerReadiness,
  options: ViewerWaitOptions = {},
): Promise<void> {
  const readinessController = new AbortController();
  let onError: ((error: Error) => void) | undefined;
  let onExit:
    | ((code: number | null, signal: NodeJS.Signals | null) => void)
    | undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    onError = (error) => reject(error);
    onExit = (code, signal) =>
      reject(
        new Error(
          `Viewer process exited before it was ready (code ${code ?? "none"}, signal ${signal ?? "none"}).`,
        ),
      );
    child.once("error", onError);
    child.once("exit", onExit);
  });
  try {
    const signal = options.signal
      ? AbortSignal.any([options.signal, readinessController.signal])
      : readinessController.signal;
    await Promise.race([
      waitForViewer(url, readiness, { ...options, signal }),
      stopped,
    ]);
  } finally {
    readinessController.abort(new Error("Viewer readiness check cancelled."));
    if (onError) child.removeListener("error", onError);
    if (onExit) child.removeListener("exit", onExit);
  }
}

export async function stopViewerChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await new Promise<void>((resolve) => {
    let giveUpTimer: NodeJS.Timeout | undefined;
    const forceTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      giveUpTimer = setTimeout(resolve, 2_000);
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(forceTimer);
      if (giveUpTimer) clearTimeout(giveUpTimer);
      resolve();
    });
  });
}

function registerViewerShutdown(child: ChildProcess): () => void {
  const shutdown = (): void => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  };
  const removeListeners = (): void => {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    process.removeListener("SIGHUP", shutdown);
    process.removeListener("exit", shutdown);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("SIGHUP", shutdown);
  process.once("exit", shutdown);
  return removeListeners;
}

function manageViewerLifecycle(child: ChildProcess): void {
  const removeListeners = registerViewerShutdown(child);
  child.once("error", (error) => {
    process.stderr.write(`Viewer process failed: ${error.message}\n`);
  });
  child.once("exit", (code) => {
    removeListeners();
    if (code && code !== 0) process.exitCode = code;
  });
}

export function createProgram(): Command {
  const program = new Command()
    .name("project-atlas")
    .description("Local project evidence and memory for coding agents.")
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
    .option(
      "--framework <framework>",
      "astro, vue, or react",
      (value): Framework => {
        if (value === "astro" || value === "vue" || value === "react") {
          return value;
        }
        throw new InvalidArgumentError(
          'Framework must be one of "astro", "vue", or "react".',
        );
      },
    )
    .option("--json", "print the full graph")
    .option("--full", "disable the incremental scan path")
    .option("--project-key <key>", "explicit stable logical project key")
    .description("Scan a repository and refresh its local component graph.")
    .action(
      async (
        rootPath: string,
        options: {
          framework?: Framework;
          json?: boolean;
          full?: boolean;
          projectKey?: string;
        },
      ) => {
        const graph = await scanProject(
          rootPath,
          {
            ...(options.framework ? { framework: options.framework } : {}),
            ...(options.full ? { incremental: false } : {}),
            ...(options.projectKey ? { projectKey: options.projectKey } : {}),
          },
        );
        printJson(options.json ? graph : graphSummary(graph));
      },
    );

  const capabilities = program
    .command("capabilities")
    .description("Inspect or report connector and enrichment state without probing credentials.");

  capabilities
    .command("show")
    .argument("[path]", "repository root", ".")
    .description("Show observed and locally inferred source capabilities.")
    .action(async (rootPath: string) => {
      printJson(await getProjectCapabilities(rootPath));
    });

  capabilities
    .command("report")
    .argument("[path]", "repository root", ".")
    .requiredOption("--input <json>", "bounded observation JSON file")
    .description("Record current-session capability observations.")
    .action(async (rootPath: string, options: { input: string }) => {
      const observations = JSON.parse(
        await readFile(path.resolve(options.input), "utf8"),
      ) as Parameters<typeof reportProjectCapabilities>[1];
      printJson(await reportProjectCapabilities(rootPath, observations));
    });

  const evaluation = program
    .command("evaluation")
    .description("Opt-in local metrics without task text, code, or source URLs.");

  evaluation
    .command("record")
    .argument("[path]", "repository root", ".")
    .requiredOption("--input <json>", "task evaluation JSON file")
    .description("Hash the task and store only bounded quality metrics.")
    .action(async (rootPath: string, options: { input: string }) => {
      const payload = JSON.parse(
        await readFile(path.resolve(options.input), "utf8"),
      ) as Omit<
        Parameters<typeof recordTaskEvaluation>[0],
        "rootPath"
      >;
      printJson(await recordTaskEvaluation({ rootPath, ...payload }));
    });

  evaluation
    .command("list")
    .argument("[path]", "repository root", ".")
    .option("--limit <number>", "maximum local records", "20")
    .description("List recent content-free evaluation metrics.")
    .action(async (rootPath: string, options: { limit: string }) => {
      printJson(await listTaskEvaluations(rootPath, parseLimit(options.limit, 50)));
    });

  evaluation
    .command("clear")
    .argument("[path]", "repository root", ".")
    .requiredOption("--confirm", "confirm deletion of local evaluation metrics")
    .description("Clear the project-local evaluation history.")
    .action(async (rootPath: string, options: { confirm: boolean }) => {
      if (!options.confirm) throw new Error("Use --confirm to clear metrics.");
      printJson(await clearTaskEvaluations(rootPath));
    });

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
    .option("--budget <characters>", "hard response budget", "3600")
    .description("Return compact reuse context for a coding agent.")
    .action(async (
      rootPath: string,
      intent: string,
      options: { limit: string; budget: string },
    ) => {
      const graph = await loadProjectGraph(rootPath);
      const context = buildReuseContext(
        graph,
        intent,
        parseLimit(options.limit, 5),
      );
      printBudgetedJson(
        fitBudgetedResponse(context as unknown as Record<string, unknown>, {
          budgetChars: parseBudget(options.budget),
          totalMatches: context.candidates.length,
          expandableIds: context.candidates.map(
            (candidate) => candidate.component.id,
          ),
        }),
      );
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
    .option("--project-scope", "promote this confirmed decision to the logical project")
    .option("--confirm-project-scope", "confirm project-wide promotion")
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
          projectScope?: boolean;
          confirmProjectScope?: boolean;
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
            scope: options.projectScope ? "project" : "checkout",
            ...(options.projectScope
              ? { confirmedProjectScope: options.confirmProjectScope === true }
              : {}),
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
    .option("--limit <count>", "maximum candidates per source", "3")
    .option("--refresh", "refresh Markdown memory before retrieval")
    .option("--confirm-objective", "confirm the reviewed objective")
    .option(
      "--source <kind=reference...>",
      "confirmed exact task sources (jira, confluence, figma, github, openapi, other)",
    )
    .option(
      "--omit-source <kinds...>",
      "explicitly omit source kinds after review",
    )
    .option(
      "--unavailable-source <kinds...>",
      "mark reviewed source kinds unavailable",
    )
    .description("Build a compact handle/receipt-ID bundle after task intake clears.")
    .action(
      async (
        rootPath: string,
        task: string,
        options: {
          figmaFile?: string;
          budget: string;
          limit: string;
          refresh?: boolean;
          confirmObjective?: boolean;
          source?: string[];
          omitSource?: string[];
          unavailableSource?: string[];
        },
      ) => {
        const allowedKinds = new Set([
          "jira",
          "confluence",
          "figma",
          "github",
          "openapi",
          "other",
        ]);
        const sources: TaskSourceDecision[] = (options.source ?? []).map((entry) => {
          const separator = entry.indexOf("=");
          const kind = entry.slice(0, separator);
          const reference = entry.slice(separator + 1);
          if (
            separator < 1 ||
            !allowedKinds.has(kind) ||
            !reference.trim()
          ) {
            throw new Error(
              `Invalid --source "${entry}". Use kind=exact-reference.`,
            );
          }
          return {
            id: taskSourceId(kind as TaskSourceKind, reference),
            kind: kind as TaskSourceKind,
            reference,
            origin: "manual" as const,
            state: "confirmed" as const,
            required: false,
            relationship: "primary" as const,
          };
        });
        for (const [state, kinds] of [
          ["omitted", options.omitSource ?? []],
          ["unavailable", options.unavailableSource ?? []],
        ] as const) {
          for (const kind of kinds) {
            if (!allowedKinds.has(kind)) {
              throw new Error(`Invalid source kind "${kind}".`);
            }
            const reference = missingTaskSourceReference(
              kind as TaskSourceKind,
            );
            sources.push({
              id: taskSourceId(kind as TaskSourceKind, reference),
              kind: kind as TaskSourceKind,
              reference,
              origin: "manual",
              state,
              required: false,
              relationship: "primary",
            });
          }
        }
        printBudgetedJson(
          await prepareTaskContext(
            rootPath,
            {
              schemaVersion: 1,
              scope: "task",
              objective: task,
              objectiveConfirmed: options.confirmObjective ?? false,
              risk: assessTaskRisk(task),
              sources,
            },
            {
              budgetChars: parseBudget(options.budget),
              topK: parseLimit(options.limit, 10),
              ...(options.figmaFile ? { figmaFile: options.figmaFile } : {}),
              ...(options.refresh ? { refreshMemory: true } : {}),
            },
          ),
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
    .option(
      "--confirm-canonical",
      "explicitly confirm versionable project-memory Markdown paths",
    )
    .option("--budget <chars>", "hard response budget in characters", "3600")
    .description("Apply a reviewed proposal to Markdown and SQLite.")
    .action(
      async (
        rootPath: string,
        proposal: string,
        options: {
          confirm: boolean;
          confirmCanonical?: boolean;
          target: string;
          budget: string;
        },
      ) => {
        if (!["local", "canonical"].includes(options.target)) {
          throw new Error('Memory target must be "local" or "canonical".');
        }
        printBudgetedJson(
          await applyMemoryUpdate(rootPath, proposal, {
            confirmed: options.confirm,
            target: options.target as "local" | "canonical",
            ...(options.confirmCanonical !== undefined
              ? { canonicalConfirmed: options.confirmCanonical }
              : {}),
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
    .option("--scope-page-id <id>", "parent page ID for scoped metadata")
    .option("--scope-page-name <name>", "parent page name for scoped metadata")
    .option(
      "--enrichment <file>",
      "optional JSON with status, resources, libraries, Code Connect, or variables",
    )
    .option("--force", "reprocess an unchanged metadata snapshot")
    .option("--budget <characters>", "hard response budget", "3600")
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
          scopePageId?: string;
          scopePageName?: string;
          enrichment?: string;
          force?: boolean;
          budget: string;
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
        const result = await mapFigmaDesign({
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
            ...(options.scopePageId
              ? { scopePageId: options.scopePageId }
              : {}),
            ...(options.scopePageName
              ? { scopePageName: options.scopePageName }
              : {}),
            ...(enrichment ? { enrichment } : {}),
            ...(options.force ? { force: true } : {}),
          });
        printBudgetedJson(
          fitBudgetedResponse(result as unknown as Record<string, unknown>, {
            budgetChars: parseBudget(options.budget),
            totalMatches: result.summary.stats.nodes,
            expandableIds: result.summary.pages.flatMap((page) =>
              page.mainNodes.map((node) => node.id),
            ),
            preserveFirstKeys: ["summary", "gate"],
          }),
        );
      },
    );

  figma
    .command("list")
    .argument("<path>", "repository root")
    .option("--budget <characters>", "hard response budget", "3600")
    .description("List cached Figma maps without loading their full nodes.")
    .action(async (rootPath: string, options: { budget: string }) => {
      const indexes = await listFigmaDesignIndexes(rootPath);
      printBudgetedJson(
        fitBudgetedResponse(
          { indexes },
          {
            budgetChars: parseBudget(options.budget),
            totalMatches: indexes.length,
            expandableIds: indexes.map((index) => index.file.key),
            preserveFirstKeys: ["indexes"],
          },
        ),
      );
    });

  figma
    .command("find")
    .argument("<path>", "repository root")
    .argument("<task>", "task or implementation intent")
    .option("--file <figma-file>", "Figma URL or file key")
    .option("-l, --limit <number>", "maximum candidates", "5")
    .option("--budget <characters>", "hard response budget", "3600")
    .description(
      "Rank a few explainable design candidates using Figma and Atlas signals.",
    )
    .action(
      async (
        rootPath: string,
        task: string,
        options: { file?: string; limit: string; budget: string },
      ) => {
        const result = await findTaskDesignCandidates(rootPath, task, {
            ...(options.file ? { figmaFile: options.file } : {}),
            limit: parseLimit(options.limit, 10),
          });
        printBudgetedJson(
          fitBudgetedResponse(result as unknown as Record<string, unknown>, {
            budgetChars: parseBudget(options.budget),
            totalMatches: result.candidates.length,
            expandableIds: result.candidates.map((item) => item.node.id),
            preserveFirstKeys: ["candidates", "gate"],
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
    .argument("[path]", "repository root; omit it to use the project launcher")
    .option(
      "-p, --port <port>",
      'local viewer port or "auto" for a free loopback port',
      "auto",
    )
    .option("--no-browser", "do not open the default browser")
    .description(
      "Launch the local Project Atlas product, optionally opening one repository.",
    )
    .action(
      async (
        rootPath: string | undefined,
        options: { port: string; browser: boolean },
      ) => openViewer(rootPath, options),
    );

  program
    .command("mcp")
    .description("Start the Project Atlas MCP server over stdio.")
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
