import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  loadTaskCompletionIntent,
  loadTaskCompletionReceipt,
  loadTaskResumeCapsule,
  pruneExpiredTaskState,
} from "@component-atlas/runtime";
import { describe, expect, it } from "vitest";
import {
  createMcpServer,
  DECLARED_CORE_MCP_CONTRACT_COST,
} from "./index.js";
import { copyFixture } from "../../../scripts/test-fixture-copy.mjs";
import {
  cleanupSession,
  createSession,
  recordArtifact,
  selectDirection,
} from "../../../skills/visual-direction/scripts/temporary-artifacts.mjs";
import { setTaskCompletionFaultInjectorForTests } from "./core-task-completion.js";

const execFileAsync = promisify(execFile);
const coreProfile = JSON.parse(
  await readFile(
    fileURLToPath(new URL("../core-profile.json", import.meta.url)),
    "utf8",
  ),
) as { profile: string; tools: string[] };

async function recordedVisualCapture(
  sessionPath: string,
  visualRoot: string,
  fileName: string,
  viewport: string,
  state: string,
) {
  const capturePath = path.join(sessionPath, fileName);
  await writeFile(capturePath, `${viewport}:${state}\n`, "utf8");
  const recorded = await recordArtifact({
    sessionPath,
    artifactPath: capturePath,
    kind: "review-capture",
    root: visualRoot,
  });
  return {
    handle: recorded.handle,
    hash: recorded.hash,
    receipt: recorded.receipt,
    viewport,
    state,
  };
}

describe("Project Atlas MCP surface", () => {
  it("exposes only the six annotated high-level tools by default", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer("core");
    const client = new Client({ name: "component-atlas-core-test", version: "0.2.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      const serialized = JSON.stringify(tools.tools);
      expect(coreProfile.profile).toBe("core");
      expect(names).toEqual(coreProfile.tools);
      expect({
        mcpToolCount: tools.tools.length,
        mcpDescriptionChars: tools.tools.reduce(
          (total, tool) => total + (tool.description?.length ?? 0),
          0,
        ),
        mcpSchemaChars: tools.tools.reduce(
          (total, tool) =>
            total +
            JSON.stringify(tool.inputSchema ?? {}).length +
            JSON.stringify(tool.outputSchema ?? {}).length,
          0,
        ),
        mcpSerializedChars: serialized.length,
        mcpContractHash: createHash("sha256").update(serialized).digest("hex"),
      }).toEqual(DECLARED_CORE_MCP_CONTRACT_COST);
      expect(serialized.length).toBeLessThanOrEqual(16_000);
      for (const tool of tools.tools) {
        expect(tool.annotations).toMatchObject({
          destructiveHint: false,
          idempotentHint: tool.name === "atlas_expand_context",
        });
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("rejects an unknown profile instead of expanding to legacy", () => {
    expect(() => createMcpServer("unexpected" as never)).toThrow(
      "Project Atlas MCP profile must be core or legacy.",
    );
  });

  it("composes the six core operations through one bounded task capsule", async () => {
    const rootPath = await mkdtemp(
      path.join(os.tmpdir(), "component-atlas-core-flow-"),
    );
    const atlasHome = await mkdtemp(
      path.join(os.tmpdir(), "component-atlas-core-home-"),
    );
    const previousAtlasHome = process.env.PROJECT_ATLAS_HOME;
    process.env.PROJECT_ATLAS_HOME = atlasHome;
    const visualRoot = path.join(atlasHome, "temp", "visual-direction");
    const source = fileURLToPath(
      new URL("../../../fixtures/vue-nuxt", import.meta.url),
    );
    await copyFixture(source, rootPath);
    await execFileAsync("git", ["init"], { cwd: rootPath });
    await execFileAsync("git", ["add", "."], { cwd: rootPath });
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
      { cwd: rootPath },
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createMcpServer("core");
    const client = new Client({
      name: "component-atlas-core-flow-test",
      version: "0.2.0",
    });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      const prepared = await client.callTool({
        name: "atlas_prepare_task",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          objective: "Update the existing confirmation dialog without changing account settings.",
          objective_confirmed: true,
          budget_chars: 3600,
        },
      });
      expect(prepared.isError).not.toBe(true);
      expect(JSON.stringify(prepared.structuredContent).length).toBeLessThanOrEqual(3_600);
      expect(prepared.structuredContent).toMatchObject({
        taskId: "task-core-flow",
        status: "ready",
        risk: expect.objectContaining({ level: expect.any(String) }),
        governance: {
          size: "small",
          risk: "low",
          reviewTier: "none",
          reasons: expect.any(Array),
        },
      });
      const preparedContent = prepared.structuredContent as {
        code?: Array<{ id: string }>;
      };
      const componentId = preparedContent.code?.[0]?.id;
      expect(componentId).toBeTruthy();

      const expanded = await client.callTool({
        name: "atlas_expand_context",
        arguments: {
          root_path: rootPath,
          handle: `code:${componentId}`,
          response_format: "concise",
        },
      });
      expect(expanded.isError).not.toBe(true);
      expect(JSON.stringify(expanded.structuredContent).length).toBeLessThanOrEqual(1_600);

      const visualSession = await createSession({
        taskId: "task-core-flow",
        root: visualRoot,
        ttlMs: 5 * 60_000,
      });
      const selectedVisual = await selectDirection({
        sessionPath: visualSession.sessionPath,
        direction: {
          version: 1,
          mode: "inherit",
          locked_direction: { id: "quiet-confirmation" },
        },
        root: visualRoot,
      });
      const visualHash = selectedVisual.directionHash;
      const visualHandle = selectedVisual.contractHandle;
      const visualEvidence = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          action: "attach-evidence",
          visual_contract: {
            handle: visualHandle,
            hash: visualHash,
            selection_receipt: selectedVisual.selectionReceipt,
            authority: "selected-direction",
            selected_direction_id: "quiet-confirmation",
            summary: "Selected confirmation-dialog visual direction.",
            expires_at: selectedVisual.expiresAt,
          },
        },
      });
      expect(
        visualEvidence.isError,
        JSON.stringify(visualEvidence.structuredContent ?? visualEvidence.content),
      ).not.toBe(true);

      const invalidFirstLock = await client.callTool({
        name: "atlas_lock_change_scope",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          primary_component: componentId,
          exclusions: ["account settings"],
          decision: "reuse",
          rationale: "The existing component already owns the dialog behavior.",
          selected_component_ids: [componentId],
          invalidation_reason: "There is no prior lock to invalidate.",
        },
      });
      expect(invalidFirstLock.isError).toBe(true);

      const locked = await client.callTool({
        name: "atlas_lock_change_scope",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          primary_component: componentId,
          exclusions: ["account settings"],
          decision: "reuse",
          rationale: "The existing component already owns the dialog behavior.",
          selected_component_ids: [componentId],
        },
      });
      expect(locked.structuredContent).toMatchObject({
        taskId: "task-core-flow",
        status: "locked",
        governance: {
          size: "small",
          risk: "low",
          reviewTier: "none",
          reasons: expect.any(Array),
        },
        lock: expect.objectContaining({ exclusions: ["account settings"] }),
      });

      const bypassRelock = await client.callTool({
        name: "atlas_lock_change_scope",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          primary_component: componentId,
          allowed_files: ["unexpected-scope.ts"],
          exclusions: [],
          decision: "reuse",
          rationale: "Attempt to widen the lock without a prepared invalidation.",
          selected_component_ids: [componentId],
          invalidation_reason: "Unpersisted scope expansion.",
        },
      });
      expect(bypassRelock.isError).toBe(true);

      const lateEvidence = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          action: "attach-evidence",
          visual_contract: {
            handle: "visual:vd-too-late:eeeeeeeeeeeeeeee",
            hash: "e".repeat(64),
            selection_receipt: selectedVisual.selectionReceipt,
            authority: "selected-direction",
            selected_direction_id: "direction-after-lock",
            summary: "This evidence arrived after the scope lock.",
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          },
        },
      });
      expect(lateEvidence.isError).toBe(true);
      const blockedVisualReview = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          action: "attach-review",
          visual_review: {
            contract_handle: visualHandle,
            contract_hash: visualHash,
            state_matrix: {
              surface: "Confirmation dialog",
              viewports: ["desktop", "narrow"],
              required_states: ["default", "focus-visible"],
            },
            captures: [],
            result: "blocked",
            deviation_count: 1,
            cleanup: { state: "cleanup-pending" },
          },
        },
      });
      expect(blockedVisualReview.structuredContent).toMatchObject({
        status: "blocked",
      });

      const resumed = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          action: "resume",
        },
      });
      expect(resumed.structuredContent).toMatchObject({
        format: expect.stringMatching(/^(?:toon|json)$/u),
        body: expect.stringContaining("task-core-flow"),
      });

      const validated = await client.callTool({
        name: "atlas_validate_change",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
        },
      });
      expect(
        validated.isError,
        JSON.stringify(validated.structuredContent ?? validated.content),
      ).not.toBe(true);

      const postValidationFile = path.join(rootPath, "post-validation.txt");
      await writeFile(postValidationFile, "changed after validation\n", "utf8");
      const staleOutcome = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          action: "complete",
          result: "success",
          summary: "This completion must be rejected.",
          verification: ["stale validation"],
        },
      });
      expect(staleOutcome.isError).toBe(true);
      await rm(postValidationFile);

      const invalidated = await client.callTool({
        name: "atlas_prepare_task",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          objective:
            "Update the existing confirmation dialog without changing account settings.",
          objective_confirmed: true,
          invalidation_reason: "The repository graph changed after validation.",
          budget_chars: 3_600,
        },
      });
      expect(
        invalidated.structuredContent,
        JSON.stringify(invalidated.structuredContent ?? invalidated.content),
      ).toMatchObject({
        taskId: "task-core-flow",
        status: "relock-required",
      });
      const invalidatedOutcome = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          action: "complete",
          result: "success",
          summary: "This completion must wait for relock.",
          verification: ["old validation"],
        },
      });
      expect(invalidatedOutcome.isError).toBe(true);
      const relocked = await client.callTool({
        name: "atlas_lock_change_scope",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          primary_component: componentId,
          exclusions: ["account settings"],
          decision: "reuse",
          rationale: "The existing component still owns the dialog behavior.",
          selected_component_ids: [componentId],
          invalidation_reason: "The repository graph changed after validation.",
        },
      });
      expect(
        relocked.structuredContent,
        JSON.stringify(relocked.structuredContent ?? relocked.content),
      ).toMatchObject({
        status: "locked",
        lock: expect.objectContaining({
          revision: 2,
          evidenceHandles: expect.arrayContaining([visualHandle]),
        }),
      });
      const revalidated = await client.callTool({
        name: "atlas_validate_change",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
        },
      });
      expect(revalidated.isError).not.toBe(true);
      expect(revalidated.structuredContent).toMatchObject({ status: "pass" });
      const reviewCaptures = [
        await recordedVisualCapture(
          visualSession.sessionPath,
          visualRoot,
          "review-desktop.png",
          "desktop",
          "default",
        ),
        await recordedVisualCapture(
          visualSession.sessionPath,
          visualRoot,
          "review-narrow.png",
          "narrow",
          "focus-visible",
        ),
      ];
      const forgedCaptureReview = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          action: "attach-review",
          visual_review: {
            contract_handle: visualHandle,
            contract_hash: visualHash,
            state_matrix: {
              surface: "Confirmation dialog",
              viewports: ["desktop", "narrow"],
              required_states: ["default", "focus-visible"],
            },
            captures: [
              {
                ...reviewCaptures[0],
                receipt: reviewCaptures[0]!.receipt.replace(
                  /:[a-f0-9]{16}$/u,
                  ":0000000000000000",
                ),
              },
              reviewCaptures[1],
            ],
            result: "pass",
            deviation_count: 0,
            cleanup: { state: "selected-retained" },
          },
        },
      });
      expect(forgedCaptureReview.isError).toBe(true);
      const directFinalReview = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          action: "attach-review",
          visual_review: {
            contract_handle: visualHandle,
            contract_hash: visualHash,
            state_matrix: {
              surface: "Confirmation dialog",
              viewports: ["desktop", "narrow"],
              required_states: ["default", "focus-visible"],
            },
            captures: reviewCaptures,
            result: "pass",
            deviation_count: 0,
            cleanup: {
              state: "clean",
              receipt:
                "cleanup:v1:0000000000000000:vd-core-flow:close:m1234567:0000000000000000",
            },
          },
        },
      });
      expect(directFinalReview.isError).toBe(true);
      const retainedVisualReview = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          action: "attach-review",
          visual_review: {
            contract_handle: visualHandle,
            contract_hash: visualHash,
            state_matrix: {
              surface: "Confirmation dialog",
              viewports: ["desktop", "narrow"],
              required_states: ["default", "focus-visible"],
            },
            captures: reviewCaptures,
            result: "pass",
            deviation_count: 0,
            cleanup: { state: "selected-retained" },
          },
        },
      });
      expect(
        retainedVisualReview.isError,
        JSON.stringify(
          retainedVisualReview.structuredContent ?? retainedVisualReview.content,
        ),
      ).not.toBe(true);
      expect(retainedVisualReview.structuredContent).toMatchObject({
        status: "blocked",
      });
      const preliminaryReviewHandle = (
        retainedVisualReview.structuredContent as { reviewReceipt: string }
      ).reviewReceipt;
      const retainedCompletion = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          action: "complete",
          result: "success",
          summary: "A retained visual selection must not close normally.",
          verification: ["targeted tests passed"],
        },
      });
      expect(retainedCompletion.isError).toBe(true);
      const cleanup = await cleanupSession({
        sessionPath: visualSession.sessionPath,
        root: visualRoot,
        reason: "close",
      });
      const mismatchedFinal = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          action: "attach-review",
          visual_review: {
            contract_handle: visualHandle,
            contract_hash: visualHash,
            state_matrix: {
              surface: "Confirmation dialog changed",
              viewports: ["desktop", "narrow"],
              required_states: ["default", "focus-visible"],
            },
            captures: reviewCaptures,
            result: "pass",
            deviation_count: 0,
            cleanup: { state: "clean", receipt: cleanup.receipt },
            preliminary_review_handle: preliminaryReviewHandle,
          },
        },
      });
      expect(mismatchedFinal.isError).toBe(true);
      const reattachedVisualReview = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          action: "attach-review",
          visual_review: {
            contract_handle: visualHandle,
            contract_hash: visualHash,
            state_matrix: {
              surface: "Confirmation dialog",
              viewports: ["desktop", "narrow"],
              required_states: ["default", "focus-visible"],
            },
            captures: reviewCaptures,
            result: "pass",
            deviation_count: 0,
            cleanup: { state: "clean", receipt: cleanup.receipt },
            preliminary_review_handle: preliminaryReviewHandle,
          },
        },
      });
      expect(reattachedVisualReview.structuredContent).toMatchObject({
        status: "review-attached",
      });
      const reviewHandle = (
        reattachedVisualReview.structuredContent as { reviewReceipt: string }
      ).reviewReceipt;
      const expandedReview = await client.callTool({
        name: "atlas_expand_context",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          handle: reviewHandle,
        },
      });
      expect(expandedReview.structuredContent).toMatchObject({
        receipt: {
          handle: reviewHandle,
          taskId: "task-core-flow",
          preliminaryReviewHandle,
          coverage: { complete: true },
        },
      });

      const completionArguments = {
        root_path: rootPath,
        task_id: "task-core-flow",
        action: "complete",
        result: "success",
        summary: "Verified the bounded core workflow fixture.",
        verification: ["targeted tests passed"],
      };
      let injected = false;
      setTaskCompletionFaultInjectorForTests((stage) => {
        if (!injected && stage === "after-delivery") {
          injected = true;
          throw new Error("injected completion interruption");
        }
      });
      const interrupted = await client.callTool({
        name: "atlas_task_state",
        arguments: completionArguments,
      });
      expect(interrupted.isError).toBe(true);
      setTaskCompletionFaultInjectorForTests();
      const convergedOutcomes = await Promise.all(
        Array.from({ length: 8 }, () =>
          client.callTool({
            name: "atlas_task_state",
            arguments: completionArguments,
          }),
        ),
      );
      const outcome = convergedOutcomes[0]!;
      const convergedPayloads = new Set(
        convergedOutcomes.map((entry) =>
          JSON.stringify(entry.structuredContent ?? entry.content),
        ),
      );
      expect(
        convergedPayloads.size,
        JSON.stringify([...convergedPayloads]),
      ).toBe(1);
      expect(
        outcome.isError,
        JSON.stringify(outcome.structuredContent ?? outcome.content),
      ).not.toBe(true);
      expect(outcome.structuredContent).toMatchObject({
        taskId: "task-core-flow",
        status: "completed",
        result: "success",
        deliveryReceipt: expect.stringMatching(
          /^delivery:task-core-flow:[a-f0-9]{16}$/u,
        ),
        memory: "not-written",
      });
      const completionIntent = await loadTaskCompletionIntent(
        rootPath,
        "task-core-flow",
      );
      expect(completionIntent).toMatchObject({
        request: {
          result: "success",
          summary: "Verified the bounded core workflow fixture.",
        },
      });
      const repeatedCompletion = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          action: "complete",
          result: "partial",
          summary: "This must not replace an immutable successful closeout.",
          verification: ["unexpected second closeout"],
        },
      });
      expect(repeatedCompletion.isError).toBe(true);
      await expect(
        loadTaskResumeCapsule(rootPath, "task-core-flow"),
      ).resolves.toMatchObject({
        status: "completed",
        completion: {
          result: "success",
          deliveryReceipt: (
            outcome.structuredContent as { deliveryReceipt: string }
          ).deliveryReceipt,
        },
      });
      const deliveryHandle = (
        outcome.structuredContent as { deliveryReceipt: string }
      ).deliveryReceipt;
      await expect(
        loadTaskCompletionReceipt(
          rootPath,
          deliveryHandle,
          "task-core-flow",
        ),
      ).resolves.toMatchObject({ completedAt: completionIntent?.completedAt });
      const expandedDelivery = await client.callTool({
        name: "atlas_expand_context",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          handle: deliveryHandle,
        },
      });
      expect(expandedDelivery.structuredContent).toMatchObject({
        status: "complete",
        receipt: {
          handle: deliveryHandle,
          taskId: "task-core-flow",
          lockId: expect.stringMatching(/^[a-f0-9]{24}$/u),
          deltaHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
          verification: expect.arrayContaining([
            expect.stringMatching(/^visual-review:[a-f0-9]{64}$/u),
          ]),
          sourceHandles: expect.arrayContaining([
            visualHandle,
          ]),
          visualReview: {
            receiptHandle: expect.stringMatching(
              /^visual-review:task-core-flow:[a-f0-9]{16}$/u,
            ),
            contractHandle: visualHandle,
            contractHash: visualHash,
            reviewHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
            result: "pass",
            captureCount: 2,
            cleanupState: "clean",
          },
        },
      });
      const crossTaskDelivery = await client.callTool({
        name: "atlas_expand_context",
        arguments: {
          root_path: rootPath,
          task_id: "another-task",
          handle: deliveryHandle,
        },
      });
      expect(crossTaskDelivery.isError).toBe(true);
      await pruneExpiredTaskState(
        rootPath,
        new Date(Date.now() + 8 * 24 * 60 * 60 * 1_000),
      );
      const resumedFinal = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          action: "resume",
        },
      });
      expect(resumedFinal.structuredContent).toMatchObject({
        status: "completed",
        taskId: "task-core-flow",
        deliveryReceipt: deliveryHandle,
        handles: [deliveryHandle],
        final: {
          result: "success",
          summary: "Verified the bounded core workflow fixture.",
          lock: { id: expect.stringMatching(/^[a-f0-9]{24}$/u) },
          validation: {
            deltaHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
          },
        },
      });
      const postTtlMemoryPreview = await client.callTool({
        name: "atlas_memory",
        arguments: {
          root_path: rootPath,
          task_id: "task-core-flow",
          action: "record-episodic",
          result: "success",
          summary: "The durable delivery receipt remains valid after capsule expiry.",
          evidence: ["delivery receipt expanded and verified"],
        },
      });
      expect(postTtlMemoryPreview.structuredContent).toMatchObject({
        status: "needs-consent",
        memoryWritten: false,
        scope: {
          evidence: ["delivery receipt expanded and verified"],
        },
      });
    } finally {
      setTaskCompletionFaultInjectorForTests();
      await client.close();
      await server.close();
      await rm(rootPath, { recursive: true, force: true });
      await rm(atlasHome, { recursive: true, force: true });
      if (previousAtlasHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
      else process.env.PROJECT_ATLAS_HOME = previousAtlasHome;
    }
  });
});
