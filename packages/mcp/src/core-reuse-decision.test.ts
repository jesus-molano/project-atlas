import { describe, expect, it } from "vitest";
import { assertReuseDecisionInvariants } from "./core-reuse-decision.js";

const components = ["component:a", "component:b"];

describe("core reuse decision invariants", () => {
  it("canonicalizes a valid existing-component decision", () => {
    expect(
      assertReuseDecisionInvariants({
        decision: "extend",
        existingComponentIds: components,
        primaryComponentId: "component:a",
        hasPrimarySurface: false,
        selectedComponentIds: ["component:a", "component:a"],
        rejectedComponentIds: ["component:b"],
        rationale: "Extend the existing shared API.",
      }),
    ).toEqual({
      selectedComponentIds: ["component:a"],
      rejectedComponentIds: ["component:b"],
    });
  });

  it.each(["reuse", "extend", "compose", "extract-and-reuse"] as const)(
    "requires the primary graph component to be selected for %s",
    (decision) => {
      expect(() =>
        assertReuseDecisionInvariants({
          decision,
          existingComponentIds: components,
          primaryComponentId: "component:a",
          hasPrimarySurface: false,
          selectedComponentIds: [],
          rationale: "Explicit decision.",
        }),
      ).toThrow(/primary component must be selected/i);
    },
  );

  it("rejects unknown, overlapping and self-contradictory component IDs", () => {
    expect(() =>
      assertReuseDecisionInvariants({
        decision: "reuse",
        existingComponentIds: components,
        primaryComponentId: "component:a",
        hasPrimarySurface: false,
        selectedComponentIds: ["component:missing"],
        rationale: "Reuse.",
      }),
    ).toThrow(/does not exist/i);
    expect(() =>
      assertReuseDecisionInvariants({
        decision: "reuse",
        existingComponentIds: components,
        primaryComponentId: "component:a",
        hasPrimarySurface: false,
        selectedComponentIds: ["component:a"],
        rejectedComponentIds: ["component:a"],
        rationale: "Reuse.",
      }),
    ).toThrow(/both selected and rejected/i);
  });

  it("requires create to target a future surface with an auditable search", () => {
    expect(
      assertReuseDecisionInvariants({
        decision: "create",
        existingComponentIds: components,
        hasPrimarySurface: true,
        rejectedComponentIds: ["component:a"],
        rationale: "The candidate cannot satisfy the interaction contract.",
      }),
    ).toEqual({
      selectedComponentIds: [],
      rejectedComponentIds: ["component:a"],
    });
    expect(() =>
      assertReuseDecisionInvariants({
        decision: "create",
        existingComponentIds: components,
        hasPrimarySurface: true,
        rationale: "Build a new component.",
      }),
    ).toThrow(/name real rejected candidates/i);
    expect(
      assertReuseDecisionInvariants({
        decision: "create",
        existingComponentIds: components,
        hasPrimarySurface: true,
        rationale: "No hay ningún candidato viable para esta responsabilidad.",
      }).selectedComponentIds,
    ).toEqual([]);
  });

  it("keeps not-applicable free of component candidate bookkeeping", () => {
    expect(() =>
      assertReuseDecisionInvariants({
        decision: "not-applicable",
        existingComponentIds: components,
        hasPrimarySurface: true,
        rejectedComponentIds: ["component:a"],
        rationale: "Configuration-only change.",
      }),
    ).toThrow(/cannot select or reject/i);
  });
});
