import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyMemoryUpdate,
  checkBeforeChange,
  getProjectMemoryItem,
  getTaskContext,
  indexProjectMemory,
  mapFigmaDesign,
  orientProject,
  proposeMemoryUpdate,
  recordProjectOutcome,
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

  it("combines memory, code, and optional design under one hard budget", async () => {
    await indexProjectMemory(rootPath);
    const metadata = await readFile(figmaFixture, "utf8");
    await mapFigmaDesign({
      rootPath,
      figmaUrl: "https://www.figma.com/design/PersonalShop/Personal-shop",
      metadata,
      format: "figma-mcp-xml",
    });

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
    expect(context.metrics.estimatedTokens).toBeLessThanOrEqual(700);

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
      codeAtlas: { components: 4 },
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
});
