import { projectId } from "@component-atlas/core/naming";
import { AtlasStore } from "@component-atlas/store";

export default defineEventHandler((event) => {
  const rootPath = process.env.ATLAS_PROJECT_ROOT;
  if (!rootPath) {
    throw createError({
      statusCode: 503,
      statusMessage: "ATLAS_PROJECT_ROOT is missing.",
    });
  }
  const query = getQuery(event);
  const id = projectId(rootPath);
  const store = new AtlasStore(id);
  try {
    return store.listScenarios(
      id,
      typeof query.component === "string" ? query.component : undefined,
    );
  } finally {
    store.close();
  }
});
