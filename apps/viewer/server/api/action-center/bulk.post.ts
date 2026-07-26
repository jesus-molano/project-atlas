import type { ActionCenterMutation } from "@component-atlas/core";
import { getProjectCapabilities, listAgentRunAudits } from "@component-atlas/runtime";
import {
  buildActionCenterSnapshot,
  executeBulkActionMutations,
  listActionResolutionsForSnapshot,
} from "../../utils/action-center";
import { assertAgentSession } from "../../utils/agent-session";
import { loadProjectAtlasSnapshot } from "../../utils/project";

interface BulkBody {
  mutations?: ActionCenterMutation[];
}

export default defineEventHandler(async (event) => {
  assertAgentSession(event);
  const body = await readBody<BulkBody>(event);
  const mutations = body?.mutations ?? [];
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
  return { results: executeBulkActionMutations(center, mutations) };
});
