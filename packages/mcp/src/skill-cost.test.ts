import { describe, expect, it } from "vitest";
import { measureFrontendTaskSkillCost } from "./skill-cost.js";

describe("frontend-task skill cost", () => {
  it("measures the routed references instead of reporting a hard-coded zero", async () => {
    await expect(measureFrontendTaskSkillCost()).resolves.toMatchObject({
      measurement: "exact",
      skillChars: expect.any(Number),
      skillReferenceChars: expect.any(Number),
      skillReferenceFiles: expect.any(Number),
      skillManifestHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    const cost = await measureFrontendTaskSkillCost();
    expect(cost.skillChars).toBeGreaterThan(0);
    expect(cost.skillReferenceChars).toBeGreaterThan(0);
    expect(cost.skillReferenceFiles).toBeGreaterThan(0);
  });
});
