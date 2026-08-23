import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  lockTaskChangeSurface,
  writeTaskCheckpoint,
} from "@component-atlas/runtime";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createMcpServer } from "./index.js";

const run = promisify(execFile);
let dataHome: string;
let root: string;
let previousDataHome: string | undefined;

beforeEach(async () => {
  previousDataHome = process.env.PROJECT_ATLAS_HOME;
  dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-relock-block-home-"));
  root = await mkdtemp(path.join(os.tmpdir(), "atlas-relock-block-"));
  process.env.PROJECT_ATLAS_HOME = dataHome;
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "relock-block", dependencies: { react: "^19" } }),
  );
  await run("git", ["init"], { cwd: root, windowsHide: true });
  await run("git", ["add", "."], { cwd: root, windowsHide: true });
  await run(
    "git",
    [
      "-c",
      "user.name=Atlas Test",
      "-c",
      "user.email=atlas@example.invalid",
      "commit",
      "-m",
      "fixture",
    ],
    { cwd: root, windowsHide: true },
  );
});

afterEach(async () => {
  if (previousDataHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousDataHome;
  await Promise.all([
    rm(dataHome, { recursive: true, force: true }),
    rm(root, { recursive: true, force: true }),
  ]);
});

it("points a blocked invalidated task at the failed relock", async () => {
  const taskId = "task-relock-block";
  const objective = "Update the service worker after a graph change.";
  await writeTaskCheckpoint(root, {
    taskId,
    milestone: "batch-completed",
    objective,
    objectiveApproved: true,
    decisions: [],
    sourceReceiptIds: [],
    handles: [],
    covered: ["prepared"],
    remaining: ["lock"],
    budgetChars: 1_600,
    nextSafeAction: "Lock the change scope.",
  });
  const lock = await lockTaskChangeSurface(root, {
    taskId,
    intent: objective,
    primary: {
      kind: "non-component",
      surfaceKind: "service-worker",
      id: "pwa-service-worker",
      path: "src/pwa/sw.ts",
    },
    allowedFiles: ["src/pwa/sw.ts"],
    reuseDecision: {
      decision: "not-applicable",
      rationale: "The existing service-worker module owns this batch.",
    },
  });
  await writeTaskCheckpoint(root, {
    taskId,
    milestone: "batch-completed",
    objective,
    objectiveApproved: true,
    decisions: [],
    sourceReceiptIds: [],
    handles: [],
    covered: ["locked"],
    remaining: ["implementation"],
    budgetChars: 1_600,
    changeSurface: lock,
    nextSafeAction: "Implement.",
  });
  const reason = "The repository graph changed.";
  await writeTaskCheckpoint(root, {
    taskId,
    milestone: "risk-boundary",
    objective,
    objectiveApproved: true,
    decisions: [],
    sourceReceiptIds: [],
    handles: [],
    covered: ["new graph scanned"],
    remaining: ["relock"],
    budgetChars: 1_600,
    changeInvalidation: { reason },
    nextSafeAction: "Expand an obsolete continuation.",
  });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createMcpServer("core");
  const client = new Client({ name: "relock-block-test", version: "0.1.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  try {
    const blocked = await client.callTool({
      name: "atlas_task_state",
      arguments: { root_path: root, task_id: taskId, action: "block" },
    });
    expect(blocked.structuredContent).toMatchObject({
      status: "blocked",
      nextSafeAction: expect.stringContaining(
        `retry atlas_lock_change_scope with invalidation_reason matching: ${reason}`,
      ),
    });
  } finally {
    await client.close();
    await server.close();
  }
});
