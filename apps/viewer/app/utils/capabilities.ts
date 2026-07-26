import type { CapabilityObservation } from "@component-atlas/core/browser";

const SIMULATION_MARKERS = /\b(?:synthetic|simulated|fake|fixture)\b/i;

export function isSimulatedCapability(
  capability: Pick<CapabilityObservation, "detail">,
): boolean {
  return SIMULATION_MARKERS.test(capability.detail ?? "");
}

export function capabilityDisplayState(
  capability: Pick<CapabilityObservation, "state" | "detail">,
): string {
  return isSimulatedCapability(capability)
    ? `simulated ${capability.state}`
    : capability.state;
}
