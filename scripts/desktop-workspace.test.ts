import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

describe("desktop evidence workspace contract", () => {
  it("keeps daily work, evidence, review, and system areas in a two-level shell", async () => {
    const page = await source("apps/viewer/app/pages/index.vue");
    for (const label of [
      "Home",
      "Code",
      "Design",
      "Memory",
      "Task Workbench",
      "Decisions & risks",
      "Memory Inbox",
      "Connections",
      "Settings",
    ]) {
      expect(page).toContain(`label: "${label}"`);
    }
    expect(page).toContain("useEvidenceInTask");
    expect(page).toContain('aria-label="Project Atlas navigation"');
    expect(page).toContain('aria-label="Search code, design, memory, and tasks"');
    expect(page).toContain("Recent projects");
    expect(page).toContain("Open another folder");
    expect(page).toContain('"/api/projects/activate"');
    expect(page).toContain("Browse is available in the desktop app");
    expect(page).toContain("chooseDesktopProjectFolder");
    expect(page).toContain("projectMenuOpen.value = false");
    const css = await source("apps/viewer/app/assets/css/main.css");
    expect(css).toContain(".nav-group > button > .atlas-icon");
    expect(css).toContain("transform: translateY(-1px)");
  });

  it("turns each Atlas evidence plane into an action for the Workbench", async () => {
    const [code, design, memory, workbench] = await Promise.all([
      source("apps/viewer/app/components/CodeAtlasView.vue"),
      source("apps/viewer/app/components/DesignAtlasView.vue"),
      source("apps/viewer/app/components/ProjectMemoryView.vue"),
      source("apps/viewer/app/components/TaskWorkbenchView.vue"),
    ]);
    for (const view of [code, design, memory]) {
      expect(view).toContain("useInTask");
      expect(view).toContain("Use in task");
    }
    expect(code).toContain("Reuse");
    expect(code).toContain("Change impact");
    expect(code).toContain("Associated tests");
    expect(design).toContain("Status unavailable from source");
    expect(design).toContain("indexed metadata");
    expect(design).toContain("fixture claims, not live Figma verification");
    expect(design).toContain("Indexed code mappings");
    expect(memory).toContain("Concept map");
    expect(memory).toContain("Timeline");
    expect(memory).toContain("Active by default");
    expect(workbench).toContain("Review before Codex starts");
    expect(workbench).toContain("Cancel safely");
    expect(workbench).toContain("Continue same Codex task");
    expect(workbench).toContain("Context inspector");
  });

  it("gives the catalog, graph, and inspector independent scroll ownership", async () => {
    const [code, graph, css] = await Promise.all([
      source("apps/viewer/app/components/CodeAtlasView.vue"),
      source("apps/viewer/app/components/AtlasGraph.client.vue"),
      source("apps/viewer/app/assets/css/main.css"),
    ]);
    expect(code).toContain("visibleComponents");
    expect(code).toContain("CODE_ATLAS_PAGE_SIZE");
    expect(code).toContain("Fit selection");
    expect(code).toContain("Fit graph");
    expect(code).toContain("Reset");
    expect(code).toContain('role="tablist"');
    expect(code).toContain('role="tabpanel"');
    expect(code).toContain("activateCodeInspectorGoal");
    expect(code.indexOf("inspector-goal-nav")).toBeGreaterThan(
      code.indexOf('aria-label="Component details"'),
    );
    expect(code).toContain('"Inspect selected component"');
    expect(code).toContain('"Hide component details"');
    expect(code).toContain('aria-label="Close component details"');
    expect(code).toContain('event.key === "Escape"');
    expect(code).toContain("inspectorReturnFocus");
    expect(css).toMatch(/\.code-section\s*\{[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(
      /\.code-atlas \.component-list\s*\{[^}]*overflow-y:\s*auto/s,
    );
    expect(css).toMatch(
      /\.code-atlas > \.detail-panel\s*\{[^}]*overflow-y:\s*auto/s,
    );
    expect(css).toMatch(/\.detail-panel-bar\s*\{[^}]*position:\s*sticky/s);
    expect(css).toContain(".inspector-backdrop");
    expect(css).toContain("@media (max-width: 1360px)");
    expect(css).toContain("container-name: atlas-workspace");
    expect(css).toContain(
      "@container atlas-workspace (max-width: 1100px)",
    );
    expect(css).toContain(
      "grid-template-columns: minmax(250px, 320px) minmax(420px, 1fr)",
    );
    const selectionBody = graph.slice(
      graph.indexOf("function selectCurrent"),
      graph.indexOf("function fitGraph"),
    );
    expect(selectionBody).toContain("center:");
    expect(selectionBody).not.toContain("fit:");
    expect(graph).toContain("ResizeObserver");
  });

  it("uses the Atlas-specific design contract and semantic icons", async () => {
    const [page, css, brief] = await Promise.all([
      source("apps/viewer/app/pages/index.vue"),
      source("apps/viewer/app/assets/css/main.css"),
      source("docs/visual-direction.md"),
    ]);
    expect(brief).toContain("Concept: Waypoint Signal");
    expect(brief).toContain("Base text: 14px");
    expect(css).toContain("--atlas-neutral-1000: #090a0d");
    expect(css).toContain("--atlas-signal-500: #ff5b4d");
    expect(css).toContain("--atlas-success-400: #73bd8a");
    expect(css).toContain("--atlas-selection: var(--atlas-signal-500)");
    expect(css).toContain("font-size: 14px");
    expect(page).toContain("<AtlasIcon");
    expect(page).not.toMatch(/glyph:\s*["']/);
  });

  it("does not restore the discarded rendering surface", async () => {
    const page = await source("apps/viewer/app/pages/index.vue");
    const components = await source(
      "apps/viewer/app/components/TaskWorkbenchView.vue",
    );
    expect(`${page}\n${components}`).not.toMatch(
      /component\s+(?:render\s+)?preview|atlas\s+lab|localhost:4174/i,
    );
  });
});
