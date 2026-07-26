import { scanProject } from "@component-atlas/runtime";
import { createError } from "h3";
import { hasActiveAgentRun } from "../../utils/agent-runs";
import {
  assertAgentSession,
  assertSameOrigin,
} from "../../utils/agent-session";
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
  assertAgentSession(event);
  if (hasActiveAgentRun()) {
    throw createError({
      statusCode: 409,
      statusMessage:
        "Finish or cancel the active Codex run before changing projects.",
    });
  }
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
