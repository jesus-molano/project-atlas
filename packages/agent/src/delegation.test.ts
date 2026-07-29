import { describe, expect, it } from "vitest";
import {
  assertAgentDelegationBundle,
  assertCompactDelegationResult,
  compactDelegatedEvidence,
  planAgentDelegation,
  type AgentDelegationJob,
  type AgentDelegationResult,
} from "./delegation.js";

function job(
  domain: AgentDelegationJob["domain"],
  sourceDecisionIds: string[] = [],
): AgentDelegationJob {
  return {
    id: `delegate-${domain}-1`,
    domain,
    sourceDecisionIds,
    primaryAdapter:
      domain === "figma"
        ? "figma-desktop-mcp-local"
        : domain === "atlassian"
          ? "atlassian-rovo"
          : domain === "openapi"
            ? "openapi-public-http"
            : "project-atlas",
    outputBudgetChars: 4_000,
    permissions: {
      confirmSources: false,
      changeAuthority: false,
      changeScope: false,
      useProviderFallback: false,
      implement: false,
    },
    onBlocked: "return-compact-blocker",
  };
}

function measured(
  result: Omit<AgentDelegationResult, "metrics">,
): AgentDelegationResult {
  const draft: AgentDelegationResult = {
    ...result,
    metrics: { outputChars: 0, rawBodiesIncluded: false },
  };
  return {
    ...draft,
    metrics: {
      ...draft.metrics,
      outputChars: JSON.stringify(draft).length,
    },
  };
}

describe("optional compact delegation", () => {
  it("stays disabled by default and weighs total work against coordinator context", () => {
    const workItems = [
      {
        domain: "figma" as const,
        sourceDecisionIds: ["source-figma-11111111"],
        confirmed: true,
        authorityConfirmed: true,
        primaryAdapter: "figma-desktop-mcp-local",
        fallbackPolicy: "deny" as const,
        estimatedRawChars: 24_000,
        compactBudgetChars: 3_000,
      },
      {
        domain: "atlassian" as const,
        sourceDecisionIds: ["source-confluence-22222222"],
        confirmed: true,
        authorityConfirmed: true,
        primaryAdapter: "atlassian-rovo",
        fallbackPolicy: "deny" as const,
        estimatedRawChars: 12_000,
        compactBudgetChars: 2_000,
      },
      {
        domain: "openapi" as const,
        sourceDecisionIds: ["source-openapi-33333333"],
        confirmed: true,
        authorityConfirmed: true,
        primaryAdapter: "openapi-public-http",
        fallbackPolicy: "deny" as const,
        estimatedRawChars: 18_000,
        compactBudgetChars: 2_400,
      },
      {
        domain: "code" as const,
        sourceDecisionIds: [],
        confirmed: true,
        authorityConfirmed: true,
        primaryAdapter: "project-atlas",
        fallbackPolicy: "deny" as const,
        estimatedRawChars: 7_000,
        compactBudgetChars: 2_000,
      },
    ];
    const disabled = planAgentDelegation({
      taskId: "task-2fa",
      explicitlyAllowed: false,
      coordinatorContextRemainingChars: 9_000,
      workItems,
    });
    expect(disabled).toMatchObject({
      enabled: false,
      maxConcurrent: 0,
      jobs: [],
      reason: expect.stringMatching(/not explicitly allowed/i),
    });

    const enabled = planAgentDelegation({
      taskId: "task-2fa",
      explicitlyAllowed: true,
      coordinatorContextRemainingChars: 9_000,
      workItems,
    });
    expect(enabled).toMatchObject({
      enabled: true,
      maxConcurrent: 2,
      coordinatorRetains: [
        "source-confirmation",
        "authority-resolution",
        "scope-decision",
        "single-implementation",
      ],
    });
    expect(enabled.jobs.map((item) => item.domain)).toEqual([
      "figma",
      "openapi",
    ]);
    expect(enabled.jobs.every((item) => item.permissions.implement === false))
      .toBe(true);
    expect(enabled.cost.totalWorkChars).toBeGreaterThan(
      enabled.cost.coordinatorWithoutDelegationChars,
    );
    expect(enabled.cost.netCoordinatorSavingsChars).toBeGreaterThan(8_000);
  });

  it("accepts only compact domain contracts for Figma, Rovo, OpenAPI, and code", () => {
    const figmaJob = job("figma", ["source-figma-11111111"]);
    const atlassianJob = job("atlassian", [
      "source-jira-22222222",
      "source-confluence-33333333",
    ]);
    const openApiJob = job("openapi", ["source-openapi-44444444"]);
    const codeJob = job("code");
    const results = [
      measured({
        schemaVersion: 1,
        jobId: figmaJob.id,
        taskId: "task-2fa",
        domain: "figma",
        status: "completed",
        sourceDecisionIds: figmaJob.sourceDecisionIds,
        receiptIds: ["receipt-1111111111111111"],
        payload: {
          kind: "figma",
          map: {
            fileKey: "FileKey",
            confirmedScopeId: "39:2731",
            selectedScopeIds: ["2064:5554"],
          },
          states: [{ id: "1:1", name: "OTP error", category: "error" }],
          overlays: [{ id: "2:2", name: "Loading overlay" }],
          responsive: [{ id: "3:3", viewport: "tablet" }],
          assets: [
            {
              handle:
                "figma-asset:task-2fa:aaaaaaaaaaaaaaaaaaaaaaaa",
              contentHash: `sha256:${"a".repeat(64)}`,
              format: "svg",
              bytes: 512,
            },
          ],
          codeConnect: "missing-advisory",
        },
        warnings: [],
      }),
      measured({
        schemaVersion: 1,
        jobId: atlassianJob.id,
        taskId: "task-2fa",
        domain: "atlassian",
        status: "completed",
        sourceDecisionIds: atlassianJob.sourceDecisionIds,
        receiptIds: [
          "receipt-2222222222222222",
          "receipt-3333333333333333",
        ],
        payload: {
          kind: "atlassian",
          requirements: [
            {
              id: "HH-554:ac-1",
              statement: "Require a login OTP challenge.",
              sourceDecisionId: "source-jira-22222222",
            },
          ],
          contradictions: [],
          versions: [
            {
              sourceDecisionId: "source-confluence-33333333",
              version: "12",
            },
          ],
        },
        warnings: [],
      }),
      measured({
        schemaVersion: 1,
        jobId: openApiJob.id,
        taskId: "task-2fa",
        domain: "openapi",
        status: "completed",
        sourceDecisionIds: openApiJob.sourceDecisionIds,
        receiptIds: ["receipt-4444444444444444"],
        payload: {
          kind: "openapi",
          contractIdentity: "https://api.example.com/swagger",
          operations: [
            {
              operationId: "verifyLoginOtp",
              method: "POST",
              path: "/auth/login/otp",
              typeNames: ["OtpChallenge", "OtpError"],
              errorStatuses: ["400", "401", "429"],
            },
          ],
          authentication: ["bearer"],
          derivationReceiptId: "receipt-4444444444444444",
        },
        warnings: [],
      }),
      measured({
        schemaVersion: 1,
        jobId: codeJob.id,
        taskId: "task-2fa",
        domain: "code",
        status: "completed",
        sourceDecisionIds: [],
        receiptIds: [],
        payload: {
          kind: "code",
          changeSurface: {
            primaryId: "LoginChallenge",
            files: [
              {
                path: "components/LoginChallenge.vue",
                role: "implementation",
              },
            ],
            referenceIds: ["BackofficeLogin"],
            outOfScope: ["ProfileFingerprintModal"],
          },
          reuseDecision: {
            kind: "compose",
            componentId: "LoginChallenge",
            reason: "Compose the existing OTP field and modal primitives.",
          },
        },
        warnings: [],
      }),
    ];

    for (const [result, contract] of [
      [results[0]!, figmaJob],
      [results[1]!, atlassianJob],
      [results[2]!, openApiJob],
      [results[3]!, codeJob],
    ] as const) {
      expect(() => assertCompactDelegationResult(result, contract)).not.toThrow();
    }
    expect(JSON.stringify(results)).not.toMatch(
      /<svg|localhost:3845|responseBody|metadataXml/iu,
    );
  });

  it("rejects raw bodies and never reinserts them into coordinator evidence", () => {
    const figmaJob = job("figma", ["source-figma-11111111"]);
    const result = measured({
      schemaVersion: 1,
      jobId: figmaJob.id,
      taskId: "task-2fa",
      domain: "figma",
      status: "blocked",
      sourceDecisionIds: figmaJob.sourceDecisionIds,
      receiptIds: [],
      warnings: [],
      blocker: "Desktop MCP did not expose the selected node.",
    });
    const plan = {
      ...planAgentDelegation({
        taskId: "task-2fa",
        explicitlyAllowed: true,
        coordinatorContextRemainingChars: 8_000,
        workItems: [
          {
            domain: "figma" as const,
            sourceDecisionIds: figmaJob.sourceDecisionIds,
            confirmed: true,
            authorityConfirmed: true,
            primaryAdapter: "figma-desktop-mcp-local",
            fallbackPolicy: "deny" as const,
            estimatedRawChars: 30_000,
            compactBudgetChars: 4_000,
          },
        ],
      }),
      jobs: [figmaJob],
      maxConcurrent: 1 as const,
      enabled: true,
    };
    expect(() =>
      assertAgentDelegationBundle({ plan, results: [result] }),
    ).not.toThrow();
    const injected = compactDelegatedEvidence({ plan, results: [result] });
    expect(injected.length).toBeLessThanOrEqual(8_000);
    expect(injected).not.toMatch(/<svg|localhost:3845|raw source/iu);

    const unsafe = {
      ...result,
      payload: {
        kind: "figma",
        raw: "<svg><path /></svg>",
      },
      metrics: { outputChars: 0, rawBodiesIncluded: false as const },
    } as unknown as AgentDelegationResult;
    unsafe.metrics.outputChars = JSON.stringify(unsafe).length;
    expect(() => assertCompactDelegationResult(unsafe, figmaJob)).toThrow(
      /invalid|forbidden|raw body/i,
    );
  });
});
