import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  loadLatestTaskContinuationBundle,
  loadLatestTaskEvidenceContract,
  loadTaskFeedbackQueue,
  loadTaskResumeCapsule,
  scanProject,
} from "@component-atlas/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFixture } from "../../../scripts/test-fixture-copy.mjs";
import { createMcpServer } from "./index.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
let previousAtlasHome: string | undefined;

beforeEach(async () => {
  previousAtlasHome = process.env.PROJECT_ATLAS_HOME;
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-reconcile-home-"));
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
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-reconcile-root-"));
  roots.push(root);
  await copyFixture(
    fileURLToPath(new URL("../../../fixtures/vue-nuxt", import.meta.url)),
    root,
  );
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync(
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
    { cwd: root },
  );
  return root;
}

async function withCoreClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createMcpServer("core");
  const client = new Client({
    name: "component-atlas-reconcile-test",
    version: "0.2.0",
  });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  try {
    return await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

async function preparedTask(client: Client, root: string, taskId: string) {
  const graph = await scanProject(root, { writeArtifacts: false });
  const evidenceHandle = `code:${graph.components[0]!.id}`;
  const prepared = await client.callTool({
    name: "atlas_prepare_task",
    arguments: {
      root_path: root,
      task_id: taskId,
      objective: "Keep one Atlas task coherent while feedback changes its contract.",
      objective_confirmed: true,
      budget_chars: 3_600,
    },
  });
  expect(prepared.isError, JSON.stringify(prepared.content)).not.toBe(true);

  const recorded = await client.callTool({
    name: "atlas_task_state",
    arguments: {
      root_path: root,
      task_id: taskId,
      action: "record-contract",
      evidence_contract: {
        criteria: [
          { id: "stable", statement: "Stable work remains verified.", required: true },
          { id: "changed", statement: "Old behaviour is covered.", required: true },
        ],
        decisions: [
          {
            id: "old-decision",
            question: "Which old rule applies?",
            status: "resolved",
            answer: "Use the old rule.",
          },
        ],
      },
    },
  });
  expect(recorded.isError, JSON.stringify(recorded.content)).not.toBe(true);
  const contractHandle = (
    recorded.structuredContent as { contract: { handle: string } }
  ).contract.handle;
  const continued = await client.callTool({
    name: "atlas_task_state",
    arguments: {
      root_path: root,
      task_id: taskId,
      action: "checkpoint-continuation",
      continuation: {
        contract_handle: contractHandle,
        criteria: [
          { criterion_id: "stable", status: "satisfied", evidence_refs: [evidenceHandle] },
          { criterion_id: "changed", status: "satisfied", evidence_refs: [evidenceHandle] },
        ],
        next_action: "Lock the bounded file surface.",
      },
    },
  });
  expect(continued.isError, JSON.stringify(continued.content)).not.toBe(true);
  const locked = await client.callTool({
    name: "atlas_lock_change_scope",
    arguments: {
      root_path: root,
      task_id: taskId,
      primary_surface: {
        kind: "files",
        id: "confirm-dialog",
        path: "app/components/feature/ConfirmDialog.vue",
      },
      allowed_files: ["app/components/feature/ConfirmDialog.vue"],
      decision: "not-applicable",
      rationale: "The task is bounded to the existing confirmation dialog.",
    },
  });
  expect(locked.isError, JSON.stringify(locked.content)).not.toBe(true);
  return {
    contractHandle,
    lockId: (locked.structuredContent as { lock: { id: string } }).lock.id,
    evidenceHandle,
  };
}

describe("core task reconciliation", () => {
  it("rejects forged feedback evidence and keeps the required event pending", async () => {
    const root = await createGitRoot();
    const taskId = "task-reconcile-forged-evidence";
    await withCoreClient(async (client) => {
      await preparedTask(client, root, taskId);
      const appended = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "append-feedback",
          kind: "review-finding",
          text: "Resolve only when the attached evidence is task-owned.",
          evidence_refs: ["invented:evidence"],
        },
      });
      expect(appended.isError, JSON.stringify(appended.content)).not.toBe(true);
      const feedbackId = (await loadTaskFeedbackQueue(root, taskId)).at(-1)!
        .feedbackId;
      const reconciled = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "reconcile",
          feedback_ids: [feedbackId],
        },
      });
      expect(reconciled.isError).toBe(true);
      expect(JSON.stringify(reconciled.content)).toMatch(/handle|evidence/iu);
      await expect(loadTaskFeedbackQueue(root, taskId)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ feedbackId, status: "pending" }),
        ]),
      );
    });
  });

  it("amends a contract sparsely, preserves unchanged progress and relocks an in-scope correction", async () => {
    const root = await createGitRoot();
    const taskId = "task-reconcile-in-scope";
    await withCoreClient(async (client) => {
      const initial = await preparedTask(client, root, taskId);
      const applied = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "append-feedback",
          kind: "correction",
          text: "The old behaviour changed; keep the stable proof and add the missing case.",
          impact: "within-scope",
          contract_patch: {
            criteria: [
              {
                operation: "replace",
                id: "changed-v2",
                replaces: "changed",
                statement: "New behaviour is covered.",
                required: true,
              },
              {
                operation: "add",
                id: "added",
                statement: "The newly required case is covered.",
                required: true,
              },
            ],
            decisions: [
              {
                operation: "replace",
                id: "new-decision",
                replaces: "old-decision",
                question: "Which rule applies now?",
                status: "resolved",
                answer: "Use the new rule.",
              },
            ],
          },
        },
      });
      expect(applied.isError, JSON.stringify(applied.content)).not.toBe(true);
      expect(applied.structuredContent).toMatchObject({ status: "feedback-applied" });

      const [contract, continuation, capsule, feedback] = await Promise.all([
        loadLatestTaskEvidenceContract(root, taskId),
        loadLatestTaskContinuationBundle(root, taskId),
        loadTaskResumeCapsule(root, taskId),
        loadTaskFeedbackQueue(root, taskId),
      ]);
      expect(contract).toMatchObject({ revision: 2 });
      expect(contract?.criteria).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "stable" }),
          expect.objectContaining({ id: "changed-v2", supersedes: ["changed"] }),
          expect.objectContaining({ id: "added" }),
        ]),
      );
      expect(contract?.criteria.some((criterion) => criterion.id === "changed")).toBe(false);
      expect(contract?.decisions).toEqual([
        expect.objectContaining({ id: "new-decision", supersedes: ["old-decision"] }),
      ]);
      expect(continuation?.criteria).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ criterionId: "stable", status: "satisfied", evidenceRefs: [initial.evidenceHandle] }),
          expect.objectContaining({ criterionId: "changed-v2", status: "pending" }),
          expect.objectContaining({ criterionId: "added", status: "pending" }),
        ]),
      );
      expect(capsule?.changeSurface?.revision).toBe(2);
      expect(capsule?.changeSurface?.lockId).not.toBe(initial.lockId);
      expect(continuation?.changeSurfaceLockId).toBe(capsule?.changeSurface?.lockId);
      expect(feedback.filter((event) => event.required && event.status === "pending")).toHaveLength(0);

      const feedbackId = feedback.at(-1)!.feedbackId;
      const retried = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "reconcile",
          feedback_ids: [feedbackId],
        },
      });
      expect(retried.isError, JSON.stringify(retried.content)).not.toBe(true);
      expect((await loadLatestTaskEvidenceContract(root, taskId))?.revision).toBe(2);
    });
  });

  it("keeps required feedback pending without its exact id, supports sparse progress, and invalidates scope changes without relocking", async () => {
    const root = await createGitRoot();
    const taskId = "task-reconcile-scope";
    await withCoreClient(async (client) => {
      const initial = await preparedTask(client, root, taskId);
      const appended = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "append-feedback",
          kind: "review-finding",
          text: "Document the remaining review finding before completion.",
        },
      });
      expect(appended.isError, JSON.stringify(appended.content)).not.toBe(true);
      const noIds = await client.callTool({
        name: "atlas_task_state",
        arguments: { root_path: root, task_id: taskId, action: "reconcile" },
      });
      expect(noIds.isError, JSON.stringify(noIds.content)).not.toBe(true);
      expect(noIds.structuredContent).toMatchObject({ feedback: { pending: 1 } });
      const feedbackId = (await loadTaskFeedbackQueue(root, taskId)).at(-1)!
        .feedbackId;
      const unsupportedResolution = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "reconcile",
          feedback_ids: [feedbackId],
        },
      });
      expect(unsupportedResolution.isError).toBe(true);
      expect(JSON.stringify(unsupportedResolution.content)).toMatch(
        /contract patch|criterion update|evidence reference|scope invalidation/iu,
      );
      await expect(
        client.callTool({
          name: "atlas_task_state",
          arguments: {
            root_path: root,
            task_id: taskId,
            action: "complete",
            result: "success",
            summary: "Attempt to close while feedback remains pending.",
            verification: ["not applicable"],
          },
        }),
      ).resolves.toMatchObject({ isError: true });

      const sparse = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "reconcile",
          feedback_ids: [feedbackId],
          criterion_updates: [
            {
              criterion_id: "changed",
              status: "blocked",
              note: "Waiting for the review decision.",
            },
          ],
        },
      });
      expect(sparse.isError, JSON.stringify(sparse.content)).not.toBe(true);
      const sparseContinuation = await loadLatestTaskContinuationBundle(root, taskId);
      expect(sparseContinuation?.criteria).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ criterionId: "stable", status: "satisfied" }),
          expect.objectContaining({ criterionId: "changed", status: "blocked", note: "Waiting for the review decision." }),
        ]),
      );

      const scope = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "append-feedback",
          kind: "scope-change",
          text: "A second route now belongs to the task.",
          impact: "scope-change",
        },
      });
      expect(scope.isError, JSON.stringify(scope.content)).not.toBe(true);
      const capsule = await loadTaskResumeCapsule(root, taskId);
      expect(capsule?.changeSurface?.lockId).toBe(initial.lockId);
      expect(capsule?.changeInvalidation?.reason).toMatch(/scope/u);
    });
  });
});
