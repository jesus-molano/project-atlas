import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  recordDecision,
  scanProject,
} from "../packages/runtime/src/index.js";
import { loadProjectAtlasSnapshot } from "../apps/viewer/server/utils/project.js";

const fixtureRoot = fileURLToPath(
  new URL("../fixtures/vue-nuxt", import.meta.url),
);

describe.sequential("viewer snapshot consistency", () => {
  let rootPath: string;
  let dataHome: string;
  let previousDataHome: string | undefined;
  let previousRoot: string | undefined;

  beforeEach(async () => {
    rootPath = await mkdtemp(path.join(os.tmpdir(), "project-atlas-viewer-"));
    dataHome = await mkdtemp(path.join(os.tmpdir(), "project-atlas-data-"));
    previousDataHome = process.env.COMPONENT_ATLAS_HOME;
    process.env.COMPONENT_ATLAS_HOME = dataHome;
    await cp(fixtureRoot, rootPath, { recursive: true });
    previousRoot = process.env.ATLAS_PROJECT_ROOT;
    process.env.ATLAS_PROJECT_ROOT = rootPath;
  });

  afterEach(async () => {
    if (previousRoot === undefined) delete process.env.ATLAS_PROJECT_ROOT;
    else process.env.ATLAS_PROJECT_ROOT = previousRoot;
    if (previousDataHome === undefined) delete process.env.COMPONENT_ATLAS_HOME;
    else process.env.COMPONENT_ATLAS_HOME = previousDataHome;
    await Promise.all([
      rm(rootPath, { recursive: true, force: true }),
      rm(dataHome, { recursive: true, force: true }),
    ]);
  });

  it("publishes one atomic revision after scan, decision, and rescan", async () => {
    await scanProject(rootPath);
    const first = loadProjectAtlasSnapshot();
    expect(first.graph.components.length).toBeGreaterThan(0);
    expect(first.componentDecisions).toHaveLength(0);

    const decision = await recordDecision({
      rootPath,
      intent: "Extend the existing settings form",
      decision: "extend",
      selectedComponentIds: [first.graph.components[0]!.id],
      rationale: "The existing API and ownership boundary match.",
    });
    const withDecision = loadProjectAtlasSnapshot();
    expect(withDecision.fingerprint).not.toBe(first.fingerprint);
    expect(withDecision.componentDecisions.map((item) => item.id)).toContain(
      decision.id,
    );

    await scanProject(rootPath);
    const rescanned = loadProjectAtlasSnapshot();
    expect(rescanned.graph.components).toHaveLength(
      withDecision.graph.components.length,
    );
    expect(rescanned.graph.edges).toHaveLength(withDecision.graph.edges.length);
    expect(rescanned.componentDecisions).toHaveLength(1);
    expect(rescanned.fingerprint).not.toBe(withDecision.fingerprint);
  });
});
