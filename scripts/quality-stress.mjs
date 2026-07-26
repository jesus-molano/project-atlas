import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

if (typeof global.gc !== "function") {
  throw new Error("Run this script with node --expose-gc.");
}

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), "project-atlas-quality-"),
);
process.env.COMPONENT_ATLAS_HOME = path.join(temporaryRoot, "atlas-home");

const runtime = await import(
  pathToFileURL(
    path.join(repositoryRoot, "packages", "runtime", "dist", "index.js"),
  ).href
);

function elapsed(start) {
  return Number((performance.now() - start).toFixed(1));
}

function activeHandleCount() {
  const handles =
    typeof process._getActiveHandles === "function"
      ? process._getActiveHandles()
      : [];
  return handles.filter(
    (handle) =>
      handle !== process.stdin &&
      handle !== process.stdout &&
      handle !== process.stderr,
  ).length;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Child process did not exit in time.")),
      timeoutMs,
    );
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function waitForWorkspace(port, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/workspace`,
        { signal: AbortSignal.timeout(300) },
      );
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Viewer did not start on port ${port}.`);
}

async function exerciseViewer(rootPath) {
  const port = await freePort();
  const serverEntry = path.join(
    repositoryRoot,
    "apps",
    "viewer",
    ".output",
    "server",
    "index.mjs",
  );
  const cliEntry = path.join(
    repositoryRoot,
    "packages",
    "cli",
    "dist",
    "index.js",
  );
  const environment = {
    ...process.env,
    ATLAS_PROJECT_ROOT: rootPath,
    ATLAS_CLI_ENTRY: cliEntry,
    NITRO_HOST: "127.0.0.1",
    NITRO_PORT: String(port),
  };
  const first = spawn(process.execPath, [serverEntry], {
    env: environment,
    stdio: "ignore",
    windowsHide: true,
  });
  let conflictingExit;
  try {
    await waitForWorkspace(port);
    const conflicting = spawn(process.execPath, [serverEntry], {
      env: environment,
      stdio: "ignore",
      windowsHide: true,
    });
    conflictingExit = await waitForExit(conflicting);
    await waitForWorkspace(port);
  } finally {
    first.kill();
    await waitForExit(first);
  }
  return conflictingExit;
}

async function createSizedFixture(name, count) {
  const rootPath = path.join(temporaryRoot, name);
  const componentsPath = path.join(rootPath, "components");
  await mkdir(componentsPath, { recursive: true });
  await writeFile(
    path.join(rootPath, "package.json"),
    JSON.stringify({
      name,
      private: true,
      dependencies: { vue: "^3.5.0" },
    }),
    "utf8",
  );
  for (let index = 0; index < count; index += 1) {
    await writeFile(
      path.join(componentsPath, `Item${index}.vue`),
      `<script setup lang="ts">
defineProps<{ label: string; selected?: boolean }>()
defineEmits<{ select: [id: number] }>()
</script>
<template><button class="item rounded" @click="$emit('select', ${index})">{{ label }}</button></template>
`,
      "utf8",
    );
  }
  return rootPath;
}

const fixtureRoot = path.join(temporaryRoot, "fixture");
const sourceFixture = path.join(repositoryRoot, "fixtures", "vue-nuxt");
const figmaFixture = path.join(
  repositoryRoot,
  "fixtures",
  "figma",
  "personal-no-dev-mode.xml",
);

const metrics = {
  stress: {},
  benchmark: {},
  viewer: {},
};

try {
  await cp(sourceFixture, fixtureRoot, { recursive: true });
  const metadata = await import("node:fs/promises").then(({ readFile }) =>
    readFile(figmaFixture, "utf8"),
  );
  await runtime.scanProject(fixtureRoot);
  await runtime.indexProjectMemory(fixtureRoot);
  await runtime.mapFigmaDesign({
    rootPath: fixtureRoot,
    figmaUrl: "https://www.figma.com/design/QualityFixture/Quality",
    metadata,
    format: "figma-mcp-xml",
  });

  global.gc();
  const handlesBefore = activeHandleCount();
  const heapSamples = [];
  const started = performance.now();
  for (let index = 0; index < 12; index += 1) {
    await runtime.scanProject(fixtureRoot, { writeArtifacts: false });
    await runtime.orientProject(fixtureRoot, { budgetChars: 1_600 });
    await runtime.searchProjectMemory(fixtureRoot, "search filter", {
      budgetChars: 1_200,
      limit: 3,
    });
    const context = await runtime.getTaskContext(
      fixtureRoot,
      "add a filter to search",
      { budgetChars: 2_000, topK: 3, figmaFile: "QualityFixture" },
    );
    if (JSON.stringify(context).length > 2_000) {
      throw new Error("Task Context exceeded its hard budget.");
    }
    await runtime.checkBeforeChange(
      fixtureRoot,
      "change the search filters",
      { budgetChars: 1_600 },
    );
    await runtime.mapFigmaDesign({
      rootPath: fixtureRoot,
      figmaUrl: "https://www.figma.com/design/QualityFixture/Quality",
      metadata,
      format: "figma-mcp-xml",
      force: true,
    });
    await runtime.findTaskDesignCandidates(
      fixtureRoot,
      "search filters",
      { figmaFile: "QualityFixture", limit: 3 },
    );
    const indexes = await runtime.listFigmaDesignIndexes(fixtureRoot);
    const inspectId = indexes[0]?.pages[0]?.mainNodes[0]?.id;
    if (inspectId) {
      await runtime.inspectFigmaDesignNode(
        fixtureRoot,
        "QualityFixture",
        inspectId,
      );
    }
    const proposal = await runtime.proposeMemoryUpdate({
      rootPath: fixtureRoot,
      rationale: `Stress proposal ${index}`,
      items: [
        {
          type: "note",
          title: `Stress note ${index}`,
          summary: "A bounded, generic quality fixture.",
          confidence: 0.7,
          authority: "observed",
        },
      ],
    });
    await runtime.rejectMemoryUpdate(fixtureRoot, proposal.proposal.id, {
      confirmed: true,
      reason: "Stress fixture cleanup.",
    });
    await runtime.recordProjectOutcome({
      rootPath: fixtureRoot,
      task: `Quality cycle ${index}`,
      result: "success",
      summary: "The bounded cycle completed.",
    });
    global.gc();
    heapSamples.push(process.memoryUsage().heapUsed);
  }
  global.gc();
  const handlesAfter = activeHandleCount();
  const steadyGrowth =
    Math.max(...heapSamples.slice(-4)) - Math.min(...heapSamples.slice(0, 4));
  if (steadyGrowth > 12 * 1024 * 1024) {
    throw new Error(
      `Heap growth exceeded 12 MiB (${Math.round(steadyGrowth / 1024)} KiB).`,
    );
  }
  if (handlesAfter - handlesBefore > 2) {
    throw new Error(
      `Active handles grew from ${handlesBefore} to ${handlesAfter}.`,
    );
  }
  metrics.stress = {
    cycles: 12,
    elapsedMs: elapsed(started),
    heapMinMiB: Number(
      (Math.min(...heapSamples) / 1024 / 1024).toFixed(2),
    ),
    heapMaxMiB: Number(
      (Math.max(...heapSamples) / 1024 / 1024).toFixed(2),
    ),
    steadyGrowthMiB: Number((steadyGrowth / 1024 / 1024).toFixed(2)),
    activeHandlesBefore: handlesBefore,
    activeHandlesAfter: handlesAfter,
  };

  const operationBenchmarks = {};
  let operationStart = performance.now();
  await runtime.searchProjectMemory(fixtureRoot, "search filter", {
    budgetChars: 1_200,
    limit: 3,
  });
  operationBenchmarks.memorySearchMs = elapsed(operationStart);
  operationStart = performance.now();
  await runtime.getTaskContext(fixtureRoot, "add a filter to search", {
    budgetChars: 2_000,
    topK: 3,
    figmaFile: "QualityFixture",
  });
  operationBenchmarks.taskContextMs = elapsed(operationStart);
  operationStart = performance.now();
  await runtime.mapFigmaDesign({
    rootPath: fixtureRoot,
    figmaUrl: "https://www.figma.com/design/QualityFixture/Quality",
    metadata,
    format: "figma-mcp-xml",
    force: true,
  });
  operationBenchmarks.figmaMapMs = elapsed(operationStart);

  for (const [name, count] of [
    ["small", 10],
    ["medium", 100],
    ["large", 300],
  ]) {
    const sizedRoot = await createSizedFixture(`benchmark-${name}`, count);
    const initialStart = performance.now();
    await runtime.scanProject(sizedRoot, { writeArtifacts: false });
    const initialMs = elapsed(initialStart);
    const rescanStart = performance.now();
    const graph = await runtime.scanProject(sizedRoot, {
      writeArtifacts: false,
    });
    metrics.benchmark[name] = {
      components: graph.components.length,
      relations: graph.edges.length,
      initialScanMs: initialMs,
      rescanMs: elapsed(rescanStart),
    };
  }
  metrics.benchmark.operations = operationBenchmarks;

  const viewerStarted = performance.now();
  const conflictExitCodes = [];
  for (let index = 0; index < 3; index += 1) {
    conflictExitCodes.push(await exerciseViewer(fixtureRoot));
  }
  metrics.viewer = {
    startStopCycles: 3,
    portConflictChecks: 3,
    conflictExitCodes,
    elapsedMs: elapsed(viewerStarted),
    averageCycleMs: Number(
      ((performance.now() - viewerStarted) / 3).toFixed(1),
    ),
  };
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
