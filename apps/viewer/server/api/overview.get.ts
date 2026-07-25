import { buildProjectOverviewViewModel } from "@component-atlas/runtime";
import { loadProjectAtlasSnapshot } from "../utils/project";

export default defineEventHandler(() =>
  buildProjectOverviewViewModel(loadProjectAtlasSnapshot()),
);
