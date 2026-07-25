import { buildProjectSearchViewModel } from "@component-atlas/runtime";
import { loadProjectAtlasSnapshot } from "../utils/project";

export default defineEventHandler((event) => {
  const query = getQuery(event);
  const value = Array.isArray(query.q) ? query.q[0] : query.q;
  const search = typeof value === "string" ? value : "";
  return buildProjectSearchViewModel(loadProjectAtlasSnapshot(), search, 5);
});
