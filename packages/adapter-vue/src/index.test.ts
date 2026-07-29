import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGraphEdges } from "@component-atlas/core";
import { scanVueProject, scanVueProjectDetailed } from "./index.js";

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

  it("reports SFC syntax failures instead of silently dropping template facts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-vue-error-"));
    try {
      await mkdir(path.join(root, "src"), { recursive: true });
      await writeFile(
        path.join(root, "src", "Broken.vue"),
        "<script setup>const value = ;</script><template><div></template>",
        "utf8",
      );
      const result = await scanVueProjectDetailed({ rootPath: root });
      expect(result.coverage).toMatchObject({
        candidateFiles: 1,
        parsedFiles: 0,
        errorFiles: 1,
        complete: false,
      });
      expect(result.coverage.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "src/Broken.vue" }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("marks unsupported SFC block languages as skipped coverage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-vue-pug-"));
    try {
      await mkdir(path.join(root, "src"), { recursive: true });
      await writeFile(
        path.join(root, "src", "PugCard.vue"),
        '<script>export default { props: ["title"] }</script><template lang="pug">article {{ title }}</template>',
        "utf8",
      );
      const result = await scanVueProjectDetailed({ rootPath: root });
      expect(result.coverage).toMatchObject({
        candidateFiles: 1,
        parsedFiles: 0,
        skippedFiles: 1,
        errorFiles: 0,
        complete: false,
      });
      expect(result.components[0]?.props.map((prop) => prop.name)).toEqual([
        "title",
      ]);
      expect(result.coverage.diagnostics[0]).toMatchObject({
        code: "vue-unsupported-sfc-block",
        path: "src/PugCard.vue",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
