import { describe, expect, it } from "vitest";
import {
  MEMORY_SCHEMA_VERSION,
  assertMemoryContentSafe,
  compactMemorySearch,
  findSecretLikeContent,
  fitBudgetedResponse,
  memoryItemMarkdown,
  parseMemoryMarkdown,
  type MemoryItem,
} from "./index.js";

const baseItem: MemoryItem = {
  schemaVersion: MEMORY_SCHEMA_VERSION,
  id: "decision-search-url",
  projectId: "project-a",
  namespace: "search",
  type: "decision",
  title: "Search filters live in the URL",
  summary: "Applied filters are shareable query parameters.",
  body: "Use normalized query parameters and derive applied state from the route.",
  status: "active",
  confidence: 0.95,
  authority: "decided",
  scope: "canonical",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
  tags: ["search", "filters", "url"],
  provenance: {
    kind: "markdown",
    evidence: ["Architecture decision"],
  },
  supersedes: [],
  relations: [
    {
      kind: "references_code",
      targetId: "app/components/SearchFilters.vue",
    },
  ],
};

describe("Project Atlas memory primitives", () => {
  it("round-trips typed Obsidian-compatible Markdown", () => {
    const markdown = memoryItemMarkdown(baseItem);
    expect(markdown).toContain("[[app/components/SearchFilters.vue]]");
    const parsed = parseMemoryMarkdown(markdown, {
      projectId: "project-a",
      projectName: "Project A",
      sourcePath: "project-memory/search-url.md",
      now: "2026-07-25T00:00:00.000Z",
    });
    expect(parsed).toMatchObject({
      id: baseItem.id,
      type: "decision",
      status: "active",
      authority: "decided",
      projectId: "project-a",
      tags: ["search", "filters", "url"],
      relations: [
        {
          kind: "references_code",
          targetId: "app/components/SearchFilters.vue",
        },
      ],
    });
  });

  it("enforces hard response budgets and exposes pagination metrics", () => {
    const items = Array.from({ length: 20 }, (_, index): MemoryItem => ({
      ...baseItem,
      id: `decision-${index}`,
      title: `Decision ${index}`,
      summary: `Long compact summary ${index} ${"context ".repeat(20)}`,
    }));
    const result = compactMemorySearch(items, "decision", {
      limit: 10,
      budgetChars: 800,
    });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(800);
    expect(result.metrics).toMatchObject({
      budgetChars: 800,
      truncated: true,
      totalMatches: 20,
      nextCursor: expect.any(String),
    });
    expect(result.metrics.estimatedTokens).toBeLessThanOrEqual(200);

    const payload = fitBudgetedResponse(
      {
        values: Array.from({ length: 50 }, (_, index) => ({
          id: index,
          text: "evidence ".repeat(30),
        })),
      },
      { budgetChars: 900, totalMatches: 50 },
    );
    expect(JSON.stringify(payload).length).toBeLessThanOrEqual(900);

    const composed = fitBudgetedResponse(
      {
        memory: Array.from({ length: 4 }, (_, index) => ({
          id: `memory-${index}`,
          summary: "memory evidence ".repeat(25),
        })),
        code: Array.from({ length: 4 }, (_, index) => ({
          id: `code-${index}`,
          summary: "code evidence ".repeat(25),
        })),
        design: {
          candidates: Array.from({ length: 4 }, (_, index) => ({
            id: `design-${index}`,
            summary: "design evidence ".repeat(25),
          })),
        },
      },
      {
        budgetChars: 900,
        preserveFirstKeys: ["memory", "code", "candidates"],
      },
    );
    expect(composed.memory).toHaveLength(1);
    expect(composed.code).toHaveLength(1);
    expect(composed.design.candidates).toHaveLength(1);
    expect(JSON.stringify(composed).length).toBeLessThanOrEqual(900);
  });

  it("rejects secret-like memory content without echoing the secret", () => {
    const content = {
      summary: "Temporary integration configuration",
      body: "api_key=fixture-value-that-must-never-be-stored",
    };
    expect(findSecretLikeContent(content)).toEqual([
      { path: "body", kind: "assigned-secret" },
    ]);
    expect(() => assertMemoryContentSafe(content)).toThrow(
      /assigned-secret at body/,
    );
    expect(() => assertMemoryContentSafe(content)).not.toThrow(
      /fixture-value-that-must-never-be-stored/,
    );
  });
});
