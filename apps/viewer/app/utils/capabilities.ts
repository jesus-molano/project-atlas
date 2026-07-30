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
  if (isSimulatedCapability(capability)) {
    return `simulated ${capability.state}`;
  }
  if (capability.state === "unknown") {
    return "not reported in this session";
  }
  if (/\bcache\b/i.test(capability.detail ?? "")) {
    return "local cache; state and freshness reported separately";
  }
  return capability.state;
}
