import type { ActionCenterMutation } from "@component-atlas/core";
import { getProjectCapabilities, listAgentRunAudits } from "@component-atlas/runtime";
import {
  buildActionCenterSnapshot,
  executeActionMutation,
  listActionResolutionsForSnapshot,
} from "../../utils/action-center";
import { assertAgentSession } from "../../utils/agent-session";
import { loadProjectAtlasSnapshot } from "../../utils/project";

export default defineEventHandler(async (event) => {
  assertAgentSession(event);
  const body = await readBody<ActionCenterMutation>(event);
  if (!body) {
    throw createError({
      statusCode: 400,
      statusMessage: "An Action Center mutation is required.",
    });
  }
  const snapshot = loadProjectAtlasSnapshot();
  const [capabilities, runs] = await Promise.all([
    getProjectCapabilities(snapshot.graph.project.rootPath),
    listAgentRunAudits(snapshot.graph.project.rootPath, 50),
  ]);
  const center = buildActionCenterSnapshot(
    snapshot,
    capabilities,
    runs,
    listActionResolutionsForSnapshot(snapshot),
  );
  return executeActionMutation(center, body);
});
