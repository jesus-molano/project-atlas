import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readViewerCssSync } from "./viewer-css";

const page = readFileSync(
  fileURLToPath(
    new URL("../apps/viewer/app/pages/index.vue", import.meta.url),
  ),
  "utf8",
);
const pageState = readFileSync(
  fileURLToPath(
    new URL(
      "../apps/viewer/app/composables/useAtlasWorkspacePage.ts",
      import.meta.url,
    ),
  ),
  "utf8",
);
const css = readViewerCssSync();

describe("no-project launcher recovery", () => {
  it("treats a missing active root as launcher state without requesting a workspace", () => {
    expect(pageState.indexOf("useFetch<ProjectsResponse>(\"/api/projects\")")).toBeLessThan(
      pageState.indexOf("useFetch<WorkspaceSnapshot>(\"/api/workspace\""),
    );
    expect(pageState).toContain("immediate: Boolean(projects.value?.activeRoot)");
    expect(page).toContain(
      "v-if=\"!projects?.activeRoot || workspaceError\"",
    );
    expect(page).not.toContain(
      "<p class=\"launcher-diagnostic\">{{ t(workspaceError.message) }}</p>",
    );
  });

  it("offers a translated retry for a genuine active-workspace failure", () => {
    expect(page).toContain("workspaceError && projects?.activeRoot");
    expect(page).toContain("t(\"Workspace could not be loaded\")");
    expect(page).toContain("@click=\"refreshWorkspace()\"");
    expect(page).toContain("t(\"Retry workspace\")");
  });

  it("previews an existing project checkout before activation", () => {
    expect(pageState).toContain("\"/api/projects/inspect\"");
    expect(page).toContain("<ProjectDestinationPreview");
    expect(page).toContain("@confirm=\"activateProject()\"");
    expect(page).toContain(":title=\"workspace.git.worktreePath");
    expect(page).toContain(":title=\"workspace.git.branch");
    expect(page).toContain(
      "<code :title=\"overview.data.project.rootPath\">",
    );
  });

  it("keeps checkout selection read-only and exposes no branch/worktree creation routes", () => {
    expect(pageState).not.toMatch(
      /\/api\/projects\/(?:branch|worktree)\/(?:preview|create)/,
    );
    expect(page).not.toContain("WorktreeCreationPreview");
    for (const route of [
      "branch/create.post.ts",
      "branch/preview.post.ts",
      "worktree/create.post.ts",
      "worktree/preview.post.ts",
    ]) {
      expect(
        existsSync(
          fileURLToPath(
            new URL(`../apps/viewer/server/api/projects/${route}`, import.meta.url),
          ),
        ),
      ).toBe(false);
    }
  });

  it("bounds long project identity and prevents background double-scroll", () => {
    expect(css).toMatch(
      /\.project-switcher strong,[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/,
    );
    expect(css).toContain(
      ".desktop-shell.project-menu-open .desktop-workspace",
    );
    expect(css).toMatch(
      /\.project-popover\s*\{[^}]*max-height:\s*calc\(100vh - 86px\);[^}]*overflow-y:\s*auto;/s,
    );
  });
});
