import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  applyMemoryUpdate,
  beginMemoryConsentExecution,
  commitMemoryConsentExecution,
  loadMemoryConsentState,
  loadVisualEvidenceContract,
  pruneExpiredTaskState,
  proposeMemoryUpdate,
  recordProjectOutcome,
  scanProject,
  writeTaskCheckpoint,
} from "@component-atlas/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFixture } from "../../../scripts/test-fixture-copy.mjs";
import {
  bindSourceEvidence,
  normalizedSources,
} from "./core-source-evidence.js";
import { createMcpServer } from "./index.js";
import { visualCleanupReceipt } from "./visual-receipt-test-fixtures.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
let previousAtlasHome: string | undefined;

beforeEach(async () => {
  previousAtlasHome = process.env.PROJECT_ATLAS_HOME;
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-lifecycle-home-"));
  roots.push(dataHome);
  process.env.PROJECT_ATLAS_HOME = dataHome;
});

async function createGitRoot(withFixture = false): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-lifecycle-"));
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
async function withCoreClient<T>(
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createMcpServer("core");
  const client = new Client({
    name: "component-atlas-lifecycle-test",
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

afterEach(async () => {
  if (previousAtlasHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousAtlasHome;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

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
function blockedExactReview(
  contractHandle: string, contractHash: string,
  cleanup: Record<string, string>,
  figmaComparisons: Array<Record<string, string>> = [],
  preliminaryReviewHandle?: string,
) {
  return {
    contract_handle: contractHandle,
    contract_hash: contractHash,
    state_matrix: { surface: "Exact visual surface", cases: [
      { id: "exact-default-desktop", route: "/exact", viewport: "desktop", state: "default" },
    ] },
    captures: [],
    figma_comparisons: figmaComparisons,
    result: "blocked",
    deviation_count: 1,
    cleanup,
    ...(preliminaryReviewHandle ? { preliminary_review_handle: preliminaryReviewHandle } : {}),
  };
}
describe("core lifecycle tools", () => {
  it("requires visual authority at lock and supersedes an expired contract during explicit relock", async () => {
    const root = await createGitRoot(true);
    const graph = await scanProject(root, { writeArtifacts: false });
    const componentId = graph.components[0]!.id;
    const sources = [
      {
        reference:
          "https://www.figma.com/design/VisualLock/Atlas?node-id=12-34",
        kind: "figma" as const,
        state: "confirmed" as const,
        authority_role: "visual" as const,
        primary_adapter: "figma-remote-connector",
        fallback: "deny" as const,
        evidence: {
          adapter: "figma-remote-connector" as const,
          route: "figma-app",
          operation: "get_design_context",
          observed_at: new Date().toISOString(),
          freshness: "current" as const,
        },
      },
    ];
    const decisions = normalizedSources("Implement exact visual lock", [], sources);
    const [receiptId] = await bindSourceEvidence(root, decisions, sources, []);
    await writeTaskCheckpoint(root, {
      taskId: "task-visual-relock",
      milestone: "source-resolved",
      objective: "Implement exact visual lock",
      objectiveApproved: true,
      decisions,
      sourceReceiptIds: [receiptId!],
      handles: [],
      covered: ["source gate"],
      remaining: ["lock change scope"],
      budgetChars: 1_600,
      nextSafeAction: "Attach the exact visual contract.",
    });

    await withCoreClient(async (client) => {
      const attachReview = (visualReview: ReturnType<typeof blockedExactReview>) =>
        client.callTool({
          name: "atlas_task_state",
          arguments: {
            root_path: root,
            task_id: "task-visual-relock",
            action: "attach-review",
            visual_review: visualReview,
          },
        });
      const lockArguments = {
        root_path: root,
        task_id: "task-visual-relock",
        primary_component: componentId,
        decision: "reuse",
        rationale: "Reuse the incumbent component under exact visual authority.",
        selected_component_ids: [componentId],
      };
      const missing = await client.callTool({
        name: "atlas_lock_change_scope",
        arguments: lockArguments,
      });
      expect(missing.isError).toBe(true);

      const oldHash = "a".repeat(64);
      const oldHandle = `visual:vd-old:${oldHash.slice(0, 16)}`;
      const oldExpiresAt = new Date(Date.now() + 800).toISOString();
      const oldSelectionReceipt = await emitVisualSelection(
        "task-visual-relock",
        oldHandle,
        oldHash,
        oldExpiresAt,
      );
      const attachedOld = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: "task-visual-relock",
          action: "attach-evidence",
          visual_contract: {
            handle: oldHandle,
            hash: oldHash,
            selection_receipt: oldSelectionReceipt,
            authority: "exact-figma",
            summary: "Short-lived exact Figma contract.",
            figma: { file_key: "VisualLock", node_id: "12:34" },
            receipt_ids: [receiptId],
            expires_at: oldExpiresAt,
          },
        },
      });
      expect(attachedOld.isError).not.toBe(true);
      const firstLock = await client.callTool({
        name: "atlas_lock_change_scope",
        arguments: lockArguments,
      });
      expect(firstLock.structuredContent).toMatchObject({
        status: "locked",
        lock: {
          revision: 1,
          evidenceHandles: expect.arrayContaining([oldHandle]),
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 850));
      const invalidationReason = "The locked visual contract expired.";
      const prepared = await client.callTool({
        name: "atlas_prepare_task",
        arguments: {
          root_path: root,
          task_id: "task-visual-relock",
          objective: "Implement exact visual lock",
          objective_confirmed: true,
          invalidation_reason: invalidationReason,
          budget_chars: 1_600,
        },
      });
      expect(
        prepared.structuredContent,
        JSON.stringify(prepared.structuredContent ?? prepared.content),
      ).toMatchObject({
        status: "relock-required",
      });

      const newHash = "b".repeat(64);
      const newHandle = `visual:vd-new:${newHash.slice(0, 16)}`;
      const newExpiresAt = new Date(Date.now() + 60_000).toISOString();
      const newSelectionReceipt = await emitVisualSelection(
        "task-visual-relock",
        newHandle,
        newHash,
        newExpiresAt,
      );
      const attachedNew = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: "task-visual-relock",
          action: "attach-evidence",
          visual_contract: {
            handle: newHandle,
            hash: newHash,
            selection_receipt: newSelectionReceipt,
            authority: "exact-figma",
            summary: "Replacement exact Figma contract.",
            figma: { file_key: "VisualLock", node_id: "12:34" },
            receipt_ids: [receiptId],
            expires_at: newExpiresAt,
          },
        },
      });
      expect(attachedNew.structuredContent).toMatchObject({
        status: "evidence-attached",
        handles: expect.arrayContaining([newHandle]),
      });
      expect(
        (attachedNew.structuredContent as { handles: string[] }).handles,
      ).not.toContain(oldHandle);

      const relocked = await client.callTool({
        name: "atlas_lock_change_scope",
        arguments: { ...lockArguments, invalidation_reason: invalidationReason },
      });
      expect(relocked.structuredContent, JSON.stringify(relocked.content)).toMatchObject({
        status: "locked",
        lock: {
          revision: 2,
          evidenceHandles: expect.arrayContaining([newHandle]),
        },
      });
      expect(
        (relocked.structuredContent as { lock: { evidenceHandles: string[] } })
          .lock.evidenceHandles,
      ).not.toContain(oldHandle);

      const unbackedFigmaComparison = await attachReview(
        blockedExactReview(
          newHandle,
          newHash,
          { state: "not-applicable" },
          [
            {
              case_id: "exact-default-desktop",
              status: "match",
              node_id: "12:34",
            },
          ],
        ),
      );
      expect(unbackedFigmaComparison.isError).toBe(true);
      expect(JSON.stringify(unbackedFigmaComparison.content)).toMatch(
        /semantic snapshot/iu,
      );

      const blockedReview = await attachReview(
        blockedExactReview(newHandle, newHash, { state: "cleanup-pending" }),
      );
      expect(
        blockedReview.structuredContent,
        JSON.stringify(blockedReview.content),
      ).toMatchObject({ status: "blocked" });
      const prematurePartial = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: "task-visual-relock",
          action: "complete",
          result: "partial",
          summary: "Cleanup is still pending.",
          verification: ["visual blocker documented"],
        },
      });
      expect(prematurePartial.isError).toBe(true);
      const preliminaryReview = await attachReview(
        blockedExactReview(newHandle, newHash, { state: "selected-retained" }),
      );
      expect(
        preliminaryReview.isError,
        JSON.stringify(preliminaryReview.content),
      ).not.toBe(true);
      const preliminaryHandle = (
        preliminaryReview.structuredContent as { reviewReceipt: string }
      ).reviewReceipt;
      await rm(
        path.join(
          process.env.PROJECT_ATLAS_HOME!,
          "temp",
          "visual-direction",
          "vd-new",
        ),
        { recursive: true, force: true },
      );
      const cleanupReceipt = visualCleanupReceipt(
        "task-visual-relock",
        "vd-new",
      );
      const closedReview = await attachReview(
        blockedExactReview(
          newHandle,
          newHash,
          { state: "clean", receipt: cleanupReceipt },
          [],
          preliminaryHandle,
        ),
      );
      expect(
        closedReview.isError,
        JSON.stringify(closedReview.content),
      ).not.toBe(true);
      const partial = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: "task-visual-relock",
          action: "complete",
          result: "partial",
          summary: "Visual comparison is blocked by missing capture access.",
          verification: ["locked contract retained for follow-up"],
        },
      });
      expect(
        partial.isError,
        JSON.stringify(partial.structuredContent ?? partial.content),
      ).not.toBe(true);
      expect(partial.structuredContent).toMatchObject({
        status: "completed",
        result: "partial",
        ready: false,
        verification: expect.arrayContaining([
          expect.stringMatching(/^visual-review-outcome:visual-review:.*:blocked$/u),
        ]),
      });
    });
  });

  it("verifies direct and visual receipt IDs against the task ledger before persisting", async () => {
    const root = await createGitRoot();
    const supplied = (reference: string) => [
      {
        reference,
        kind: "github" as const,
        state: "confirmed" as const,
        primary_adapter: "github-connector",
        fallback: "deny" as const,
        evidence: {
          adapter: "github-connector" as const,
          route: "github-app",
          operation: "read_issue",
          observed_at: "2026-07-31T10:00:00.000Z",
          freshness: "current" as const,
        },
      },
    ];
    const taskSources = supplied(
      "https://github.com/example/project/issues/42",
    );
    const taskDecisions = normalizedSources("Implement issue 42", [], taskSources);
    const [taskReceiptId] = await bindSourceEvidence(
      root,
      taskDecisions,
      taskSources,
      [],
    );
    const foreignSources = supplied(
      "https://github.com/example/project/issues/99",
    );
    const foreignDecisions = normalizedSources(
      "Implement issue 99",
      [],
      foreignSources,
    );
    const [foreignReceiptId] = await bindSourceEvidence(
      root,
      foreignDecisions,
      foreignSources,
      [],
    );
    const figmaSources = [
      {
        reference:
          "https://www.figma.com/design/FigmaLedger/Atlas?node-id=12-34",
        kind: "figma" as const,
        state: "confirmed" as const,
        authority_role: "visual" as const,
        primary_adapter: "figma-remote-connector",
        fallback: "deny" as const,
        evidence: {
          adapter: "figma-remote-connector" as const,
          route: "figma-app",
          operation: "get_design_context",
          observed_at: "2026-07-31T10:00:00.000Z",
          freshness: "current" as const,
        },
      },
    ];
    const figmaDecisions = normalizedSources(
      "Implement the confirmed Figma node",
      [],
      figmaSources,
    );
    const [figmaReceiptId] = await bindSourceEvidence(
      root,
      figmaDecisions,
      figmaSources,
      [],
    );
    await writeTaskCheckpoint(root, {
      taskId: "task-receipt-ledger",
      milestone: "source-resolved",
      objective: "Implement issue 42",
      objectiveApproved: true,
      decisions: [...taskDecisions, ...figmaDecisions],
      sourceReceiptIds: [taskReceiptId!, figmaReceiptId!],
      handles: Array.from({ length: 8 }, (_, index) => `code:existing-${index}`),
      covered: ["source gate"],
      remaining: ["implementation"],
      budgetChars: 1_600,
      nextSafeAction: "Attach visual evidence.",
    });

    const visualExpiresAt = new Date(Date.now() + 60_000).toISOString();
    const foreignHash = "a".repeat(64);
    const foreignHandle = `visual:vd-foreign:${foreignHash.slice(0, 16)}`;
    const foreignSelectionReceipt = await emitVisualSelection(
      "task-receipt-ledger",
      foreignHandle,
      foreignHash,
      visualExpiresAt,
    );
    const wrongProviderHash = "c".repeat(64);
    const wrongProviderHandle = `visual:vd-not-figma:${wrongProviderHash.slice(0, 16)}`;
    const wrongProviderSelectionReceipt = await emitVisualSelection(
      "task-receipt-ledger",
      wrongProviderHandle,
      wrongProviderHash,
      visualExpiresAt,
    );
    const figmaHash = "d".repeat(64);
    const figmaHandle = `visual:vd-figma:${figmaHash.slice(0, 16)}`;
    const figmaSelectionReceipt = await emitVisualSelection(
      "task-receipt-ledger",
      figmaHandle,
      figmaHash,
      visualExpiresAt,
    );
    const taskVisualHash = "b".repeat(64);
    const taskVisualHandle = `visual:vd-task:${taskVisualHash.slice(0, 16)}`;
    const taskVisualSelectionReceipt = await emitVisualSelection(
      "task-receipt-ledger",
      taskVisualHandle,
      taskVisualHash,
      visualExpiresAt,
    );

    await withCoreClient(async (client) => {
      const rejected = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: "task-receipt-ledger",
          action: "attach-evidence",
          receipt_ids: [taskReceiptId],
          visual_contract: {
            handle: foreignHandle,
            hash: foreignHash,
            selection_receipt: foreignSelectionReceipt,
            authority: "existing-system",
            summary: "Comparison from the existing system.",
            receipt_ids: [foreignReceiptId],
            expires_at: visualExpiresAt,
          },
        },
      });
      expect(rejected.isError).toBe(true);
      await expect(
        loadVisualEvidenceContract(root, foreignHandle),
      ).rejects.toThrow();

      const wrongProvider = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: "task-receipt-ledger",
          action: "attach-evidence",
          visual_contract: {
            handle: wrongProviderHandle,
            hash: wrongProviderHash,
            selection_receipt: wrongProviderSelectionReceipt,
            authority: "exact-figma",
            summary: "A GitHub receipt must not authorize exact Figma evidence.",
            figma: { file_key: "figma-file", node_id: "12:34" },
            receipt_ids: [taskReceiptId],
            expires_at: visualExpiresAt,
          },
        },
      });
      expect(wrongProvider.isError).toBe(true);
      await expect(
        loadVisualEvidenceContract(
          root,
          wrongProviderHandle,
        ),
      ).rejects.toThrow();

      const exactFigma = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: "task-receipt-ledger",
          action: "attach-evidence",
          visual_contract: {
            handle: figmaHandle,
            hash: figmaHash,
            selection_receipt: figmaSelectionReceipt,
            authority: "exact-figma",
            summary: "Exact node evidence from the confirmed Figma source.",
            figma: { file_key: "FigmaLedger", node_id: "12:34" },
            receipt_ids: [figmaReceiptId],
            expires_at: visualExpiresAt,
          },
        },
      });
      expect(exactFigma.isError).not.toBe(true);
      await expect(
        loadVisualEvidenceContract(root, figmaHandle),
      ).resolves.toMatchObject({
        authority: "exact-figma",
        sourceReceiptIds: [figmaReceiptId],
        figma: { fileKey: "FigmaLedger", nodeId: "12:34" },
      });

      const accepted = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: "task-receipt-ledger",
          action: "attach-evidence",
          visual_contract: {
            handle: taskVisualHandle,
            hash: taskVisualHash,
            selection_receipt: taskVisualSelectionReceipt,
            authority: "existing-system",
            summary: "Comparison bound to the confirmed task source.",
            receipt_ids: [taskReceiptId],
            expires_at: visualExpiresAt,
          },
        },
      });
      expect(accepted.isError).not.toBe(true);
      expect(
        (accepted.structuredContent as { handles: string[] }).handles[0],
      ).toBe(taskVisualHandle);
      await expect(
        loadVisualEvidenceContract(root, taskVisualHandle),
      ).resolves.toMatchObject({ sourceReceiptIds: [taskReceiptId] });

      const manySources = Array.from({ length: 21 }, (_, index) => ({
        reference: "https://github.com/example/project/issues/200",
        kind: "github" as const,
        state: "confirmed" as const,
        primary_adapter: "github-connector",
        fallback: "deny" as const,
        evidence: {
          adapter: "github-connector" as const,
          route: "github-app",
          operation: "read_issue",
          observed_at: new Date(
            Date.parse("2026-07-31T10:00:00.000Z") + index * 1_000,
          ).toISOString(),
          freshness: "current" as const,
        },
      }));
      const manyDecisions = normalizedSources(
        "Attach one of many confirmed receipts",
        [],
        [manySources[0]!],
      );
      const manyReceiptIds = await bindSourceEvidence(
        root,
        manyDecisions,
        manySources,
        [],
      );
      await writeTaskCheckpoint(root, {
        taskId: "task-many-receipts",
        milestone: "source-resolved",
        objective: "Attach one of many confirmed receipts",
        objectiveApproved: true,
        decisions: manyDecisions,
        sourceReceiptIds: manyReceiptIds,
        handles: [],
        covered: ["source gate"],
        remaining: ["implementation"],
        budgetChars: 1_600,
        nextSafeAction: "Attach the selected receipt.",
      });
      const attachedFromFullLedger = await client.callTool({
        name: "atlas_task_state",
        arguments: {
          root_path: root,
          task_id: "task-many-receipts",
          action: "attach-evidence",
          receipt_ids: [manyReceiptIds[20]],
        },
      });
      expect(
        attachedFromFullLedger.isError,
        JSON.stringify(
          attachedFromFullLedger.structuredContent ??
            attachedFromFullLedger.content,
        ),
      ).not.toBe(true);
      expect(
        (
          attachedFromFullLedger.structuredContent as {
            sourceReceiptIds: string[];
          }
        ).sourceReceiptIds[0],
      ).toBe(manyReceiptIds[20]);
    });
  });

  it("binds consent to the exact payload and reconciles interrupted memory mutations idempotently", async () => {
    const root = await createGitRoot(true);
    await scanProject(root, { writeArtifacts: false });
    await writeTaskCheckpoint(root, {
      taskId: "task-memory-consent",
      status: "completed",
      milestone: "completed",
      lifecyclePhase: "completed",
      objective: "Verify the frontend confirmation workflow",
      objectiveApproved: true,
      decisions: [],
      sourceReceiptIds: [],
      handles: [],
      covered: ["delivery completed"],
      remaining: [],
      budgetChars: 1_600,
      nextSafeAction: "Ask before writing memory.",
    });

    await withCoreClient(async (client) => {
      const episodicArguments = {
        root_path: root,
        task_id: "task-memory-consent",
        action: "record-episodic",
        result: "success",
        summary: "The bounded confirmation workflow passed its checks.",
        evidence: ["targeted lifecycle test passed"],
      } as const;
      const fabricatedArguments = {
        ...episodicArguments,
        summary: "A fabricated token must not bypass issuance.",
      } as const;
      const fabricatedPayload = {
        action: fabricatedArguments.action,
        taskId: fabricatedArguments.task_id,
        task: "Verify the frontend confirmation workflow",
        result: fabricatedArguments.result,
        summary: fabricatedArguments.summary,
        evidence: fabricatedArguments.evidence,
        files: [],
        relatedEntityIds: [],
      };
      const fabricated = await client.callTool({
        name: "atlas_memory",
        arguments: {
          ...fabricatedArguments,
          consent: `${fabricatedArguments.action}:${createHash("sha256")
            .update(JSON.stringify(fabricatedPayload))
            .digest("hex")}`,
        },
      });
      expect(fabricated.isError).toBe(true);
      const preview = await client.callTool({
        name: "atlas_memory",
        arguments: episodicArguments,
      });
      expect(preview.structuredContent).toMatchObject({
        status: "needs-consent",
        action: "record-episodic",
        memoryWritten: false,
        consentToken: expect.stringMatching(/^record-episodic:[a-f0-9]{64}$/u),
        consentReceipt: {
          id: expect.stringMatching(
            /^consent:task-memory-consent:[a-f0-9]{16}$/u,
          ),
          status: "issued",
          payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
        scope: {
          task: "Verify the frontend confirmation workflow",
          result: "success",
          summary: "The bounded confirmation workflow passed its checks.",
          evidence: ["targeted lifecycle test passed"],
          files: [],
          relatedEntityIds: [],
          target: "episodic",
        },
      });
      const previewContent = preview.structuredContent as {
        consentToken: string;
        consentReceipt: { payloadHash: string };
      };
      const repeatedPreview = await client.callTool({
        name: "atlas_memory",
        arguments: episodicArguments,
      });
      expect(repeatedPreview.structuredContent).toMatchObject({
        consentReceipt: (
          preview.structuredContent as { consentReceipt: Record<string, unknown> }
        ).consentReceipt,
      });
      await expect(
        loadMemoryConsentState(
          root,
          "task-memory-consent",
          "record-episodic",
          previewContent.consentReceipt.payloadHash,
        ),
      ).resolves.toMatchObject({
        issued: { status: "issued" },
      });
      await beginMemoryConsentExecution(root, {
        taskId: "task-memory-consent",
        action: "record-episodic",
        payloadHash: previewContent.consentReceipt.payloadHash,
      });
      const interruptedOutcome = await recordProjectOutcome({
        rootPath: root,
        taskId: "task-memory-consent",
        task: "Verify the frontend confirmation workflow",
        result: episodicArguments.result,
        summary: episodicArguments.summary,
        evidence: [...episodicArguments.evidence],
        relatedEntityIds: [],
        budgetChars: 1_600,
        idempotencyKey: previewContent.consentReceipt.payloadHash,
      });
      const interruptedConsent = await loadMemoryConsentState(
        root,
        "task-memory-consent",
        "record-episodic",
        previewContent.consentReceipt.payloadHash,
      );
      expect(interruptedConsent).toMatchObject({
        executing: { status: "executing" },
      });
      expect(interruptedConsent).not.toHaveProperty("committed");
      expect(interruptedConsent).not.toHaveProperty("consumed");
      const recorded = await client.callTool({
        name: "atlas_memory",
        arguments: {
          ...episodicArguments,
          consent: previewContent.consentToken,
        },
      });
      expect(recorded.structuredContent).toMatchObject({
        outcome: expect.objectContaining({
          id: (interruptedOutcome as { outcome: { id: string } }).outcome.id,
          result: "success",
        }),
        consentReceipt: {
          id: (
            preview.structuredContent as {
              consentReceipt: { id: string };
            }
          ).consentReceipt.id,
          status: "consumed",
        },
      });
      await expect(
        loadMemoryConsentState(
          root,
          "task-memory-consent",
          "record-episodic",
          previewContent.consentReceipt.payloadHash,
        ),
      ).resolves.toMatchObject({
        issued: { status: "issued" },
        executing: { status: "executing" },
        committed: { status: "committed" },
        consumed: { status: "consumed" },
      });
      const repeatedRecord = await client.callTool({
        name: "atlas_memory",
        arguments: {
          ...episodicArguments,
          consent: previewContent.consentToken,
        },
      });
      expect(repeatedRecord.structuredContent).toMatchObject({
        status: "already-consumed",
        action: "record-episodic",
        memoryWritten: true,
        consentReceipt: { status: "consumed" },
      });

      const proposalArguments = {
        root_path: root,
        task_id: "task-memory-consent",
        action: "propose-canonical",
        rationale: "Keep the verified frontend workflow convention.",
        evidence: ["targeted lifecycle test passed"],
        items: [
          {
            type: "convention",
            title: "Lifecycle consent test convention",
            summary: "Preview the exact scoped consent token before memory mutation.",
            body: "The reviewed proposal must expose this full body before approval.",
            confidence: 0.95,
            authority: "verified",
            tags: ["consent", "frontend"],
            supersedes: ["memory:legacy-confirmation-convention"],
            relations: [
              {
                kind: "references_code",
                target_id: "component:confirmation-dialog",
              },
            ],
          },
        ],
      } as const;
      const proposalPreview = await client.callTool({
        name: "atlas_memory",
        arguments: proposalArguments,
      });
      const proposalPreviewContent = proposalPreview.structuredContent as {
        consentToken: string;
      };
      expect(proposalPreviewContent.consentToken).toMatch(
        /^propose-canonical:[a-f0-9]{64}$/u,
      );
      expect(proposalPreview.structuredContent).toMatchObject({
        scope: {
          evidence: ["targeted lifecycle test passed"],
          items: [
            expect.objectContaining({
              body: "The reviewed proposal must expose this full body before approval.",
              supersedes: ["memory:legacy-confirmation-convention"],
              relations: [
                expect.objectContaining({
                  kind: "references_code",
                  targetId: "component:confirmation-dialog",
                }),
              ],
            }),
          ],
        },
      });
      const proposalPayloadHash = proposalPreviewContent.consentToken.slice(
        "propose-canonical:".length,
      );
      await beginMemoryConsentExecution(root, {
        taskId: "task-memory-consent",
        action: "propose-canonical",
        payloadHash: proposalPayloadHash,
      });
      const interruptedProposal = await proposeMemoryUpdate({
        rootPath: root,
        rationale: proposalArguments.rationale,
        evidence: [...proposalArguments.evidence],
        proposedBy: "task-memory-consent",
        idempotencyKey: proposalPayloadHash,
        items: [
          {
            type: "convention",
            title: "Lifecycle consent test convention",
            summary:
              "Preview the exact scoped consent token before memory mutation.",
            body: "The reviewed proposal must expose this full body before approval.",
            confidence: 0.95,
            authority: "verified",
            scope: "canonical",
            tags: ["consent", "frontend"],
            supersedes: ["memory:legacy-confirmation-convention"],
            relations: [
              {
                kind: "references_code",
                targetId: "component:confirmation-dialog",
              },
            ],
          },
        ],
        budgetChars: 1_600,
      });
      await commitMemoryConsentExecution(root, {
        taskId: "task-memory-consent",
        action: "propose-canonical",
        payloadHash: proposalPayloadHash,
        result: interruptedProposal as unknown as Record<string, unknown>,
      });
      const proposed = await client.callTool({
        name: "atlas_memory",
        arguments: {
          ...proposalArguments,
          consent: proposalPreviewContent.consentToken,
        },
      });
      const proposalId = (
        proposed.structuredContent as { proposal: { id: string } }
      ).proposal.id;
      expect(proposed.structuredContent).toMatchObject({
        status: "already-consumed",
        proposal: (
          interruptedProposal as unknown as { proposal: Record<string, unknown> }
        ).proposal,
        consentReceipt: { status: "consumed" },
      });
      const retriedProposal = await client.callTool({
        name: "atlas_memory",
        arguments: {
          ...proposalArguments,
          consent: proposalPreviewContent.consentToken,
        },
      });
      expect(retriedProposal.structuredContent).toMatchObject({
        status: "already-consumed",
        action: "propose-canonical",
        memoryWritten: true,
        consentReceipt: { status: "consumed" },
      });

      await pruneExpiredTaskState(
        root,
        new Date(Date.now() + 8 * 24 * 60 * 60 * 1_000),
      );
      await expect(
        loadMemoryConsentState(
          root,
          "task-memory-consent",
          "record-episodic",
          previewContent.consentReceipt.payloadHash,
        ),
      ).resolves.toMatchObject({
        issued: { status: "issued" },
        consumed: { status: "consumed" },
      });
      const reviewed = await client.callTool({
        name: "atlas_memory",
        arguments: {
          root_path: root,
          task_id: "task-memory-consent",
          action: "review-proposal",
          proposal_id: proposalId,
        },
      });
      expect(reviewed.structuredContent).toMatchObject({
        proposalId,
        proposalHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        proposedBy: "task-memory-consent",
        rationale: proposalArguments.rationale,
        target: "canonical",
        impact: {
          items: [
            expect.objectContaining({
              title: "Lifecycle consent test convention",
              summary:
                "Preview the exact scoped consent token before memory mutation.",
              body: "The reviewed proposal must expose this full body before approval.",
              confidence: 0.95,
              authority: "verified",
              tags: ["consent", "frontend"],
              supersedes: ["memory:legacy-confirmation-convention"],
              relations: [
                expect.objectContaining({
                  kind: "references_code",
                  targetId: "component:confirmation-dialog",
                }),
              ],
            }),
          ],
        },
      });
      const crossTaskApply = await client.callTool({
        name: "atlas_memory",
        arguments: {
          root_path: root,
          task_id: "another-task",
          action: "apply-canonical",
          proposal_id: proposalId,
        },
      });
      expect(crossTaskApply.isError).toBe(true);
      const applyPreview = await client.callTool({
        name: "atlas_memory",
        arguments: {
          root_path: root,
          task_id: "task-memory-consent",
          action: "apply-canonical",
          proposal_id: proposalId,
        },
      });
      expect(applyPreview.structuredContent).toMatchObject({
        status: "needs-consent",
        consentToken: expect.stringMatching(/^apply-canonical:[a-f0-9]{64}$/u),
        memoryWritten: false,
      });
      const rejectionPreview = await client.callTool({
        name: "atlas_memory",
        arguments: {
          root_path: root,
          task_id: "task-memory-consent",
          action: "reject-proposal",
          proposal_id: proposalId,
          rejection_reason: "The convention needs narrower wording.",
        },
      });
      const rejectionPreviewContent = rejectionPreview.structuredContent as {
        consentToken: string;
      };
      const changedRejection = await client.callTool({
        name: "atlas_memory",
        arguments: {
          root_path: root,
          task_id: "task-memory-consent",
          action: "reject-proposal",
          proposal_id: proposalId,
          rejection_reason: "The evidence is not yet durable enough.",
          consent: rejectionPreviewContent.consentToken,
        },
      });
      expect(changedRejection.structuredContent).toMatchObject({
        status: "needs-consent",
        consentToken: expect.stringMatching(/^reject-proposal:[a-f0-9]{64}$/u),
        memoryWritten: false,
      });
      expect(
        (changedRejection.structuredContent as { consentToken: string })
          .consentToken,
      ).not.toBe(rejectionPreviewContent.consentToken);
      const applyConsentToken = (
        applyPreview.structuredContent as { consentToken: string }
      ).consentToken;
      const applyPayloadHash = applyConsentToken.slice(
        "apply-canonical:".length,
      );
      await beginMemoryConsentExecution(root, {
        taskId: "task-memory-consent",
        action: "apply-canonical",
        payloadHash: applyPayloadHash,
      });
      const interruptedApplication = await applyMemoryUpdate(root, proposalId, {
        confirmed: true,
        target: "canonical",
        canonicalConfirmed: true,
        budgetChars: 1_600,
        idempotencyKey: applyPayloadHash,
      });
      const applied = await client.callTool({
        name: "atlas_memory",
        arguments: {
          root_path: root,
          task_id: "task-memory-consent",
          action: "apply-canonical",
          proposal_id: proposalId,
          consent: applyConsentToken,
        },
      });
      expect(applied.isError).not.toBe(true);
      expect(applied.structuredContent).toMatchObject({
        proposalId,
        status: "applied",
        applied: (interruptedApplication as { applied: unknown[] }).applied,
        consentReceipt: { status: "consumed" },
      });
      const reviewedAfterApply = await client.callTool({
        name: "atlas_memory",
        arguments: {
          root_path: root,
          task_id: "task-memory-consent",
          action: "review-proposal",
          proposal_id: proposalId,
        },
      });
      expect(reviewedAfterApply.structuredContent).toMatchObject({
        proposalStatus: "applied",
        impact: {
          items: [
            expect.objectContaining({
              supersedes: ["memory:legacy-confirmation-convention"],
            }),
          ],
        },
      });
    });
  });
});
