import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface FrontendTaskCase {
  id: string;
  sources: string[];
  capabilities?: string[];
  expected: Record<string, unknown>;
}

describe("frontend-task capability routing fixtures", () => {
  it("keeps every active workflow document on the six-tool core contract", async () => {
    const skillsRoot = fileURLToPath(new URL("../skills", import.meta.url));
    const activeRoots = ["frontend-task", "reuse-first", "visual-direction"];
    const markdownFiles: string[] = [];
    const collectMarkdown = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) await collectMarkdown(fullPath);
        else if (entry.isFile() && entry.name.endsWith(".md")) {
          markdownFiles.push(fullPath);
        }
      }
    };
    await Promise.all(
      activeRoots.map((root) => collectMarkdown(path.join(skillsRoot, root))),
    );
    const contents = await Promise.all(
      markdownFiles.map((file) => readFile(file, "utf8")),
    );
    const namedTools = [
      ...new Set(
        contents.flatMap((content) => content.match(/\batlas_[a-z0-9_]+\b/gu) ?? []),
      ),
    ].sort();
    expect(namedTools).toEqual([
      "atlas_expand_context",
      "atlas_lock_change_scope",
      "atlas_memory",
      "atlas_prepare_task",
      "atlas_task_state",
      "atlas_validate_change",
    ]);
  });

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
      "large-figma-frame-segmented-context",
      "very-large-figma-page-adaptive-degradation",
      "figma-local-fallback",
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
      "memory-closeout-none",
      "memory-closeout-canonical-confirmed",
      "memory-closeout-local-only",
      "memory-closeout-declined",
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
      localEndpoint: "http://127.0.0.1:3845/mcp",
      preinspection: "get_metadata",
      deepContext: "direct-standard-timeout",
      doNotUseFirst: ["global-figma-mcp", "remote-figma-connector"],
      codexFigmaSkillRole: "instructions-or-operation-prerequisite",
      fallbackOnlyWhen: [
        "desktop-mcp-not-connected",
        "desktop-mcp-request-failed",
        "desktop-mcp-timeout-or-no-response",
        "desktop-mcp-unauthorized",
        "operation-unsupported",
      ],
    });
    expect(
      byId.get("large-figma-frame-segmented-context")?.expected,
    ).toMatchObject({
      figmaRoute: "figma-desktop-mcp-first",
      localEndpoint: "http://127.0.0.1:3845/mcp",
      preinspection: "sparse-metadata-hierarchy",
      deepContext: "segment-from-start-by-relevant-subtree",
      incrementalProgress: true,
      timeoutRecovery: "reduce-scope-and-segment",
      unchangedRetryWithHigherTimeout: false,
    });
    expect(
      byId.get("very-large-figma-page-adaptive-degradation")?.expected,
    ).toMatchObject({
      originalPageReference: "preserved",
      overview: [
        "screenshot-or-summary-when-available",
        "economical-hierarchy-and-ids",
      ],
      atlasSupplement: "cached-sparse-scope-only",
      selection: "relevant-components-and-related-groups",
      batching: "small-adaptive-related-subtrees",
      singleNodeOnly: false,
      oversizedBatchRecovery: "shrink-next-batch",
      successfulChunks: "preserved-not-repeated",
      missingOverviewOrMetadata: "document-and-request-narrower-evidence",
      inventHierarchy: false,
    });
    expect(byId.get("figma-local-fallback")?.expected).toMatchObject({
      localEndpointAttemptedFirst: "http://127.0.0.1:3845/mcp",
      localCondition: "timeout-or-no-response",
      fallback: "remote-figma-connector",
      fallbackExplanation: "brief-and-required",
      unchangedRetryWithHigherTimeout: false,
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
    expect(byId.get("memory-closeout-none")?.expected).toMatchObject({
      memoryCloseout: "none",
      confirmationRequired: false,
      automaticWrite: false,
    });
    expect(
      byId.get("memory-closeout-canonical-confirmed")?.expected,
    ).toMatchObject({
      memoryCloseout: "canonical-candidate",
      confirmationMode: "one-exact-canonical-write-question",
      automaticWrite: false,
      afterExplicitConfirmation: "canonical-stored",
    });
    expect(byId.get("memory-closeout-local-only")?.expected).toMatchObject({
      memoryCloseout: "local-only",
      canonicalPromotionQuestion: false,
      automaticWrite: false,
    });
    expect(byId.get("memory-closeout-declined")?.expected).toMatchObject({
      memoryCloseout: "declined",
      stored: false,
      askAgain: false,
    });

    const serialized = JSON.stringify(fixture);
    expect(serialized).not.toMatch(
      /(?:atlassian\.net|figma\.com\/design\/[A-Za-z0-9_-]{12,}|github\.com\/(?!example))/i,
    );
  });

  it("keeps the explicit bounded v2 workflow in the skill contract", async () => {
    const [skill, metadata] = await Promise.all([
      readFile(
        new URL("../skills/frontend-task/SKILL.md", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../skills/frontend-task/agents/openai.yaml",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);

    expect(metadata).toMatch(/allow_implicit_invocation:\s*false/i);
    expect(skill.length).toBeLessThanOrEqual(8_000);
    expect(skill).toMatch(/call `atlas_prepare_task` once/i);
    expect(skill).toMatch(/Classify only sources that are supplied or materially required/i);
    expect(skill).toMatch(/bare\s+reference stays `pending`/i);
    expect(skill).toMatch(/Missing\s+optional evidence is a warning, not a blocker/i);
    expect(skill).toMatch(/transient OpenAPI 502\/503\/504, retry once/i);
    expect(skill).toMatch(/call `atlas_lock_change_scope`/i);
    expect(skill).toMatch(/Plan mode and filesystem permissions belong to native Codex/i);
    expect(skill).toMatch(/same native task/i);
    expect(skill).toMatch(/Use `atlas_task_state` only to resume/i);
    expect(skill).toMatch(/call `atlas_validate_change`/i);
    expect(skill).toMatch(/main native Codex task is coordinator and sole writer/i);
    expect(skill).toMatch(/small\/low: no agent reviewer/i);
    expect(skill).toMatch(/medium: one read-only correctness\/architecture reviewer/i);
    expect(skill).toMatch(/high: up to three narrow read-only reviewers/i);
    expect(skill).toMatch(/Stop after two review passes/i);
    expect(skill).toMatch(
      /Atlas supplies bounded evidence; it must not create,\s*route, resume, cancel, or grant permissions/i,
    );
    expect(skill).toMatch(/tight file\/line evidence/i);
    expect(skill).toMatch(/Call `atlas_task_state` with action `complete`/i);
    expect(skill).toMatch(/Use `atlas_memory` action `review-proposal`/i);
    expect(skill).not.toMatch(/atlas_record_outcome/i);
    expect(skill).toMatch(/invoke `\$visual-direction` explicitly/i);
    expect(skill).not.toMatch(/confirm Jira, Confluence, Figma, and Swagger\/OpenAPI/i);
  });
});
