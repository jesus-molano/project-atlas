import { describe, expect, it } from "vitest";
import {
  capabilityDisplayState,
  isSimulatedCapability,
} from "../apps/viewer/app/utils/capabilities";

describe("capability claim labels", () => {
  it("never presents self-identified fixture reports as live connections", () => {
    const simulated = {
      state: "connected" as const,
      detail: "Deterministic fake adapter.",
    };
    expect(isSimulatedCapability(simulated)).toBe(true);
    expect(capabilityDisplayState(simulated)).toBe("simulated connected");
  });

  it("preserves real and unavailable states without inventing simulation", () => {
    expect(
      capabilityDisplayState({
        state: "unavailable",
        detail: "Connector was not configured.",
      }),
    ).toBe("unavailable");
  });
});
