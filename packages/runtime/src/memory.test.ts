import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyMemoryUpdate,
  checkBeforeChange,
  combineMemoryProposals,
  getProjectMemoryItem,
  getTaskContext,
  indexProjectMemory,
  listFigmaDesignIndexes,
  mapFigmaDesign,
  orientProject,
  proposeMemoryUpdate,
  recordDecision,
  recordProjectOutcome,
  rejectMemoryUpdate,
  reviewMemoryProposal,
  reviseMemoryProposal,
  scanProject,
  searchProjectMemory,
} from "./index.js";

const vueFixture = fileURLToPath(
  new URL("../../../fixtures/vue-nuxt", import.meta.url),
);
const figmaFixture = new URL(
  "../../../fixtures/figma/personal-no-dev-mode.xml",
  import.meta.url,
);

describe.sequential("Project Atlas runtime", () => {
  let rootPath: string;
  let emptyRoot: string;

  beforeEach(async () => {
    rootPath = await mkdtemp(path.join(os.tmpdir(), "project-atlas-memory-"));
    emptyRoot = await mkdtemp(path.join(os.tmpdir(), "project-atlas-empty-"));
    await cp(vueFixture, rootPath, { recursive: true });
    await cp(vueFixture, emptyRoot, { recursive: true });
    await rm(path.join(emptyRoot, "project-memory"), {
      recursive: true,
      force: true,
    });
    await scanProject(rootPath);
    await scanProject(emptyRoot);
  });

  afterEach(async () => {
    await Promise.all([
      rm(rootPath, { recursive: true, force: true }),
      rm(emptyRoot, { recursive: true, force: true }),
    ]);
  });

  it("rebuilds Markdown memory idempotently and isolates projects", async () => {
    const first = await indexProjectMemory(rootPath);
    const second = await indexProjectMemory(rootPath);
    expect(first).toMatchObject({
      indexedFiles: 5,
      indexedItems: 5,
      counts: { total: 5, active: 4, superseded: 1 },
    });
    expect(second).toMatchObject({
      indexedFiles: 5,
      indexedItems: 5,
      counts: { total: 5 },
    });

    const current = await searchProjectMemory(
      rootPath,
      "study search filter URL",
      { budgetChars: 1_800 },
    );
    expect(current.results[0]).toMatchObject({
      id: "decision-search-url-v2",
      status: "active",
    });
    expect(
      current.results.some(
        (item) => item.id === "decision-search-local-state-v1",
      ),
    ).toBe(false);
    expect(JSON.stringify(current).length).toBeLessThanOrEqual(1_800);

    const historical = await searchProjectMemory(rootPath, "local state", {
      statuses: ["superseded"],
    });
    expect(historical.results[0]?.id).toBe(
      "decision-search-local-state-v1",
    );

    const cold = await indexProjectMemory(emptyRoot);
    expect(cold).toMatchObject({
      indexedFiles: 0,
      indexedItems: 0,
      counts: { total: 0 },
    });
    const isolated = await searchProjectMemory(
      emptyRoot,
      "study search filter URL",
    );
    expect(isolated.results).toEqual([]);
    expect(isolated.metrics.totalMatches).toBe(0);
  });

  it("publishes complete snapshots when two scans target the same project", async () => {
    const [first, second] = await Promise.all([
      scanProject(rootPath, { writeArtifacts: false }),
      scanProject(rootPath, { writeArtifacts: false }),
    ]);
    expect(first.components).toHaveLength(second.components.length);
    const orientation = await orientProject(rootPath, {
      budgetChars: 1_600,
    });
    expect(orientation.codeAtlas).toMatchObject({
      components: first.components.length,
      relations: first.edges.length,
    });
  });

  it("combines memory, code, and optional design under one hard budget", async () => {
    await indexProjectMemory(rootPath);
    const metadata = await readFile(figmaFixture, "utf8");
    await mapFigmaDesign({
      rootPath,
      figmaUrl: "https://www.figma.com/design/PersonalShop/Personal-shop",
      metadata,
      format: "figma-mcp-xml",
    });
    await mapFigmaDesign({
      rootPath,
      figmaUrl: "https://www.figma.com/design/PersonalShop/Personal-shop",
      metadata,
      format: "figma-mcp-xml",
      force: true,
    });
    expect((await listFigmaDesignIndexes(rootPath))[0]?.stats.nodes).toBe(8);

    const context = await getTaskContext(
      rootPath,
      "add study filter to search on mobile",
      { figmaFile: "PersonalShop", budgetChars: 2_800 },
    );
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(2_800);
    expect(context.memory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "decision-search-url-v2" }),
      ]),
    );
    expect(context.code.length).toBeGreaterThan(0);
    expect(context.design).toMatchObject({
      available: true,
      candidates: expect.any(Array),
    });
    expect(context.gate.overall.status).not.toBe("clear");
    expect(context.metrics.estimatedTokens).toBeLessThanOrEqual(700);

    const narrow = await getTaskContext(
      rootPath,
      "add study filter to search on mobile",
      { figmaFile: "PersonalShop", budgetChars: 2_800, topK: 1 },
    );
    expect(narrow.memory.length).toBeLessThanOrEqual(1);
    expect(narrow.code.length).toBeLessThanOrEqual(1);
    expect(narrow.design.candidates.length).toBeLessThanOrEqual(1);

    const graph = await scanProject(rootPath, { writeArtifacts: false });
    const selectedComponent = graph.components[0]!;
    const selectedDesignNodeId = context.design.candidates[0]!.id;
    const selected = await getTaskContext(rootPath, "unrelated copy update", {
      figmaFile: "PersonalShop",
      budgetChars: 3_200,
      topK: 3,
      selectedHandles: [
        `code:${selectedComponent.id}`,
        "memory:decision-search-url-v2",
        `design:PersonalShop::${selectedDesignNodeId}`,
      ],
    });
    expect(selected.selections).toHaveLength(3);
    expect(selected.code[0]?.id).toBe(selectedComponent.id);
    expect(selected.memory[0]?.id).toBe("decision-search-url-v2");
    expect(selected.design.candidates[0]?.id).toBe(selectedDesignNodeId);
    expect(JSON.stringify(selected).length).toBeLessThanOrEqual(3_200);

    const withoutDesign = await getTaskContext(
      emptyRoot,
      "confirmation dialog",
      { budgetChars: 1_400 },
    );
    expect(withoutDesign.design).toMatchObject({
      available: false,
      candidates: [],
    });
    expect(JSON.stringify(withoutDesign).length).toBeLessThanOrEqual(1_400);
  });

  it("surfaces recorded reuse decisions in project orientation", async () => {
    const decision = await recordDecision({
      rootPath,
      intent: "extend the existing confirmation behavior",
      decision: "compose",
      selectedComponentIds: [],
      rationale: "Keep responsibilities explicit and reuse the existing flow.",
    });
    const map = await orientProject(rootPath, { budgetChars: 3_600 });

    expect(map.projectMemory.currentDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: decision.id,
          type: "reuse-decision",
        }),
      ]),
    );
  });

  it("raises conflicts, stale knowledge, and failed attempts before change", async () => {
    await indexProjectMemory(rootPath);
    const gate = await checkBeforeChange(
      rootPath,
      "add a study search filter stored in the URL",
      {
        files: ["app/components/feature/SearchFilters.vue"],
        budgetChars: 3_000,
      },
    );
    expect(gate.gate.status).toBe("blocked");
    expect(gate.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "decision-required",
          code: "memory-contradiction",
        }),
        expect.objectContaining({
          level: "warning",
          code: "failed-attempt",
        }),
        expect.objectContaining({
          level: "warning",
          code: "stale-memory",
        }),
      ]),
    );
    expect(gate.gate.questions[0]).toMatchObject({
      evidence: expect.any(Array),
      recommendation: expect.any(String),
    });

    const map = await orientProject(rootPath, { budgetChars: 1_600 });
    expect(JSON.stringify(map).length).toBeLessThanOrEqual(1_600);
    expect(map).toMatchObject({
      codeAtlas: { components: 6 },
      projectMemory: { counts: { total: 5 } },
    });
  });

  it("keeps durable writes proposal-first and rejects secret-like content", async () => {
    await indexProjectMemory(rootPath);
    await expect(
      proposeMemoryUpdate({
        rootPath,
        rationale: "Persist integration troubleshooting",
        items: [
          {
            type: "note",
            title: "Integration credential",
            summary: "api_key=fixture-value-that-must-not-be-stored",
            confidence: 0.8,
            authority: "observed",
          },
        ],
      }),
    ).rejects.toThrow(/secret-like content/);

    await expect(
      proposeMemoryUpdate({
        rootPath,
        rationale: "Malformed boundary fixture",
        items: [
          {
            type: "not-a-memory-type",
            title: "Invalid",
            summary: "Must be rejected before persistence.",
            confidence: 2,
            authority: "observed",
          },
        ] as unknown as Parameters<typeof proposeMemoryUpdate>[0]["items"],
      }),
    ).rejects.toThrow(/item 1 is invalid/);

    await expect(
      recordProjectOutcome({
        rootPath,
        task: "",
        result: "success",
        summary: "",
      }),
    ).rejects.toThrow(/requires a task/);

    const proposed = await proposeMemoryUpdate({
      rootPath,
      rationale: "The verified implementation established a stable convention.",
      evidence: ["Route synchronization tests passed"],
      items: [
        {
          type: "convention",
          title: "Normalize filter query values once",
          summary:
            "Parse route filter values at the boundary and keep components typed.",
          confidence: 0.95,
          authority: "verified",
          tags: ["search", "filters", "routing"],
          relations: [
            {
              kind: "implements",
              targetId: "decision-search-url-v2",
            },
          ],
        },
      ],
    });
    expect(proposed.proposal.status).toBe("pending");
    const proposalId = proposed.proposal.id;
    const withPendingProposal = await orientProject(rootPath, {
      budgetChars: 3_600,
    });
    expect(withPendingProposal.projectMemory.pendingProposals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: proposalId }),
      ]),
    );

    await expect(
      applyMemoryUpdate(rootPath, proposalId, { confirmed: false }),
    ).rejects.toThrow(/confirmed=true/);
    await expect(
      getProjectMemoryItem(
        rootPath,
        "memory:fixture-search:normalize-filter-query-values-once",
      ),
    ).rejects.toThrow();

    const applied = await applyMemoryUpdate(rootPath, proposalId, {
      confirmed: true,
      target: "local",
    });
    expect(applied).toMatchObject({
      status: "applied",
      applied: [
        expect.objectContaining({
          title: "Normalize filter query values once",
          path: expect.stringContaining(".component-atlas/memory/"),
        }),
      ],
    });
    const item = await getProjectMemoryItem(
      rootPath,
      applied.applied[0]!.id,
    );
    expect(item.item).toMatchObject({
      status: "active",
      authority: "verified",
      scope: "local",
    });

    const outcome = await recordProjectOutcome({
      rootPath,
      task: "add study filter",
      result: "failure",
      summary: "A bidirectional watcher caused duplicate fetches.",
      evidence: ["Regression test reproduced the failure"],
      files: ["app/components/feature/SearchFilters.vue"],
    });
    expect(outcome.outcome).toMatchObject({
      result: "failure",
      authority: "observed",
    });
    const afterOutcome = await checkBeforeChange(
      rootPath,
      "add study filter",
    );
    expect(afterOutcome.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "failed-attempt",
          memoryIds: expect.arrayContaining([outcome.outcome.id]),
        }),
      ]),
    );
  });

  it("shares proposal impact and hard gates across local and canonical writes", async () => {
    const blocked = await proposeMemoryUpdate({
      rootPath,
      rationale: "Replace the current search URL rule.",
      items: [
        {
          id: "blocked-search-rule",
          type: "decision",
          title: "Keep filters outside the URL",
          summary: "Store search filters only in local component state.",
          confidence: 0.8,
          authority: "decided",
          relations: [
            {
              kind: "contradicts",
              targetId: "decision-search-url-v2",
            },
          ],
        },
      ],
    });
    const blockedReview = await reviewMemoryProposal(
      rootPath,
      blocked.proposal.id,
      { target: "local" },
    );
    expect(blockedReview).toMatchObject({
      canApply: false,
      gate: {
        status: "blocked",
        blockingFindingIds: [expect.stringContaining("memory-contradiction")],
      },
      impact: {
        directory: ".component-atlas/memory",
        itemCount: 1,
      },
    });
    await expect(
      applyMemoryUpdate(rootPath, blocked.proposal.id, {
        confirmed: true,
        target: "local",
      }),
    ).rejects.toThrow(/unresolved decision-required findings/);

    const canonical = await proposeMemoryUpdate({
      rootPath,
      rationale: "Record a distinct reviewed canonical note.",
      items: [
        {
          id: "canonical-review-contract",
          type: "note",
          title: "Canonical review contract",
          summary: "Canonical writes expose their exact versionable path.",
          body: "The complete proposed body must be visible before approval.",
          confidence: 0.9,
          authority: "verified",
          tags: ["memory", "review"],
        },
      ],
    });
    const canonicalReview = await reviewMemoryProposal(
      rootPath,
      canonical.proposal.id,
      { target: "canonical" },
    );
    expect(canonicalReview).toMatchObject({
      canApply: true,
      requiresCanonicalConfirmation: true,
      impact: {
        directory: "project-memory",
        items: [
          {
            id: "canonical-review-contract",
            scope: "canonical",
            path: "project-memory/canonical-review-contract.md",
          },
        ],
      },
    });
    await expect(
      applyMemoryUpdate(rootPath, canonical.proposal.id, {
        confirmed: true,
        target: "canonical",
      }),
    ).rejects.toThrow(/canonicalConfirmed=true/);
    const applied = await applyMemoryUpdate(
      rootPath,
      canonical.proposal.id,
      {
        confirmed: true,
        canonicalConfirmed: true,
        target: "canonical",
      },
    );
    expect(applied).toMatchObject({
      status: "applied",
      target: "canonical",
      impact: {
        directory: "project-memory",
        itemCount: 1,
      },
    });
  });

  it("supports auditable revise, combine, and reject inbox actions", async () => {
    await indexProjectMemory(rootPath);
    const first = await proposeMemoryUpdate({
      rootPath,
      rationale: "Capture the first bounded convention.",
      items: [
        {
          type: "convention",
          title: "Keep filter values canonical",
          summary: "Normalize filter values before component props receive them.",
          confidence: 0.8,
          authority: "inferred",
        },
      ],
    });
    const second = await proposeMemoryUpdate({
      rootPath,
      rationale: "Capture related verification evidence.",
      evidence: ["Fixture route test passed"],
      items: [
        {
          type: "outcome",
          title: "Filter route remained stable",
          summary: "The verified route round trip preserved the selected filter.",
          confidence: 0.9,
          authority: "verified",
        },
      ],
    });

    const revised = await reviseMemoryProposal({
      rootPath,
      proposalId: first.proposal.id,
      rationale: "Capture the reviewed bounded convention.",
      evidence: ["Fixture review completed"],
      items: [
        {
          type: "convention",
          title: "Keep filter values canonical",
          summary: "Normalize filter values at the route boundary.",
          confidence: 0.9,
          authority: "verified",
        },
      ],
      budgetChars: 1_800,
    });
    expect(revised.proposal).toMatchObject({
      status: "pending",
      rationale: "Capture the reviewed bounded convention.",
    });
    expect(JSON.stringify(revised).length).toBeLessThanOrEqual(1_800);

    const combined = await combineMemoryProposals({
      rootPath,
      targetProposalId: first.proposal.id,
      sourceProposalId: second.proposal.id,
      confirmed: true,
      budgetChars: 1_800,
    });
    expect(combined).toMatchObject({
      status: "combined",
      itemCount: 2,
    });
    expect(JSON.stringify(combined).length).toBeLessThanOrEqual(1_800);

    await expect(
      rejectMemoryUpdate(rootPath, first.proposal.id, {
        confirmed: false,
        reason: "The team has not adopted this as a durable convention.",
      }),
    ).rejects.toThrow(/confirmed=true/);
    const rejected = await rejectMemoryUpdate(rootPath, first.proposal.id, {
      confirmed: true,
      reason: "The team has not adopted this as a durable convention.",
      budgetChars: 1_200,
    });
    expect(rejected).toMatchObject({ status: "rejected" });
    expect(JSON.stringify(rejected).length).toBeLessThanOrEqual(1_200);

    const orientation = await orientProject(rootPath, { budgetChars: 3_600 });
    expect(orientation.projectMemory.pendingProposals).toEqual([]);
  });
});
