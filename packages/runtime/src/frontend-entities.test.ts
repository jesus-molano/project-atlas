import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanProject } from "./index.js";

const temporary: string[] = [];

async function put(root: string, relative: string, source: string) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, source);
}

afterEach(async () => {
  delete process.env.PROJECT_ATLAS_HOME;
  await Promise.all(
    temporary.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Frontend Code Graph v5", () => {
  it("indexes Vue composables, stores, endpoints, stories and tests with honest resolution", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-graph-v5-"));
    temporary.push(root);
    process.env.PROJECT_ATLAS_HOME = path.join(root, ".private");
    await put(
      root,
      "package.json",
      JSON.stringify({
        name: "semantic-vue",
        dependencies: { vue: "^3.5.0", nuxt: "^4.0.0", pinia: "^3.0.0" },
      }),
    );
    await put(
      root,
      "composables/useOrders.ts",
      `export function useOrders() { return { ready: true } }`,
    );
    await put(
      root,
      "stores/account.ts",
      `import { defineStore } from "pinia";
       export const useAccountStore = defineStore("account", () => ({}));`,
    );
    await put(
      root,
      "pages/orders.vue",
      `<script setup lang="ts">
       const orders = useOrders();
       const account = useAccountStore();
       const list = await useFetch("/api/orders");
       const refreshed = await useFetch("/api/orders");
       const detail = await $fetch(\`/api/orders/\${orders.id}\`);
       </script><template><main>Orders</main></template>`,
    );
    await put(
      root,
      "server/api/orders.get.ts",
      `export default function listOrders() { return { orders: [] } }`,
    );
    await put(
      root,
      "components/OrderCard.vue",
      `<template><article>Order</article></template>`,
    );
    await put(
      root,
      "components/OrderCard.stories.ts",
      `export default { title: "OrderCard" };`,
    );
    await put(
      root,
      "components/OrderCard.test.ts",
      `import OrderCard from "./OrderCard.vue"; void OrderCard;`,
    );

    const graph = await scanProject(root, { writeArtifacts: false });
    expect(graph.schemaVersion).toBe(5);
    expect(graph.entities.map((entity) => entity.kind)).toEqual(
      expect.arrayContaining([
        "composable",
        "store",
        "module",
        "service",
        "endpoint",
        "story",
        "test",
      ]),
    );
    expect(
      graph.entities.find(
        (entity) => entity.relativePath === "server/api/orders.get.ts",
      ),
    ).toMatchObject({
      kind: "service",
      resolution: "exact",
    });
    expect(
      graph.entities.find(
        (entity) =>
          entity.kind === "endpoint" && entity.endpoint?.path === "/api/orders",
      ),
    ).toMatchObject({
      resolution: "exact",
      endpoint: { client: "useFetch", method: "GET", openApiStatus: "unresolved" },
    });
    const orderEndpoints = graph.entities.filter(
      (entity) =>
        entity.kind === "endpoint" && entity.endpoint?.path === "/api/orders",
    );
    expect(orderEndpoints).toHaveLength(2);
    expect(new Set(orderEndpoints.map((entity) => entity.id)).size).toBe(2);
    expect(
      graph.entities.find(
        (entity) =>
          entity.kind === "endpoint" &&
          entity.endpoint?.openApiStatus === "ambiguous",
      ),
    ).toMatchObject({ resolution: "inferred" });
    expect(graph.edges.map((edge) => edge.kind)).toEqual(
      expect.arrayContaining([
        "uses_composable",
        "uses_store",
        "calls_endpoint",
        "demonstrated_by",
        "tested_by",
      ]),
    );
    expect(
      graph.edges
        .filter((edge) => edge.resolution === "exact")
        .every((edge) => edge.kind === "calls_endpoint"),
    ).toBe(true);

    const rescanned = await scanProject(root, { writeArtifacts: false });
    expect(
      rescanned.entities
        .filter(
          (entity) =>
            entity.kind === "endpoint" &&
            entity.endpoint?.path === "/api/orders",
        )
        .map((entity) => entity.id),
    ).toEqual(orderEndpoints.map((entity) => entity.id));
  });

  it.each([
    {
      framework: "react",
      dependencies: { react: "^19.0.0", next: "^16.0.0" },
      files: {
        "src/useCart.ts":
          "export function useCart() { return fetch(\"/api/cart\") }",
        "src/CartContext.tsx":
          "import { createContext } from \"react\"; export const CartContext = createContext({});",
        "src/Cart.stories.tsx": "export default { title: \"Cart\" };",
      },
      kinds: ["composable", "store", "endpoint", "story"],
    },
    {
      framework: "astro",
      dependencies: { astro: "^5.0.0" },
      files: {
        "src/pages/orders.astro":
          "---\nconst orders = await fetch(\"/api/orders\");\n---\n<main>{orders}</main>",
        "src/orders.test.ts": "export const covered = true;",
      },
      kinds: ["endpoint", "test"],
    },
  ])(
    "keeps the v5 semantic contract for $framework with explicit degradation",
    async ({ dependencies, files, kinds }) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "atlas-graph-parity-"));
      temporary.push(root);
      process.env.PROJECT_ATLAS_HOME = path.join(root, ".private");
      await put(
        root,
        "package.json",
        JSON.stringify({ name: "semantic-parity", dependencies }),
      );
      for (const [relative, source] of Object.entries(files)) {
        await put(root, relative, source);
      }
      const graph = await scanProject(root, { writeArtifacts: false });
      expect(graph.entities.map((entity) => entity.kind)).toEqual(
        expect.arrayContaining(kinds),
      );
      expect(
        graph.entities
          .filter((entity) => entity.resolution === "inferred")
          .every((entity) => entity.provenance.analyzer === "heuristic"),
      ).toBe(true);
    },
  );
});
