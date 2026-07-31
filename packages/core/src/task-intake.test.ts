import { describe, expect, it } from "vitest";
import {
  assessTaskIntake,
  assessScopedTaskRisk,
  assessTaskRisk,
  detectTaskSources,
  ensureTaskSourceDecisions,
  normalizeTaskSourceDecisions,
  normalizeTaskSourceRelations,
  taskContextSourcePolicy,
  taskSourceId,
  type TaskIntakeState,
} from "./task-intake.js";

describe("task intake", () => {
  it("does not grill a clearly small presentation change", () => {
    expect(assessTaskRisk("Fix the typo in the settings button label")).toMatchObject({
      level: "low",
      requiresObjectiveConfirmation: false,
    });
  });

  it("requires confirmation for risky or connected work", () => {
    expect(assessTaskRisk("Change authentication permissions")).toMatchObject({
      level: "high",
      requiresObjectiveConfirmation: true,
    });
    expect(assessTaskRisk("Implement the Figma responsive navigation")).toMatchObject({
      level: "medium",
      requiresObjectiveConfirmation: true,
    });
    expect(
      assessTaskRisk(
        "En Problem Tags, igual que en Back Office, habilitar biometría para el doble factor.",
      ),
    ).toMatchObject({
      level: "high",
      reasons: expect.arrayContaining([
        "Biometric or multi-factor authentication",
      ]),
      requiresObjectiveConfirmation: true,
    });
  });

  it("escalates risk monotonically from the discovered change surface", () => {
    expect(
      assessScopedTaskRisk("Change the button color", {
        impact: {
          level: "high",
          directConsumers: 14,
          transitiveConsumers: 31,
        },
        publicApiChanged: true,
        implementationFiles: 9,
      }),
    ).toMatchObject({
      level: "high",
      requiresObjectiveConfirmation: true,
      reasons: expect.arrayContaining([
        "High-impact shared surface",
        "Public component API change",
        "Broad implementation surface",
      ]),
    });
  });

  it("detects links and inferred issue keys without confirming them", () => {
    const sources = detectTaskSources(
      "Implement APP-42 from https://www.figma.com/design/abc123/My-file",
    );
    expect(sources.map(({ kind, state }) => ({ kind, state }))).toEqual([
      { kind: "figma", state: "pending" },
      { kind: "jira", state: "pending" },
    ]);
  });

  it("does not ask twice when a Jira key is already inside its URL", () => {
    const sources = detectTaskSources(
      "Use https://example.atlassian.net/browse/APP-42.",
    );
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ kind: "jira", state: "pending" });
  });

  it("detects OpenAPI URLs and common local filenames without accessing them", () => {
    const sources = detectTaskSources(
      "Review https://api.example.com/v1/openapi.json and ./contracts/swagger.yaml",
    );
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "openapi",
          reference: "https://api.example.com/v1/openapi.json",
          state: "pending",
        }),
        expect.objectContaining({
          kind: "openapi",
          reference: "./contracts/swagger.yaml",
          state: "pending",
        }),
      ]),
    );
    expect(assessTaskRisk("Implement the API from openapi.yaml").level).toBe(
      "medium",
    );
  });

  it("never auto-confirms an OpenAPI specification from task wording", () => {
    expect(detectTaskSources("Use ./openapi.yaml to implement checkout")[0]).toMatchObject({
      kind: "openapi",
      reference: "./openapi.yaml",
      state: "pending",
      required: true,
    });
    const prefixed = detectTaskSources(
      "Use OpenAPI: https://api.example.com/v1/openapi.json for checkout",
    );
    expect(prefixed).toHaveLength(1);
    expect(prefixed[0]).toMatchObject({
      kind: "openapi",
      state: "pending",
      required: true,
    });
  });

  it("uses semantic identities for equivalent Figma and OpenAPI references", () => {
    expect(
      taskSourceId(
        "figma",
        "https://www.figma.com/design/FileKey/Old-slug?node-id=39-2731&utm_source=atlas",
      ),
    ).toBe(
      taskSourceId(
        "figma",
        "https://www.figma.com/design/FileKey/New-slug?node-id=39:2731",
      ),
    );
    expect(
      taskSourceId(
        "openapi",
        "https://api.example.com/openapi.json?b=2&a=1#operations",
      ),
    ).toBe(
      taskSourceId(
        "openapi",
        "https://api.example.com/openapi.json?a=1&b=2",
      ),
    );
  });

  it("allows a source to be resolved externally without claiming retrieval", () => {
    const objective =
      "Render catalog cards from https://api.example.com/openapi.json";
    const sources = detectTaskSources(objective).map((source) => ({
      ...source,
      state: "external" as const,
      decidedAt: new Date(0).toISOString(),
    }));
    expect(
      assessTaskIntake({
        schemaVersion: 1,
        scope: "task",
        objective,
        objectiveConfirmed: true,
        risk: assessTaskRisk(objective),
        sources,
      }),
    ).toMatchObject({ status: "ready" });
    expect(taskContextSourcePolicy(sources)).toMatchObject({
      confirmedKinds: [],
      externalKinds: ["openapi"],
    });
  });

  it("blocks a required source that was moved outside Atlas authority", () => {
    const objective =
      "Render catalog cards from https://api.example.com/openapi.json";
    const sources = detectTaskSources(objective).map((source) => ({
      ...source,
      required: true,
      state: "external" as const,
      decidedAt: new Date(0).toISOString(),
    }));
    expect(
      assessTaskIntake({
        schemaVersion: 1,
        scope: "task",
        objective,
        objectiveConfirmed: true,
        risk: assessTaskRisk(objective),
        sources,
      }),
    ).toMatchObject({ status: "blocked" });
  });

  it("does not invent absent source categories for a high-risk task", () => {
    const objective = "Change authentication permissions";
    const sources = ensureTaskSourceDecisions(objective, []);
    expect(sources).toEqual([]);
    expect(
      assessTaskIntake({
        schemaVersion: 1,
        scope: "task",
        objective,
        objectiveConfirmed: true,
        risk: assessTaskRisk(objective),
        sources: [],
      }),
    ).toMatchObject({ status: "ready" });
  });

  it("blocks execution until objective and source choices are explicit", () => {
    const sources = detectTaskSources("Implement APP-42");
    const intake: TaskIntakeState = {
      schemaVersion: 1,
      scope: "task",
      objective: "Implement APP-42",
      objectiveConfirmed: false,
      risk: assessTaskRisk("Implement APP-42"),
      sources,
    };
    expect(assessTaskIntake(intake).status).toBe("needs-confirmation");
    intake.objectiveConfirmed = true;
    intake.sources[0] = {
      ...intake.sources[0]!,
      state: "omitted",
      decidedAt: new Date(0).toISOString(),
    };
    expect(assessTaskIntake(intake).status).toBe("ready");
  });

  it("normalizes untrusted source ledgers before connector access", () => {
    expect(
      normalizeTaskSourceDecisions([
        {
          id: "client-controlled",
          kind: "jira",
          reference: " APP-42 ",
          origin: "manual",
          state: "confirmed",
          required: false,
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        id: taskSourceId("jira", "APP-42"),
        reference: "APP-42",
      }),
    ]);
    expect(() =>
      normalizeTaskSourceDecisions([
        {
          kind: "figma",
          reference: "http://127.0.0.1/private",
          origin: "manual",
          state: "confirmed",
          required: false,
        },
      ]),
    ).toThrow(/invalid/i);
    expect(() =>
      normalizeTaskSourceDecisions([
        {
          kind: "confluence",
          reference:
            "https://example.atlassian.net/wiki/spaces/APP/pages/123/Spec",
          origin: "inferred",
          state: "confirmed",
          required: false,
          parentSourceId: taskSourceId("jira", "APP-42"),
          relationship: "linked-secondary",
        },
      ]),
    ).toThrow(/promoted to an explicit primary/i);
  });

  it("records authority, primary provider, and explicit source-to-scope relations", () => {
    const decisions = normalizeTaskSourceDecisions([
      {
        kind: "confluence",
        reference: "confluence:470516116",
        origin: "explicit",
        state: "confirmed",
        required: true,
        routePolicy: {
          primaryAdapter: "atlassian-rovo",
          fallback: "deny",
        },
      },
      {
        kind: "figma",
        reference:
          "https://www.figma.com/design/FileKey/Login?node-id=39-2731",
        origin: "explicit",
        state: "confirmed",
        required: true,
        routePolicy: {
          primaryAdapter: "figma-desktop-mcp-local",
          fallback: "deny",
        },
      },
    ]);
    const relations = normalizeTaskSourceRelations(
      [
        {
          fromSourceId: decisions[0]!.id,
          toSourceId: decisions[1]!.id,
          kind: "references-design",
          targetScope: {
            provider: "figma",
            kind: "selection",
            id: "2064:5554",
          },
        },
      ],
      decisions,
    );

    expect(decisions.map((source) => source.authorityRole)).toEqual([
      "requirement",
      "visual",
    ]);
    expect(taskContextSourcePolicy(decisions, relations)).toMatchObject({
      routes: [
        {
          primaryAdapter: "atlassian-rovo",
          fallback: "deny",
        },
        {
          primaryAdapter: "figma-desktop-mcp-local",
          fallback: "deny",
        },
      ],
      relations: [
        {
          kind: "references-design",
          targetScope: { id: "2064:5554" },
        },
      ],
    });
  });
});
