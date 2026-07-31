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
    const unitScriptName = "test:unit:built";
    const unitScript = rootPackage.scripts?.[unitScriptName] ?? "";
    const prepareIndex = testScript.indexOf("prepare:viewer");
    const unitIndex = testScript.indexOf(unitScriptName);

    expect(rootPackage.scripts?.["prepare:viewer"]).toContain("nuxt prepare");
    expect(prepareIndex).toBeGreaterThanOrEqual(0);
    expect(unitIndex).toBeGreaterThan(prepareIndex);
    expect(unitScript).toContain("vitest run");
  });
});
