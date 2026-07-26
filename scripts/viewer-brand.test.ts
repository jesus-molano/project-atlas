import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Project Atlas brand mark", () => {
  it("draws shared SVG edges before its three semantic nodes", async () => {
    const page = await readFile(
      new URL("../apps/viewer/app/pages/index.vue", import.meta.url),
      "utf8",
    );
    const css = await readFile(
      new URL("../apps/viewer/app/assets/css/main.css", import.meta.url),
      "utf8",
    );
    const mark = page.slice(
      page.indexOf('<svg\n            class="atlas-mark"'),
      page.indexOf("</svg>") + "</svg>".length,
    );

    expect(mark).toContain('viewBox="0 0 31 31"');
    expect(mark).toContain('aria-hidden="true"');
    expect(mark.match(/<line /g)).toHaveLength(3);
    expect(mark.match(/<circle /g)).toHaveLength(3);
    expect(mark.indexOf("<line ")).toBeLessThan(mark.indexOf("<circle "));
    expect(css).not.toMatch(/\.atlas-mark::(?:before|after)/);
    expect(css).not.toMatch(/\.atlas-mark span/);
    expect(css).toContain("vector-effect: non-scaling-stroke");
  });
});
