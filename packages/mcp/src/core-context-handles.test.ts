import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanProject } from "@component-atlas/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { copyFixture } from "../../../scripts/test-fixture-copy.mjs";
import { expandEntityContext } from "./core-context-handles.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("core semantic entity handles", () => {
  it("expands one typed entity and returns only typed neighboring handles", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-entity-handle-"));
    roots.push(root);
    await copyFixture(
      fileURLToPath(new URL("../../../fixtures/vue-nuxt", import.meta.url)),
      root,
    );
    await mkdir(path.join(root, "app", "composables"), { recursive: true });
    await mkdir(path.join(root, "app", "services"), { recursive: true });
    await writeFile(
      path.join(root, "app", "composables", "useBilling.ts"),
      "export function useBilling() { return { ready: true }; }\n",
    );
    await writeFile(
      path.join(root, "app", "services", "billing.ts"),
      [
        "import { useBilling } from \"../composables/useBilling\";",
        "export function loadBilling() { return useBilling(); }",
        "",
      ].join("\n"),
    );
    const graph = await scanProject(root, { writeArtifacts: false });
    const entity = graph.entities.find(
      (candidate) =>
        candidate.kind === "composable" &&
        candidate.name === "useBilling" &&
        graph.edges.some((edge) => {
          if (edge.source !== candidate.id && edge.target !== candidate.id) {
            return false;
          }
          const neighborId =
            edge.source === candidate.id ? edge.target : edge.source;
          return (
            graph.entities.some((neighbor) => neighbor.id === neighborId) ||
            graph.components.some((neighbor) => neighbor.id === neighborId)
          );
        }),
    );
    if (!entity) throw new Error("Fixture has no related frontend entity.");
    const expanded = await expandEntityContext(root, entity.id, 2_000);
    expect(expanded).toMatchObject({
      entity: { id: entity.id, handle: `entity:${entity.id}` },
      relations: expect.any(Array),
    });
    expect(expanded.metrics.expandableIds.length).toBeGreaterThan(0);
    expect(
      expanded.metrics.expandableIds.every((handle) =>
        /^(?:code|entity):/u.test(handle),
      ),
    ).toBe(true);
  });
});
