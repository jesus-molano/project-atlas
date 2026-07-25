import { loadProjectAtlasSnapshot } from "../utils/project";

export default defineEventHandler(() => loadProjectAtlasSnapshot().graph);
