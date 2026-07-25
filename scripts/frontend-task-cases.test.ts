import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface FrontendTaskCase {
  id: string;
  sources: string[];
  capabilities?: string[];
  expected: Record<string, unknown>;
}

describe("frontend-task capability routing fixtures", () => {
  it("covers adaptive source and question modes without corporate data", async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL("../fixtures/frontend-task/cases.json", import.meta.url),
        "utf8",
      ),
    ) as { cases: FrontendTaskCase[] };
    const byId = new Map(fixture.cases.map((item) => [item.id, item]));
    const requiredCases = [
      "repository-and-conversation",
      "jira-without-confluence-or-figma",
      "direct-figma-node",
      "all-explicit-sources",
      "required-figma-capability-unavailable",
      "atlas-unavailable",
      "non-visual-change",
      "plan-mode-native-selector",
      "default-mode-question-fallback",
    ];

    expect([...byId.keys()]).toEqual(expect.arrayContaining(requiredCases));
    expect(
      byId.get("non-visual-change")?.expected,
    ).toMatchObject({
      figmaClassification: "not-applicable",
      accessFigma: false,
      questionMode: "none",
    });
    expect(
      byId.get("required-figma-capability-unavailable")?.expected,
    ).toMatchObject({
      figmaClassification: "unavailable",
      gate: "do-not-invent-design",
    });
    expect(
      byId.get("plan-mode-native-selector")?.expected,
    ).toMatchObject({
      questionMode: "native-selector",
      maxQuestions: 3,
    });
    expect(
      byId.get("default-mode-question-fallback")?.expected,
    ).toMatchObject({
      questionMode: "one-chat-question",
      customUi: false,
    });

    const serialized = JSON.stringify(fixture);
    expect(serialized).not.toMatch(
      /(?:atlassian\.net|figma\.com\/design\/[A-Za-z0-9_-]{12,}|github\.com\/(?!example))/i,
    );
  });
});
