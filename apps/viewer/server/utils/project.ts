import { projectId } from "@component-atlas/core/naming";
import type { ProjectAtlasSnapshot } from "@component-atlas/runtime";
import { AtlasStore } from "@component-atlas/store";
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
  const id = projectId(rootPath);
  const store = new AtlasStore(id);
  try {
    const graph = store.loadGraph(id);
    if (!graph) {
      throw createError({
        statusCode: 404,
        statusMessage: "No index found. Run project-atlas scan first.",
      });
    }
    return {
      graph,
      designIndexes: store.listDesignIndexes(id),
      memoryItems: store.listMemoryItems(id),
      memoryProposals: store.listMemoryProposals(id),
    };
  } finally {
    store.close();
  }
}
