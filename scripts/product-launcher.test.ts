import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findAvailableLoopbackPort,
  parseViewerPort,
  stopViewerChild,
  waitForViewerChild,
} from "../packages/cli/src/index.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const cliEntry = path.join(
  repositoryRoot,
  "packages",
  "cli",
  "dist",
  "index.js",
);
const codeFixture = path.join(repositoryRoot, "fixtures", "vue-nuxt");
const viewerPreload = pathToFileURL(
  path.join(
    repositoryRoot,
    "scripts",
    "fixtures",
    "viewer-launcher-preload.mjs",
  ),
).href;

interface RunningLauncher {
  child: ChildProcess;
  output: () => string;
  url?: string;
}

async function waitForOutput(
  child: ChildProcess,
  output: () => string,
  pattern: RegExp,
  timeoutMs = 15_000,
): Promise<RegExpMatchArray> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const match = output().match(pattern);
    if (match) return match;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Launcher exited before readiness (${child.exitCode ?? child.signalCode}).\n${output()}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Launcher did not become ready.\n${output()}`);
}

function spawnLauncher(
  args: string[],
  environment: NodeJS.ProcessEnv,
): RunningLauncher {
  let output = "";
  const child = spawn(process.execPath, [cliEntry, "open", ...args, "--no-browser"], {
    cwd: repositoryRoot,
    windowsHide: true,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    output += String(chunk);
  });
  return {
    child,
    output: () => output,
  };
}

async function startLauncher(
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<RunningLauncher> {
  const launcher = await spawnLauncher(args, environment);
  const match = await waitForOutput(
    launcher.child,
    launcher.output,
    /Project Atlas GUI is running at (http:\/\/127\.0\.0\.1:\d+)/,
  );
  return {
    ...launcher,
    url: match[1]!,
  };
}

async function stopLauncher(launcher: RunningLauncher): Promise<void> {
  if (
    launcher.child.exitCode === null &&
    launcher.child.signalCode === null
  ) {
    launcher.child.kill();
  }
  await new Promise<void>((resolve, reject) => {
    if (
      launcher.child.exitCode !== null ||
      launcher.child.signalCode !== null
    ) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      launcher.child.kill("SIGKILL");
      reject(new Error(`Launcher did not stop cleanly.\n${launcher.output()}`));
    }, 5_000);
    launcher.child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function expectServerClosed(url: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await fetch(`${url}/api/projects`, {
        signal: AbortSignal.timeout(150),
      });
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Viewer was still reachable after launcher exit at ${url}.`);
}

async function waitForExit(
  child: ChildProcess,
  timeoutMs = 5_000,
  output?: () => string,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `Launcher did not exit in time.${output ? `\n${output()}` : ""}`,
          ),
        ),
      timeoutMs,
    );
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

describe.sequential("built local product launcher", () => {
  let temporaryRoot: string;
  let environment: NodeJS.ProcessEnv;
  const launchers: RunningLauncher[] = [];

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "atlas-product-"));
    environment = {
      ...process.env,
      COMPONENT_ATLAS_HOME: path.join(temporaryRoot, "atlas-home"),
      ATLAS_RECENT_PROJECTS_PATH: path.join(
        temporaryRoot,
        "recent-projects.json",
      ),
    };
    delete environment.ATLAS_PROJECT_ROOT;
    delete environment.ATLAS_PROJECT_ID;
    delete environment.ATLAS_CHECKOUT_ID;
  });

  afterEach(async () => {
    await Promise.all(launchers.splice(0).map(stopLauncher));
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  it("validates explicit ports and releases an automatically selected port", async () => {
    expect(parseViewerPort("auto")).toBeUndefined();
    expect(parseViewerPort("49173")).toBe(49_173);
    expect(() => parseViewerPort("0")).toThrow();
    expect(() => parseViewerPort("not-a-port")).toThrow();

    const port = await findAvailableLoopbackPort();
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("opens the graphical project selector without scanning a default folder", async () => {
    const blocker = net.createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(4_173, "127.0.0.1", () => resolve());
    });
    try {
      const launcher = await startLauncher([], environment);
      launchers.push(launcher);
      expect(new URL(launcher.url!).port).not.toBe("4173");
      const projects = (await fetch(`${launcher.url!}/api/projects`).then(
        (response) => response.json(),
      )) as { activeRoot?: string; projects: unknown[] };
      expect(projects.activeRoot).toBeUndefined();
      expect(projects.projects).toEqual([]);

      launchers.pop();
      await stopLauncher(launcher);
      await expectServerClosed(launcher.url!);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it("uses and releases the exact explicit loopback port", async () => {
    const port = await findAvailableLoopbackPort();
    const launcher = await startLauncher(
      ["--port", String(port)],
      environment,
    );
    launchers.push(launcher);

    expect(new URL(launcher.url!).port).toBe(String(port));
    launchers.pop();
    await stopLauncher(launcher);
    await expectServerClosed(launcher.url!);
  });

  it("reports an occupied explicit port and exits without retrying", async () => {
    const port = await findAvailableLoopbackPort();
    const launcher = spawnLauncher(
      ["--port", String(port)],
      {
        ...environment,
        NODE_OPTIONS: `--import=${viewerPreload}`,
        ATLAS_TEST_VIEWER_TRACE: "1",
        ATLAS_TEST_VIEWER_BIND_FAILURE: "1",
      },
    );
    const result = await waitForExit(
      launcher.child,
      3_000,
      launcher.output,
    );

    expect(result.code).toBe(1);
    expect(launcher.output()).toContain(
      `Project Atlas viewer failed to start on explicit loopback port ${port}.`,
    );
    expect(launcher.output()).toContain(
      `EADDRINUSE: address already in use 127.0.0.1:${port}`,
    );
    expect(launcher.output().match(/atlas-test-viewer-port:/g)).toHaveLength(
      1,
    );
    expect(launcher.output()).not.toContain("automatically selected");
    await expectServerClosed(`http://127.0.0.1:${port}`);
  });

  it("opens an explicit project directly and cleans up its viewer process", async () => {
    const projectRoot = path.join(temporaryRoot, "product");
    await cp(codeFixture, projectRoot, { recursive: true });
    const launcher = await startLauncher([projectRoot], environment);
    launchers.push(launcher);

    const workspace = (await fetch(`${launcher.url!}/api/workspace`).then(
      (response) => response.json(),
    )) as { graph: { project: { rootPath: string } } };
    expect(path.resolve(workspace.graph.project.rootPath)).toBe(
      path.resolve(projectRoot),
    );

    launchers.pop();
    await stopLauncher(launcher);
    await expectServerClosed(launcher.url!);
  });

  it(
    "keeps one automatically selected port while a slow viewer becomes ready",
    async () => {
      const launcher = await spawnLauncher([], {
        ...environment,
        NODE_OPTIONS: `--import=${viewerPreload}`,
        ATLAS_TEST_VIEWER_TRACE: "1",
        ATLAS_TEST_VIEWER_START_DELAY_MS: "6000",
      });
      launchers.push(launcher);
      const match = await waitForOutput(
        launcher.child,
        launcher.output,
        /Project Atlas GUI is running at (http:\/\/127\.0\.0\.1:\d+)/,
        15_000,
      );
      launcher.url = match[1]!;

      const attemptedPorts = [
        ...launcher.output().matchAll(/atlas-test-viewer-port:(\d+)/g),
      ].map((entry) => entry[1]);
      expect(attemptedPorts).toHaveLength(1);
      expect(attemptedPorts[0]).toBe(new URL(launcher.url).port);
    },
    20_000,
  );

  it("reports a child startup failure once and exits without a viewer orphan", async () => {
    const launcher = await spawnLauncher([], {
      ...environment,
      NODE_OPTIONS: `--import=${viewerPreload}`,
      ATLAS_TEST_VIEWER_TRACE: "1",
      ATLAS_TEST_VIEWER_FAILURE: "1",
    });
    const result = await waitForExit(launcher.child);

    expect(result.code).toBe(1);
    expect(launcher.output()).toContain(
      "atlas-test-viewer-failure: simulated startup failure",
    );
    expect(launcher.output()).toMatch(
      /Viewer process exited before it was ready \(code 23, signal none\)/,
    );
    expect(launcher.output().match(/atlas-test-viewer-port:/g)).toHaveLength(1);
  });

  it("cleans up a child after a readiness timeout", async () => {
    const port = await findAvailableLoopbackPort();
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      {
        windowsHide: true,
        stdio: "ignore",
      },
    );
    const url = `http://127.0.0.1:${port}`;

    await expect(
      waitForViewerChild(
        child,
        url,
        { sessionToken: "never-ready" },
        { timeoutMs: 200, pollIntervalMs: 25 },
      ),
    ).rejects.toThrow(/Last readiness check:/);
    await stopViewerChild(child);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    await expectServerClosed(url);
  });
});
