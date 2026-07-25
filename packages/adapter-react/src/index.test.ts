import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanReactProject } from "./index.js";

const fixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/react-next",
);

describe("ReactAdapter", () => {
  it("indexes exported and private React components", async () => {
    const components = await scanReactProject({ rootPath: fixture });
    const button = components.find((item) => item.name === "Button");
    const salary = components.find((item) => item.name === "SalaryDialog");
    const summary = components.find((item) => item.name === "DialogSummary");

    expect(components).toHaveLength(5);
    expect(button?.visibility).toBe("public");
    expect(button?.slots).toContain("children");
    expect(button?.testPaths).toHaveLength(1);
    expect(button?.props).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "children", required: true }),
        expect.objectContaining({
          name: "variant",
          type: '"primary" | "danger"',
          defaultValue: '"primary"',
        }),
        expect.objectContaining({ name: "disabled", required: false }),
      ]),
    );
    expect(salary?.renderedNames).toEqual(
      expect.arrayContaining(["DialogSummary", "Button"]),
    );
    expect(summary?.visibility).toBe("private");
  });
});
