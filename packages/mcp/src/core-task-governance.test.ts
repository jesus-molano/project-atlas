import { assessTaskRisk } from "@component-atlas/core";
import { describe, expect, it } from "vitest";
import {
  classifyPreparedTaskGovernance,
  escalateLockedTaskGovernance,
  reconcilePreparedTaskGovernance,
  requiredTaskReviewTier,
} from "./core-task-governance.js";

describe("core task governance", () => {
  it.each([
    {
      objective: "Update the tooltip copy in the existing button.",
      roles: ["requirement"] as const,
      expected: { size: "small", risk: "low", reviewTier: "none" },
    },
    {
      objective:
        "Extend the shared DatePicker state and keyboard accessibility behavior.",
      roles: ["requirement", "visual"] as const,
      expected: {
        size: "medium",
        risk: "medium",
        reviewTier: "correctness",
      },
    },
    {
      objective:
        "Migrate the checkout workflow end-to-end across packages without changing its contract.",
      roles: ["requirement", "visual", "contract"] as const,
      expected: { size: "large", risk: "high", reviewTier: "specialist" },
    },
  ] as const)(
    "classifies a real $expected.size task at prepare",
    ({ objective, roles, expected }) => {
      expect(
        classifyPreparedTaskGovernance({
          objective,
          risk: assessTaskRisk(objective),
          confirmedAuthorityRoles: roles,
        }),
      ).toMatchObject(expected);
    },
  );

  it("uses source authority roles deterministically", () => {
    const objective = "Update the button copy.";
    const risk = assessTaskRisk(objective);
    const left = classifyPreparedTaskGovernance({
      objective,
      risk,
      confirmedAuthorityRoles: ["visual", "requirement", "visual"],
    });
    const right = classifyPreparedTaskGovernance({
      objective,
      risk,
      confirmedAuthorityRoles: ["requirement", "visual"],
    });
    expect(left).toEqual(right);
    expect(left).toMatchObject({
      size: "medium",
      risk: "low",
      reviewTier: "correctness",
    });
  });

  it("escalates from concrete file, public, shared and API evidence", () => {
    const initial = classifyPreparedTaskGovernance({
      objective: "Update the account card label.",
      risk: assessTaskRisk("Update the account card label."),
    });
    const medium = escalateLockedTaskGovernance(initial, {
      fileCount: 5,
      publicApiChanged: true,
      sharedSurface: true,
      apiContractChanged: true,
      impact: { level: "shared", directConsumers: 4 },
    });
    expect(medium).toMatchObject({
      size: "medium",
      risk: "medium",
      reviewTier: "correctness",
    });
    expect(medium.reasons).toEqual(
      expect.arrayContaining([
        "Shared component consumers",
        "Multi-file implementation surface: 5 files",
        "External API contract change",
        "Public component API change",
      ]),
    );
    expect(medium.reasons).toHaveLength(4);

    const large = escalateLockedTaskGovernance(medium, {
      fileCount: 9,
      apiContractChanged: true,
      impact: { level: "high", transitiveConsumers: 11 },
    });
    expect(large).toMatchObject({
      size: "large",
      risk: "high",
      reviewTier: "specialist",
    });
  });

  it("never lowers a persisted classification when lock evidence is narrow", () => {
    const current = {
      size: "large" as const,
      risk: "high" as const,
      reviewTier: "specialist" as const,
      reasons: ["Previously confirmed broad impact"],
    };
    expect(
      escalateLockedTaskGovernance(current, {
        fileCount: 1,
        impact: { level: "contained", directConsumers: 0 },
      }),
    ).toEqual(current);
  });

  it("reconciles repeated prepare classifications monotonically", () => {
    const current = {
      size: "large" as const,
      risk: "high" as const,
      reviewTier: "specialist" as const,
      reasons: ["Previously confirmed broad impact"],
    };
    const prepared = classifyPreparedTaskGovernance({
      objective: "Update the account card label.",
      risk: assessTaskRisk("Update the account card label."),
    });
    expect(reconcilePreparedTaskGovernance(current, prepared)).toMatchObject({
      size: "large",
      risk: "high",
      reviewTier: "specialist",
    });
  });

  it("derives review tiers and keeps reasons compact", () => {
    expect(requiredTaskReviewTier("small", "low")).toBe("none");
    expect(requiredTaskReviewTier("small", "medium")).toBe("correctness");
    expect(requiredTaskReviewTier("medium", "low")).toBe("correctness");
    expect(requiredTaskReviewTier("large", "low")).toBe("specialist");
    expect(requiredTaskReviewTier("small", "high")).toBe("specialist");

    const governance = classifyPreparedTaskGovernance({
      objective: "Update a shared component contract.",
      risk: {
        level: "medium",
        reasons: ["x".repeat(500)],
        requiresObjectiveConfirmation: true,
      },
      confirmedAuthorityRoles: ["contract"],
    });
    expect(governance.reasons.length).toBeLessThanOrEqual(4);
    expect(governance.reasons.every((reason) => reason.length <= 72)).toBe(true);
    expect(() =>
      escalateLockedTaskGovernance(governance, { fileCount: -1 }),
    ).toThrow(/non-negative integer/i);
  });
});
