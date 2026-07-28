import { describe, expect, it } from "vitest";
import {
  assessTaskIntake,
  assessTaskRisk,
  detectTaskSources,
  normalizeTaskSourceDecisions,
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
  });
});
