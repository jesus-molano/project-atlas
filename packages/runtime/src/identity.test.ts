import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GRAPH_SCHEMA_VERSION, projectId } from "@component-atlas/core";
import { AtlasStore, databaseExists } from "@component-atlas/store";
import {
  normalizeRepositoryRemote,
  resolveProjectIdentity,
} from "./identity.js";
import { loadProjectGraph, scanProject } from "./index.js";

const temporary: string[] = [];

async function repository(name: string, remote?: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), `atlas-${name}-`));
  temporary.push(root);
  await mkdir(path.join(root, "components"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name, dependencies: { vue: "^3.0.0" } }),
  );
  await writeFile(
    path.join(root, "components", "StatusCard.vue"),
    "<script setup lang=\"ts\">defineProps<{ label: string }>()</script><template><div>{{ label }}</div></template>",
  );
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "atlas@example.test"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Atlas Test"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-qm", "fixture"]);
  if (remote) {
    execFileSync("git", ["-C", root, "remote", "add", "origin", remote]);
  }
  return root;
}

afterEach(async () => {
  delete process.env.COMPONENT_ATLAS_HOME;
  await Promise.all(
    temporary.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("stable project identity", () => {
  it("normalizes equivalent HTTPS and SSH remotes", () => {
    expect(
      normalizeRepositoryRemote("git@github.com:Example/Project.git"),
    ).toBe("github.com/example/project");
    expect(
      normalizeRepositoryRemote("https://github.com/example/project.git"),
    ).toBe("github.com/example/project");
    expect(
      normalizeRepositoryRemote("ssh://git@github.com/Example/Project.git"),
    ).toBe("github.com/example/project");
  });

  it("shares logical identity across worktrees but keeps checkout graphs separate", async () => {
    const root = await repository(
      "shared-project",
      "git@github.com:example/shared-project.git",
    );
    const worktree = `${root}-worktree`;
    temporary.push(worktree);
    execFileSync("git", [
      "-C",
      root,
      "worktree",
      "add",
      "-q",
      "-b",
      "feature",
      worktree,
    ]);
    const first = await resolveProjectIdentity(root);
    const second = await resolveProjectIdentity(worktree);
    expect(second.logicalId).toBe(first.logicalId);
    expect(second.checkoutId).not.toBe(first.checkoutId);

    const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-data-"));
    temporary.push(dataHome);
    process.env.COMPONENT_ATLAS_HOME = dataHome;
    const primaryGraph = await scanProject(root, { writeArtifacts: false });
    await writeFile(
      path.join(worktree, "components", "StatusCard.vue"),
      "<script setup lang=\"ts\">defineProps<{ label: string; tone?: string }>()</script><template><div>{{ label }}</div></template>",
    );
    const worktreeGraph = await scanProject(worktree, { writeArtifacts: false });
    expect(primaryGraph.project.id).toBe(worktreeGraph.project.id);
    expect(worktreeGraph.components[0]?.props.map((prop) => prop.name)).toContain(
      "tone",
    );
    const reloadedPrimary = await loadProjectGraph(root, {
      scanIfMissing: false,
    });
    expect(reloadedPrimary.components[0]?.props.map((prop) => prop.name)).not.toContain(
      "tone",
    );
  }, 15_000);

  it("separates same-name repositories and changes scope when the remote changes", async () => {
    const left = await repository(
      "same-name",
      "https://github.com/example/left.git",
    );
    const right = await repository(
      "same-name",
      "https://github.com/example/right.git",
    );
    const leftIdentity = await resolveProjectIdentity(left);
    const rightIdentity = await resolveProjectIdentity(right);
    expect(leftIdentity.logicalId).not.toBe(rightIdentity.logicalId);

    execFileSync("git", [
      "-C",
      left,
      "remote",
      "set-url",
      "origin",
      "https://github.com/example/reassigned.git",
    ]);
    const reassigned = await resolveProjectIdentity(left, { fresh: true });
    expect(reassigned.logicalId).not.toBe(leftIdentity.logicalId);
  }, 15_000);

  it("uses the common Git directory without a remote and supports an override", async () => {
    const root = await repository("local-only");
    const local = await resolveProjectIdentity(root);
    expect(local.source).toBe("git-common-dir");
    const overridden = await resolveProjectIdentity(root, {
      projectKey: "team/catalogue",
    });
    expect(overridden.source).toBe("override");
    expect(overridden.logicalId).not.toBe(local.logicalId);
  }, 15_000);

  it("copies a matching legacy path scope without deleting the recovery database", async () => {
    const root = await repository(
      "legacy-project",
      "https://github.com/example/legacy-project.git",
    );
    const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-data-"));
    temporary.push(dataHome);
    process.env.COMPONENT_ATLAS_HOME = dataHome;
    const legacyId = projectId(root);
    const legacy = new AtlasStore(legacyId);
    const now = new Date().toISOString();
    try {
      legacy.replaceGraph({
        schemaVersion: GRAPH_SCHEMA_VERSION,
        project: {
          id: legacyId,
          name: "legacy-project",
          rootPath: root,
          framework: "vue",
          scannedAt: now,
          sourceFiles: 0,
        },
        components: [],
        edges: [],
        tokens: [],
      });
      legacy.saveMemoryItem(legacyId, {
        schemaVersion: 1,
        id: "decision:legacy-fixture",
        projectId: legacyId,
        checkoutId: "legacy-path-checkout",
        namespace: "project",
        type: "decision",
        title: "Keep the stable public API",
        summary: "Generic migration fixture.",
        status: "active",
        confidence: 1,
        authority: "decided",
        scope: "local",
        createdAt: now,
        updatedAt: now,
        tags: [],
        provenance: { kind: "import" },
        supersedes: [],
        relations: [],
      });
    } finally {
      legacy.close();
    }

    const graph = await scanProject(root, { writeArtifacts: false });
    expect(graph.project.id).not.toBe(legacyId);
    const migrated = new AtlasStore(graph.project.id);
    try {
      expect(
        migrated.listMemoryItems(
          graph.project.id,
          graph.project.identity?.checkoutId,
        ),
      ).toEqual([
        expect.objectContaining({
          id: "decision:legacy-fixture",
          projectId: graph.project.id,
          checkoutId: graph.project.identity?.checkoutId,
        }),
      ]);
    } finally {
      migrated.close();
    }
    expect(databaseExists(legacyId)).toBe(true);
  }, 15_000);
});
