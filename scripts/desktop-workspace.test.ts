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
      "Codex handoff",
      "Action Center",
      "Memory Inbox",
      "Connections",
      "Settings",
    ]) {
      expect(page).toContain(`label: t("${label}")`);
    }
    expect(page).toContain("useEvidenceInTask");
    expect(page).toContain(`:aria-label="t('Project Atlas navigation')"`);
    expect(page).toContain(
      `:aria-label="t('Search code, design, memory, and tasks')"`,
    );
    expect(page).toContain('t("Recent projects")');
    expect(page).toContain('t("Open another folder")');
    expect(page).toContain('"/api/projects/activate"');
    expect(page).toContain('"/api/projects/select-directory"');
    expect(page).toContain("projectPathFromDrop");
    expect(page).toContain('t("Choose folder…")');
    expect(page).toContain('t("Atlas never uploads the project.")');
    expect(page).toContain("chooseDesktopProjectFolder");
    expect(page).toContain("projectMenuOpen.value = false");
    const css = await source("apps/viewer/app/assets/css/main.css");
    expect(css).toContain(".nav-group > button > .atlas-icon");
    expect(css).toContain("transform: translateY(-1px)");
    const compactShell = css.slice(css.indexOf("@media (max-width: 860px)"));
    expect(compactShell).toContain(".project-switcher-wrap");
    expect(compactShell).toContain("position: fixed");
    expect(compactShell).not.toMatch(
      /\.project-switcher-wrap,\s*\n\s*\.navigator-foot[\s\S]*?display:\s*none/,
    );
    expect(compactShell).toContain(
      "width: min(390px, calc(100vw - 28px))",
    );
  });

  it("turns each Atlas evidence plane into an action for the Workbench", async () => {
    const [
      code,
      design,
      memory,
      memoryI18n,
      workbench,
      agentBrowser,
      agentPackageSource,
    ] = await Promise.all([
      source("apps/viewer/app/components/CodeAtlasView.vue"),
      source("apps/viewer/app/components/DesignAtlasView.vue"),
      source("apps/viewer/app/components/ProjectMemoryView.vue"),
      source("apps/viewer/app/utils/memory-i18n.ts"),
      source("apps/viewer/app/components/TaskWorkbenchView.vue"),
      source("packages/agent/src/browser.ts"),
      source("packages/agent/package.json"),
    ]);
    for (const view of [code, design]) {
      expect(view).toContain("useInTask");
      expect(view).toContain("Use in task");
    }
    expect(memory).toContain("useInTask");
    expect(memory).toContain('memoryT("useInTask")');
    expect(memoryI18n).toContain('useInTask: "Use in task"');
    expect(code).toContain("Reuse");
    expect(code).toContain("Change impact");
    expect(code).toContain("Associated tests");
    expect(design).toContain("Status unavailable from source");
    expect(design).toContain("indexed metadata");
    expect(design).toContain("fixture claims, not live Figma verification");
    expect(design).toContain("Indexed code mappings");
    expect(memory).toContain('memoryT("conceptMap")');
    expect(memory).toContain('memoryT("timeline")');
    expect(memory).toContain('memoryT("activeDefault")');
    expect(memoryI18n).toContain('conceptMap: "Concept map"');
    expect(memoryI18n).toContain('conceptMap: "Mapa conceptual"');
    expect(workbench).toContain("Review before Codex starts");
    expect(workbench).toContain("Review before Codex resumes");
    expect(workbench).toContain("Cancel safely");
    expect(workbench).toContain("Continue same Codex task");
    expect(workbench).toContain("Codex task to resume");
    expect(workbench).toContain("runSummaries");
    expect(workbench).toContain("Mark reviewed");
    expect(workbench).toContain("Exact sources");
    expect(workbench).toContain("Codex may pause for");
    expect(workbench).toContain('value="openapi"');
    expect(workbench).toContain("Context inspector");
    expect(workbench).toContain("Memory candidates");
    expect(workbench).toContain("No automatic memory writes");
    expect(workbench).toContain("Explicit confirmation required:");
    expect(workbench).toContain("Local / episodic outcome");
    expect(workbench).toContain("memoryCloseoutActionMessage");
    expect(workbench).toContain("Confirm canonical memory");
    expect(workbench).toContain("Continue without saving");
    expect(workbench).toContain('from "@component-atlas/agent/browser"');
    expect(agentBrowser).toContain('export * from "./memory-closeout.js"');
    expect(agentBrowser).not.toContain("./codex.js");
    expect(JSON.parse(agentPackageSource).exports["./browser"]).toEqual({
      types: "./dist/browser.d.ts",
      import: "./dist/browser.js",
    });
  });

  it("explains and live-refreshes confirmed Figma ingestion", async () => {
    const [page, design, workbench, agent] = await Promise.all([
      source("apps/viewer/app/pages/index.vue"),
      source("apps/viewer/app/components/DesignAtlasView.vue"),
      source("apps/viewer/app/components/TaskWorkbenchView.vue"),
      source("packages/agent/src/codex.ts"),
    ]);
    for (const status of [
      "Figma · loading",
      "Figma · available",
      "Figma · no access or sync error",
      "Figma · confirmed, not synchronized",
    ]) {
      expect(workbench).toContain(status);
    }
    expect(workbench).toContain('emit("workspaceChanged")');
    expect(workbench).toContain("pendingFigmaSources");
    expect(page).toContain('@workspace-changed="refreshSnapshot"');
    expect(page).toContain(':sync-state="designSyncState"');
    expect(design).toContain("Synchronizing confirmed Figma source");
    expect(design).toContain("Figma source could not be synchronized");
    expect(design).toContain("Figma source confirmed, not synchronized");
    expect(agent).toContain("Confirmed Figma ingestion");
    expect(agent).toContain("Figma Desktop MCP");
    expect(agent).toContain("`map_figma_file`");
  });

  it("keeps Action Center resolutions evidence-bound and human-gated", async () => {
    const [view, domain, server, actionRoute, bulkRoute, workbench] =
      await Promise.all([
        source("apps/viewer/app/components/RisksView.vue"),
        source("packages/core/src/action-center.ts"),
        source("apps/viewer/server/utils/action-center.ts"),
        source("apps/viewer/server/api/action-center/actions.post.ts"),
        source("apps/viewer/server/api/action-center/bulk.post.ts"),
        source("apps/viewer/app/components/TaskWorkbenchView.vue"),
      ]);
    for (const label of [
      "What Atlas detected",
      "Why it matters",
      "Affected task",
      "If you do nothing",
      "Evidence changed",
      "Resolve next",
    ]) {
      expect(view).toContain(label);
    }
    expect(view).toContain("Choose authority & resolve");
    expect(view).toContain("Accept risk");
    expect(view).toContain("Ignore warning");
    expect(domain).toContain("expectedEvidenceFingerprint");
    expect(domain).toContain("resolutionInvalidated");
    expect(domain).toContain("compactActionDelta");
    expect(server).toContain("The originating run is unavailable");
    expect(server).toContain("executeBulkActionMutations");
    expect(actionRoute).toContain("assertAgentSession(event)");
    expect(bulkRoute).toContain("assertAgentSession(event)");
    expect(workbench).toContain("recentActions");
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
    expect(code).toContain(`:aria-label="t('Close component details')"`);
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

  it("keeps Design Atlas context stable while its catalog and evidence panes scroll independently", async () => {
    const [page, design, css] = await Promise.all([
      source("apps/viewer/app/pages/index.vue"),
      source("apps/viewer/app/components/DesignAtlasView.vue"),
      source("apps/viewer/app/assets/css/main.css"),
    ]);

    expect(page).toContain("section-workspace design-section");
    expect(design).toContain('class="atlas-workspace three-pane design-atlas"');
    expect(design).toContain('ref="entityList"');
    expect(design).toContain('role="listbox"');
    expect(design).toContain('role="option"');
    expect(design).toContain("handleNodeKeydown");
    expect(design).toContain("handleVariableCollectionKeydown");
    expect(design).toContain("handleVariableKeydown");
    expect(design).toContain("No design node matches this filter.");
    expect(design).toContain("syncNoticeVisible");
    expect(css).toMatch(/\.design-section\s*\{[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(
      /\.design-atlas \.entity-list\s*\{[^}]*flex:\s*1[^}]*overflow-y:\s*auto/s,
    );
    expect(css).toMatch(
      /\.design-atlas > \.detail-pane,[\s\S]*?\.design-atlas > \.inspector-pane\s*\{[^}]*overflow-y:\s*auto/s,
    );
    expect(css).toContain("@container atlas-workspace (min-width: 901px)");
    expect(css).toContain("@container atlas-workspace (max-width: 900px)");
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
