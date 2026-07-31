import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  loadTaskFinalReceipt,
  loadTaskResumeCapsule,
  loadTaskSourceLedger,
  projectStorageDirectory,
  pruneExpiredTaskState,
  resolveProjectIdentity,
  resolveTaskObjective,
  writeTaskCheckpoint,
} from "@component-atlas/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMcpServer } from "./index.js";

const run = promisify(execFile);
const roots: string[] = [];
let previousAtlasHome: string | undefined;

beforeEach(async () => {
  previousAtlasHome = process.env.PROJECT_ATLAS_HOME;
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-terminal-home-"));
  roots.push(dataHome);
  process.env.PROJECT_ATLAS_HOME = dataHome;
});

afterEach(async () => {
  if (previousAtlasHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousAtlasHome;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createGitRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-terminal-repo-"));
  roots.push(root);
  await run("git", ["init"], { cwd: root, windowsHide: true });
  await run(
    "git",
    [
      "-c",
      "user.name=Project Atlas Test",
      "-c",
      "user.email=atlas@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "fixture",
    ],
    { cwd: root, windowsHide: true },
  );
  return root;
}

async function withCoreClient<T>(runClient: (client: Client) => Promise<T>) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createMcpServer("core");
  const client = new Client({
    name: "component-atlas-terminal-prepare-test",
    version: "0.2.0",
  });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  try {
    return await runClient(client);
  } finally {
    await client.close();
    await server.close();
  }
}

async function writeCompletedCapsule(
  root: string,
  taskId: string,
  objective: string,
) {
  return writeTaskCheckpoint(root, {
    taskId,
    status: "completed",
    milestone: "completed",
    objective,
    objectiveApproved: true,
    decisions: [],
    sourceReceiptIds: [],
    handles: [],
    covered: ["technical closeout"],
    remaining: [],
    budgetChars: 1_600,
    nextSafeAction: "Inspect the immutable closeout through resume.",
  });
}

async function taskStateSnapshot(root: string): Promise<Record<string, string>> {
  const identity = await resolveProjectIdentity(root);
  const stateRoot = path.join(
    projectStorageDirectory(identity.logicalId),
    "task-state",
  );
  const snapshot: Record<string, string> = {};
  async function visit(directory: string, prefix = ""): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute, relative);
      else snapshot[relative] = await readFile(absolute, "utf8");
    }
  }
  await visit(stateRoot);
  return snapshot;
}

async function attemptTerminalPrepare(root: string, taskId: string) {
  return withCoreClient((client) =>
    client.callTool({
      name: "atlas_prepare_task",
      arguments: {
        root_path: root,
        task_id: taskId,
        objective:
          "Replace the completed objective and create fresh mutable task state.",
        objective_confirmed: true,
      },
    }),
  );
}

describe("atlas_prepare_task terminal task guard", () => {
  it("refuses a pruned task with an immutable final receipt before writing state", async () => {
    const root = await createGitRoot();
    const taskId = "task-terminal-pruned";
    const objective = "Preserve this completed objective after capsule pruning.";
    await writeCompletedCapsule(root, taskId, objective);
    await pruneExpiredTaskState(
      root,
      new Date(Date.now() + 8 * 24 * 60 * 60 * 1_000),
    );
    expect(await loadTaskResumeCapsule(root, taskId)).toBeUndefined();
    const finalBefore = await loadTaskFinalReceipt(root, taskId);
    expect(finalBefore).toMatchObject({ taskId, objective });
    const stateBefore = await taskStateSnapshot(root);

    const first = await attemptTerminalPrepare(root, taskId);
    const retry = await attemptTerminalPrepare(root, taskId);

    expect(first.isError).not.toBe(true);
    expect(first.structuredContent).toMatchObject({
      taskId,
      status: "completed",
      terminal: true,
      repositoryScanned: false,
      requiresNewTaskId: true,
    });
    expect(retry.structuredContent).toEqual(first.structuredContent);
    expect(await taskStateSnapshot(root)).toEqual(stateBefore);
    expect(await loadTaskResumeCapsule(root, taskId)).toBeUndefined();
    expect(await loadTaskSourceLedger(root, taskId)).toBeUndefined();
    await expect(resolveTaskObjective(root, taskId)).resolves.toMatchObject({
      text: objective,
      authority: "authoritative",
    });
    await expect(loadTaskFinalReceipt(root, taskId)).resolves.toEqual(finalBefore);
  });

  it("refuses a completed capsule before rewriting its objective or ledger", async () => {
    const root = await createGitRoot();
    const taskId = "task-terminal-capsule";
    const objective = "Keep this recently completed capsule immutable.";
    const capsuleBefore = await writeCompletedCapsule(root, taskId, objective);
    expect(await loadTaskFinalReceipt(root, taskId)).toBeUndefined();
    const stateBefore = await taskStateSnapshot(root);

    const first = await attemptTerminalPrepare(root, taskId);
    const retry = await attemptTerminalPrepare(root, taskId);

    expect(first.isError).not.toBe(true);
    expect(first.structuredContent).toMatchObject({
      taskId,
      status: "completed",
      terminal: true,
      repositoryScanned: false,
      requiresNewTaskId: true,
    });
    expect(retry.structuredContent).toEqual(first.structuredContent);
    expect(await taskStateSnapshot(root)).toEqual(stateBefore);
    await expect(loadTaskResumeCapsule(root, taskId)).resolves.toEqual(
      capsuleBefore,
    );
    expect(await loadTaskSourceLedger(root, taskId)).toBeUndefined();
    await expect(resolveTaskObjective(root, taskId)).resolves.toMatchObject({
      text: objective,
      authority: "authoritative",
    });
    expect(await loadTaskFinalReceipt(root, taskId)).toBeUndefined();
  });
});
