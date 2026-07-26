import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGraphEdges } from "@component-atlas/core";
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
    const settings = components.find(
      (item) => item.effectiveName === "FormsAccountSettingsForm",
    );
    const route = components.find((item) => item.kind === "route");

    expect(components).toHaveLength(6);
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
    expect(settings?.props).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "accountId",
          type: "string",
          required: true,
        }),
        expect.objectContaining({
          name: "density",
          type: '"compact" | "comfortable"',
          required: false,
          defaultValue: '"comfortable"',
        }),
        expect.objectContaining({
          name: "label",
          required: false,
          defaultValue: '"Account settings"',
        }),
        expect.objectContaining({
          name: "locked",
          type: "boolean",
          required: false,
        }),
      ]),
    );
    expect(settings?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "save",
          payload: "payload: SettingsPayload",
        }),
        expect.objectContaining({ name: "cancel" }),
        expect.objectContaining({
          name: "validated",
          payload: "[valid: boolean]",
        }),
      ]),
    );
    expect(settings?.testPaths).toEqual(
      expect.arrayContaining([
        "tests/unit/components/forms/AccountSettingsForm.spec.ts",
        "app/components/forms/__tests__/AutoImportedForm.spec.ts",
      ]),
    );
    expect(settings?.testPaths).not.toContain(
      "tests/unit/components/forms/AccountSettingsFormHelpers.spec.ts",
    );
    expect(confirm?.renderedNames).toContain("UiBaseModal");
    expect(hint?.visibility).toBe("private");
    expect(route).toMatchObject({
      name: "Dialogs",
      exported: false,
      visibility: "private",
      renderedNames: ["ConfirmDialog"],
    });
    const confirmNode = components.find((item) => item.name === "ConfirmDialog");
    expect(
      buildGraphEdges(components).some(
        (edge) =>
          edge.kind === "renders" &&
          edge.source === route?.id &&
          edge.target === confirmNode?.id,
      ),
    ).toBe(true);
  });
});
