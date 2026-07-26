import { getProjectCapabilities, listAgentRunAudits } from "@component-atlas/runtime";
import {
  buildActionCenterSnapshot,
  listActionResolutionsForSnapshot,
} from "../../utils/action-center";
import { loadProjectAtlasSnapshot } from "../../utils/project";

export default defineEventHandler(async () => {
  const snapshot = loadProjectAtlasSnapshot();
  const [capabilities, runs] = await Promise.all([
    getProjectCapabilities(snapshot.graph.project.rootPath),
    listAgentRunAudits(snapshot.graph.project.rootPath, 50),
  ]);
  return buildActionCenterSnapshot(
    snapshot,
    capabilities,
    runs,
    listActionResolutionsForSnapshot(snapshot),
  );
});
