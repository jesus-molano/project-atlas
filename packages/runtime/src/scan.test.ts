import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { scanProject } from "./index.js";

const temporary: string[] = [];
const vueSrcFixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/vue-src",
);

afterEach(async () => {
  delete process.env.COMPONENT_ATLAS_HOME;
  await Promise.all(
    temporary.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("incremental repository scans", () => {
  it("indexes every existing Vue src node without assuming a router from folder names", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-vue-src-"));
    const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-data-"));
    temporary.push(root, dataHome);
    process.env.COMPONENT_ATLAS_HOME = dataHome;
    await cp(vueSrcFixture, root, { recursive: true });

    const initial = await scanProject(root, { writeArtifacts: false });
    expect(initial.project.scan?.mode).toBe("full");
    expect(initial.components).toHaveLength(6);
    expect(initial.components.map((component) => component.relativePath)).toEqual(
      expect.arrayContaining([
        "src/app.vue",
        "src/components/account/AccountCard.vue",
        "src/components/ui/BaseButton.vue",
        "src/layouts/DefaultLayout.vue",
        "src/pages/HomePage.vue",
        "src/pages/settings/SettingsPage.vue",
      ]),
    );
    expect(initial.components.filter((component) => component.kind === "route"))
      .toHaveLength(0);

    await writeFile(
      path.join(root, "src", "components", "account", "TaskCreatedBadge.vue"),
      "<template><span>New</span></template>",
    );
    const incremental = await scanProject(root, { writeArtifacts: false });
    expect(incremental.project.scan?.mode).toBe("incremental");
    expect(incremental.components).toHaveLength(7);
    expect(
      incremental.components.filter((component) => component.kind === "route"),
    ).toHaveLength(0);
    expect(
      incremental.components.some(
        (component) => component.relativePath === "src/pages/HomePage.vue",
      ),
    ).toBe(true);
  }, 15_000);

  it("reuses unchanged snapshots, reparses component deltas, and falls back safely", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-incremental-"));
    const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-data-"));
    temporary.push(root, dataHome);
    process.env.COMPONENT_ATLAS_HOME = dataHome;
    await mkdir(path.join(root, "components"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "incremental-fixture", dependencies: { vue: "^3.0.0" } }),
    );
    const componentPath = path.join(root, "components", "NoticeCard.vue");
    await writeFile(
      componentPath,
      "<script setup lang=\"ts\">defineProps<{ title: string }>()</script><template><article>{{ title }}</article></template>",
    );

    const full = await scanProject(root, { writeArtifacts: false });
    expect(full.project.scan?.mode).toBe("full");
    const unchanged = await scanProject(root, { writeArtifacts: false });
    expect(unchanged.project.scan).toMatchObject({
      mode: "unchanged",
      changedFiles: 0,
    });

    await writeFile(
      componentPath,
      "<script setup lang=\"ts\">defineProps<{ title: string; compact?: boolean }>()</script><template><article>{{ title }}</article></template>",
    );
    const incremental = await scanProject(root, { writeArtifacts: false });
    expect(incremental.project.scan?.mode).toBe("incremental");
    expect(incremental.components[0]?.props.map((prop) => prop.name)).toContain(
      "compact",
    );

    await writeFile(path.join(root, "components", "types.ts"), "export type Tone = 'info';");
    const fallback = await scanProject(root, { writeArtifacts: false });
    expect(fallback.project.scan?.mode).toBe("full");
  }, 15_000);

  it("honors cancellation before parsing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-abort-"));
    const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-data-"));
    temporary.push(root, dataHome);
    process.env.COMPONENT_ATLAS_HOME = dataHome;
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "abort-fixture", dependencies: { vue: "^3.0.0" } }),
    );
    const controller = new AbortController();
    controller.abort(new Error("stop requested"));
    await expect(
      scanProject(root, {
        writeArtifacts: false,
        signal: controller.signal,
      }),
    ).rejects.toThrow("stop requested");
  });
});
