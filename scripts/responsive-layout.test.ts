import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(
    new URL("../apps/viewer/app/assets/css/main.css", import.meta.url),
  ),
  "utf8",
);
const codeAtlas = readFileSync(
  fileURLToPath(
    new URL("../apps/viewer/app/components/CodeAtlasView.vue", import.meta.url),
  ),
  "utf8",
);

function usefulWidth(viewport: number, scale = 1): number {
  const cssViewport = Math.floor(viewport / scale);
  if (cssViewport <= 860) return cssViewport - 48;
  const sidebar = cssViewport <= 1360 ? 224 : 256;
  const horizontalPadding = cssViewport <= 1360 ? 48 : 72;
  return cssViewport - sidebar - horizontalPadding;
}

function memoryColumns(width: number): 1 | 2 | 3 {
  if (width <= 900) return 1;
  if (width <= 1100) return 2;
  return 3;
}

describe("evidence workspace responsive layout", () => {
  it("keeps Memory readable at 1280x800 instead of compressing three columns", () => {
    const width = usefulWidth(1280);
    expect(width).toBe(1008);
    expect(memoryColumns(width)).toBe(2);
    expect(width - 320).toBeGreaterThanOrEqual(420);
    expect(css).toContain("container-name: atlas-workspace");
    expect(css).toContain("@container atlas-workspace (max-width: 1100px)");
    expect(css).toContain("@container atlas-workspace (max-width: 900px)");
  });

  it("lets the Code graph introduction use the full toolbar width", () => {
    expect(css).toMatch(
      /\.map-toolbar\s*>\s*div:first-child\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/s,
    );
  });

  it("uses compact, accessible icon controls for the graph viewport", () => {
    for (const label of [
      "Inspect selected component",
      "Fit selection",
      "Fit graph",
      "Reset graph view",
    ]) {
      expect(codeAtlas).toContain(`aria-label="${label}"`);
      expect(codeAtlas).toContain(`title="${label}"`);
    }
    expect(codeAtlas).not.toContain(">Fit selection<");
    expect(codeAtlas).not.toContain(">Fit graph<");
  });

  it.each([
    [1440, 1, 3],
    [1280, 1, 2],
    [1152, 1, 1],
    [1024, 1, 1],
    [1280, 1.25, 1],
    [1280, 1.5, 1],
  ])(
    "selects a readable composition at %ipx and %sx scale",
    (viewport, scale, columns) => {
      expect(memoryColumns(usefulWidth(viewport, scale))).toBe(columns);
    },
  );
});
