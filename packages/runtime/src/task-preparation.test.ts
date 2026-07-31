import {
  assessTaskRisk,
  ensureTaskSourceDecisions,
  type TaskIntakeState,
} from "@component-atlas/core";
import { describe, expect, it, vi } from "vitest";
import {
  prepareTaskContext,
  TaskPreparationBlockedError,
} from "./task-preparation.js";

function intake(
  objective: string,
  sources = ensureTaskSourceDecisions(objective, []),
): TaskIntakeState {
  return {
    schemaVersion: 1,
    scope: "task",
    objective,
    objectiveConfirmed: true,
    risk: assessTaskRisk(objective),
    sources,
  };
}

describe("guarded task preparation", () => {
  it("does not invent source gates for a high-risk task without declared sources", async () => {
    const getContext = vi.fn();
    getContext.mockResolvedValue({ ok: true } as never);
    await expect(
      prepareTaskContext(
        "/repo",
        intake("Change production authentication"),
        {},
        { getContext },
      ),
    ).resolves.toEqual({ ok: true });
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it("calls context generation only after all high-risk source decisions resolve", async () => {
    const sequence: string[] = [];
    const objective = "Change production authentication";
    const sources = ensureTaskSourceDecisions(objective, []).map((source) => ({
      ...source,
      state: "omitted" as const,
      decidedAt: "2026-07-29T12:00:00.000Z",
    }));
    const getContext = vi.fn(async () => {
      sequence.push("context");
      return { ok: true } as never;
    });
    sequence.push("gate");
    await prepareTaskContext("/repo", intake(objective, sources), {}, {
      getContext,
    });
    expect(sequence).toEqual(["gate", "context"]);
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it("blocks an unresolved exact source before composing any local context", async () => {
    const sequence: string[] = [];
    const objective =
      "Match exactly https://www.figma.com/design/AtlasFile/Recovery?node-id=60-2";
    const sources = ensureTaskSourceDecisions(objective, []).map((source) => ({
      ...source,
      state: "confirmed" as const,
      decidedAt: "2026-07-29T12:00:00.000Z",
    }));
    const getContext = vi.fn(async () => {
      sequence.push("context");
      return { ok: true } as never;
    });
    const preflightSources = vi.fn(async () => {
      sequence.push("source-preflight");
      return {
        reasons: ["The exact confirmed Figma node has not been synchronized."],
      };
    });
    await expect(
      prepareTaskContext("/repo", intake(objective, sources), {}, {
        getContext,
        preflightSources,
      }),
    ).rejects.toBeInstanceOf(TaskPreparationBlockedError);
    expect(sequence).toEqual(["source-preflight"]);
    expect(getContext).not.toHaveBeenCalled();
  });
});
