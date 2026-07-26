import type { ProjectAtlasSnapshot } from "@component-atlas/runtime";
import { AtlasStore } from "@component-atlas/store";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function projectRootPath(): string {
  const rootPath = process.env.ATLAS_PROJECT_ROOT;
  if (!rootPath) {
    throw createError({
      statusCode: 503,
      statusMessage:
        "ATLAS_PROJECT_ROOT is missing. Launch Project Atlas with the CLI open command.",
    });
  }
  return rootPath;
}

export function projectAtlasCliEntry(): string {
  return process.env.ATLAS_CLI_ENTRY
    ? path.resolve(process.env.ATLAS_CLI_ENTRY)
    : path.resolve(process.cwd(), "packages", "cli", "dist", "index.js");
}

export function loadProjectAtlasSnapshot(): ProjectAtlasSnapshot {
  const rootPath = projectRootPath();
  let artifact:
    | {
        project?: {
          id?: string;
          rootPath?: string;
          identity?: { checkoutId?: string };
        };
      }
    | undefined;
  const artifactPath = path.join(rootPath, ".component-atlas", "project.json");
  if (existsSync(artifactPath)) {
    try {
      artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as typeof artifact;
    } catch {
      artifact = undefined;
    }
  }
  const artifactMatches =
    artifact?.project?.rootPath &&
    path.resolve(artifact.project.rootPath).toLowerCase() ===
      path.resolve(rootPath).toLowerCase();
  const id =
    process.env.ATLAS_PROJECT_ID ??
    (artifactMatches ? artifact?.project?.id : undefined) ??
    createHash("sha256")
      .update(path.resolve(rootPath).toLowerCase())
      .digest("hex")
      .slice(0, 20);
  const checkoutId =
    process.env.ATLAS_CHECKOUT_ID ??
    (artifactMatches ? artifact?.project?.identity?.checkoutId : undefined);
  const store = new AtlasStore(id);
  try {
    const stored = store.readProjectSnapshot(id, checkoutId);
    const graph = stored.graph;
    if (!graph) {
      throw createError({
        statusCode: 404,
        statusMessage: "No index found. Run project-atlas scan first.",
      });
    }
    const capturedAt = new Date().toISOString();
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          project: [graph.project.id, graph.project.scannedAt],
          graph: [graph.components.length, graph.edges.length, graph.tokens.length],
          design: stored.designIndexes.map((index) => [
            index.file.key,
            index.indexedAt,
            index.nodes.length,
          ]),
          memory: stored.memoryItems.map((item) => [item.id, item.updatedAt, item.status]),
          proposals: stored.memoryProposals.map((item) => [
            item.id,
            item.createdAt,
            item.status,
          ]),
          decisions: stored.componentDecisions.map((item) => [
            item.id,
            item.createdAt,
          ]),
        }),
      )
      .digest("hex")
      .slice(0, 16);
    return {
      fingerprint,
      capturedAt,
      graph,
      designIndexes: stored.designIndexes,
      memoryItems: stored.memoryItems,
      memoryProposals: stored.memoryProposals,
      componentDecisions: stored.componentDecisions,
    };
  } finally {
    store.close();
  }
}
