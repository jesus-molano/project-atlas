import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanReactProject, scanReactProjectDetailed } from "./index.js";

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
          type: "\"primary\" | \"danger\"",
          defaultValue: "\"primary\"",
        }),
        expect.objectContaining({ name: "disabled", required: false }),
      ]),
    );
    expect(salary?.renderedNames).toEqual(
      expect.arrayContaining(["DialogSummary", "Button"]),
    );
    expect(summary?.visibility).toBe("private");
  });

  it("reports syntax failures instead of claiming complete coverage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-react-error-"));
    try {
      await mkdir(path.join(root, "src"), { recursive: true });
      await writeFile(
        path.join(root, "src", "Broken.tsx"),
        "export function Broken( { return <div />; }",
        "utf8",
      );
      const result = await scanReactProjectDetailed({ rootPath: root });
      expect(result.coverage).toMatchObject({
        candidateFiles: 1,
        parsedFiles: 0,
        errorFiles: 1,
        complete: false,
      });
      expect(result.coverage.diagnostics[0]).toMatchObject({
        code: "react-syntax",
        path: "src/Broken.tsx",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
