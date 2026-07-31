import type { ActionCenterMutation } from "@component-atlas/core";
import { getProjectCapabilities } from "@component-atlas/runtime";
import {
  buildActionCenterSnapshot,
  executeActionMutation,
  listActionResolutionsForSnapshot,
} from "../../utils/action-center";
import { assertLocalSession } from "../../utils/local-session";
import { loadProjectAtlasSnapshot } from "../../utils/project";

export default defineEventHandler(async (event) => {
  assertLocalSession(event);
  const body = await readBody<ActionCenterMutation>(event);
  if (!body) {
    throw createError({
      statusCode: 400,
      statusMessage: "An Action Center mutation is required.",
    });
  }
  const snapshot = loadProjectAtlasSnapshot();
  const capabilities = await getProjectCapabilities(
    snapshot.graph.project.rootPath,
  );
  const center = buildActionCenterSnapshot(
    snapshot,
    capabilities,
    listActionResolutionsForSnapshot(snapshot),
  );
  return executeActionMutation(center, body);
});
