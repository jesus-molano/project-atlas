import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMcpServer } from "./index.js";

const run = promisify(execFile);
const roots: string[] = [];
let previousAtlasHome: string | undefined;

beforeEach(async () => {
  previousAtlasHome = process.env.PROJECT_ATLAS_HOME;
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-reuse-home-"));
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
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-reuse-repo-"));
  roots.push(root);
  await writeFile(
    path.join(root, "PlanView.vue"),
    "<template><main>Plan</main></template>\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "atlas-reuse-fixture", dependencies: { vue: "3.5.0" } })}\n`,
    "utf8",
  );
  await run("git", ["init"], { cwd: root, windowsHide: true });
  await run("git", ["add", "PlanView.vue", "package.json"], {
    cwd: root,
    windowsHide: true,
  });
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
    name: "component-atlas-reuse-budget-test",
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

describe("atlas_prepare_task reuse budget", () => {
  it("permits one rerank and then preserves a safe path to scope lock", async () => {
    const root = await createGitRoot();
    const taskId = "task-iterative-reuse";

    await withCoreClient(async (client) => {
      for (const objective of [
        "Redesign the PLAN view.",
        "Redesign the PLAN view and its themes.",
      ]) {
        const prepared = await client.callTool({
          name: "atlas_prepare_task",
          arguments: {
            root_path: root,
            task_id: taskId,
            objective,
            objective_confirmed: true,
          },
        });
        if (prepared.isError) throw new Error(JSON.stringify(prepared.content));
        expect(prepared.structuredContent).toMatchObject({ status: "ready" });
      }

      const fallback = await client.callTool({
        name: "atlas_prepare_task",
        arguments: {
          root_path: root,
          task_id: taskId,
          objective:
            "Redesign the PLAN view, its themes, and financial persistence.",
          objective_confirmed: true,
        },
      });
      expect(fallback.isError).not.toBe(true);
      expect(fallback.structuredContent).toMatchObject({
        status: "ready-with-existing-context",
        repositoryScanned: true,
        reuse: {
          consumed: 2,
          limit: 2,
          fallbackDecisions: ["planned-surfaces", "not-applicable"],
        },
      });
      expect(JSON.stringify(fallback.structuredContent)).toContain(
        "atlas_lock_change_scope",
      );

      const invalidated = await client.callTool({
        name: "atlas_prepare_task",
        arguments: {
          root_path: root,
          task_id: taskId,
          objective:
            "Redesign the PLAN view, its themes, and financial persistence.",
          objective_confirmed: true,
          retrieval_invalidation_reason: "scope-changed",
        },
      });
      expect(invalidated.isError).not.toBe(true);
      expect(invalidated.structuredContent).toMatchObject({ status: "ready" });
    });
  });

  it("persists a pending relock invalidation when reuse is exhausted", async () => {
    const root = await createGitRoot();
    const taskId = "task-relock-after-reuse";

    await withCoreClient(async (client) => {
      let componentId = "";
      for (const objective of [
        "Refine the PLAN view.",
        "Refine the PLAN view theme.",
      ]) {
        const prepared = await client.callTool({
          name: "atlas_prepare_task",
          arguments: {
            root_path: root,
            task_id: taskId,
            objective,
            objective_confirmed: true,
          },
        });
        expect(prepared.isError).not.toBe(true);
        const code = (prepared.structuredContent as { code?: Array<{ id: string }> })
          .code;
        componentId = code?.[0]?.id ?? componentId;
      }
      expect(componentId).toBeTruthy();

      const locked = await client.callTool({
        name: "atlas_lock_change_scope",
        arguments: {
          root_path: root,
          task_id: taskId,
          primary_component: componentId,
          exclusions: [],
          decision: "reuse",
          rationale: "The existing PLAN component owns this view.",
          selected_component_ids: [componentId],
        },
      });
      expect(locked.isError).not.toBe(true);

      const reason = "The refined objective adds PLAN persistence.";
      const fallback = await client.callTool({
        name: "atlas_prepare_task",
        arguments: {
          root_path: root,
          task_id: taskId,
          objective: "Refine the PLAN view theme and persistence.",
          objective_confirmed: true,
          invalidation_reason: reason,
        },
      });
      expect(fallback.isError).not.toBe(true);
      expect(fallback.structuredContent).toMatchObject({
        status: "relock-required-with-existing-context",
        invalidationReason: reason,
      });

      const relocked = await client.callTool({
        name: "atlas_lock_change_scope",
        arguments: {
          root_path: root,
          task_id: taskId,
          primary_component: componentId,
          exclusions: [],
          decision: "reuse",
          rationale: "The existing PLAN component still owns the refined view.",
          selected_component_ids: [componentId],
          invalidation_reason: reason,
        },
      });
      expect(relocked.isError).not.toBe(true);
      expect(relocked.structuredContent).toMatchObject({ status: "locked" });
    });
  });
});
