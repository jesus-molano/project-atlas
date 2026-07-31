import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAtlasHandoff as buildRawAtlasHandoff } from "../skills/visual-direction/scripts/build-atlas-handoff.mjs";
import { resolveAuthority } from "../skills/visual-direction/scripts/resolve-authority.mjs";
import {
  CleanupPendingError,
  CorruptManifestError,
  cleanupSession,
  createSession,
  readSelectedContract,
  recordArtifact,
  retryCleanup,
  retrySelectionCleanup,
  selectDirection,
  sweepExpired,
  writeJsonAtomic,
} from "../skills/visual-direction/scripts/temporary-artifacts.mjs";

interface AuthorityFixture {
  id: string;
  input: Record<string, unknown>;
  expected: {
    mode?: string;
    inventionBudget?: number;
    explorationRequired?: boolean;
    previewCount?: number;
    visualAuthority?: string;
    acceptedReferences?: string[];
    rejectedReferences?: string[];
    atlasCandidateCanReplaceExactFigma?: boolean;
    redesignRequiresExplicitRequest?: boolean;
    figmaWrite?: string;
    productionImplementationCount?: number;
    previewWorktrees?: number;
    implementationWorktrees?: number;
    artifacts?: string;
  };
}

function futureVisualExpiry(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
}

const SYNTHETIC_SELECTION_RECEIPT =
  "selection-receipt:v1:0123456789abcdef:vd-handoff:0123456789abcdef:m1234567:abcdef0123456789";
const SYNTHETIC_PRELIMINARY_REVIEW =
  "visual-review:task-handoff:0123456789abcdef";
const V3_SOURCE_RECEIPT = `receipt-${"a".repeat(64)}`;

function syntheticCaptureReceipt(hash: string): string {
  return `capture-receipt:v1:0123456789abcdef:vd-handoff:${hash.slice(
    0,
    16,
  )}:abcdef0123456789`;
}

function buildAtlasHandoff(input: Record<string, unknown>) {
  return buildRawAtlasHandoff({
    rootPath: path.resolve("C:/project-atlas-handoff"),
    taskId: "task-handoff",
    ...input,
  });
}

async function exists(target: string) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(target)));
    } else {
      files.push(target);
    }
  }
  return files;
}

describe("visual-direction authority fixtures", () => {
  it("enforces source authority, modes, option counts, and invention budgets", async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL("../fixtures/visual-direction/cases.json", import.meta.url),
        "utf8",
      ),
    ) as { cases: AuthorityFixture[] };

    for (const item of fixture.cases) {
      const decision = resolveAuthority(item.input);
      expect(decision, item.id).toMatchObject({
        ...(item.expected.mode ? { mode: item.expected.mode } : {}),
        ...(item.expected.inventionBudget !== undefined
          ? { inventionBudget: item.expected.inventionBudget }
          : {}),
        ...(item.expected.explorationRequired !== undefined
          ? { explorationRequired: item.expected.explorationRequired }
          : {}),
        ...(item.expected.previewCount !== undefined
          ? { previewCount: item.expected.previewCount }
          : {}),
        ...(item.expected.visualAuthority
          ? { authority: { visual: item.expected.visualAuthority } }
          : {}),
        ...(item.expected.acceptedReferences
          ? {
              referencePolicy: {
                accepted: item.expected.acceptedReferences,
              },
            }
          : {}),
        ...(item.expected.rejectedReferences
          ? {
              referencePolicy: {
                rejected: item.expected.rejectedReferences,
              },
            }
          : {}),
        ...(item.expected.atlasCandidateCanReplaceExactFigma !== undefined
          ? {
              atlasCandidateCanReplaceExactFigma:
                item.expected.atlasCandidateCanReplaceExactFigma,
            }
          : {}),
        ...(item.expected.redesignRequiresExplicitRequest !== undefined
          ? {
              redesignRequiresExplicitRequest:
                item.expected.redesignRequiresExplicitRequest,
            }
          : {}),
        ...(item.expected.figmaWrite
          ? { figmaWrite: item.expected.figmaWrite }
          : {}),
        ...(item.expected.productionImplementationCount !== undefined
          ? {
              productionImplementationCount:
                item.expected.productionImplementationCount,
            }
          : {}),
        ...(item.expected.previewWorktrees !== undefined
          ? { previewWorktrees: item.expected.previewWorktrees }
          : {}),
        ...(item.expected.implementationWorktrees !== undefined
          ? { implementationWorktrees: item.expected.implementationWorktrees }
          : {}),
        ...(item.expected.artifacts
          ? { artifacts: item.expected.artifacts }
          : {}),
      });
    }
  });

  it("requires a complete exact Figma identity", () => {
    expect(() =>
      resolveAuthority({
        scope: "component",
        hasExistingProject: true,
        hasExactFigma: true,
        exactFigma: { fileKey: "file", nodeId: "1:2" },
      }),
    ).toThrow(/exactFigma\.url/);
  });
});

describe("visual-direction temporary artifact lifecycle", () => {
  it("keeps the previous manifest when an atomic write is interrupted", async () => {
    const testRoot = await mkdtemp(
      path.join(os.tmpdir(), "visual-direction-atomic-"),
    );
    const ownedRoot = path.join(testRoot, "owned");
    try {
      const session = await createSession({
        taskId: "task-atomic",
        root: ownedRoot,
      });
      const manifestFile = path.join(
        session.sessionPath,
        ".visual-direction-session.json",
      );
      const previous = await readFile(manifestFile, "utf8");
      const next = { ...JSON.parse(previous), state: "selected" };

      await expect(
        writeJsonAtomic(manifestFile, next, {
          faultInjector: ({ stage }: { stage: string }) => {
            expect(stage).toBe("after-sync-before-rename");
            throw new Error("simulated interruption");
          },
        }),
      ).rejects.toThrow(/simulated interruption/);

      expect(await readFile(manifestFile, "utf8")).toBe(previous);
      expect(await readdir(session.sessionPath)).toEqual([
        ".visual-direction-session.json",
      ]);
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  });

  it("preserves a corrupt session during sweep and returns recovery guidance", async () => {
    const testRoot = await mkdtemp(
      path.join(os.tmpdir(), "visual-direction-corrupt-"),
    );
    const ownedRoot = path.join(testRoot, "owned");
    try {
      const session = await createSession({
        taskId: "task-corrupt",
        root: ownedRoot,
        ttlMs: 1,
        now: 0,
      });
      await writeFile(
        path.join(session.sessionPath, ".visual-direction-session.json"),
        "{\"owner\":",
        "utf8",
      );
      let removeCalls = 0;
      const swept = await sweepExpired({
        root: ownedRoot,
        now: 2,
        remove: async () => {
          removeCalls += 1;
        },
      });

      expect(removeCalls).toBe(0);
      expect(swept.cleaned).toEqual([]);
      expect(swept.ignored).toContain(session.sessionId);
      expect(swept.diagnostics).toEqual([
        expect.objectContaining({
          state: "manual-review-required",
          code: "MANIFEST_JSON_INVALID",
          sessionId: session.sessionId,
          preserved: true,
          recovery: expect.stringMatching(/restore|inspect/i),
        }),
      ]);
      expect(await exists(session.sessionPath)).toBe(true);

      const artifact = path.join(session.sessionPath, "capture.png");
      await writeFile(artifact, "capture", "utf8");
      await expect(
        recordArtifact({
          sessionPath: session.sessionPath,
          artifactPath: artifact,
          kind: "review-capture",
          root: ownedRoot,
        }),
      ).rejects.toBeInstanceOf(CorruptManifestError);
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  });

  it("purges unselected options, keeps one choice through review, and closes cleanly", async () => {
    const testRoot = await mkdtemp(
      path.join(os.tmpdir(), "visual-direction-selection-"),
    );
    const ownedRoot = path.join(testRoot, "owned");
    try {
      const session = await createSession({
        taskId: "task-selection",
        root: ownedRoot,
      });
      const firstPath = path.join(session.sessionPath, "first.png");
      const secondPath = path.join(session.sessionPath, "second.png");
      const sheetPath = path.join(session.sessionPath, "comparison.png");
      await Promise.all([
        writeFile(firstPath, "first"),
        writeFile(secondPath, "second"),
        writeFile(sheetPath, "sheet"),
      ]);
      await recordArtifact({
        sessionPath: session.sessionPath,
        artifactPath: firstPath,
        kind: "mockup",
        root: ownedRoot,
      });
      const selected = await recordArtifact({
        sessionPath: session.sessionPath,
        artifactPath: secondPath,
        kind: "mockup",
        root: ownedRoot,
      });
      await recordArtifact({
        sessionPath: session.sessionPath,
        artifactPath: sheetPath,
        kind: "contact-sheet",
        root: ownedRoot,
      });

      const receipt = await selectDirection({
        sessionPath: session.sessionPath,
        direction: {
          version: 1,
          mode: "inherit",
          locked_direction: { base: "direction-b" },
        },
        selectedArtifactHandle: selected.handle,
        root: ownedRoot,
      });

      expect(receipt).toMatchObject({
        state: "selected",
        contractHandle: expect.stringMatching(/^visual:vd-[^:]+:[a-f0-9]{16}$/),
        selectedHandle: selected.handle,
        selectedHash: selected.hash,
        selectionReceipt: expect.stringMatching(
          /^selection-receipt:v1:[a-f0-9]{16}:vd-[A-Za-z0-9_-]+:[a-f0-9]{16}:[a-z0-9]+:[a-f0-9]{16}$/u,
        ),
        lifecycle: "selected-until-review-close",
      });
      expect(receipt).not.toHaveProperty("sessionPath");
      expect(await exists(firstPath)).toBe(false);
      expect(await exists(sheetPath)).toBe(false);
      expect(await exists(secondPath)).toBe(true);
      const expanded = await readSelectedContract({
        contractHandle: receipt.contractHandle,
        root: ownedRoot,
      });
      expect(expanded).toMatchObject({
        contractHandle: receipt.contractHandle,
        directionHash: receipt.directionHash,
        contract: {
          version: 1,
          mode: "inherit",
          locked_direction: { base: "direction-b" },
        },
      });

      const reviewPath = path.join(session.sessionPath, "review-narrow.png");
      await writeFile(reviewPath, "review");
      const recordedReview = await recordArtifact({
        sessionPath: session.sessionPath,
        artifactPath: reviewPath,
        kind: "review-capture",
        root: ownedRoot,
      });
      expect(recordedReview.receipt).toMatch(
        /^capture-receipt:v1:[a-f0-9]{16}:vd-[A-Za-z0-9_-]+:[a-f0-9]{16}:[a-f0-9]{16}$/u,
      );

      const cleanup = await cleanupSession({
        sessionPath: session.sessionPath,
        root: ownedRoot,
        reason: "close",
      });
      expect(cleanup).toMatchObject({
        state: "clean",
        reason: "close",
        receipt: expect.stringMatching(
          /^cleanup:v1:[a-f0-9]{16}:vd-[A-Za-z0-9_-]+:close:[a-z0-9]+:[a-f0-9]{16}$/u,
        ),
      });
      expect(await exists(session.sessionPath)).toBe(false);
      expect(await readdir(ownedRoot)).toEqual([]);
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  });

  it("recovers a failed selection purge before implementation", async () => {
    const testRoot = await mkdtemp(
      path.join(os.tmpdir(), "visual-direction-select-retry-"),
    );
    const ownedRoot = path.join(testRoot, "owned");
    try {
      const session = await createSession({
        taskId: "task-select-retry",
        root: ownedRoot,
      });
      const firstPath = path.join(session.sessionPath, "first.html");
      const secondPath = path.join(session.sessionPath, "second.html");
      await Promise.all([
        writeFile(firstPath, "<p>first</p>"),
        writeFile(secondPath, "<p>second</p>"),
      ]);
      await recordArtifact({
        sessionPath: session.sessionPath,
        artifactPath: firstPath,
        kind: "mockup",
        root: ownedRoot,
      });
      const selected = await recordArtifact({
        sessionPath: session.sessionPath,
        artifactPath: secondPath,
        kind: "mockup",
        root: ownedRoot,
      });

      const lockedError = Object.assign(new Error("locked"), { code: "EBUSY" });
      await expect(
        selectDirection({
          sessionPath: session.sessionPath,
          direction: { version: 1, locked_direction: { base: "second" } },
          selectedArtifactHandle: selected.handle,
          root: ownedRoot,
          remove: async () => {
            throw lockedError;
          },
        }),
      ).rejects.toBeInstanceOf(CleanupPendingError);

      const recovered = await retrySelectionCleanup({
        sessionPath: session.sessionPath,
        root: ownedRoot,
      });
      expect(recovered).toMatchObject({
        state: "selected",
        contractHandle: expect.stringMatching(/^visual:vd-[^:]+:[a-f0-9]{16}$/),
        selectedHandle: selected.handle,
      });
      expect(await exists(firstPath)).toBe(false);
      expect(await exists(secondPath)).toBe(true);
      await cleanupSession({
        sessionPath: session.sessionPath,
        root: ownedRoot,
      });
      expect(await readdir(ownedRoot)).toEqual([]);
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  });

  it("leaves a bounded cleanup receipt on failure and removes it on retry", async () => {
    const testRoot = await mkdtemp(
      path.join(os.tmpdir(), "visual-direction-close-retry-"),
    );
    const ownedRoot = path.join(testRoot, "owned");
    try {
      const session = await createSession({
        taskId: "task-close-retry",
        root: ownedRoot,
      });
      const lockedError = Object.assign(new Error("locked"), { code: "EBUSY" });
      await expect(
        cleanupSession({
          sessionPath: session.sessionPath,
          root: ownedRoot,
          reason: "cancel",
          remove: async () => {
            throw lockedError;
          },
        }),
      ).rejects.toBeInstanceOf(CleanupPendingError);

      const entriesAfterFailure = await readdir(ownedRoot);
      expect(entriesAfterFailure).toContain(session.sessionId);
      expect(entriesAfterFailure).toContain(
        `.cleanup-${session.sessionId}.json`,
      );

      const recovered = await retryCleanup({
        sessionId: session.sessionId,
        root: ownedRoot,
      });
      expect(recovered).toMatchObject({
        state: "clean",
        sessionId: session.sessionId,
        reason: "cancel",
        attempts: 2,
      });
      expect(await readdir(ownedRoot)).toEqual([]);
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  });

  it("expires selected handles without residue and rejects artifact roots inside Git", async () => {
    const testRoot = await mkdtemp(
      path.join(os.tmpdir(), "visual-direction-ttl-"),
    );
    const ownedRoot = path.join(testRoot, "owned");
    const start = Date.UTC(2026, 6, 29, 10, 0, 0);
    try {
      const session = await createSession({
        taskId: "task-ttl",
        root: ownedRoot,
        ttlMs: 1_000,
        now: start,
      });
      const selection = await selectDirection({
        sessionPath: session.sessionPath,
        direction: {
          version: 1,
          mode: "explore",
          locked_direction: { base: "direction-a" },
        },
        root: ownedRoot,
      });
      await expect(
        readSelectedContract({
          contractHandle: selection.contractHandle,
          root: ownedRoot,
        }),
      ).resolves.toMatchObject({
        contractHandle: selection.contractHandle,
        directionHash: selection.directionHash,
      });
      const swept = await sweepExpired({
        root: ownedRoot,
        now: Date.parse(selection.expiresAt) + 1,
      });
      expect(swept.cleaned).toContain(session.sessionId);
      expect(await readdir(ownedRoot)).toEqual([]);
      await expect(
        readSelectedContract({
          contractHandle: selection.contractHandle,
          root: ownedRoot,
        }),
      ).rejects.toThrow();

      const forbiddenRoot = path.join(
        process.cwd(),
        ".visual-direction-should-never-exist",
      );
      await expect(
        createSession({
          taskId: "forbidden",
          root: forbiddenRoot,
        }),
      ).rejects.toThrow(/outside a Git worktree/);
      expect(await exists(forbiddenRoot)).toBe(false);
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  });
});

describe("visual-direction Atlas handoff", () => {
  it("rejects locked fidelity without a persisted selected contract", () => {
    const authorityDecision = resolveAuthority({
      scope: "component",
      hasExistingProject: true,
      hasExactFigma: true,
      exactFigma: {
        fileKey: "ExactFile",
        nodeId: "42:7",
        url: "https://www.figma.com/design/ExactFile/Product?node-id=42-7",
      },
    });
    expect(() =>
      buildAtlasHandoff({
        authorityDecision,
        workflowState: "locked",
        cleanup: { state: "not-applicable" },
      }),
    ).toThrow(/including fidelity mode/i);
  });

  it("preserves exact Figma identity and exposes no alternatives or payloads", () => {
    const authorityDecision = resolveAuthority({
      scope: "component",
      hasExistingProject: true,
      hasExactFigma: true,
      exactFigma: {
        fileKey: "ExactFile",
        nodeId: "42:7",
        url: "https://www.figma.com/design/ExactFile/Product?node-id=42-7",
      },
    });
    const handoff = buildAtlasHandoff({
      authorityDecision,
      workflowState: "locked",
      selectedContract: {
        contractHandle: "visual:vd-exact:0123456789abcdef",
        contractHash:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        expiresAt: futureVisualExpiry(),
        selectionReceipt: SYNTHETIC_SELECTION_RECEIPT,
      },
      cleanup: { state: "not-applicable" },
      sourceReceiptIds: [V3_SOURCE_RECEIPT],
      atlasHandles: ["design:figma:ExactFile:42:7"],
      previewPayload: "data:image/png;base64,SHOULD_NOT_CROSS",
      temporaryPath: "C:\\Temp\\visual-direction\\preview.png",
    });

    expect(handoff).toMatchObject({
      surface: {
        owner: "native-codex",
        atlasProfile: "core-six-tool",
        inspector: "progressive-disclosure",
      },
      status: "locked",
      readyForImplementation: true,
      authority: {
        mode: "fidelity",
        inventionBudget: 0,
        visual: "exact-figma",
        exactFigmaIdentity: authorityDecision.exactFigmaIdentity,
      },
      provenance: {
        sourceReceiptIds: [V3_SOURCE_RECEIPT],
        receiptsExpanded: false,
      },
      coreProjection: {
        taskState: {
          action: "attach-evidence",
          receipt_ids: [V3_SOURCE_RECEIPT],
        },
      },
    });
    expect(handoff).not.toHaveProperty("directionCards");
    expect(JSON.stringify(handoff)).not.toMatch(
      /SHOULD_NOT_CROSS|data:image|preview\.png|temporaryPath/i,
    );
  });

  it("shows bounded cards only for pending selection", () => {
    const authorityDecision = resolveAuthority({
      scope: "section",
      hasExistingProject: true,
      materialVisualChoice: true,
    });
    const handoff = buildAtlasHandoff({
      authorityDecision,
      workflowState: "needs-selection",
      directionCards: [
        {
          id: "direction-a",
          name: "Quiet hierarchy",
          premise: "Keep density and emphasize one incumbent heading tier.",
          artifact_handle: "visual-artifact:must-not-cross",
        },
        {
          id: "direction-b",
          name: "Grouped rhythm",
          premise: "Keep tokens and compare one grouped composition.",
          artifact_handle: "visual-artifact:must-not-cross",
        },
      ],
      cleanup: { state: "ephemeral-active" },
      sourceReceiptIds: [],
      atlasHandles: ["code:incumbent-section"],
    });

    expect(handoff).toMatchObject({
      status: "needs-selection",
      readyForImplementation: false,
      directionCards: [
        { id: "direction-a", name: "Quiet hierarchy" },
        { id: "direction-b", name: "Grouped rhythm" },
      ],
      nextSafeAction: "select-or-combine-direction",
    });
    expect(JSON.stringify(handoff)).not.toContain("artifact_handle");
    expect(Buffer.byteLength(JSON.stringify(handoff), "utf8")).toBeLessThanOrEqual(
      3_072,
    );
  });

  it("projects one visual handle into the existing capsule without receipt bodies", () => {
    const expiresAt = futureVisualExpiry();
    const authorityDecision = resolveAuthority({
      scope: "greenfield",
      hasExistingProject: false,
      visualDecision: "selected-direction",
    });
    const handoff = buildAtlasHandoff({
      authorityDecision,
      workflowState: "locked",
      selectedContract: {
        contractHandle: "visual:vd-task-42:0123456789abcdef",
        contractHash:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        expiresAt,
        selectionReceipt: SYNTHETIC_SELECTION_RECEIPT,
        selectedDirectionId: "pricing-quiet-hierarchy",
        contract: { should: "remain behind the handle" },
      },
      stateMatrix: {
        surface: "Pricing comparison",
        viewports: ["desktop", "narrow"],
        requiredStates: ["default", "focus-visible", "overflow"],
      },
      cleanup: { state: "selected-retained" },
      sourceReceiptIds: ["receipt-fedcba9876543210"],
      atlasHandles: ["code:pricing-shell", "memory:accessibility-rule"],
      sourceReceipts: [{ body: "must not be expanded" }],
    });

    expect(handoff.coreProjection).toMatchObject({
      taskState: {
        action: "attach-evidence",
        receipt_ids: ["receipt-fedcba9876543210"],
        visual_contract: {
          handle: "visual:vd-task-42:0123456789abcdef",
          hash:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          selection_receipt: SYNTHETIC_SELECTION_RECEIPT,
          authority: "selected-direction",
          selected_direction_id: "pricing-quiet-hierarchy",
          receipt_ids: ["receipt-fedcba9876543210"],
          expires_at: expiresAt,
        },
      },
      resumeHandles: [
        "visual:vd-task-42:0123456789abcdef",
        "code:pricing-shell",
        "memory:accessibility-rule",
      ],
      checkpoint: {
        action: "checkpoint",
        next_action: "implement-one-selected-direction",
      },
    });
    expect(JSON.stringify(handoff)).not.toMatch(
      /remain behind|must not be expanded|sourceReceipts/i,
    );
  });

  it("projects structured visual review and cleanup into the core task-state bridge", () => {
    const expiresAt = futureVisualExpiry();
    const authorityDecision = resolveAuthority({
      scope: "component",
      hasExistingProject: true,
      visualDecision: "selected-direction",
    });
    const handoff = buildAtlasHandoff({
      authorityDecision,
      workflowState: "review",
      selectedContract: {
        contractHandle: "visual:vd-review:1234567890abcdef",
        contractHash:
          "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        expiresAt,
        selectionReceipt: SYNTHETIC_SELECTION_RECEIPT,
        selectedDirectionId: "quiet-dialog",
      },
      stateMatrix: {
        surface: "Confirmation dialog",
        viewports: ["desktop", "narrow"],
        requiredStates: ["default", "focus-visible"],
      },
      visualReview: {
        result: "pass",
        deviationCount: 0,
        captures: [
          {
            handle: "artifact-aaaaaaaaaaaa-00000001",
            hash: "a".repeat(64),
            receipt: syntheticCaptureReceipt("a".repeat(64)),
            viewport: "desktop",
            state: "default",
          },
          {
            handle: "artifact-bbbbbbbbbbbb-00000002",
            hash: "b".repeat(64),
            receipt: syntheticCaptureReceipt("b".repeat(64)),
            viewport: "narrow",
            state: "focus-visible",
          },
        ],
        preliminaryReviewHandle: SYNTHETIC_PRELIMINARY_REVIEW,
      },
      cleanup: {
        state: "clean",
        receipt:
          "cleanup:v1:0123456789abcdef:vd-review:close:m1234567:abcdef0123456789",
      },
      sourceReceiptIds: [],
      atlasHandles: [],
    });

    expect(handoff.coreProjection.taskState).toMatchObject({
      action: "attach-review",
      visual_review: {
        contract_handle: "visual:vd-review:1234567890abcdef",
        contract_hash:
          "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        state_matrix: {
          surface: "Confirmation dialog",
          viewports: ["desktop", "narrow"],
          required_states: ["default", "focus-visible"],
        },
        captures: [
          {
            handle: "artifact-aaaaaaaaaaaa-00000001",
            hash: "a".repeat(64),
            receipt: syntheticCaptureReceipt("a".repeat(64)),
            viewport: "desktop",
            state: "default",
          },
          {
            handle: "artifact-bbbbbbbbbbbb-00000002",
            hash: "b".repeat(64),
            receipt: syntheticCaptureReceipt("b".repeat(64)),
            viewport: "narrow",
            state: "focus-visible",
          },
        ],
        result: "pass",
        deviation_count: 0,
        cleanup: {
          state: "clean",
          receipt:
            "cleanup:v1:0123456789abcdef:vd-review:close:m1234567:abcdef0123456789",
        },
        preliminary_review_handle: SYNTHETIC_PRELIMINARY_REVIEW,
      },
    });
  });

  it("rejects incomplete or duplicated passing capture coverage", () => {
    const authorityDecision = resolveAuthority({
      scope: "component",
      hasExistingProject: true,
      visualDecision: "selected-direction",
    });
    const base = {
      authorityDecision,
      workflowState: "review",
      selectedContract: {
        contractHandle: "visual:vd-review:1234567890abcdef",
        contractHash: "1234567890abcdef".repeat(4),
        expiresAt: futureVisualExpiry(),
        selectionReceipt: SYNTHETIC_SELECTION_RECEIPT,
        selectedDirectionId: "quiet-dialog",
      },
      stateMatrix: {
        surface: "Dialog",
        viewports: ["desktop", "narrow"],
        requiredStates: ["default", "focus-visible"],
      },
      cleanup: { state: "not-applicable" },
    };
    const desktop = {
      handle: "artifact-aaaaaaaaaaaa-00000001",
      hash: "a".repeat(64),
      receipt: syntheticCaptureReceipt("a".repeat(64)),
      viewport: "desktop",
      state: "default",
    };
    expect(() =>
      buildAtlasHandoff({
        ...base,
        visualReview: { result: "pass", deviationCount: 0, captures: [desktop] },
      }),
    ).toThrow(/cover every viewport/i);
    expect(() =>
      buildAtlasHandoff({
        ...base,
        visualReview: {
          result: "blocked",
          deviationCount: 1,
          captures: [desktop, { ...desktop, handle: "artifact-aaaaaaaaaaaa-00000002" }],
        },
      }),
    ).toThrow(/pairs must be unique/i);
  });

  it("keeps the largest declared state coverage inside the bounded evidence handoff", () => {
    const authorityDecision = resolveAuthority({
      scope: "component",
      hasExistingProject: true,
      visualDecision: "selected-direction",
    });
    const viewports = Array.from({ length: 6 }, (_, index) => `viewport-${index}`);
    const requiredStates = Array.from({ length: 14 }, (_, index) => `state-${index}`);
    const captures = requiredStates.map((state, index) => {
      const fill = (index % 15).toString(16);
      const hash = fill.repeat(64);
      return {
        handle: `artifact-${hash.slice(0, 12)}-${(index + 1)
          .toString(16)
          .padStart(8, "0")}`,
        hash,
        receipt: syntheticCaptureReceipt(hash),
        viewport: viewports[index % viewports.length]!,
        state,
      };
    });
    const handoff = buildAtlasHandoff({
      authorityDecision,
      workflowState: "review",
      selectedContract: {
        contractHandle: "visual:vd-max-review:1234567890abcdef",
        contractHash: "1234567890abcdef".repeat(4),
        expiresAt: futureVisualExpiry(),
        selectionReceipt: SYNTHETIC_SELECTION_RECEIPT,
        selectedDirectionId: "max-review",
      },
      stateMatrix: { surface: "Dense state surface", viewports, requiredStates },
      visualReview: {
        result: "pass",
        deviationCount: 0,
        captures,
        preliminaryReviewHandle: SYNTHETIC_PRELIMINARY_REVIEW,
      },
      cleanup: {
        state: "clean",
        receipt:
          "cleanup:v1:0123456789abcdef:vd-max-review:close:m1234567:abcdef0123456789",
      },
    });
    expect(Buffer.byteLength(JSON.stringify(handoff), "utf8")).toBeLessThanOrEqual(
      8_192,
    );
  });

  it("makes cleanup failure recoverable and blocks ready claims", () => {
    const authorityDecision = resolveAuthority({
      scope: "component",
      hasExistingProject: true,
      visualDecision: "selected-direction",
    });
    const handoff = buildAtlasHandoff({
      authorityDecision,
      workflowState: "locked",
      selectedContract: {
        contractHandle: "visual:vd-cleanup:abcdef0123456789",
        contractHash: "abcdef0123456789".repeat(4),
        expiresAt: futureVisualExpiry(),
        selectionReceipt: SYNTHETIC_SELECTION_RECEIPT,
      },
      cleanup: {
        state: "cleanup-pending",
        retrySessionId: "vd-cleanup",
      },
      sourceReceiptIds: [],
      atlasHandles: [],
    });

    expect(handoff).toMatchObject({
      status: "cleanup-pending",
      readyForImplementation: false,
      cleanup: {
        state: "cleanup-pending",
        blocksCompletion: true,
        retrySessionId: "vd-cleanup",
      },
      nextSafeAction: "retry-temporary-cleanup",
    });
  });

  it("rejects cards after selection and full SourceReceipt-shaped inputs", () => {
    const expiresAt = futureVisualExpiry();
    const authorityDecision = resolveAuthority({
      scope: "section",
      hasExistingProject: true,
      visualDecision: "selected-direction",
    });
    expect(() =>
      buildAtlasHandoff({
        authorityDecision,
        workflowState: "locked",
        directionCards: [
          { id: "direction-a", name: "A", premise: "A premise" },
        ],
        selectedContract: {
          contractHandle: "visual:vd-task:0123456789abcdef",
          contractHash: "0123456789abcdef".repeat(4),
          expiresAt,
          selectionReceipt: SYNTHETIC_SELECTION_RECEIPT,
        },
        cleanup: { state: "selected-retained" },
      }),
    ).toThrow(/only while selection is pending/i);

    expect(() =>
      buildAtlasHandoff({
        authorityDecision,
        workflowState: "locked",
        selectedContract: {
          contractHandle: "visual:vd-task:0123456789abcdef",
          contractHash: "0123456789abcdef".repeat(4),
          expiresAt,
          selectionReceipt: SYNTHETIC_SELECTION_RECEIPT,
          selectedDirectionId: "direction-a",
        },
        cleanup: { state: "selected-retained" },
        sourceReceiptIds: [{ id: "receipt-0123456789abcdef", body: "raw" }],
      }),
    ).toThrow(/sourceReceiptIds\[0\] must be a non-empty string/i);
  });
});

describe("visual-direction skill contract", () => {
  it("is explicit-only and integrated without repository preview artifacts", async () => {
    const [
      skill,
      metadata,
      authority,
      temporary,
      atlasHandoff,
      frontendTask,
      brief,
    ] =
      await Promise.all([
        readFile(
          new URL("../skills/visual-direction/SKILL.md", import.meta.url),
          "utf8",
        ),
        readFile(
          new URL(
            "../skills/visual-direction/agents/openai.yaml",
            import.meta.url,
          ),
          "utf8",
        ),
        readFile(
          new URL(
            "../skills/visual-direction/references/authority-and-contracts.md",
            import.meta.url,
          ),
          "utf8",
        ),
        readFile(
          new URL(
            "../skills/visual-direction/references/temporary-artifacts.md",
            import.meta.url,
          ),
          "utf8",
        ),
        readFile(
          new URL(
            "../skills/visual-direction/references/atlas-handoff.md",
            import.meta.url,
          ),
          "utf8",
        ),
        readFile(
          new URL("../skills/frontend-task/SKILL.md", import.meta.url),
          "utf8",
        ),
        readFile(
          new URL(
            "../skills/frontend-task/references/brief-contract.md",
            import.meta.url,
          ),
          "utf8",
        ),
      ]);

    expect(metadata).toMatch(/allow_implicit_invocation:\s*false/);
    expect(skill).toMatch(/fidelity[\s\S]*inherit[\s\S]*explore[\s\S]*redesign/i);
    expect(skill).toMatch(/Never replace an[\s\S]*explicit link or node/i);
    expect(skill).toMatch(/two for an existing[\s\S]*exactly three for greenfield/i);
    expect(skill).toMatch(/one implementation branch\/worktree/i);
    expect(skill).toMatch(/Never write exploration artifacts[\s\S]*repository/i);
    expect(skill).toMatch(/On close or cancellation, purge the entire session/i);
    expect(authority).toMatch(/Direction cards[\s\S]*DesignContract[\s\S]*State matrix/i);
    expect(temporary).toMatch(/cleanup-pending[\s\S]*TTL sweep/i);
    expect(atlasHandoff).toMatch(
      /Atlas core handoff[\s\S]*Native Codex owns[\s\S]*Atlas stores bounded receipts/i,
    );
    expect(atlasHandoff).toMatch(/Exclude prompts?[\s\S]*preview payloads/i);
    expect(frontendTask).toMatch(/`\$visual-direction`/);
    expect(brief).toMatch(/visual_direction:/);

    const fixtureFiles = await listFiles(
      path.resolve("fixtures/visual-direction"),
    );
    expect(fixtureFiles.map((file) => path.basename(file))).toEqual([
      "cases.json",
    ]);
    const skillFiles = await listFiles(path.resolve("skills/visual-direction"));
    expect(skillFiles).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\.(?:png|jpe?g|gif|webp|html|tsx|vue)$/i),
      ]),
    );
  });
});
