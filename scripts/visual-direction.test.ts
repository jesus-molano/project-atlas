import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAtlasHandoff } from "../skills/visual-direction/scripts/build-atlas-handoff.mjs";
import { resolveAuthority } from "../skills/visual-direction/scripts/resolve-authority.mjs";
import {
  CleanupPendingError,
  cleanupSession,
  createSession,
  readSelectedContract,
  recordArtifact,
  retryCleanup,
  retrySelectionCleanup,
  selectDirection,
  sweepExpired,
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
      await recordArtifact({
        sessionPath: session.sessionPath,
        artifactPath: reviewPath,
        kind: "review-capture",
        root: ownedRoot,
      });

      await cleanupSession({
        sessionPath: session.sessionPath,
        root: ownedRoot,
        reason: "close",
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
      cleanup: { state: "not-applicable" },
      sourceReceiptIds: ["receipt-0123456789abcdef"],
      atlasHandles: ["design:figma:ExactFile:42:7"],
      previewPayload: "data:image/png;base64,SHOULD_NOT_CROSS",
      temporaryPath: "C:\\Temp\\visual-direction\\preview.png",
    });

    expect(handoff).toMatchObject({
      surface: {
        primary: "codex-handoff",
        runner: "secondary-experimental",
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
        sourceReceiptIds: ["receipt-0123456789abcdef"],
        receiptsExpanded: false,
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
        expiresAt: "2026-07-30T12:00:00.000Z",
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

    expect(handoff.capsuleProjection).toEqual({
      sourceReceiptIds: ["receipt-fedcba9876543210"],
      handles: [
        "visual:vd-task-42:0123456789abcdef",
        "code:pricing-shell",
        "memory:accessibility-rule",
      ],
      nextSafeAction: "implement-one-selected-direction",
    });
    expect(JSON.stringify(handoff)).not.toMatch(
      /remain behind|must not be expanded|sourceReceipts/i,
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
        contractHash: "abcdef0123456789abcdef0123456789",
        expiresAt: "2026-07-30T12:00:00.000Z",
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
          contractHash: "0123456789abcdef",
          expiresAt: "2026-07-30T12:00:00.000Z",
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
          contractHash: "0123456789abcdef",
          expiresAt: "2026-07-30T12:00:00.000Z",
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
      /Work \/ Codex handoff[\s\S]*progressive[\s\S]*capsuleProjection/i,
    );
    expect(atlasHandoff).toMatch(/never crosses[\s\S]*preview image bytes/i);
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
