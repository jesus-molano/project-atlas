import { scanProject } from "@component-atlas/runtime";
import {
  assertLocalSession,
  assertSameOrigin,
} from "../../utils/local-session";
import {
  rememberRecentProject,
  setActiveProjectRoot,
  validateProjectRoot,
} from "../../utils/project";

interface ActivateProjectBody {
  rootPath?: string;
}

export default defineEventHandler(async (event) => {
  assertSameOrigin(event);
  assertLocalSession(event);
  const body = await readBody<ActivateProjectBody>(event);
  const rootPath = await validateProjectRoot(body?.rootPath ?? "");
  const graph = await scanProject(rootPath);
  setActiveProjectRoot(rootPath);
  await rememberRecentProject(rootPath);
  return {
    rootPath,
    name: graph.project.name,
    projectId: graph.project.id,
    checkoutId: graph.project.identity?.checkoutId,
    scannedAt: graph.project.scannedAt,
  };
});
