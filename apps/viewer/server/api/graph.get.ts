import { projectId } from "@component-atlas/core/naming";
import { AtlasStore } from "@component-atlas/store";

export default defineEventHandler(async () => {
  const rootPath = process.env.ATLAS_PROJECT_ROOT;
  if (!rootPath) {
    throw createError({
      statusCode: 503,
      statusMessage:
        "ATLAS_PROJECT_ROOT is missing. Launch the viewer with component-atlas open.",
    });
  }
  const id = projectId(rootPath);
  const store = new AtlasStore(id);
  try {
    const graph = store.loadGraph(id);
    if (!graph) {
      throw createError({
        statusCode: 404,
        statusMessage: "No index found. Run component-atlas scan first.",
      });
    }
    return graph;
  } finally {
    store.close();
  }
});
