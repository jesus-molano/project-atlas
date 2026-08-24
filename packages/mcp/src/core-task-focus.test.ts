import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  clearTaskFocus,
  loadTaskResumeCapsule,
  readTaskFocus,
  resolveTaskObjective,
} from "@component-atlas/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMcpServer } from "./index.js";

const run = promisify(execFile);
const roots: string[] = [];
let previousAtlasHome: string | undefined;

beforeEach(async () => {
  previousAtlasHome = process.env.PROJECT_ATLAS_HOME;
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-focus-home-"));
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
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-focus-repo-"));
  roots.push(root);
  await writeFile(
    path.join(root, "PlanView.vue"),
    "<template><main>Plan</main></template>\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "atlas-focus-fixture", dependencies: { vue: "3.5.0" } })}\n`,
    "utf8",
  );
  await run("git", ["init"], { cwd: root, windowsHide: true });
  await run("git", ["add", "."], { cwd: root, windowsHide: true });
  await run(
    "git",
    [
      "-c",
      "user.name=Project Atlas Test",
      "-c",
      "user.email=atlas@example.invalid",
      "commit",
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
    name: "component-atlas-focus-test",
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

function result(value: Record<string, unknown> | undefined): Record<string, unknown> {
  return value ?? {};
}

describe("core task focus", () => {
  it("focuses the first prepared task, recovers its complete objective, and refuses a silent objective change", async () => {
    const root = await createGitRoot();
    const taskId = "task-focused";
    const title = "Continuidad de consentimientos";
    const objective =
      "Mantener una sola tarea Atlas mientras se corrigen consentimientos y se conserva la trazabilidad completa.";

    await withCoreClient(async (client) => {
      const first = await client.callTool({
        name: "atlas_prepare_task",
        arguments: {
          root_path: root,
          task_id: taskId,
          title,
          objective,
          objective_confirmed: true,
        },
      });
      expect(first.isError, JSON.stringify(first.content)).not.toBe(true);
      expect(result(first.structuredContent)).toMatchObject({ taskId, status: "ready" });

      const focused = await client.callTool({
        name: "atlas_prepare_task",
        arguments: {
          root_path: root,
          objective,
          objective_confirmed: true,
        },
      });
      expect(focused.isError, JSON.stringify(focused.content)).not.toBe(true);
      expect(result(focused.structuredContent)).toMatchObject({ taskId, status: "ready" });

      const resume = await client.callTool({
        name: "atlas_task_state",
        arguments: { root_path: root, action: "resume" },
      });
      expect(resume.isError, JSON.stringify(resume.content)).not.toBe(true);
      expect(result(resume.structuredContent)).toMatchObject({
        taskId,
        title,
        objective,
        recovered: "exact-checkout",
      });

      const changed = await client.callTool({
        name: "atlas_prepare_task",
        arguments: {
          root_path: root,
          objective: "Reemplazar por completo el flujo de perfiles de otra área.",
          objective_confirmed: true,
        },
      });
      expect(changed.isError, JSON.stringify(changed.content)).not.toBe(true);
      expect(result(changed.structuredContent)).toMatchObject({
        taskId,
        title,
        status: "feedback-required",
        objective,
      });
      expect(await resolveTaskObjective(root, taskId)).toMatchObject({ text: objective });

      const completed = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "complete",
          result: "partial",
          summary: "Continuity behaviour is recorded; delivery remains partial.",
          verification: ["Focused task lifecycle test"],
        },
      });
      expect(completed.isError, JSON.stringify(completed.content)).not.toBe(true);
      await expect(readTaskFocus(root)).resolves.toBeUndefined();

      const closedDecision = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "append-feedback",
          kind: "decision",
          text: "No convertir una decisión tardía en una corrección.",
        },
      });
      expect(closedDecision.isError).toBe(true);
      await expect(readTaskFocus(root)).resolves.toBeUndefined();

      const followUp = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "append-feedback",
          kind: "correction",
          text: "Añadir una corrección posterior sin reabrir el resultado anterior.",
        },
      });
      expect(followUp.isError, JSON.stringify(followUp.content)).not.toBe(true);
      const followUpResult = result(followUp.structuredContent);
      expect(followUpResult).toMatchObject({
        status: "follow-up-created",
        parentTaskId: taskId,
      });
      const childTaskId = followUpResult.taskId as string;
      await expect(loadTaskResumeCapsule(root, childTaskId)).resolves.toMatchObject({
        lineage: {
          rootTaskId: taskId,
          parentTaskId: taskId,
          relation: "correction",
        },
      });
      await expect(readTaskFocus(root)).resolves.toMatchObject({
        taskId: childTaskId,
      });
      await expect(loadTaskResumeCapsule(root, taskId)).resolves.toMatchObject({
        status: "completed",
        completion: {
          result: "partial",
          summary: "Continuity behaviour is recorded; delivery remains partial.",
        },
      });
    });
  });

  it("creates a new task only when requested and recommends without creating when recovery is ambiguous", async () => {
    const root = await createGitRoot();
    const firstId = "task-first";
    const secondId = "task-second";
    const firstObjective = "Mantener el primer flujo de Atlas en esta rama.";
    const secondObjective = "Mantener el segundo flujo de Atlas en esta rama.";

    await withCoreClient(async (client) => {
      for (const [taskId, objective] of [
        [firstId, firstObjective],
        [secondId, secondObjective],
      ]) {
        const prepared = await client.callTool({
          name: "atlas_prepare_task",
          arguments: {
            root_path: root,
            task_id: taskId,
            title: taskId === firstId ? "Primer flujo" : "Segundo flujo",
            objective,
            objective_confirmed: true,
          },
        });
        expect(prepared.isError, JSON.stringify(prepared.content)).not.toBe(true);
      }

      const fresh = await client.callTool({
        name: "atlas_prepare_task",
        arguments: {
          root_path: root,
          start_new_task: true,
          title: "Tercer flujo separado",
          objective: "Crear una tarea nueva solo porque este objetivo es independiente.",
          objective_confirmed: true,
        },
      });
      expect(fresh.isError, JSON.stringify(fresh.content)).not.toBe(true);
      const freshResult = result(fresh.structuredContent);
      expect(freshResult).toMatchObject({ status: "ready" });
      expect(freshResult.taskId).toMatch(/^task-/u);
      expect(freshResult.taskId).not.toBe(firstId);
      expect(freshResult.taskId).not.toBe(secondId);
      expect(
        await loadTaskResumeCapsule(root, freshResult.taskId as string),
      ).toMatchObject({ title: "Tercer flujo separado" });

      await clearTaskFocus(root);
      const ambiguous = await client.callTool({
        name: "atlas_prepare_task",
        arguments: {
          root_path: root,
          objective: "No crear nada cuando hay más de una tarea activa.",
          objective_confirmed: true,
        },
      });
      expect(ambiguous.isError, JSON.stringify(ambiguous.content)).not.toBe(true);
      const ambiguousResult = result(ambiguous.structuredContent);
      expect(ambiguousResult).toMatchObject({ status: "selection-required" });
      expect(ambiguousResult.candidateCount).toBe(3);
      expect(ambiguousResult.recommendedTaskId).toEqual(expect.any(String));
      expect(await loadTaskResumeCapsule(root, firstId)).toBeTruthy();
      expect(await loadTaskResumeCapsule(root, secondId)).toBeTruthy();
    });
  });
});
