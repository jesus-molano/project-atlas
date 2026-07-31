import { describe, expect, it } from "vitest";
import { mergedObjective } from "./core-tool-helpers.js";

describe("core objective merge", () => {
  it("keeps a long exact objective byte-for-byte", () => {
    const objective = `${"Acceptance criterion. ".repeat(80)}TAIL-SENTINEL`;
    expect(mergedObjective(objective, objective)).toBe(objective);
  });

  it("binds a tail update instead of comparing only a compact prefix", () => {
    const prior = "Shared prefix. ".repeat(40);
    const merged = mergedObjective(prior, "Preserve the final sentinel state.");
    expect(merged).toBe(
      `${prior.trim()}\nUpdate: Preserve the final sentinel state.`,
    );
  });

  it("rejects an oversized cumulative objective without truncating authority", () => {
    expect(() => mergedObjective("a".repeat(5_990), "tail update")).toThrow(
      /never truncate authority silently/i,
    );
  });
});
