import { describe, expect, it } from "vitest";
import { projectAtlasActions } from "./actions.js";

describe("Action and Capability Manifest", () => {
  it("keeps native actions versioned, unique, and honest about writes", () => {
    expect(projectAtlasActions.length).toBeGreaterThanOrEqual(5);
    expect(new Set(projectAtlasActions.map((action) => action.id)).size).toBe(
      projectAtlasActions.length,
    );
    for (const action of projectAtlasActions) {
      expect(action.schemaVersion).toBe(1);
      expect(action.intent.length).toBeGreaterThan(4);
      expect(action.resultKind).toBeTruthy();
      expect(action.timeoutMs).toBeGreaterThan(0);
      if (action.executionClass === "local") {
        expect(action.adapter).toBeUndefined();
        expect(action.possibleWrites).not.toContain("external");
      }
      if (action.executionClass === "agent-assisted") {
        expect(action.adapter).toBeTruthy();
        expect(action.cancellable).toBe(true);
        expect(action.resumable).toBe(true);
      }
      if (action.possibleWrites.includes("checkout")) {
        expect(action.risk).not.toBe("low");
      }
    }
  });

  it("does not model external mutations as implicit task preparation", () => {
    const taskActions = projectAtlasActions.filter((action) =>
      action.id.includes("frontend-task"),
    );
    expect(taskActions.length).toBeGreaterThan(0);
    for (const action of taskActions) {
      expect(action.executionClass).toBe("agent-assisted");
      expect(action.possibleWrites).not.toContain("jira");
      expect(action.possibleWrites).not.toContain("figma");
      expect(action.possibleWrites).not.toContain("github");
    }
  });
});
