import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readViewerComponent } from "./viewer-component";
import { readViewerCss } from "./viewer-css";

async function source(relativePath: string): Promise<string> {
  if (relativePath.endsWith("/assets/css/main.css")) return readViewerCss();
  const url = new URL(`../${relativePath}`, import.meta.url);
  return relativePath.endsWith(".vue")
    ? readViewerComponent(fileURLToPath(url))
    : readFile(url, "utf8");
}

describe("desktop evidence workspace contract", () => {
  it("keeps evidence, review, and system areas without an execution surface", async () => {
    const [page, pageState] = await Promise.all([
      source("apps/viewer/app/pages/index.vue"),
      source("apps/viewer/app/composables/useAtlasWorkspacePage.ts"),
    ]);
    for (const label of [
      "Home",
      "Code",
      "Design",
      "Memory",
      "Action Center",
      "Memory Inbox",
      "Connections",
      "Settings",
    ]) {
      expect(pageState).toContain(`label: t("${label}")`);
    }
    expect(`${page}\n${pageState}`).not.toMatch(
      /Codex handoff|TaskWorkbenchView|agent\/runs/u,
    );
    expect(page).toContain(`:aria-label="t('Project Atlas navigation')"`);
    expect(page).toContain(`:aria-label="t('Search code, design, and memory')"`);
    expect(page).toContain("t(\"Recent projects\")");
    expect(pageState).toContain("\"/api/projects/activate\"");
    expect(pageState).toContain("\"/api/projects/select-directory\"");
    expect(pageState).toContain("chooseDesktopProjectFolder");
  });

  it("keeps Code, Design, and Memory as evidence browsers", async () => {
    const [code, design, memory, memoryI18n] = await Promise.all([
      source("apps/viewer/app/components/CodeAtlasView.vue"),
      source("apps/viewer/app/components/DesignAtlasView.vue"),
      source("apps/viewer/app/components/ProjectMemoryView.vue"),
      source("apps/viewer/app/utils/memory-i18n.ts"),
    ]);
    expect(code).toContain("Reuse");
    expect(code).toContain("Change impact");
    expect(code).toContain("Associated tests");
    expect(code).not.toContain("useInTask");
    expect(design).toContain("Status not exposed by source");
    expect(design).toContain("Indexed code mappings");
    expect(design).not.toContain("prepareTask");
    expect(memory).toContain("memoryT(\"conceptMap\")");
    expect(memory).toContain("memoryT(\"timeline\")");
    expect(memory).not.toContain("useInTask");
    expect(memoryI18n).toContain("conceptMap: \"Concept map\"");
  });

  it("keeps Action Center resolutions evidence-bound and human-gated", async () => {
    const [view, domain, server, actionRoute, bulkRoute] = await Promise.all([
      source("apps/viewer/app/components/RisksView.vue"),
      source("packages/core/src/action-center.ts"),
      source("apps/viewer/server/utils/action-center.ts"),
      source("apps/viewer/server/api/action-center/actions.post.ts"),
      source("apps/viewer/server/api/action-center/bulk.post.ts"),
    ]);
    for (const label of [
      "What Atlas detected",
      "Why it matters",
      "Affected task",
      "If you do nothing",
      "Resolve next",
    ]) {
      expect(view).toContain(label);
    }
    expect(view).toContain("Choose authority & resolve");
    expect(domain).toContain("expectedEvidenceFingerprint");
    expect(domain).not.toContain("save-decision-and-continue");
    expect(server).toContain("executeBulkActionMutations");
    expect(actionRoute).toContain("assertLocalSession(event)");
    expect(bulkRoute).toContain("assertLocalSession(event)");
  });

  it("gives evidence panes independent responsive scroll ownership", async () => {
    const [code, graph, design, css] = await Promise.all([
      source("apps/viewer/app/components/CodeAtlasView.vue"),
      source("apps/viewer/app/components/AtlasGraph.client.vue"),
      source("apps/viewer/app/components/DesignAtlasView.vue"),
      source("apps/viewer/app/assets/css/main.css"),
    ]);
    expect(code).toContain("CODE_ATLAS_PAGE_SIZE");
    expect(code).toContain("role=\"tablist\"");
    expect(code).toContain("event.key === \"Escape\"");
    expect(graph).toContain("ResizeObserver");
    expect(design).toContain("class=\"atlas-workspace three-pane design-atlas\"");
    expect(css).toContain("container-name: atlas-workspace");
    expect(css).toContain("@container atlas-workspace (max-width: 1100px)");
    expect(css).not.toContain(".workbench");
  });

  it("removes the runner package and every GUI runner route", async () => {
    const removed = [
      "packages/agent/package.json",
      "apps/viewer/app/components/TaskWorkbenchView.vue",
      "apps/viewer/server/api/agent/runs.post.ts",
      "apps/viewer/server/api/task-context.post.ts",
    ];
    for (const relativePath of removed) {
      await expect(
        access(fileURLToPath(new URL(`../${relativePath}`, import.meta.url))),
      ).rejects.toThrow();
    }
    const packageSource = await source("apps/viewer/package.json");
    expect(packageSource).not.toContain("@component-atlas/agent");
  });
});
