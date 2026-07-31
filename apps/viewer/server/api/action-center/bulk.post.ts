import type { ActionCenterMutation } from "@component-atlas/core";
import { getProjectCapabilities } from "@component-atlas/runtime";
import {
  buildActionCenterSnapshot,
  executeBulkActionMutations,
  listActionResolutionsForSnapshot,
} from "../../utils/action-center";
import { assertLocalSession } from "../../utils/local-session";
import { loadProjectAtlasSnapshot } from "../../utils/project";

interface BulkBody {
  mutations?: ActionCenterMutation[];
}

export default defineEventHandler(async (event) => {
  assertLocalSession(event);
  const body = await readBody<BulkBody>(event);
  const mutations = body?.mutations ?? [];
  const snapshot = loadProjectAtlasSnapshot();
  const capabilities = await getProjectCapabilities(
    snapshot.graph.project.rootPath,
  );
  const center = buildActionCenterSnapshot(
    snapshot,
    capabilities,
    listActionResolutionsForSnapshot(snapshot),
  );
  return { results: executeBulkActionMutations(center, mutations) };
});
