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
      "conflicting-sources",
      "high-risk-persistence-choice",
      "high-risk-urls-without-decision",
      "high-risk-current-turn-confirmed",
      "new-high-risk-biometry-reuse-example-no-links",
      "required-openapi-contract-not-yet-linked",
      "continue-dirty-worktree",
      "correct-after-failed-validation",
      "detected-source-confirmation",
      "low-risk-no-source-grill",
      "task-scope-promotion",
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
    expect(byId.get("direct-figma-node")?.expected).toMatchObject({
      figmaRoute: "figma-desktop-mcp-first",
      codexFigmaSkillRole: "instructions-or-operation-prerequisite",
      fallbackOnlyWhen: [
        "desktop-mcp-not-connected",
        "desktop-mcp-unauthorized",
        "operation-unsupported",
      ],
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
    expect(byId.get("conflicting-sources")?.expected).toMatchObject({
      gate: "decision-required-with-evidence-and-recommendation",
    });
    expect(byId.get("high-risk-persistence-choice")?.expected).toMatchObject({
      risk: "high",
      checkpoint: "required-during-planning-before-investigation",
      sourceIntake: "grouped-jira-confluence-figma-openapi",
      decision: "immediate-persistence-vs-save",
      maxQuestions: 3,
    });
    expect(byId.get("high-risk-urls-without-decision")?.expected).toMatchObject({
      checkpoint: "required-during-planning-before-investigation",
      sourceIntake: "grouped-jira-confluence-figma-openapi",
      linksCountAsConfirmation: false,
    });
    expect(byId.get("high-risk-current-turn-confirmed")?.expected).toMatchObject({
      checkpoint: "required-during-planning-before-investigation",
      sourceIntake: "grouped-jira-confluence-figma-openapi",
      productDecisionCheckpoint: "satisfied-by-current-turn-confirmation",
      questionMode: "grouped-source-confirmation-only",
    });
    expect(
      byId.get("new-high-risk-biometry-reuse-example-no-links")?.expected,
    ).toMatchObject({
      mode: "new",
      priorFlowReference: "reuse-evidence-not-continuation",
      risk: "high",
      checkpoint: "required-during-planning-before-investigation",
      groupedSources: ["jira", "confluence", "figma", "openapi"],
      perSourceChoices: ["confirm", "provide-or-replace", "continue-without"],
      emptySourceLedgerSatisfiesCheckpoint: false,
      openapiClassification: "recommended",
      connectorProbeBeforeConfirmation: false,
      absentSourceMeansNotNeeded: false,
    });
    expect(
      byId.get("required-openapi-contract-not-yet-linked")?.expected,
    ).toMatchObject({
      mode: "new",
      risk: "high",
      groupedSources: ["jira", "confluence", "figma", "openapi"],
      emptySourceLedgerSatisfiesCheckpoint: false,
      openapiClassification: "required",
      omitOpenapiOutcome: "blocked-no-contract-invention",
      connectorProbeBeforeConfirmation: false,
    });
    expect(byId.get("continue-dirty-worktree")?.expected).toMatchObject({
      mode: "continue",
      brief: "delta-only",
      preserveExistingChanges: true,
      repeatOnboarding: false,
    });
    expect(byId.get("correct-after-failed-validation")?.expected).toMatchObject({
      mode: "correct",
      retrieve: "affected-evidence-only",
      repeatOnboarding: false,
    });
    expect(byId.get("detected-source-confirmation")?.expected).toMatchObject({
      initialState: "pending",
      connectorAccessBeforeConfirmation: false,
      choices: ["confirm", "replace-or-add", "omit", "unavailable"],
    });
    expect(byId.get("low-risk-no-source-grill")?.expected).toMatchObject({
      risk: "low",
      questionMode: "none",
      firstAgentTurn: "read-only",
    });
    expect(byId.get("task-scope-promotion")?.expected).toMatchObject({
      exactReferencesScope: "task",
      promotion: "explicit-only",
      checkoutEvidenceScope: "checkout",
    });

    const serialized = JSON.stringify(fixture);
    expect(serialized).not.toMatch(
      /(?:atlassian\.net|figma\.com\/design\/[A-Za-z0-9_-]{12,}|github\.com\/(?!example))/i,
    );
  });

  it("keeps the high-risk source checkpoint and continuation rules in the skill contract", async () => {
    const [skill, precheck, continuation, brief, routing] = await Promise.all([
      readFile(
        new URL("../skills/frontend-task/SKILL.md", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../skills/frontend-task/references/source-precheck.md",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../skills/frontend-task/references/continuation-mode.md",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../skills/frontend-task/references/brief-contract.md",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../skills/frontend-task/references/capability-routing.md",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);

    expect(skill).toMatch(/new high-risk task/i);
    expect(skill).toMatch(/before repository investigation or external retrieval/i);
    expect(skill).toMatch(/Jira, Confluence, Figma, and Swagger\/OpenAPI/i);
    expect(skill).toMatch(/reuse evidence, not a\s+continuation signal/i);
    expect(precheck).toMatch(/regardless of connector availability/i);
    expect(precheck).toMatch(
      /empty ledger or\s+one containing detected links only leaves the other rows unresolved/i,
    );
    expect(precheck).toMatch(/do not call a\s+connector[\s\S]*before the user confirms/i);
    expect(continuation).toMatch(/biometrics in Problem Tags like Back Office/i);
    expect(brief).toMatch(/jira \| confluence \| figma \| github \| openapi/i);
    expect(brief).toMatch(/openapi: required \| recommended \| optional/i);
    expect(routing).toMatch(/Swagger\/OpenAPI contract/i);
    expect(skill).toMatch(/Figma Desktop MCP.*local MCP server exposed by the Figma desktop/i);
    expect(routing).toMatch(
      /Codex\/Figma skill supplies\s+instructions or a mandatory operation prerequisite/i,
    );
    expect(routing).toMatch(
      /Figma Desktop MCP is not connected, not authorized, or does not cover the\s+operation/i,
    );
  });
});
