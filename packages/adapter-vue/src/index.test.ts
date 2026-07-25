import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanVueProject } from "./index.js";

const fixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/vue-nuxt",
);

describe("VueAdapter", () => {
  it("indexes Nuxt runtime names, macros, auto-imports, and local components", async () => {
    const components = await scanVueProject({ rootPath: fixture });
    const modal = components.find((item) => item.effectiveName === "UiBaseModal");
    const confirm = components.find(
      (item) => item.effectiveName === "FeatureConfirmDialog",
    );
    const hint = components.find((item) => item.name === "InlineHint");

    expect(components).toHaveLength(4);
    expect(modal?.props).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "title", required: true }),
        expect.objectContaining({
          name: "open",
          required: false,
          defaultValue: "false",
        }),
        expect.objectContaining({
          name: "size",
          type: "'sm' | 'md' | 'lg'",
          defaultValue: "'md'",
        }),
      ]),
    );
    expect(modal?.slots).toEqual(expect.arrayContaining(["default", "footer"]));
    expect(modal?.testPaths).toHaveLength(1);
    expect(confirm?.renderedNames).toContain("UiBaseModal");
    expect(hint?.visibility).toBe("private");
  });
});
