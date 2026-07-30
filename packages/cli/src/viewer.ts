import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, readdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanProject } from "@component-atlas/runtime";
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
        const finish = (): void => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(
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
    throw new Error("Viewer port must be \"auto\" or an integer from 1 to 65535.");
  }
  return port;
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

export async function openViewer(
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
