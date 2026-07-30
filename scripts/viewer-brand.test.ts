import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readViewerCss } from "./viewer-css";

describe("Project Atlas Waypoint A brand mark", () => {
  it("uses one accessible decorative component with four route nodes", async () => {
    const [page, component, css] = await Promise.all([
      readFile(
        new URL("../apps/viewer/app/pages/index.vue", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../apps/viewer/app/components/AtlasMark.vue", import.meta.url),
        "utf8",
      ),
      readViewerCss(),
    ]);

    expect(page.match(/<AtlasMark \/>/g)).toHaveLength(2);
    expect(component).toContain("viewBox=\"0 0 32 32\"");
    expect(component).toContain("aria-hidden=\"true\"");
    expect(component).toContain("focusable=\"false\"");
    expect(component.match(/<path/g)).toHaveLength(1);
    expect(component.match(/<circle/g)).toHaveLength(4);
    expect(component.match(/atlas-mark-node-active/g)).toHaveLength(1);
    expect(component).toContain(
      "d=\"M5 29Q12.5 7.75 16 3Q19.5 7.75 27 29M10.5 18Q16 15 21.5 18\"",
    );
    expect(component).toMatch(/cx="16"\r?\n\s+cy="16\.5"/);
    expect(component).not.toMatch(/atlas-mark-(?:code|design|memory|edges)/);
    expect(css).toContain("stroke: currentcolor");
    expect(css).toContain("fill: var(--atlas-accent)");
    expect(css).not.toMatch(/\.atlas-mark::(?:before|after)/);
  });

  it("keeps the favicon geometry aligned with the application mark", async () => {
    const [component, favicon, config] = await Promise.all([
      readFile(
        new URL("../apps/viewer/app/components/AtlasMark.vue", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../apps/viewer/public/favicon.svg", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../apps/viewer/nuxt.config.ts", import.meta.url), "utf8"),
    ]);

    const route =
      "M5 29Q12.5 7.75 16 3Q19.5 7.75 27 29M10.5 18Q16 15 21.5 18";
    expect(component).toContain(route);
    expect(favicon).toContain(route);
    expect(favicon.match(/<circle/g)).toHaveLength(4);
    expect(favicon).toContain("fill=\"#ff5b4d\"");
    expect(config).toContain("href: \"/favicon.svg\"");
    expect(config).toContain("sizes: \"any\"");
  });
});
