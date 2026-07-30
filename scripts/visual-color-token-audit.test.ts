import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { readViewerCss } from "./viewer-css";

const appRoot = new URL("../apps/viewer/app", import.meta.url);
const sourceExtensions = new Set([".css", ".js", ".jsx", ".ts", ".tsx", ".vue"]);
const primitiveAllowlist = new Set([
  "atlas-neutral-1000",
  "atlas-neutral-950",
  "atlas-neutral-900",
  "atlas-neutral-875",
  "atlas-neutral-850",
  "atlas-neutral-800",
  "atlas-neutral-700",
  "atlas-neutral-650",
  "atlas-neutral-600",
  "atlas-neutral-500",
  "atlas-neutral-300",
  "atlas-neutral-100",
  "atlas-signal-500",
  "atlas-signal-400",
  "atlas-signal-950",
  "atlas-success-400",
  "atlas-error-400",
  "atlas-warning-400",
  "atlas-info-400",
  "atlas-code-400",
  "atlas-design-400",
  "atlas-memory-400",
  "atlas-code-border",
  "atlas-design-border",
  "atlas-memory-border",
]);

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return sourceExtensions.has(extname(path)) ? [path] : [];
    }),
  );
  return nested.flat();
}

describe("viewer color token boundary", () => {
  it("keeps raw colors inside the approved primitive token allowlist", async () => {
    const rootPath = appRoot.pathname.replace(/^\/([A-Z]:)/, "$1");
    const violations: string[] = [];

    for (const file of await sourceFiles(rootPath)) {
      const source = await readFile(file, "utf8");
      source.split(/\r?\n/).forEach((line, index) => {
        const literals = line.match(/#[\da-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi);
        if (!literals) return;
        const primitive = line.match(/^\s*--([\w-]+):\s*#[\da-f]{6};\s*$/i)?.[1];
        if (!primitive || !primitiveAllowlist.has(primitive)) {
          violations.push(
            `${relative(rootPath, file)}:${index + 1} ${line.trim()}`,
          );
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it("routes interactive and semantic states through dedicated aliases", async () => {
    const rootPath = appRoot.pathname.replace(/^\/([A-Z]:)/, "$1");
    const [css, graph] = await Promise.all([
      readViewerCss(),
      readFile(join(rootPath, "components", "AtlasGraph.client.vue"), "utf8"),
    ]);

    expect(css).toMatch(
      /:focus-visible[\s\S]*outline:\s*2px solid var\(--atlas-focus\)/,
    );
    expect(css).toMatch(
      /\.nav-group > button\.active[\s\S]*var\(--atlas-selection-soft\)/,
    );
    expect(css).toMatch(
      /\.secondary-button:active:not\(:disabled\)[\s\S]*var\(--atlas-selection\)/,
    );
    expect(css).toMatch(
      /button:disabled[\s\S]*var\(--atlas-ink-disabled\)/,
    );
    expect(css).toMatch(
      /\.inline-success[\s\S]*var\(--atlas-success\)/,
    );
    expect(css).toMatch(/\.inline-error[\s\S]*var\(--atlas-danger\)/);
    expect(css).toMatch(
      /\.loader,[\s\S]*border-top-color:\s*var\(--atlas-accent\)/,
    );
    expect(graph).toContain("graphToken(\"--atlas-graph-selected-overlay\")");
    expect(graph).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(/i);
  });

  it("limits the standalone favicon to its three self-contained brand colors", async () => {
    const favicon = await readFile(
      new URL("../apps/viewer/public/favicon.svg", import.meta.url),
      "utf8",
    );
    const colors = [
      ...new Set(favicon.match(/#[\da-f]{6}\b/gi)?.map((color) => color.toLowerCase())),
    ].sort();

    // A browser favicon cannot inherit the application's CSS custom properties.
    expect(colors).toEqual(["#0e1014", "#f1f3f5", "#ff5b4d"]);
  });
});
