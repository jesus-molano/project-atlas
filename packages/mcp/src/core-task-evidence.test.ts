import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  encodeResumeCapsule,
  loadLatestTaskContinuationBundle,
  loadLatestTaskEvidenceContract,
  loadTaskResumeCapsule,
  scanProject,
  writeTaskCheckpoint,
} from "@component-atlas/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFixture } from "../../../scripts/test-fixture-copy.mjs";
import { assertCoreTaskEvidenceReadyForSuccess } from "./core-task-evidence.js";
import {
  bindSourceEvidence,
  normalizedSources,
} from "./core-source-evidence.js";
import { createMcpServer } from "./index.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
let previousAtlasHome: string | undefined;

beforeEach(async () => {
  previousAtlasHome = process.env.PROJECT_ATLAS_HOME;
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-evidence-home-"));
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

async function createGitRoot(withFixture = false): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-evidence-root-"));
  roots.push(root);
  if (withFixture) {
    await copyFixture(
      fileURLToPath(new URL("../../../fixtures/vue-nuxt", import.meta.url)),
      root,
    );
  }
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
      "--allow-empty",
      "-m",
      "fixture",
    ],
    { cwd: root },
  );
  return root;
}

async function seedTask(root: string, taskId: string, objective: string) {
  return writeTaskCheckpoint(root, {
    taskId,
    milestone: "source-resolved",
    objective,
    objectiveApproved: true,
    decisions: [],
    sourceReceiptIds: [],
    handles: [],
    covered: ["objective confirmed"],
    remaining: ["record acceptance contract"],
    budgetChars: 3_600,
    nextSafeAction: "Record the durable evidence contract.",
  });
}

async function emitVisualSelection(
  taskId: string,
  handle: string,
  hash: string,
  expiresAt: string,
): Promise<string> {
  const handleMatch = /^visual:(vd-[A-Za-z0-9_-]+):[a-f0-9]{16}$/u.exec(
    handle,
  );
  if (!handleMatch || hash.length !== 64 || !handle.endsWith(hash.slice(0, 16))) {
    throw new Error("Invalid visual selection test fixture.");
  }
  const owner = "component-atlas-visual-direction/v1";
  const sessionId = handleMatch[1]!;
  const taskFingerprint = createHash("sha256").update(taskId).digest("hex");
  const proof = createHash("sha256")
    .update(
      [owner, taskFingerprint, sessionId, handle, hash, expiresAt].join("\0"),
    )
    .digest("hex")
    .slice(0, 16);
  const receipt = `selection-receipt:v1:${taskFingerprint.slice(
    0,
    16,
  )}:${sessionId}:${hash.slice(0, 16)}:${Date.parse(expiresAt).toString(
    36,
  )}:${proof}`;
  const sessionPath = path.join(
    process.env.PROJECT_ATLAS_HOME!,
    "temp",
    "visual-direction",
    sessionId,
  );
  await mkdir(sessionPath, { recursive: true });
  await writeFile(
    path.join(sessionPath, ".visual-direction-session.json"),
    JSON.stringify({
      owner,
      sessionId,
      taskFingerprint,
      state: "selected",
      selection: {
        directionHash: hash,
        contractHandle: handle,
        expiresAt,
        selectionReceipt: receipt,
      },
      artifacts: [],
    }),
  );
  return receipt;
}

async function withCoreClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createMcpServer("core");
  const client = new Client({
    name: "component-atlas-evidence-test",
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

describe("core task evidence lifecycle", () => {
  it("requires a contract for governed medium and large tasks only", async () => {
    const root = await createGitRoot();
    const medium = await writeTaskCheckpoint(root, {
      taskId: "task-medium-no-contract",
      milestone: "source-resolved",
      objective: "Implement a shared stateful flow.",
      objectiveApproved: true,
      governance: {
        size: "medium",
        risk: "medium",
        reviewTier: "correctness",
        reasons: ["Shared stateful flow"],
      },
      decisions: [],
      sourceReceiptIds: [],
      handles: [],
      covered: ["objective"],
      remaining: ["contract"],
      budgetChars: 2_400,
      nextSafeAction: "Record the evidence contract.",
    });
    await expect(
      assertCoreTaskEvidenceReadyForSuccess(
        root,
        medium.taskId,
        medium,
        { decisions: [], relations: [], receiptIds: [] },
      ),
    ).rejects.toThrow(/medium or large task requires/iu);

    const small = await writeTaskCheckpoint(root, {
      taskId: "task-small-no-contract",
      milestone: "source-resolved",
      objective: "Make a bounded local copy edit.",
      objectiveApproved: true,
      governance: {
        size: "small",
        risk: "low",
        reviewTier: "none",
        reasons: ["Local copy edit"],
      },
      decisions: [],
      sourceReceiptIds: [],
      handles: [],
      covered: ["objective"],
      remaining: ["implementation"],
      budgetChars: 1_600,
      nextSafeAction: "Implement the bounded edit.",
    });
    await expect(
      assertCoreTaskEvidenceReadyForSuccess(
        root,
        small.taskId,
        small,
        { decisions: [], relations: [], receiptIds: [] },
      ),
    ).resolves.toBeUndefined();
  });

  it("requires a complete current Figma snapshot frozen into exact visual authority", async () => {
    const root = await createGitRoot(true);
    const taskId = "task-exact-figma-closeout";
    const objective = "Implement the exact Figma confirmation dialog.";
    const target = "app/components/feature/ConfirmDialog.vue";
    const observedAt = new Date().toISOString();
    const lastModified = new Date(Date.now() - 1_000).toISOString();
    const source = {
      reference:
        "https://www.figma.com/design/ExactFile/Dialogs?node-id=39-2731",
      kind: "figma" as const,
      state: "confirmed" as const,
      required: true,
      authority_role: "visual" as const,
      primary_adapter: "figma-desktop-mcp-local",
      fallback: "deny" as const,
      evidence: {
        adapter: "figma-desktop-mcp-local" as const,
        route: "figma-desktop-local",
        operation: "get_design_context",
        observed_at: observedAt,
        freshness: "current" as const,
        scope: { kind: "selection" as const, id: "39:2731" },
        figma_version: "v42",
        figma_last_modified: lastModified,
        figma_scope_node_id: "39:2731",
      },
    };
    const decisions = normalizedSources(objective, [], [source]);
    const [receiptId] = await bindSourceEvidence(root, decisions, [source], []);
    await writeTaskCheckpoint(root, {
      taskId,
      milestone: "source-resolved",
      objective,
      objectiveApproved: true,
      decisions,
      sourceReceiptIds: [receiptId!],
      handles: [],
      covered: ["exact Figma source"],
      remaining: ["snapshot", "implementation"],
      budgetChars: 3_600,
      nextSafeAction: "Attach and freeze the exact visual authority.",
    });

    await withCoreClient(async (client) => {
      const hash = "c".repeat(64);
      const visualHandle = `visual:vd-exact-gate:${hash.slice(0, 16)}`;
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      const selectionReceipt = await emitVisualSelection(
        taskId,
        visualHandle,
        hash,
        expiresAt,
      );
      const attached = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "attach-evidence",
          visual_contract: {
            handle: visualHandle,
            hash,
            selection_receipt: selectionReceipt,
            authority: "exact-figma",
            summary: "Exact confirmation dialog authority.",
            figma: { file_key: "ExactFile", node_id: "39:2731" },
            receipt_ids: [receiptId],
            expires_at: expiresAt,
          },
        },
      });
      expect(attached.isError, JSON.stringify(attached.content)).not.toBe(true);

      const lockArguments = {
        root_path: root,
        task_id: taskId,
        primary_surface: {
          kind: "files" as const,
          id: "exact-figma-dialog",
          path: target,
        },
        allowed_files: [target],
        decision: "not-applicable" as const,
        rationale: "The exact Figma authority applies to one existing file.",
      };
      const locked = await client.callTool({
        name: "atlas_lock_change_scope",
        arguments: lockArguments,
      });
      expect(locked.isError, JSON.stringify(locked.content)).not.toBe(true);
      expect(
        locked.structuredContent,
        JSON.stringify(locked.structuredContent, null, 2),
      ).toMatchObject({
        status: "locked",
        lock: { evidenceHandles: expect.arrayContaining([visualHandle]) },
      });

      const withoutSnapshot = await loadTaskResumeCapsule(root, taskId);
      await expect(
        assertCoreTaskEvidenceReadyForSuccess(
          root,
          taskId,
          withoutSnapshot!,
          { decisions, relations: [], receiptIds: [receiptId!] },
        ),
      ).rejects.toThrow(/latest semantic snapshot/iu);

      const coverageComplete = { status: "complete", omitted: 0 } as const;
      const coverageNotRequested = {
        status: "not-requested",
        omitted: 0,
      } as const;
      const figmaSnapshot = {
        identity: {
          file_key: "ExactFile",
          node_id: "39-2731",
          version: "v42",
          last_modified: lastModified,
        },
        observed_at: observedAt,
        receipt_ids: [receiptId],
        coverage: {
          nodes: coverageComplete,
          components: coverageNotRequested,
          styles: coverageComplete,
          states: coverageComplete,
          assets: coverageNotRequested,
        },
        content: {
          nodes: [
            {
              id: "39:2731",
              name: "Confirmation dialog",
              type: "FRAME",
              node_id: "39:2731",
              token_refs: ["space.400", "color.surface.default"],
            },
          ],
          components: [],
          styles: [
            {
              id: "style:surface",
              name: "Surface / Default",
              type: "PAINT",
              token_refs: ["color.surface.default"],
            },
          ],
          states: [
            {
              id: "state:default",
              name: "Default",
              type: "VARIANT",
            },
          ],
          assets: [],
        },
      };
      const blockedSnapshot = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "record-figma-snapshot",
          figma_snapshot: figmaSnapshot,
        },
      });
      expect(blockedSnapshot.isError).toBe(true);
      expect(JSON.stringify(blockedSnapshot.content)).toMatch(
        /relock-required window/iu,
      );

      const invalidationReason =
        "Freeze the current semantic Figma snapshot into ChangeSurface.";
      const preparationSource = {
        ...source,
        evidence: {
          ...source.evidence,
          figma_metadata: {
            document: {
              id: "0:0",
              name: "Dialogs",
              type: "DOCUMENT",
              children: [
                {
                  id: "39:2731",
                  name: "Confirmation dialog",
                  type: "FRAME",
                  children: [],
                },
              ],
            },
          },
          figma_format: "figma-rest",
        },
      };
      const prepared = await client.callTool({
        name: "atlas_prepare_task",
        arguments: {
          root_path: root,
          task_id: taskId,
          objective,
          objective_confirmed: true,
          invalidation_reason: invalidationReason,
          budget_chars: 3_600,
          sources: [preparationSource],
        },
      });
      expect(
        prepared.structuredContent,
        JSON.stringify(prepared.content),
      ).toMatchObject({ status: "relock-required" });
      const recorded = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "record-figma-snapshot",
          figma_snapshot: figmaSnapshot,
        },
      });
      expect(recorded.isError, JSON.stringify(recorded.content)).not.toBe(true);
      const snapshotHandle = (
        recorded.structuredContent as { snapshot: { handle: string } }
      ).snapshot.handle;
      const snapshotOutsideLock = await loadTaskResumeCapsule(root, taskId);
      expect(snapshotOutsideLock?.handles).toEqual(
        expect.arrayContaining([snapshotHandle]),
      );
      await expect(
        assertCoreTaskEvidenceReadyForSuccess(
          root,
          taskId,
          snapshotOutsideLock!,
          { decisions, relations: [], receiptIds: [receiptId!] },
        ),
      ).rejects.toThrow(/active ChangeSurface/iu);

      const relocked = await client.callTool({
        name: "atlas_lock_change_scope",
        arguments: {
          ...lockArguments,
          invalidation_reason: invalidationReason,
        },
      });
      expect(relocked.isError, JSON.stringify(relocked.content)).not.toBe(true);
      expect(
        relocked.structuredContent,
        JSON.stringify(relocked.structuredContent, null, 2),
      ).toMatchObject({
        status: "locked",
        lock: {
          evidenceHandles: expect.arrayContaining([
            visualHandle,
            snapshotHandle,
          ]),
        },
      });
      const ready = await loadTaskResumeCapsule(root, taskId);
      expect(ready?.handles).toEqual(expect.arrayContaining([snapshotHandle]));
      expect(ready?.changeSurface?.evidence.handles).toEqual(
        expect.arrayContaining([snapshotHandle]),
      );
      await expect(
        assertCoreTaskEvidenceReadyForSuccess(
          root,
          taskId,
          ready!,
          { decisions, relations: [], receiptIds: [receiptId!] },
        ),
      ).resolves.toBeUndefined();

      const revisionInvalidationReason =
        "Replace the frozen Figma snapshot with its current revision.";
      const revisionPrepared = await client.callTool({
        name: "atlas_prepare_task",
        arguments: {
          root_path: root,
          task_id: taskId,
          objective,
          objective_confirmed: true,
          invalidation_reason: revisionInvalidationReason,
          budget_chars: 3_600,
          sources: [preparationSource],
        },
      });
      expect(
        revisionPrepared.structuredContent,
        JSON.stringify(revisionPrepared.content),
      ).toMatchObject({ status: "relock-required" });
      const revisedSnapshot = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "record-figma-snapshot",
          figma_snapshot: {
            ...figmaSnapshot,
            previous_handle: snapshotHandle,
            content: {
              ...figmaSnapshot.content,
              styles: [
                {
                  ...figmaSnapshot.content.styles[0],
                  token_refs: ["color.surface.raised"],
                },
              ],
            },
          },
        },
      });
      expect(
        revisedSnapshot.isError,
        JSON.stringify(revisedSnapshot.content),
      ).not.toBe(true);
      const revisedSnapshotHandle = (
        revisedSnapshot.structuredContent as { snapshot: { handle: string } }
      ).snapshot.handle;
      expect(revisedSnapshotHandle).not.toBe(snapshotHandle);

      const revisionRelocked = await client.callTool({
        name: "atlas_lock_change_scope",
        arguments: {
          ...lockArguments,
          invalidation_reason: revisionInvalidationReason,
        },
      });
      expect(
        revisionRelocked.isError,
        JSON.stringify(revisionRelocked.content),
      ).not.toBe(true);
      const revisedReady = await loadTaskResumeCapsule(root, taskId);
      expect(revisedReady?.handles).toContain(revisedSnapshotHandle);
      expect(revisedReady?.handles).not.toContain(snapshotHandle);
      expect(revisedReady?.changeSurface?.evidence.handles).toContain(
        revisedSnapshotHandle,
      );
      expect(revisedReady?.changeSurface?.evidence.handles).not.toContain(
        snapshotHandle,
      );
      expect(encodeResumeCapsule(revisedReady!).bytes).toBeLessThanOrEqual(4_096);
      await expect(
        assertCoreTaskEvidenceReadyForSuccess(
          root,
          taskId,
          revisedReady!,
          { decisions, relations: [], receiptIds: [receiptId!] },
        ),
      ).resolves.toBeUndefined();
    });
  });

  it("allows success only after the latest criteria bind to the validated lock", async () => {
    const root = await createGitRoot(true);
    const taskId = "task-accepted-closeout";
    const target = "app/components/feature/ConfirmDialog.vue";

    await withCoreClient(async (client) => {
      const prepared = await client.callTool({
        name: "atlas_prepare_task",
        arguments: {
          root_path: root,
          task_id: taskId,
          objective: "Update the existing confirmation dialog copy.",
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
              {
                id: "copy-updated",
                statement: "The confirmation dialog copy is updated.",
                required: true,
              },
            ],
            exclusions: ["Do not change dialog behavior."],
          },
        },
      });
      const contractHandle = (
        recorded.structuredContent as { contract: { handle: string } }
      ).contract.handle;
      const initial = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "checkpoint-continuation",
          continuation: {
            contract_handle: contractHandle,
            criteria: [{ criterion_id: "copy-updated", status: "pending" }],
            next_action: "Lock and update the existing dialog.",
          },
        },
      });
      const initialHandle = (
        initial.structuredContent as { continuation: { handle: string } }
      ).continuation.handle;
      const locked = await client.callTool({
        name: "atlas_lock_change_scope",
        arguments: {
          root_path: root,
          task_id: taskId,
          primary_surface: {
            kind: "files",
            id: "confirm-dialog-copy",
            path: target,
          },
          allowed_files: [target],
          decision: "not-applicable",
          rationale: "This is a bounded copy change on an existing file surface.",
        },
      });
      expect(locked.isError, JSON.stringify(locked.content)).not.toBe(true);
      const lockId = (
        locked.structuredContent as { lock: { id: string } }
      ).lock.id;

      await appendFile(
        path.join(root, target),
        "\n<!-- acceptance-gate-test -->\n",
        "utf8",
      );
      const validated = await client.callTool({
        name: "atlas_validate_change",
        arguments: { root_path: root, task_id: taskId },
      });
      expect(validated.isError, JSON.stringify(validated.content)).not.toBe(true);
      expect(validated.structuredContent).toMatchObject({ status: "pass" });
      const capsule = await loadTaskResumeCapsule(root, taskId);
      expect(capsule?.validation).toBeDefined();
      const validationReference = `validation:${lockId}:${capsule!.validation!.deltaHash}`;

      const finalProgress = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "checkpoint-continuation",
          continuation: {
            contract_handle: contractHandle,
            previous_handle: initialHandle,
            change_surface_lock_id: lockId,
            criteria: [
              {
                criterion_id: "copy-updated",
                status: "satisfied",
                validation_refs: [validationReference],
              },
            ],
            validation_refs: [validationReference],
            covered: ["dialog copy", "validation"],
            remaining: [],
            next_action: "Complete the accepted technical task.",
          },
        },
      });
      expect(
        finalProgress.isError,
        JSON.stringify(finalProgress.content),
      ).not.toBe(true);
      expect(finalProgress.structuredContent).toMatchObject({
        acceptance: { ready: true, required: 1, satisfied: 1 },
      });

      const completed = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "complete",
          result: "success",
          summary: "Updated the bounded confirmation dialog copy.",
          verification: ["Atlas validation passed for the locked file."],
          files: [target],
        },
      });
      expect(completed.isError, JSON.stringify(completed.content)).not.toBe(true);
      expect(completed.structuredContent).toMatchObject({
        status: "completed",
        ready: true,
        result: "success",
        deliveryReceipt: expect.stringMatching(
          /^delivery:task-accepted-closeout:[a-f0-9]{16}$/u,
        ),
      });
    });
  });

  it("records immutable criteria, checkpoints exact progress and resumes the checkout", async () => {
    const root = await createGitRoot(true);
    const taskId = "task-durable-evidence";
    const graph = await scanProject(root);
    const evidenceHandle = `code:${graph.components[0]!.id}`;
    await seedTask(root, taskId, "Implement durable task evidence and recovery.");

    await withCoreClient(async (client) => {
      const recorded = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "record-contract",
          evidence_contract: {
            criteria: [
              {
                id: "runtime",
                statement: "Task evidence survives context compaction.",
                required: true,
              },
              {
                id: "docs",
                statement: "The public workflow is documented.",
                required: false,
              },
            ],
            decisions: [
              {
                id: "boundary",
                question: "Does Atlas orchestrate work?",
                status: "resolved",
                answer: "No. Atlas persists evidence and continuity only.",
              },
            ],
            constraints: ["Do not create a task scheduler."],
          },
        },
      });
      expect(recorded.isError, JSON.stringify(recorded.content)).not.toBe(true);
      const contractHandle = (
        recorded.structuredContent as { contract: { handle: string } }
      ).contract.handle;
      expect(contractHandle).toMatch(
        /^contract:task-durable-evidence:[a-f0-9]{16}$/u,
      );

      const checkpointed = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "checkpoint-continuation",
          continuation: {
            contract_handle: contractHandle,
            criteria: [
              { criterion_id: "runtime", status: "pending" },
              { criterion_id: "docs", status: "pending" },
            ],
            covered: ["immutable evidence contract"],
            remaining: ["runtime validation", "documentation"],
            next_action: "Run the focused runtime and MCP tests.",
          },
        },
      });
      expect(checkpointed.isError, JSON.stringify(checkpointed.content)).not.toBe(
        true,
      );
      expect(checkpointed.structuredContent).toMatchObject({
        status: "continuation-checkpointed",
        acceptance: {
          ready: false,
          pending: ["runtime"],
        },
      });
      const continuationHandle = (
        checkpointed.structuredContent as {
          continuation: { handle: string };
        }
      ).continuation.handle;

      const resumed = await client.callTool({
        name: "atlas_task_state",
        arguments: { root_path: root, action: "resume" },
      });
      expect(resumed.isError, JSON.stringify(resumed.content)).not.toBe(true);
      expect(resumed.structuredContent).toMatchObject({
        taskId,
        recovered: "exact-checkout",
        recommendation: { taskId: taskId },
        criteria: {
          contract: { handle: expect.any(String) },
          acceptance: { pending: ["runtime"] },
        },
        nextAction: "Run the focused runtime and MCP tests.",
      });

      const expanded = await client.callTool({
        name: "atlas_expand_context",
        arguments: {
          root_path: root,
          task_id: taskId,
          handle: continuationHandle,
          response_format: "detailed",
        },
      });
      expect(expanded.isError, JSON.stringify(expanded.content)).not.toBe(true);
      expect(expanded.structuredContent).toMatchObject({
        continuation: { handle: continuationHandle },
        acceptance: { ready: false, pending: ["runtime"] },
      });

      const forged = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "checkpoint-continuation",
          continuation: {
            contract_handle: contractHandle,
            previous_handle: continuationHandle,
            criteria: [
              {
                criterion_id: "runtime",
                status: "satisfied",
                validation_refs: ["test:invented"],
              },
              { criterion_id: "docs", status: "pending" },
            ],
            next_action: "Pretend the task is ready.",
          },
        },
      });
      expect(forged.isError).toBe(true);
      expect(JSON.stringify(forged.content)).toMatch(/current Atlas validation/iu);

      const completedProgress = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: taskId,
          action: "checkpoint-continuation",
          continuation: {
            contract_handle: contractHandle,
            previous_handle: continuationHandle,
            criteria: [
              {
                criterion_id: "runtime",
                status: "satisfied",
                evidence_refs: [evidenceHandle],
              },
              { criterion_id: "docs", status: "pending" },
            ],
            covered: ["runtime validation"],
            remaining: ["documentation"],
            next_action: "Update the public documentation.",
          },
        },
      });
      expect(
        completedProgress.isError,
        JSON.stringify(completedProgress.content),
      ).not.toBe(true);
      expect(completedProgress.structuredContent).toMatchObject({
        acceptance: { ready: true, required: 1, satisfied: 1 },
      });
    });

    await expect(loadLatestTaskEvidenceContract(root, taskId)).resolves.toMatchObject({
      revision: 1,
      criteria: [{ id: "runtime" }, { id: "docs" }],
    });
    await expect(
      loadLatestTaskContinuationBundle(root, taskId),
    ).resolves.toMatchObject({ revision: 2, nextSafeAction: "Update the public documentation." });
  });

  it("requires an exact task selection when two tasks are resumable", async () => {
    const root = await createGitRoot();
    await seedTask(root, "task-one", "Implement task one.");
    await seedTask(root, "task-two", "Implement task two.");

    await withCoreClient(async (client) => {
      const ambiguous = await client.callTool({
        name: "atlas_task_state",
        arguments: { root_path: root, action: "resume" },
      });
      expect(ambiguous.isError, JSON.stringify(ambiguous.content)).not.toBe(true);
      expect(ambiguous.structuredContent).toMatchObject({
        status: "selection-required",
        candidateCount: 2,
        nextAction: expect.stringContaining("exact task_id"),
      });
      expect(
        (ambiguous.structuredContent as { candidates: Array<{ taskId: string }> })
          .candidates.map((candidate) => candidate.taskId),
      ).toEqual(["task-two", "task-one"]);

      const selected = await client.callTool({
        name: "atlas_task_state",
        arguments: { root_path: root, task_id: "task-one", action: "resume" },
      });
      expect(selected.isError, JSON.stringify(selected.content)).not.toBe(true);
      expect(selected.structuredContent).toMatchObject({
        taskId: "task-one",
        title: "Implement task one.",
        objective: "Implement task one.",
        recommendation: { taskId: "task-one", reason: "explicit-task-id" },
        git: { head: expect.any(String) },
        feedback: { total: 0, pending: 0 },
      });

      const missingTask = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          action: "record-contract",
          evidence_contract: { criteria: [] },
        },
      });
      expect(missingTask.isError).toBe(true);
      expect(JSON.stringify(missingTask.content)).toMatch(/exact task_id/iu);
    });
  });

  it("appends feedback and reconciles the uniquely recoverable task without task_id", async () => {
    const root = await createGitRoot();
    await seedTask(root, "task-feedback", "Implement task feedback continuity.");

    await withCoreClient(async (client) => {
      const appended = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          action: "append-feedback",
          kind: "correction",
          text: "Require OTP for every digital consent change.",
          origin: "user",
          impact: "within-scope",
        },
      });
      expect(appended.isError, JSON.stringify(appended.content)).not.toBe(true);
      expect(appended.structuredContent).toMatchObject({
        status: "feedback-appended",
        taskId: "task-feedback",
        feedback: { kind: "correction", origin: "user" },
      });

      const reconciled = await client.callTool({
        name: "atlas_task_state",
        arguments: { root_path: root, action: "reconcile" },
      });
      expect(reconciled.isError, JSON.stringify(reconciled.content)).not.toBe(true);
      expect(reconciled.structuredContent).toMatchObject({
        status: "reconciled",
        taskId: "task-feedback",
        feedback: { total: 1, pending: 1 },
      });
    });
  });

  it("rejects evidence owned by another task", async () => {
    const root = await createGitRoot();
    await seedTask(root, "task-owner", "Implement the owned task.");
    await seedTask(root, "task-foreign", "Implement a different task.");

    await withCoreClient(async (client) => {
      const record = async (taskId: string) =>
        client.callTool({
          name: "atlas_task_state",
          arguments: {
            root_path: root,
            task_id: taskId,
            action: "record-contract",
            evidence_contract: {
              criteria: [
                {
                  id: "implemented",
                  statement: "The task implementation is verified.",
                  required: true,
                },
              ],
            },
          },
        });
      const owned = await record("task-owner");
      const foreign = await record("task-foreign");
      const ownedHandle = (
        owned.structuredContent as { contract: { handle: string } }
      ).contract.handle;
      const foreignHandle = (
        foreign.structuredContent as { contract: { handle: string } }
      ).contract.handle;

      const crossed = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: "task-owner",
          action: "checkpoint-continuation",
          continuation: {
            contract_handle: ownedHandle,
            criteria: [
              {
                criterion_id: "implemented",
                status: "satisfied",
                evidence_refs: [foreignHandle],
              },
            ],
            next_action: "Close with foreign evidence.",
          },
        },
      });
      expect(crossed.isError).toBe(true);
      expect(JSON.stringify(crossed.content)).toMatch(/different task/iu);
      await expect(
        loadLatestTaskContinuationBundle(root, "task-owner"),
      ).resolves.toBeUndefined();
    });
  });
});
