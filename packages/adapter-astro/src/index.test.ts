import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanAstroProjectDetailed } from "./index.js";

const fixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/framework-support/projects/astro-mixed",
);

describe("AstroAdapter", () => {
  it("indexes Astro components, routes, layouts, slots, and island directives", async () => {
    const result = await scanAstroProjectDetailed({ rootPath: fixture });

    expect(result.coverage).toMatchObject({
      candidateFiles: 4,
      parsedFiles: 3,
      skippedFiles: 1,
      errorFiles: 0,
      complete: false,
    });
    expect(result.components).toHaveLength(4);
    expect(
      result.components.find((component) => component.name === "Card"),
    ).toMatchObject({
      kind: "component",
      props: expect.arrayContaining([
        expect.objectContaining({ name: "title", required: true }),
      ]),
      slots: expect.arrayContaining(["default"]),
    });
    expect(
      result.components.find(
        (component) => component.relativePath === "src/layouts/Base.astro",
      ),
    ).toMatchObject({ kind: "layout", role: "layout" });
    expect(
      result.components.find(
        (component) => component.relativePath === "src/pages/index.astro",
      ),
    ).toMatchObject({
      kind: "route",
      routePath: "/",
      renderReferences: expect.arrayContaining([
        expect.objectContaining({ name: "Card", directive: "server:defer" }),
        expect.objectContaining({ name: "Counter", directive: "client:load" }),
        expect.objectContaining({ name: "Status", directive: "client:visible" }),
      ]),
    });
  });

  it("reports invalid frontmatter as incomplete coverage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-astro-error-"));
    try {
      await mkdir(path.join(root, "src", "components"), { recursive: true });
      await writeFile(
        path.join(root, "src", "components", "Broken.astro"),
        "---\nconst value = ;\n---\n<div>{value}</div>",
        "utf8",
      );
      const result = await scanAstroProjectDetailed({ rootPath: root });
      expect(result.coverage).toMatchObject({
        candidateFiles: 1,
        parsedFiles: 0,
        errorFiles: 1,
        complete: false,
      });
      expect(result.coverage.diagnostics[0]).toMatchObject({
        code: "astro-parse",
        path: "src/components/Broken.astro",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
