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
const designAtlas = readFileSync(
  fileURLToPath(
    new URL(
      "../apps/viewer/app/components/DesignAtlasView.vue",
      import.meta.url,
    ),
  ),
  "utf8",
);
const atlasGraph = readFileSync(
  fileURLToPath(
    new URL(
      "../apps/viewer/app/components/AtlasGraph.client.vue",
      import.meta.url,
    ),
  ),
  "utf8",
);
const memoryInbox = readFileSync(
  fileURLToPath(
    new URL(
      "../apps/viewer/app/components/MemoryInboxView.vue",
      import.meta.url,
    ),
  ),
  "utf8",
);
const viewerPage = readFileSync(
  fileURLToPath(
    new URL("../apps/viewer/app/pages/index.vue", import.meta.url),
  ),
  "utf8",
);
const scrollToTop = readFileSync(
  fileURLToPath(
    new URL(
      "../apps/viewer/app/components/ScrollToTopButton.vue",
      import.meta.url,
    ),
  ),
  "utf8",
);
const actionCenter = readFileSync(
  fileURLToPath(
    new URL("../apps/viewer/app/components/RisksView.vue", import.meta.url),
  ),
  "utf8",
);
const taskWorkbench = readFileSync(
  fileURLToPath(
    new URL(
      "../apps/viewer/app/components/TaskWorkbenchView.vue",
      import.meta.url,
    ),
  ),
  "utf8",
);
const i18nComposable = readFileSync(
  fileURLToPath(
    new URL(
      "../apps/viewer/app/composables/useAtlasI18n.ts",
      import.meta.url,
    ),
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
    expect(codeAtlas).toContain(':aria-label="inspectorActionLabel"');
    expect(codeAtlas).toContain(':title="inspectorActionLabel"');
    expect(codeAtlas).toContain('"Inspect selected component"');
    expect(codeAtlas).toContain('"Hide component details"');
    for (const label of ["Fit selection", "Fit graph", "Reset graph view"]) {
      expect(codeAtlas).toContain(`:aria-label="t('${label}')"`);
      expect(codeAtlas).toContain(`:title="t('${label}')"`);
    }
    expect(codeAtlas).not.toContain(">Fit selection<");
    expect(codeAtlas).not.toContain(">Fit graph<");
  });

  it("opens Code Atlas unselected and gives selected labels room to wrap", () => {
    expect(codeAtlas).toContain("const inspectorOpen = ref(false)");
    expect(codeAtlas).not.toMatch(
      /filteredComponents\.value\.find\([\s\S]*?\)\s*\?\?\s*filteredComponents\.value\[0\]/,
    );
    expect(atlasGraph).toContain('"text-wrap": "wrap"');
    expect(atlasGraph).toContain('"text-max-width": "100px"');
    expect(atlasGraph).toContain('(?<=[a-z0-9])(?=[A-Z])');
    expect(atlasGraph).toContain('"text-margin-y": 13');
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

  it("keeps compact pills horizontal and native choice controls bounded", () => {
    expect(css).toMatch(
      /\.status-chip,[\s\S]*?white-space:\s*nowrap;/,
    );
    expect(css).toContain("flex: 0 0 var(--atlas-control-check)");
    expect(css).toContain(
      'input:not([type="checkbox"]):not([type="radio"]):not([type="range"])',
    );
  });

  it("defines shared semantic primitives and the four target breakpoints", () => {
    for (const token of [
      "--atlas-space-4",
      "--atlas-radius-pill",
      "--atlas-control-md",
      "--atlas-text-control",
      "--atlas-breakpoint-compact",
      "--atlas-breakpoint-tablet",
      "--atlas-breakpoint-laptop",
      "--atlas-breakpoint-desktop",
    ]) {
      expect(css).toContain(token);
    }
  });

  it("keeps global Figma variables distinct from selection-only fallback", () => {
    for (const state of [
      "global",
      "selection-only",
      "permission-required",
      "unavailable",
    ]) {
      expect(designAtlas).toContain(state);
    }
    expect(designAtlas).toContain("Global Figma variables");
    expect(designAtlas).toContain("This fallback is not a global file catalog");
    expect(designAtlas).toContain("activeFile?.variables.valuesIncluded");
    expect(designAtlas).toContain("selectedVariable.valuesByMode");
  });

  it("stacks the global-variable token browser at constrained widths", () => {
    expect(css).toMatch(
      /@container atlas-workspace \(max-width: 900px\)[\s\S]*?\.variable-token-browser\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(css).toContain(".variable-collection-tabs");
    expect(css).toContain(".variable-token-detail");
  });

  it("keeps the mobile source summary bounded and the exact Figma gate actionable", () => {
    expect(taskWorkbench).toContain('class="source-count-summary"');
    expect(taskWorkbench).toContain('t("Synchronize exact target")');
    expect(taskWorkbench).toContain('t("Retry exact sync")');
    expect(taskWorkbench).toContain('aria-live="polite"');
    expect(taskWorkbench).toContain("pendingFigmaSources.value.length === 0");
    expect(css).toMatch(
      /@container atlas-workspace \(max-width: 900px\)[\s\S]*?\.workbench-inspector dl > \.source-count-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(css).toMatch(
      /\.workbench-inspector \.source-count-summary\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(css).toMatch(
      /\.workbench-inspector dl > div\s*\{[^}]*grid-template-columns:\s*minmax\(72px,\s*0\.8fr\)\s*minmax\(0,\s*1\.2fr\)/,
    );
    expect(css).toMatch(
      /\.workbench-inspector dd\s*\{[^}]*overflow-wrap:\s*anywhere/,
    );
    expect(css).toMatch(
      /\.workbench-inspector dl > \.source-count-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(css).toMatch(
      /\.source-decision\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(css).toMatch(
      /\.source-decision-actions\s*\{[\s\S]*?border-top:\s*1px solid var\(--atlas-rule-soft\)/,
    );
    expect(css).toMatch(
      /\.figma-sync-band\s*\{[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\)/,
    );
    expect(css).toMatch(
      /\.figma-sync-actions\s*\{[^}]*grid-column:\s*2;[^}]*border-top:\s*1px solid var\(--atlas-rule-soft\)/,
    );
    expect(taskWorkbench).toContain(
      '"Figma source could not be synchronized. Check Figma Desktop MCP access, then retry the exact target."',
    );
    expect(taskWorkbench).toContain('class="task-intake-controls"');
    expect(taskWorkbench).toContain('class="task-status-row"');
    expect(taskWorkbench).toContain(`:aria-label="t('Task mode')"`);
    expect(taskWorkbench).toContain("t(activeCheckpoint.nextSafeAction)");
    expect(css).toMatch(
      /\.task-intake-controls\s*\{[^}]*display:\s*grid;[^}]*gap:\s*7px/,
    );
    expect(css).toMatch(
      /\.task-status-row \.text-button\s*\{[^}]*margin-left:\s*auto/,
    );
    expect(css).toMatch(
      /\.decision-record > div > span\s*\{[^}]*display:\s*block;[^}]*margin-bottom:\s*4px/,
    );
    expect(i18nComposable).toContain(
      'if (value === "clear") return t("No blockers")',
    );
  });

  it("keeps Memory Inbox decisions before long content on tablet and compact layouts", () => {
    expect(memoryInbox).toContain('class="proposal-actions"');
    expect(memoryInbox).toContain("openApprovalConfirmation");
    expect(memoryInbox).toContain('type="radio"');
    expect(memoryInbox).toContain("confirmationOpen");
    expect(memoryInbox).toContain("decisionZone.value?.focus");
    expect(memoryInbox).toContain("decisionZone.value?.scrollIntoView");
    expect(memoryInbox).toContain('action: "apply"');
    expect(memoryInbox).toContain('action: "reject"');
    expect(css).toMatch(
      /@container atlas-workspace \(max-width: 900px\)[\s\S]*?\.atlas-workspace\.inbox-layout[\s\S]*?grid-template-areas:\s*"index"\s*"actions"\s*"detail"/,
    );
    expect(css).toMatch(
      /@media \(max-width: 560px\)[\s\S]*?\.confirmation-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
  });

  it("uses one localized icon primitive for every justified scroll owner", () => {
    expect(scrollToTop).toContain("ResizeObserver");
    expect(scrollToTop).toContain("observedTarget.scrollHeight");
    expect(scrollToTop).toContain("observedTarget.scrollTop");
    expect(scrollToTop).toContain(`:aria-label="t('Back to top')"`);
    expect(scrollToTop).toContain(`:title="t('Back to top')"`);
    expect(scrollToTop).toContain('<span aria-hidden="true">↑</span>');
    expect(scrollToTop).not.toContain('<span>{{ t("Back to top") }}</span>');
    expect(viewerPage).toContain(':target="launcherScroller"');
    expect(viewerPage).toContain(':target="workspaceScroller"');
    expect(viewerPage).toContain('ref="inboxHeading"');
    expect(codeAtlas).toContain(':target="componentList"');
    expect(actionCenter).toContain(':target="actionInspector"');
    expect(css).toContain(".scroll-to-top-button");
    expect(css).toContain(".scroll-to-top-button.panel");
  });
});
