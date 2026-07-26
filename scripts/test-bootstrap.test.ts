import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rootPackage = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../package.json", import.meta.url)),
    "utf8",
  ),
) as { scripts?: Record<string, string> };

describe("clean-checkout test bootstrap", () => {
  it("generates Nuxt types before Vitest imports Viewer modules", () => {
    const testScript = rootPackage.scripts?.test ?? "";
    const prepareIndex = testScript.indexOf("prepare:viewer");
    const vitestIndex = testScript.indexOf("vitest run");

    expect(rootPackage.scripts?.["prepare:viewer"]).toContain("nuxt prepare");
    expect(prepareIndex).toBeGreaterThanOrEqual(0);
    expect(vitestIndex).toBeGreaterThan(prepareIndex);
  });
});
