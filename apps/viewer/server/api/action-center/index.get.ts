import { getProjectCapabilities } from "@component-atlas/runtime";
import {
  buildActionCenterSnapshot,
  listActionResolutionsForSnapshot,
} from "../../utils/action-center";
import { loadProjectAtlasSnapshot } from "../../utils/project";

export default defineEventHandler(async () => {
  const snapshot = loadProjectAtlasSnapshot();
  const capabilities = await getProjectCapabilities(
    snapshot.graph.project.rootPath,
  );
  return buildActionCenterSnapshot(
    snapshot,
    capabilities,
    listActionResolutionsForSnapshot(snapshot),
  );
});
