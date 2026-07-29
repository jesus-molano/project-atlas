import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findAvailableLoopbackPort,
  parseViewerPort,
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

interface RunningLauncher {
  child: ChildProcess;
  output: () => string;
  url: string;
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

async function startLauncher(
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<RunningLauncher> {
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
  const match = await waitForOutput(
    child,
    () => output,
    /Project Atlas GUI is running at (http:\/\/127\.0\.0\.1:\d+)/,
  );
  return {
    child,
    output: () => output,
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
      expect(new URL(launcher.url).port).not.toBe("4173");
      const projects = (await fetch(`${launcher.url}/api/projects`).then(
        (response) => response.json(),
      )) as { activeRoot?: string; projects: unknown[] };
      expect(projects.activeRoot).toBeUndefined();
      expect(projects.projects).toEqual([]);

      launchers.pop();
      await stopLauncher(launcher);
      await expectServerClosed(launcher.url);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it("opens an explicit project directly and cleans up its viewer process", async () => {
    const projectRoot = path.join(temporaryRoot, "product");
    await cp(codeFixture, projectRoot, { recursive: true });
    const launcher = await startLauncher([projectRoot], environment);
    launchers.push(launcher);

    const workspace = (await fetch(`${launcher.url}/api/workspace`).then(
      (response) => response.json(),
    )) as { graph: { project: { rootPath: string } } };
    expect(path.resolve(workspace.graph.project.rootPath)).toBe(
      path.resolve(projectRoot),
    );

    launchers.pop();
    await stopLauncher(launcher);
    await expectServerClosed(launcher.url);
  });
});
