import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildReuseContext } from "@component-atlas/core";
import {
  detectProjectProfile,
  scanProject,
} from "./index.js";

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/framework-support",
);
interface AcceptanceEntry {
  frameworks: Array<"astro" | "react" | "vue">;
  metaFramework: "astro" | "next" | "nuxt" | null;
  router?: "app" | "astro" | "hybrid" | "pages" | "vue-router";
  candidateFiles: number;
  skippedFiles?: number;
  components: string[];
  routes?: Array<{ path: string }>;
  layouts?: string[];
  special?: string[];
}
const acceptance = JSON.parse(
  await readFile(path.join(fixtureRoot, "acceptance.json"), "utf8"),
) as Record<string, AcceptanceEntry>;
const temporary: string[] = [];

afterEach(async () => {
  delete process.env.COMPONENT_ATLAS_HOME;
  await Promise.all(
    temporary.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function copiedFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-frameworks-"));
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-framework-data-"));
  temporary.push(root, dataHome);
  process.env.COMPONENT_ATLAS_HOME = dataHome;
  await cp(fixtureRoot, root, { recursive: true });
  return root;
}

describe("frontend framework acceptance matrix", () => {
  it("profiles every frontend workspace and preserves mixed Astro runtimes", async () => {
    const root = await copiedFixture();
    const profile = await detectProjectProfile(root);

    expect(profile.packages.map((item) => item.name).sort()).toEqual([
      "fixture-astro-mixed",
      "fixture-next-app",
      "fixture-next-app-root",
      "fixture-next-pages",
      "fixture-next-pages-src",
      "fixture-nuxt2",
      "fixture-nuxt3",
      "fixture-react",
      "fixture-vue2",
      "fixture-vue3-options",
      "fixture-vue3-setup",
    ]);
    expect(profile.frameworks).toEqual(
      expect.arrayContaining(["astro", "react", "vue"]),
    );
    for (const [fixtureName, expected] of Object.entries(acceptance)) {
      const packageProfile = profile.packages.find(
        (item) => item.name === `fixture-${fixtureName}`,
      );
      expect(packageProfile, fixtureName).toBeDefined();
      expect([...(packageProfile?.frameworks ?? [])].sort(), `${fixtureName} frameworks`).toEqual(
        [...expected.frameworks].sort(),
      );
      expect(packageProfile?.metaFramework, `${fixtureName} meta-framework`).toBe(
        expected.metaFramework ?? undefined,
      );
      expect(packageProfile?.router, `${fixtureName} router`).toBe(
        expected.router,
      );
    }
    expect(
      profile.packages.find((item) => item.name === "fixture-next-pages"),
    ).toMatchObject({ metaFramework: "next", router: "pages" });
    expect(
      profile.packages.find((item) => item.name === "fixture-next-app"),
    ).toMatchObject({ metaFramework: "next", router: "hybrid" });
    expect(
      profile.packages.find((item) => item.name === "fixture-astro-mixed"),
    ).toMatchObject({
      metaFramework: "astro",
      frameworks: expect.arrayContaining(["astro", "react", "vue"]),
    });
    expect(
      profile.packages.find((item) => item.name === "fixture-nuxt2"),
    ).toMatchObject({
      metaFramework: "nuxt",
      versions: { vue: "^2.7.0", nuxt: "^2.17.0" },
    });
    expect(
      profile.packages.find((item) => item.name === "fixture-nuxt3"),
    ).toMatchObject({
      metaFramework: "nuxt",
      versions: { vue: "^3.5.0", nuxt: "^3.17.0" },
    });
    expect(profile.packages).toHaveLength(Object.keys(acceptance).length);
  });

  it("discovers, classifies and relates the acceptance matrix without silent gaps", async () => {
    const root = await copiedFixture();
    const graph = await scanProject(root, {
      writeArtifacts: false,
      incremental: false,
    });

    const expectedFiles = Object.values(acceptance).reduce(
      (total, entry) => total + entry.candidateFiles,
      0,
    );
    const expectedSkipped = Object.values(acceptance).reduce(
      (total, entry) => total + (entry.skippedFiles ?? 0),
      0,
    );
    expect(graph.project.scan?.coverage).toMatchObject({
      candidateFiles: expectedFiles,
      parsedFiles: expectedFiles - expectedSkipped,
      skippedFiles: expectedSkipped,
      errorFiles: 0,
      complete: expectedSkipped === 0,
    });
    const expectedNodes = Object.values(acceptance).reduce(
      (total, entry) =>
        total +
        entry.components.length +
        (entry.routes?.length ?? 0) +
        (entry.layouts?.length ?? 0) +
        (entry.special?.length ?? 0),
      0,
    );
    expect(graph.components).toHaveLength(expectedNodes);
    expect(
      graph.components.some((item) =>
        /(?:pages\/api\/status|app\/api\/route|src\/Formatter)\./u.test(
          item.relativePath,
        ),
      ),
    ).toBe(false);

    for (const [fixtureName, expected] of Object.entries(acceptance)) {
      const nodes = graph.components.filter((item) =>
        item.relativePath.startsWith(`projects/${fixtureName}/`),
      );
      expect(
        nodes
          .filter((item) => (item.kind ?? "component") === "component")
          .map((item) => item.name)
          .sort(),
        fixtureName,
      ).toEqual([...expected.components].sort());
      expect(
        nodes
          .filter((item) => item.kind === "route")
          .map((item) => item.routePath)
          .sort(),
        `${fixtureName} routes`,
      ).toEqual((expected.routes ?? []).map((item) => item.path).sort());
      expect(
        nodes
          .filter((item) => item.kind === "layout")
          .map((item) => item.routePath ?? item.name)
          .sort(),
        `${fixtureName} layouts`,
      ).toEqual([...(expected.layouts ?? [])].sort());
      expect(
        nodes
          .filter((item) => item.kind === "special")
          .map((item) => item.role)
          .sort(),
        `${fixtureName} special files`,
      ).toEqual([...(expected.special ?? [])].sort());
    }

    const reactApp = graph.components.find(
      (item) => item.relativePath === "projects/react/src/App.tsx",
    );
    const reactButton = graph.components.find(
      (item) =>
        item.relativePath === "projects/react/src/components/Button.tsx",
    );
    expect(reactApp).toMatchObject({
      kind: "component",
      runtime: "universal",
      logicDependencies: ["useTheme"],
    });
    expect(reactButton).toMatchObject({
      kind: "component",
      runtime: "universal",
      exportName: "Button",
      slots: ["children"],
    });
    expect(
      graph.edges.some(
        (edge) =>
          edge.kind === "renders" &&
          edge.source === reactApp?.id &&
          edge.target === reactButton?.id &&
          edge.resolution === "exact",
      ),
    ).toBe(true);

    const vue2Card = graph.components.find(
      (item) =>
        item.relativePath ===
        "projects/vue2/src/components/LegacyCard.vue",
    );
    expect(vue2Card).toMatchObject({
      kind: "component",
      props: expect.arrayContaining([
        expect.objectContaining({ name: "value", required: true }),
        expect.objectContaining({ name: "compact" }),
      ]),
      events: expect.arrayContaining([
        expect.objectContaining({ name: "change" }),
      ]),
      models: ["value"],
      logicDependencies: ["trackable"],
      slotContracts: [
        expect.objectContaining({ name: "item", props: ["value"] }),
      ],
    });
    expect(
      graph.components.find(
        (item) =>
          item.relativePath ===
          "projects/vue2/src/views/HomeView.vue",
      ),
    ).toMatchObject({ kind: "route", routePath: "/" });

    const optionsPanel = graph.components.find(
      (item) =>
        item.relativePath ===
        "projects/vue3-options/src/components/OptionsPanel.vue",
    );
    expect(optionsPanel?.props.map((prop) => prop.name)).toEqual([
      "title",
      "tone",
    ]);
    expect(optionsPanel?.logicDependencies).toContain("useFocus");
    expect(optionsPanel?.slotContracts).toContainEqual({
      name: "actions",
      props: ["close"],
    });

    const setupPanel = graph.components.find(
      (item) =>
        item.relativePath ===
        "projects/vue3-setup/src/components/SetupPanel.vue",
    );
    expect(setupPanel).toMatchObject({
      props: expect.arrayContaining([
        expect.objectContaining({ name: "title" }),
        expect.objectContaining({ name: "compact" }),
      ]),
      events: expect.arrayContaining([
        expect.objectContaining({ name: "close" }),
      ]),
      slots: expect.arrayContaining(["default", "actions"]),
      models: ["open"],
      logicDependencies: ["usePanel"],
    });

    const nuxt2Page = graph.components.find(
      (item) => item.relativePath === "projects/nuxt2/pages/index.vue",
    );
    const nuxt2Layout = graph.components.find(
      (item) => item.relativePath === "projects/nuxt2/layouts/default.vue",
    );
    expect(nuxt2Page).toMatchObject({ kind: "route", routePath: "/" });
    expect(nuxt2Layout).toMatchObject({ kind: "layout", routePath: "/" });
    expect(
      graph.edges.some(
        (edge) =>
          edge.kind === "uses_layout" &&
          edge.source === nuxt2Page?.id &&
          edge.target === nuxt2Layout?.id,
      ),
    ).toBe(true);
    expect(
      graph.components.find(
        (item) => item.relativePath === "projects/nuxt3/pages/index.vue",
      ),
    ).toMatchObject({ kind: "route", routePath: "/" });

    expect(
      graph.components.find(
        (item) =>
          item.relativePath ===
          "projects/next-pages/pages/account/[id].js",
      ),
    ).toMatchObject({
      kind: "route",
      role: "page",
      routePath: "/account/[id]",
    });
    expect(
      graph.components.find(
        (item) =>
          item.relativePath === "projects/next-pages/pages/_app.tsx",
      ),
    ).toMatchObject({ kind: "special", role: "app-shell" });
    expect(
      graph.components.find(
        (item) =>
          item.relativePath ===
          "projects/next-pages-src/src/pages/index.tsx",
      ),
    ).toMatchObject({ kind: "route", routePath: "/" });
    expect(
      graph.components.find(
        (item) =>
          item.relativePath ===
          "projects/next-app/src/pages/legacy.tsx",
      ),
    ).toMatchObject({
      kind: "route",
      routePath: "/legacy",
      runtime: "universal",
    });
    const legacyPage = graph.components.find(
      (item) =>
        item.relativePath === "projects/next-app/src/pages/legacy.tsx",
    );
    expect(
      graph.edges.some(
        (edge) =>
          (edge.kind === "uses_layout" || edge.kind === "route_parent") &&
          edge.source === legacyPage?.id &&
          graph.components.find((item) => item.id === edge.target)?.relativePath.includes(
            "/src/app/",
          ),
      ),
    ).toBe(false);
    expect(
      graph.components.find(
        (item) =>
          item.relativePath === "projects/next-app-root/app/page.tsx",
      ),
    ).toMatchObject({ kind: "route", routePath: "/", runtime: "server" });

    const productPage = graph.components.find(
      (item) =>
        item.relativePath ===
        "projects/next-app/src/app/(shop)/products/[id]/page.tsx",
    );
    const nextCounter = graph.components.find(
      (item) =>
        item.relativePath ===
        "projects/next-app/src/components/Counter.tsx",
    );
    const astroCounter = graph.components.find(
      (item) =>
        item.relativePath ===
        "projects/astro-mixed/src/components/Counter.tsx",
    );
    expect(productPage).toMatchObject({
      kind: "route",
      routePath: "/products/[id]",
      runtime: "server",
    });
    expect(nextCounter).toMatchObject({ kind: "component", runtime: "client" });
    const serverCard = graph.components.find(
      (item) =>
        item.relativePath ===
        "projects/next-app/src/components/ServerCard.tsx",
    );
    const dynamicChart = graph.components.find(
      (item) =>
        item.relativePath === "projects/next-app/src/components/Chart.tsx",
    );
    expect(serverCard?.importBindings).toContainEqual(
      expect.objectContaining({
        local: "Chart",
        imported: "default",
        dynamic: true,
      }),
    );
    expect(
      graph.edges.some(
        (edge) =>
          edge.kind === "renders" &&
          edge.source === serverCard?.id &&
          edge.target === dynamicChart?.id &&
          edge.resolution === "exact",
      ),
    ).toBe(true);
    expect(
      graph.components.find(
        (item) =>
          item.relativePath ===
          "projects/next-app/src/app/@drawer/(...)account/page.tsx",
      ),
    ).toMatchObject({
      kind: "special",
      role: "intercepting-route",
      routePath: "/account",
    });
    expect(
      graph.edges.some(
        (edge) =>
          edge.kind === "renders" &&
          edge.source === productPage?.id &&
          edge.target === nextCounter?.id &&
          edge.resolution === "exact",
      ),
    ).toBe(true);
    expect(
      graph.edges.some(
        (edge) =>
          edge.kind === "renders" &&
          edge.source === productPage?.id &&
          edge.target === astroCounter?.id,
      ),
    ).toBe(false);

    const astroPage = graph.components.find(
      (item) =>
        item.relativePath ===
        "projects/astro-mixed/src/pages/index.astro",
    );
    const hydratedTargets = graph.edges
      .filter(
        (edge) => edge.kind === "hydrates" && edge.source === astroPage?.id,
      )
      .map((edge) => graph.components.find((item) => item.id === edge.target)?.name)
      .sort();
    expect(hydratedTargets).toEqual(["Counter", "Status"]);
    expect(
      graph.edges.some(
        (edge) =>
          edge.kind === "defers" &&
          edge.source === astroPage?.id &&
          graph.components.find((item) => item.id === edge.target)?.name === "Card",
      ),
    ).toBe(true);

    const reuse = buildReuseContext(graph, "product account page dialog", 5);
    expect(reuse.project.profile?.coverage).toMatchObject({
      candidateFiles: expectedFiles,
      parsedFiles: expectedFiles - expectedSkipped,
      skippedFiles: expectedSkipped,
      errorFiles: 0,
      complete: false,
    });
    expect(
      reuse.candidates.every(
        (candidate) =>
          graph.components.find((item) => item.id === candidate.component.id)
            ?.kind === "component",
      ),
    ).toBe(true);
  }, 20_000);
});
